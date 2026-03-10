import { contextBridge, ipcRenderer } from "electron";

import type { JournalAppApi } from "../shared/api";
import type { ExportFormat } from "../shared/types";

// Sandboxed preloads cannot rely on local CommonJS requires, so channel names live inline here.
const IPC_CHANNELS = {
  JOURNAL_LIST_PAGES: "journal:list-pages",
  JOURNAL_SEARCH_PAGES: "journal:search-pages",
  JOURNAL_CREATE_PAGE: "journal:create-page",
  JOURNAL_GET_PAGE: "journal:get-page",
  JOURNAL_UPDATE_PAGE_CONTENT: "journal:update-page-content",
  JOURNAL_RENAME_PAGE: "journal:rename-page",
  JOURNAL_MOVE_PAGE_TO_TRASH: "journal:move-page-to-trash",
  JOURNAL_RESTORE_PAGE_FROM_TRASH: "journal:restore-page-from-trash",
  JOURNAL_DELETE_PAGE_PERMANENTLY: "journal:delete-page-permanently",
  JOURNAL_EMPTY_TRASH: "journal:empty-trash",
  JOURNAL_SET_PAGE_PINNED: "journal:set-page-pinned",
  JOURNAL_SET_PAGE_TAGS: "journal:set-page-tags",
  JOURNAL_SET_PAGE_FOLDER: "journal:set-page-folder",
  JOURNAL_LIST_FOLDERS: "journal:list-folders",
  JOURNAL_CREATE_FOLDER: "journal:create-folder",
  JOURNAL_DELETE_FOLDER: "journal:delete-folder",
  JOURNAL_GET_SETTINGS: "journal:get-settings",
  JOURNAL_UPDATE_SETTINGS: "journal:update-settings",
  JOURNAL_IMPORT_FONTS: "journal:import-fonts",
  JOURNAL_REMOVE_IMPORTED_FONT: "journal:remove-imported-font",
  JOURNAL_LIST_IMPORTED_FONT_ASSETS: "journal:list-imported-font-assets",
  JOURNAL_GET_SECURITY_STATE: "journal:get-security-state",
  JOURNAL_ENABLE_PIN: "journal:enable-pin",
  JOURNAL_UNLOCK: "journal:unlock",
  JOURNAL_CHANGE_PIN: "journal:change-pin",
  JOURNAL_DISABLE_PIN: "journal:disable-pin",
  JOURNAL_LOCK: "journal:lock",
  JOURNAL_RESET_ENCRYPTED_DATA: "journal:reset-encrypted-data",
  JOURNAL_LIST_PAGE_HISTORY: "journal:list-page-history",
  JOURNAL_RESTORE_PAGE_HISTORY: "journal:restore-page-history",
  JOURNAL_DELETE_PAGE_HISTORY: "journal:delete-page-history",
  JOURNAL_CLEAR_PAGE_HISTORY: "journal:clear-page-history",
  JOURNAL_CLEAR_ALL_HISTORY: "journal:clear-all-history",
  JOURNAL_CREATE_BACKUP: "journal:create-backup",
  JOURNAL_LIST_BACKUPS: "journal:list-backups",
  JOURNAL_RESTORE_BACKUP: "journal:restore-backup",
  JOURNAL_LIST_ON_THIS_DAY_MEMORIES: "journal:list-on-this-day-memories",
  JOURNAL_GENERATE_REVIEW: "journal:generate-review",
  JOURNAL_EXPORT_DATA: "journal:export-data",
  JOURNAL_IMPORT_DATA: "journal:import-data",
  JOURNAL_GET_LAST_OPENED_PAGE_ID: "journal:get-last-opened-page-id",
  JOURNAL_SET_LAST_OPENED_PAGE_ID: "journal:set-last-opened-page-id",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "window:toggle-maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  WINDOW_STATE_CHANGED: "window:state-changed",
  WINDOW_OPEN_EXTERNAL_LINK: "window:open-external-link"
} as const;

