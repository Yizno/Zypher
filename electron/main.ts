import { existsSync } from "node:fs";
import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";

import { getImportedFontExtensions } from "../shared/fonts";
import { IPC_CHANNELS } from "../shared/ipc";
import { normalizeExternalUrl } from "../shared/links";
import type { ExportFormat, WindowMaximizeState } from "../shared/types";
import { JournalStore } from "./journalStore";

const DEV_SERVER_URL = "http://localhost:5173";
const APP_USER_MODEL_ID = "com.zypher.app";
const USER_DATA_DIR = "Zypher";
const DEV_USER_DATA_DIR = `${USER_DATA_DIR} (dev)`;
const LEGACY_USER_DATA_DIR = "journaling";

function resolveUserDataPath(): string {
  const appDataPath = app.getPath("appData");
  if (!app.isPackaged) {
    return path.join(appDataPath, DEV_USER_DATA_DIR);
  }

  const preferredPath = path.join(appDataPath, USER_DATA_DIR);
  const legacyPath = path.join(appDataPath, LEGACY_USER_DATA_DIR);
  // Keep existing installs on the legacy path until they migrate naturally.
  if (existsSync(preferredPath) || !existsSync(legacyPath)) {
    return preferredPath;
  }

  return legacyPath;
}

app.setPath("userData", resolveUserDataPath());
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow: BrowserWindow | null = null;
let store: JournalStore;
let htmlFullScreenWindows = new WeakMap<BrowserWindow, boolean>();

function getWindowState(window: BrowserWindow): WindowMaximizeState {
  return {
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
    isHtmlFullScreen: htmlFullScreenWindows.get(window) ?? false
  };
}

function sendWindowState(window: BrowserWindow): void {
  window.webContents.send(IPC_CHANNELS.WINDOW_STATE_CHANGED, getWindowState(window));
}

function exitHtmlFullScreen(window: BrowserWindow): void {
  htmlFullScreenWindows.set(window, false);
  void window.webContents.executeJavaScript(
    "if (document.fullscreenElement) { void document.exitFullscreen(); }",
    true
  );
}

function toggleWindowFullScreen(window: BrowserWindow): WindowMaximizeState {
  const state = getWindowState(window);
  if (state.isHtmlFullScreen) {
    exitHtmlFullScreen(window);
    sendWindowState(window);
    return getWindowState(window);
  }

  if (state.isFullScreen) {
    window.setFullScreen(false);
    return getWindowState(window);
  }

  if (state.isMaximized) {
    window.unmaximize();
    return getWindowState(window);
  }

  window.maximize();
  return getWindowState(window);
}

function registerWindowStateEvents(window: BrowserWindow): void {
  const syncWindowState = () => sendWindowState(window);

  htmlFullScreenWindows.set(window, false);
  window.on("maximize", syncWindowState);
  window.on("unmaximize", syncWindowState);
  window.on("minimize", syncWindowState);
  window.on("enter-full-screen", syncWindowState);
  window.on("leave-full-screen", syncWindowState);
  window.on("restore", syncWindowState);
  window.on("enter-html-full-screen", () => {
    htmlFullScreenWindows.set(window, true);
    syncWindowState();
  });
  window.on("leave-html-full-screen", () => {
    htmlFullScreenWindows.set(window, false);
    syncWindowState();
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11" && !input.isAutoRepeat) {
      event.preventDefault();
      toggleWindowFullScreen(window);
    }
  });
}

function getExportExtension(format: ExportFormat): string {
  switch (format) {
    case "json":
    case "json-encrypted":
      return "json";
    case "encrypted-zip":
      return "zip";
    case "html":
      return "html";
    case "txt":
      return "txt";
    case "md":
      return "md";
  }
}

function getExportFilterName(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "JSON files";
    case "json-encrypted":
      return "Encrypted JSON files";
    case "encrypted-zip":
      return "Encrypted ZIP backups";
    case "html":
      return "HTML files";
    case "txt":
      return "Text files";
    case "md":
      return "Markdown files";
  }
}

function getWindowFromEvent(sender: Electron.WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window) {
    throw new Error("No window available for this action.");
  }

  return window;
}