const journalAppApi: JournalAppApi = {
  journal: {
    listPages: (includeTrashed?: boolean, sortMode?: "recent" | "created" | "alphabetical") =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_LIST_PAGES, includeTrashed, sortMode),
    searchPages: (filters) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_SEARCH_PAGES, filters),
    createPage: (folderId?: string | null) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_CREATE_PAGE, folderId),
    getPage: (pageId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_GET_PAGE, pageId),
    updatePageContent: (pageId: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_UPDATE_PAGE_CONTENT, pageId, content),
    renamePage: (pageId: string, title: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_RENAME_PAGE, pageId, title),
    movePageToTrash: (pageId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_MOVE_PAGE_TO_TRASH, pageId),
    restorePageFromTrash: (pageId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_RESTORE_PAGE_FROM_TRASH, pageId),
    deletePagePermanently: (pageId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_DELETE_PAGE_PERMANENTLY, pageId),
    emptyTrash: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_EMPTY_TRASH),
    setPagePinned: (pageId: string, pinned: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_SET_PAGE_PINNED, pageId, pinned),
    setPageTags: (pageId: string, tags: string[]) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_SET_PAGE_TAGS, pageId, tags),
    setPageFolder: (pageId: string, folderId: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_SET_PAGE_FOLDER, pageId, folderId),
    listFolders: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_LIST_FOLDERS),
    createFolder: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_CREATE_FOLDER, name),
    deleteFolder: (folderId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_DELETE_FOLDER, folderId),
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_GET_SETTINGS),
    updateSettings: (partial) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_UPDATE_SETTINGS, partial),
    importFonts: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_IMPORT_FONTS),
    removeImportedFont: (fontId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_REMOVE_IMPORTED_FONT, fontId),
    listImportedFontAssets: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_LIST_IMPORTED_FONT_ASSETS),
    getSecurityState: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_GET_SECURITY_STATE),
    enablePin: (newPin: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_ENABLE_PIN, newPin),
    unlock: (pin: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_UNLOCK, pin),
    changePin: (currentPin: string, newPin: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_CHANGE_PIN, currentPin, newPin),
    disablePin: (pin: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_DISABLE_PIN, pin),
    lock: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_LOCK),
    resetEncryptedData: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_RESET_ENCRYPTED_DATA),
    listPageHistory: (pageId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_LIST_PAGE_HISTORY, pageId),
    restorePageHistory: (pageId: string, historyId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_RESTORE_PAGE_HISTORY, pageId, historyId),
    deletePageHistory: (pageId: string, historyId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_DELETE_PAGE_HISTORY, pageId, historyId),
    clearPageHistory: (pageId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_CLEAR_PAGE_HISTORY, pageId),
    clearAllHistory: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_CLEAR_ALL_HISTORY),
    createBackup: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_CREATE_BACKUP),
    listBackups: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_LIST_BACKUPS),
    restoreBackup: (backupId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_RESTORE_BACKUP, backupId),
    listOnThisDayMemories: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_LIST_ON_THIS_DAY_MEMORIES),
    generateReview: (period: "month" | "year", year: number, month?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_GENERATE_REVIEW, period, year, month),
    exportData: (format: ExportFormat, encryptedZipKey?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_EXPORT_DATA, format, encryptedZipKey),
    importData: (encryptedZipKey?: string) => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_IMPORT_DATA, encryptedZipKey),
    getLastOpenedPageId: () => ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_GET_LAST_OPENED_PAGE_ID),
    setLastOpenedPageId: (pageId: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.JOURNAL_SET_LAST_OPENED_PAGE_ID, pageId)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
    onStateChanged: (listener) => {
      const handleStateChanged = (_event: Electron.IpcRendererEvent, state: Awaited<ReturnType<JournalAppApi["window"]["isMaximized"]>>) => {
        listener(state);
      };
      ipcRenderer.on(IPC_CHANNELS.WINDOW_STATE_CHANGED, handleStateChanged);
      return () => {
        ipcRenderer.off(IPC_CHANNELS.WINDOW_STATE_CHANGED, handleStateChanged);
      };
    },
    openExternalLink: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_EXTERNAL_LINK, url)
  }
};

contextBridge.exposeInMainWorld("journalApp", journalAppApi);