function createMainWindow(): void {
  const preloadPath = path.join(__dirname, "preload.js");
  const iconFilename = process.platform === "win32" ? "icon.ico" : "icon.png";
  const iconPath = path.join(app.getAppPath(), "assets", iconFilename);
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    title: "Zypher",
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#1E1F22",
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.setMenuBarVisibility(false);
  registerWindowStateEvents(mainWindow);

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  } else {
    void mainWindow.loadURL(DEV_SERVER_URL);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.JOURNAL_LIST_PAGES,
    async (_event, includeTrashed?: boolean, sortMode?: "recent" | "created" | "alphabetical") =>
      store.listPages(Boolean(includeTrashed), sortMode ?? "recent")
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_SEARCH_PAGES, async (_event, filters) => store.searchPages(filters));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_CREATE_PAGE, async (_event, folderId?: string | null) => store.createPage(folderId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_GET_PAGE, async (_event, pageId: string) => store.getPage(pageId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_UPDATE_PAGE_CONTENT, async (_event, pageId: string, content: string) =>
    store.updatePageContent(pageId, content)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_RENAME_PAGE, async (_event, pageId: string, title: string) =>
    store.renamePage(pageId, title)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_MOVE_PAGE_TO_TRASH, async (_event, pageId: string) => store.movePageToTrash(pageId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_RESTORE_PAGE_FROM_TRASH, async (_event, pageId: string) =>
    store.restorePageFromTrash(pageId)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_DELETE_PAGE_PERMANENTLY, async (_event, pageId: string) =>
    store.deletePagePermanently(pageId)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_EMPTY_TRASH, async () => store.emptyTrash());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_SET_PAGE_PINNED, async (_event, pageId: string, pinned: boolean) =>
    store.setPagePinned(pageId, pinned)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_SET_PAGE_TAGS, async (_event, pageId: string, tags: string[]) =>
    store.setPageTags(pageId, tags)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_SET_PAGE_FOLDER, async (_event, pageId: string, folderId: string | null) =>
    store.setPageFolder(pageId, folderId)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_LIST_FOLDERS, async () => store.listFolders());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_CREATE_FOLDER, async (_event, name: string) => store.createFolder(name));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_DELETE_FOLDER, async (_event, folderId: string) => store.deleteFolder(folderId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_GET_SETTINGS, async () => store.getSettings());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_UPDATE_SETTINGS, async (_event, partial) => store.updateSettings(partial));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_IMPORT_FONTS, async (event) => {
    const window = getWindowFromEvent(event.sender);
    const selected = await dialog.showOpenDialog(window, {
      title: "Import fonts",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Supported fonts", extensions: getImportedFontExtensions() },
        { name: "TrueType fonts", extensions: ["ttf"] },
        { name: "OpenType fonts", extensions: ["otf"] },
        { name: "WOFF fonts", extensions: ["woff", "woff2"] }
      ]
    });
    if (selected.canceled || selected.filePaths.length === 0) {
      return store.getSettings();
    }

    return store.importFonts(selected.filePaths);
  });
  ipcMain.handle(IPC_CHANNELS.JOURNAL_REMOVE_IMPORTED_FONT, async (_event, fontId: string) => store.removeImportedFont(fontId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_LIST_IMPORTED_FONT_ASSETS, async () => store.listImportedFontAssets());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_GET_SECURITY_STATE, async () => store.getSecurityState());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_ENABLE_PIN, async (_event, newPin: string) => store.enablePin(newPin));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_UNLOCK, async (_event, pin: string) => store.unlock(pin));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_CHANGE_PIN, async (_event, currentPin: string, newPin: string) =>
    store.changePin(currentPin, newPin)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_DISABLE_PIN, async (_event, pin: string) => store.disablePin(pin));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_LOCK, async () => store.lock());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_RESET_ENCRYPTED_DATA, async () => store.resetEncryptedData());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_LIST_PAGE_HISTORY, async (_event, pageId: string) => store.listPageHistory(pageId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_RESTORE_PAGE_HISTORY, async (_event, pageId: string, historyId: string) =>
    store.restorePageHistory(pageId, historyId)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_DELETE_PAGE_HISTORY, async (_event, pageId: string, historyId: string) =>
    store.deletePageHistory(pageId, historyId)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_CLEAR_PAGE_HISTORY, async (_event, pageId: string) => store.clearPageHistory(pageId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_CLEAR_ALL_HISTORY, async () => store.clearAllHistory());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_CREATE_BACKUP, async () => store.createBackup());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_LIST_BACKUPS, async () => store.listBackups());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_RESTORE_BACKUP, async (_event, backupId: string) => store.restoreBackup(backupId));
  ipcMain.handle(IPC_CHANNELS.JOURNAL_LIST_ON_THIS_DAY_MEMORIES, async () => store.listOnThisDayMemories());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_GENERATE_REVIEW, async (_event, period: "month" | "year", year: number, month?: number) =>
    store.generateReview(period, year, month)
  );
  ipcMain.handle(IPC_CHANNELS.JOURNAL_EXPORT_DATA, async (event, format: ExportFormat, encryptedZipKey?: string) => {
    const window = getWindowFromEvent(event.sender);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = getExportExtension(format);
    const selected = await dialog.showSaveDialog(window, {
      title: "Export journal data",
      defaultPath: `zypher-export-${timestamp}.${extension}`,
      filters: [{ name: getExportFilterName(format), extensions: [extension] }]
    });
    if (selected.canceled || !selected.filePath) {
      return null;
    }

    return store.exportData(format, selected.filePath, encryptedZipKey);
  });
  ipcMain.handle(IPC_CHANNELS.JOURNAL_IMPORT_DATA, async (event, encryptedZipKey?: string) => {
    const window = getWindowFromEvent(event.sender);
    const selected = await dialog.showOpenDialog(window, {
      title: "Import journal bundle",
      properties: ["openFile"],
      filters: [
        { name: "Supported imports", extensions: ["json", "zip"] },
        { name: "JSON files", extensions: ["json"] },
        { name: "Encrypted ZIP backups", extensions: ["zip"] }
      ]
    });
    if (selected.canceled || selected.filePaths.length === 0) {
      return;
    }

    await store.importData(selected.filePaths[0], encryptedZipKey);
  });
  ipcMain.handle(IPC_CHANNELS.JOURNAL_GET_LAST_OPENED_PAGE_ID, async () => store.getLastOpenedPageId());
  ipcMain.handle(IPC_CHANNELS.JOURNAL_SET_LAST_OPENED_PAGE_ID, async (_event, pageId: string | null) =>
    store.setLastOpenedPageId(pageId)
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    getWindowFromEvent(event.sender).minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, (event): WindowMaximizeState => {
    const window = getWindowFromEvent(event.sender);
    return toggleWindowFullScreen(window);
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    getWindowFromEvent(event.sender).close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event): WindowMaximizeState => {
    const window = getWindowFromEvent(event.sender);
    return getWindowState(window);
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_EXTERNAL_LINK, async (_event, url: string) => {
    const normalized = normalizeExternalUrl(url);
    if (!normalized) {
      throw new Error("Invalid external URL.");
    }

    await shell.openExternal(normalized);
  });
}

void app.whenReady().then(() => {
  store = new JournalStore(app.getPath("userData"));
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
