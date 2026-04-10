import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { JournalAppApi } from "../../shared/api";
import { derivePreview, UNTITLED_TITLE } from "../../shared/journalText";
import { sortPages } from "../../shared/pageMeta";
import type { ReviewTarget } from "../../shared/reviewWindows";
import { getLaunchReviewReminderTargets, matchesReviewTarget } from "../../shared/reviewWindows";
import type {
  AppSettings,
  BackupItem,
  ExportFormat,
  JournalFolder,
  JournalPageMeta,
  JournalUpdateResult,
  MemoryReplayItem,
  PageHistoryItem,
  SearchScope,
  SecurityState,
  SortMode,
  WindowMaximizeState
} from "../../shared/types";
import Editor from "./components/Editor";
import ConfirmDialog from "./components/ConfirmDialog";
import FolderNameDialog from "./components/FolderNameDialog";
import QuickSwitcher from "./components/QuickSwitcher";
import ResetDataDialog from "./components/ResetDataDialog";
import SettingsPanel from "./components/SettingsPanel";
import Sidebar from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import VersionHistoryPanel from "./components/VersionHistoryPanel";
import ZipKeyDialog from "./components/ZipKeyDialog";
import { syncImportedFontFaces } from "./utils/importedFonts";
import { selectAllInputText } from "./utils/inputSelection";

const SIDEBAR_BREAKPOINT = 900;
const MISSING_BRIDGE_MESSAGE = "Desktop API bridge failed to load. Restart the app to recover.";
const RESET_DATA_REQUIRED_PHRASE = "I want to completely reset all of my data.";
const RESET_DATA_WAIT_SECONDS = 180;

const DEFAULT_SETTINGS: AppSettings = {
  theme: "matte",
  accentColor: "#6d7e98",
  highContrast: false,
  defaultFont: "Segoe UI",
  importedFonts: [],
  fontSize: 16,
  lineHeight: 1.65,
  tabSize: 2,
  spellcheck: true,
  autosaveDelayMs: 500,
  historySnapshotsEnabled: true,
  idleLockMinutes: 10,
  selfDestructOnFailedPin: false,
  selfDestructPinFailureLimit: 15,
  allowResetFromLockScreen: true,
  openLastPageOnLaunch: true,
  sidebarOpenByDefault: true,
  launchPopupsEnabled: true,
  shortcuts: {
    newPage: "Ctrl+N",
    focusSearch: "Ctrl+F",
    quickSwitcher: "Ctrl+K",
    toggleSidebar: "Ctrl+B",
    openSettings: "Ctrl+,",
    lockApp: "Ctrl+Shift+L"
  }
};

function rejectBridge<T>(): Promise<T> {
  return Promise.reject(new Error(MISSING_BRIDGE_MESSAGE));
}

const fallbackApi: JournalAppApi = {
  journal: {
    listPages: () => rejectBridge(),
    searchPages: () => rejectBridge(),
    createPage: () => rejectBridge(),
    getPage: () => rejectBridge(),
    updatePageContent: () => rejectBridge(),
    renamePage: () => rejectBridge(),
    movePageToTrash: () => rejectBridge(),
    restorePageFromTrash: () => rejectBridge(),
    deletePagePermanently: () => rejectBridge(),
    emptyTrash: () => rejectBridge(),
    setPagePinned: () => rejectBridge(),
    setPageTags: () => rejectBridge(),
    setPageFolder: () => rejectBridge(),
    listFolders: () => rejectBridge(),
    createFolder: () => rejectBridge(),
    deleteFolder: () => rejectBridge(),
    getSettings: () => rejectBridge(),
    updateSettings: () => rejectBridge(),
    importFonts: () => rejectBridge(),
    removeImportedFont: () => rejectBridge(),
    listImportedFontAssets: () => rejectBridge(),
    getSecurityState: () => rejectBridge(),
    enablePin: () => rejectBridge(),
    unlock: () => rejectBridge(),
    changePin: () => rejectBridge(),
    disablePin: () => rejectBridge(),
    lock: () => rejectBridge(),
    resetEncryptedData: () => rejectBridge(),
    listPageHistory: () => rejectBridge(),
    getPageHistoryContent: () => rejectBridge(),
    restorePageHistory: () => rejectBridge(),
    renamePageHistory: () => rejectBridge(),
    duplicateFromHistory: () => rejectBridge(),
    deletePageHistory: () => rejectBridge(),
    deleteMultiplePageHistory: () => rejectBridge(),
    clearPageHistory: () => rejectBridge(),
    clearAllHistory: () => rejectBridge(),
    createBackup: () => rejectBridge(),
    listBackups: () => rejectBridge(),
    restoreBackup: () => rejectBridge(),
    listOnThisDayMemories: () => rejectBridge(),
    generateReview: () => rejectBridge(),
    exportData: (_format?: ExportFormat, _encryptedZipKey?: string) => rejectBridge(),
    importData: (_encryptedZipKey?: string) => rejectBridge(),
    getLastOpenedPageId: () => rejectBridge(),
    setLastOpenedPageId: () => rejectBridge()
  },
  window: {
    minimize: () => rejectBridge(),
    toggleMaximize: () => rejectBridge(),
    close: () => rejectBridge(),
    isMaximized: () => rejectBridge(),
    onStateChanged: () => () => undefined,
    openExternalLink: () => rejectBridge()
  }
};

const DEFAULT_SECURITY_STATE: SecurityState = {
  pinEnabled: false,
  locked: false,
  cooldownUntil: null,
  failedAttempts: 0,
  allowResetFromLockScreen: true
};
const CREATE_FOLDER_OPTION_VALUE = "__create_folder__";

interface ConfirmDialogRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ZipKeyDialogRequest {
  mode: "export" | "import";
}

interface FolderNameDialogRequest {
  assignPageIds: string[];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const normalized = shortcut.toLowerCase().replace(/\s+/g, "");
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const needsCtrl = parts.includes("ctrl");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");
  const needsMeta = parts.includes("meta") || parts.includes("cmd");

  const keyMatch = event.key.toLowerCase() === key;
  if (!keyMatch) {
    return false;
  }

  return (
    event.ctrlKey === needsCtrl &&
    event.shiftKey === needsShift &&
    event.altKey === needsAlt &&
    event.metaKey === needsMeta
  );
}

function getReviewReminderTitle(target: ReviewTarget): string {
  return target.period === "month" ? "Check out your monthly review!" : "Check out your yearly review!";
}

function getReviewReminderMessage(target: ReviewTarget): string {
  if (target.period === "month") {
    const label = new Date(target.year, target.month - 1, 1).toLocaleString(undefined, {
      month: "long",
      year: "numeric"
    });
    return `${label} is ready in Settings > Memories & Reviews.`;
  }

  return `${target.year} is ready in Settings > Memories & Reviews.`;
}

function getMemoryReminderTitle(memory: MemoryReplayItem): string {
  return `${memory.yearOffset}-year-old memory`;
}

function getMemoryReminderMessage(memory: MemoryReplayItem): string {
  const createdLabel = new Date(memory.createdAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  return `"${memory.title}" from ${createdLabel} is ready to revisit.`;
}

export default function App(): JSX.Element {
  const api = window.journalApp ?? fallbackApi;

  const [allPages, setAllPages] = useState<JournalPageMeta[]>([]);
  const [pages, setPages] = useState<JournalPageMeta[]>([]);
  const [folders, setFolders] = useState<JournalFolder[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [memories, setMemories] = useState<MemoryReplayItem[]>([]);
  const [historyItems, setHistoryItems] = useState<PageHistoryItem[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [content, setContent] = useState("<p></p>");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [securityState, setSecurityState] = useState<SecurityState>(DEFAULT_SECURITY_STATE);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isNarrow, setIsNarrow] = useState<boolean>(() => window.innerWidth < SIDEBAR_BREAKPOINT);
  const [windowState, setWindowState] = useState<WindowMaximizeState>({
    isMaximized: false,
    isFullScreen: false,
    isHtmlFullScreen: false
  });
  const [viewMode, setViewMode] = useState<"pages" | "trash" | "settings">("pages");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState("");
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [editorFindRequestToken, setEditorFindRequestToken] = useState(0);
  const [tagsInput, setTagsInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [historyPreviewId, setHistoryPreviewId] = useState<string | null>(null);
  const [historyPreviewContent, setHistoryPreviewContent] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogRequest | null>(null);
  const [folderNameDialog, setFolderNameDialog] = useState<FolderNameDialogRequest | null>(null);
  const [resetDataDialogOpen, setResetDataDialogOpen] = useState(false);
  const [zipKeyDialog, setZipKeyDialog] = useState<ZipKeyDialogRequest | null>(null);
  const [cooldownNowMs, setCooldownNowMs] = useState<number>(() => Date.now());
  const [settingsFocusSection, setSettingsFocusSection] = useState<"reviews" | null>(null);
  const [settingsFocusToken, setSettingsFocusToken] = useState(0);

  const saveTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{ pageId: string; content: string } | null>(null);
  const activePageIdRef = useRef<string | null>(null);
  const wasNarrowRef = useRef<boolean>(window.innerWidth < SIDEBAR_BREAKPOINT);
  const didInitializeRef = useRef(false);
  const didHandleLaunchPopupsRef = useRef(false);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const resetDataResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const zipKeyResolverRef = useRef<((zipKey: string | null) => void) | null>(null);

  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    if (resolve) {
      resolve(confirmed);
    }
  }, []);

  const requestConfirm = useCallback((request: ConfirmDialogRequest): Promise<boolean> => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }

    setConfirmDialog({
      title: request.title,
      message: request.message,
      confirmLabel: request.confirmLabel ?? "Confirm",
      cancelLabel: request.cancelLabel ?? "Cancel",
      danger: request.danger ?? false
    });

    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }, []);

  const focusSettingsSection = useCallback((section: "reviews") => {
    setViewMode("settings");
    setSettingsFocusSection(section);
    setSettingsFocusToken((current) => current + 1);
  }, []);

  const resolveResetDataDialog = useCallback((confirmed: boolean) => {
    const resolve = resetDataResolverRef.current;
    resetDataResolverRef.current = null;
    setResetDataDialogOpen(false);
    if (resolve) {
      resolve(confirmed);
    }
  }, []);

  const requestResetDataConfirmation = useCallback((): Promise<boolean> => {
    if (resetDataResolverRef.current) {
      resetDataResolverRef.current(false);
      resetDataResolverRef.current = null;
    }

    setResetDataDialogOpen(true);
    return new Promise<boolean>((resolve) => {
      resetDataResolverRef.current = resolve;
    });
  }, []);

  const resolveZipKeyDialog = useCallback((zipKey: string | null) => {
    const resolve = zipKeyResolverRef.current;
    zipKeyResolverRef.current = null;
    setZipKeyDialog(null);
    if (resolve) {
      resolve(zipKey);
    }
  }, []);

  const requestZipKey = useCallback((mode: "export" | "import"): Promise<string | null> => {
    if (zipKeyResolverRef.current) {
      zipKeyResolverRef.current(null);
      zipKeyResolverRef.current = null;
    }

    setZipKeyDialog({ mode });
    return new Promise<string | null>((resolve) => {
      zipKeyResolverRef.current = resolve;
    });
  }, []);

  const clearSensitiveState = useCallback(() => {
    setAllPages([]);
    setPages([]);
    setFolders([]);
    setBackups([]);
    setMemories([]);
    setHistoryItems([]);
    setActivePageId(null);
    setContent("<p></p>");
    setTitleInput("");
    setTagsInput("");
    setSelectedPageIds([]);
    setQuickSwitcherOpen(false);
    setHistoryPanelOpen(false);
    pendingSaveRef.current = null;
    clearSaveTimer();
  }, [clearSaveTimer]);

  const refreshCollections = useCallback(async (): Promise<void> => {
    const [foldersResult, backupsResult, memoriesResult] = await Promise.all([
      api.journal.listFolders(),
      api.journal.listBackups(),
      api.journal.listOnThisDayMemories()
    ]);
    setFolders(foldersResult);
    setBackups(backupsResult);
    setMemories(memoriesResult);
  }, [api]);

  const refreshPages = useCallback(async (): Promise<void> => {
    const rawAll = await api.journal.listPages(true, sortMode);
    const all = sortPages(rawAll, sortMode);
    setAllPages(all);

    if (viewMode === "trash") {
      setPages(all.filter((page) => page.deletedAt));
      return;
    }

    if (viewMode === "settings") {
      setPages(all.filter((page) => !page.deletedAt));
      return;
    }

    const onlyActive = all.filter((page) => !page.deletedAt);
    if (!searchQuery.trim() && !folderFilter && !tagFilter.trim()) {
      setPages(onlyActive);
      return;
    }

    const tagList = parseTags(tagFilter);
    const results = await api.journal.searchPages({
      query: searchQuery,
      scope: searchScope,
      startDate: null,
      endDate: null,
      sortMode,
      folderId: folderFilter,
      tags: tagList,
      includeTrashed: false
    });
    setPages(results.map((entry) => entry.page));
  }, [api, folderFilter, searchQuery, searchScope, sortMode, tagFilter, viewMode]);

  const openPage = useCallback(
    async (pageId: string): Promise<void> => {
      const page = await api.journal.getPage(pageId);
      setActivePageId(page.id);
      setContent(page.content);
      await api.journal.setLastOpenedPageId(page.id);

      const history = await api.journal.listPageHistory(page.id);
      setHistoryItems(history);
      if (isNarrow) {
        setIsSidebarOpen(false);
      }
    },
    [api, isNarrow]
  );

  const initializeUnlocked = useCallback(async () => {
    const [settingsResult, maximizeState] = await Promise.all([api.journal.getSettings(), api.window.isMaximized()]);
    setSettings(settingsResult);
    setIsSidebarOpen(settingsResult.sidebarOpenByDefault);
    setWindowState(maximizeState);

    await refreshCollections();
    await refreshPages();

    const pagesList = await api.journal.listPages(false, "recent");
    let targetPageId: string | null = null;
    if (settingsResult.openLastPageOnLaunch) {
      targetPageId = await api.journal.getLastOpenedPageId();
    }
    if (!targetPageId) {
      targetPageId = pagesList[0]?.id ?? null;
    }
    if (!targetPageId) {
      const created = await api.journal.createPage(folderFilter);
      targetPageId = created.id;
    }

    await refreshPages();
    if (targetPageId) {
      await openPage(targetPageId);
    }
  }, [api, folderFilter, openPage, refreshCollections, refreshPages]);

  const initialize = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const security = await api.journal.getSecurityState();
      setSecurityState(security);
      if (security.pinEnabled && security.locked) {
        clearSensitiveState();
        setUnlockError(null);
        setUnlockPin("");
        return;
      }

      await initializeUnlocked();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [api, clearSensitiveState, initializeUnlocked]);

  useEffect(() => {
    if (didInitializeRef.current) {
      return;
    }
    didInitializeRef.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const handleResize = () => {
      const narrow = window.innerWidth < SIDEBAR_BREAKPOINT;
      setIsNarrow(narrow);

      if (!narrow && wasNarrowRef.current) {
        setIsSidebarOpen(true);
      }

      wasNarrowRef.current = narrow;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => api.window.onStateChanged((state) => setWindowState(state)), [api]);

  useEffect(() => {
    if (viewMode === "settings") {
      return;
    }

    setSettingsFocusSection(null);
  }, [viewMode]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (securityState.pinEnabled && securityState.locked) {
      return;
    }
    void refreshPages().catch((error) => setErrorMessage(toErrorMessage(error)));
  }, [isLoading, refreshPages, securityState.locked, securityState.pinEnabled]);

  useEffect(() => {
    const visiblePageIds = new Set(pages.map((page) => page.id));
    setSelectedPageIds((current) => {
      const next = current.filter((pageId) => visiblePageIds.has(pageId));
      return next.length === current.length ? current : next;
    });
  }, [pages]);

  const activePage = useMemo(() => allPages.find((page) => page.id === activePageId) ?? null, [activePageId, allPages]);
  const title = activePage?.title || UNTITLED_TITLE;
  const isLocked = securityState.pinEnabled && securityState.locked;

  useEffect(() => {
    if (!securityState.cooldownUntil) {
      return;
    }

    const cooldownAt = Date.parse(securityState.cooldownUntil);
    if (!Number.isFinite(cooldownAt) || cooldownAt <= Date.now()) {
      return;
    }

    setCooldownNowMs(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setCooldownNowMs(now);
      if (now >= cooldownAt) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [securityState.cooldownUntil]);

  const cooldownSeconds = useMemo(() => {
    if (!securityState.cooldownUntil) {
      return null;
    }
    const cooldownAt = Date.parse(securityState.cooldownUntil);
    if (!Number.isFinite(cooldownAt)) {
      return null;
    }
    const delta = cooldownAt - cooldownNowMs;
    if (delta <= 0) {
      return null;
    }
    return Math.ceil(delta / 1000);
  }, [cooldownNowMs, securityState.cooldownUntil]);

  useEffect(() => {
    let cancelled = false;

    if (securityState.pinEnabled && securityState.locked) {
      void syncImportedFontFaces([]);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const assets = settings.importedFonts.length > 0 ? await api.journal.listImportedFontAssets() : [];
        if (cancelled) {
          return;
        }
        await syncImportedFontFaces(assets);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toErrorMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, securityState.locked, securityState.pinEnabled, settings.importedFonts]);

  useEffect(() => {
    if (isLoading || isLocked || didHandleLaunchPopupsRef.current) {
      return;
    }

    didHandleLaunchPopupsRef.current = true;
    if (!settings.launchPopupsEnabled) {
      return;
    }

    const dueTargets = getLaunchReviewReminderTargets(new Date()).filter(
      (target) => !allPages.some((page) => matchesReviewTarget(page, target))
    );
    if (dueTargets.length === 0 && memories.length === 0) {
      return;
    }

    void (async () => {
      for (const target of dueTargets) {
        const openReviews = await requestConfirm({
          title: getReviewReminderTitle(target),
          message: getReviewReminderMessage(target),
          confirmLabel: "Open Reviews",
          cancelLabel: "Later"
        });
        if (openReviews) {
          focusSettingsSection("reviews");
        }
      }

      for (const memory of memories) {
        const openMemory = await requestConfirm({
          title: getMemoryReminderTitle(memory),
          message: getMemoryReminderMessage(memory),
          confirmLabel: "Open Entry",
          cancelLabel: "Later"
        });
        if (openMemory) {
          setViewMode("pages");
          await openPage(memory.pageId);
        }
      }
    })().catch((error) => setErrorMessage(toErrorMessage(error)));
  }, [allPages, focusSettingsSection, isLoading, isLocked, memories, openPage, requestConfirm, settings.launchPopupsEnabled]);

  const persistPage = useCallback(
    async (pageId: string, nextContent: string) => {
      const updateResult: JournalUpdateResult = await api.journal.updatePageContent(pageId, nextContent);
      setAllPages((current) =>
        current.map((page) =>
          page.id === pageId
            ? {
                ...page,
                title: updateResult.title,
                preview: updateResult.preview,
                updatedAt: updateResult.updatedAt,
                charCount: updateResult.charCount,
                wordCount: updateResult.wordCount,
                readingMinutes: updateResult.readingMinutes
              }
            : page
        )
      );
      setPages((current) =>
        current.map((page) =>
          page.id === pageId
            ? {
                ...page,
                title: updateResult.title,
                preview: updateResult.preview,
                updatedAt: updateResult.updatedAt,
                charCount: updateResult.charCount,
                wordCount: updateResult.wordCount,
                readingMinutes: updateResult.readingMinutes
              }
            : page
        )
      );
    },
    [api]
  );

  const flushPendingSave = useCallback(async () => {
    clearSaveTimer();
    const pending = pendingSaveRef.current;
    if (!pending) {
      return;
    }

    pendingSaveRef.current = null;
    await persistPage(pending.pageId, pending.content);
  }, [clearSaveTimer, persistPage]);

  const handleCreatePage = useCallback(async () => {
    try {
      await flushPendingSave();
      const created = await api.journal.createPage(folderFilter);
      await refreshPages();
      await openPage(created.id);
      setViewMode("pages");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api, flushPendingSave, folderFilter, openPage, refreshPages]);

  const handleSelectPage = useCallback(
    async (pageId: string) => {
      try {
        await flushPendingSave();
        await openPage(pageId);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [flushPendingSave, openPage]
  );

  const handleTogglePageSelection = useCallback((pageId: string, nextSelected: boolean) => {
    setSelectedPageIds((current) => {
      const nextIds = new Set(current);
      if (nextSelected) {
        nextIds.add(pageId);
      } else {
        nextIds.delete(pageId);
      }
      return [...nextIds];
    });
  }, []);

  const handleSelectAllPages = useCallback(() => {
    setSelectedPageIds(pages.map((page) => page.id));
  }, [pages]);

  const handleClearSelectedPages = useCallback(() => {
    setSelectedPageIds([]);
  }, []);

  const handleBulkMoveToTrash = useCallback(
    async (pageIds: string[]) => {
      const uniqueIds = [...new Set(pageIds)];
      if (uniqueIds.length === 0) {
        return;
      }

      const confirmed = await requestConfirm({
        title: "Move selected pages to Trash?",
        message:
          uniqueIds.length === 1
            ? "The selected page will be moved to Trash."
            : `${uniqueIds.length} selected pages will be moved to Trash.`,
        confirmLabel: "Move to Trash"
      });
      if (!confirmed) {
        return;
      }

      try {
        await flushPendingSave();
        await Promise.all(uniqueIds.map((pageId) => api.journal.movePageToTrash(pageId)));
        if (activePageIdRef.current && uniqueIds.includes(activePageIdRef.current)) {
          setActivePageId(null);
          setContent("<p></p>");
        }
        setSelectedPageIds((current) => current.filter((pageId) => !uniqueIds.includes(pageId)));
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, flushPendingSave, refreshPages, requestConfirm]
  );

  const handleBulkRestorePages = useCallback(
    async (pageIds: string[]) => {
      const uniqueIds = [...new Set(pageIds)];
      if (uniqueIds.length === 0) {
        return;
      }

      try {
        await Promise.all(uniqueIds.map((pageId) => api.journal.restorePageFromTrash(pageId)));
        setSelectedPageIds((current) => current.filter((pageId) => !uniqueIds.includes(pageId)));
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, refreshPages]
  );

  const handleBulkDeletePermanently = useCallback(
    async (pageIds: string[]) => {
      const uniqueIds = [...new Set(pageIds)];
      if (uniqueIds.length === 0) {
        return;
      }

      const confirmed = await requestConfirm({
        title: "Delete selected pages permanently?",
        message:
          uniqueIds.length === 1
            ? "This page will be deleted permanently and cannot be recovered."
            : `${uniqueIds.length} selected pages will be deleted permanently and cannot be recovered.`,
        confirmLabel: "Delete Permanently",
        danger: true
      });
      if (!confirmed) {
        return;
      }

      try {
        await flushPendingSave();
        await Promise.all(uniqueIds.map((pageId) => api.journal.deletePagePermanently(pageId)));
        if (activePageIdRef.current && uniqueIds.includes(activePageIdRef.current)) {
          setActivePageId(null);
          setContent("<p></p>");
        }
        setSelectedPageIds((current) => current.filter((pageId) => !uniqueIds.includes(pageId)));
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, flushPendingSave, refreshPages, requestConfirm]
  );

  const handleBulkAssignFolder = useCallback(
    async (pageIds: string[], folderId: string | null) => {
      const uniqueIds = [...new Set(pageIds)];
      if (uniqueIds.length === 0) {
        return;
      }

      try {
        await Promise.all(uniqueIds.map((pageId) => api.journal.setPageFolder(pageId, folderId)));
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, refreshPages]
  );

  const handleBulkAddTags = useCallback(
    async (pageIds: string[], tags: string[]) => {
      const uniqueIds = [...new Set(pageIds)];
      const normalizedTags = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
      if (uniqueIds.length === 0 || normalizedTags.length === 0) {
        return;
      }

      try {
        const pageLookup = new Map(allPages.map((page) => [page.id, page]));
        await Promise.all(
          uniqueIds.map((pageId) => {
            const existingTags = pageLookup.get(pageId)?.tags ?? [];
            const mergedTags = [...new Set([...existingTags, ...normalizedTags])];
            return api.journal.setPageTags(pageId, mergedTags);
          })
        );
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [allPages, api, refreshPages]
  );

  const handleSwitchView = useCallback((view: "pages" | "trash" | "settings") => {
    setSelectedPageIds([]);
    setViewMode(view);
  }, []);

  const handleEditorChange = useCallback(
    (nextValue: string) => {
      const pageId = activePageIdRef.current;
      if (!pageId) {
        return;
      }

      setContent(nextValue);
      const nextPreview = derivePreview(nextValue);
      setAllPages((current) => current.map((page) => (page.id === pageId ? { ...page, preview: nextPreview } : page)));
      setPages((current) => current.map((page) => (page.id === pageId ? { ...page, preview: nextPreview } : page)));
      pendingSaveRef.current = { pageId, content: nextValue };
      clearSaveTimer();
      saveTimerRef.current = window.setTimeout(() => {
        const pending = pendingSaveRef.current;
        if (!pending) {
          return;
        }

        pendingSaveRef.current = null;
        void persistPage(pending.pageId, pending.content).catch((error) => {
          setErrorMessage(toErrorMessage(error));
        });
      }, settings.autosaveDelayMs);
    },
    [clearSaveTimer, persistPage, settings.autosaveDelayMs]
  );

  const openCreateFolderDialog = useCallback((assignPageIds: string[] = []) => {
    setFolderNameDialog({ assignPageIds });
  }, []);

  const handleConfirmCreateFolder = useCallback(
    async (name: string) => {
      if (!folderNameDialog) {
        return;
      }

      try {
        const folder = await api.journal.createFolder(name.trim());
        if (folderNameDialog.assignPageIds.length > 0) {
          await Promise.all(folderNameDialog.assignPageIds.map((pageId) => api.journal.setPageFolder(pageId, folder.id)));
        }
        await refreshCollections();
        await refreshPages();
        setInfoMessage(`Created folder "${folder.name}".`);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setFolderNameDialog(null);
      }
    },
    [api, folderNameDialog, refreshCollections, refreshPages]
  );

  const handleUpdateSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      try {
        const nextSettings = await api.journal.updateSettings(partial);
        setSettings(nextSettings);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api]
  );

  const handleClearAllHistory = useCallback(async () => {
    const confirmed = await requestConfirm({
      title: "Delete all saved history?",
      message: "Every page's History snapshots will be deleted permanently. Your pages themselves will stay intact.",
      confirmLabel: "Delete All History",
      danger: true
    });
    if (!confirmed) {
      return;
    }

    try {
      await api.journal.clearAllHistory();
      setHistoryItems([]);
      setHistoryPanelOpen(false);
      setInfoMessage("All saved history was deleted.");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api, requestConfirm]);

  const handleImportFonts = useCallback(async () => {
    try {
      const previousCount = settings.importedFonts.length;
      const nextSettings = await api.journal.importFonts();
      setSettings(nextSettings);
      const addedCount = nextSettings.importedFonts.length - previousCount;
      if (addedCount > 0) {
        setInfoMessage(`Imported ${addedCount} font${addedCount === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api, settings.importedFonts.length]);

  const handleRemoveImportedFont = useCallback(
    async (fontId: string) => {
      try {
        const removedFont = settings.importedFonts.find((font) => font.id === fontId);
        const nextSettings = await api.journal.removeImportedFont(fontId);
        setSettings(nextSettings);
        if (removedFont) {
          setInfoMessage(`Removed ${removedFont.family}.`);
        }
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, settings.importedFonts]
  );

  const refreshSecurityState = useCallback(async (): Promise<SecurityState> => {
    const next = await api.journal.getSecurityState();
    setSecurityState(next);
    return next;
  }, [api]);

  const handleLockNow = useCallback(async () => {
    try {
      const next = await api.journal.lock();
      setSecurityState(next);
      if (next.locked) {
        clearSensitiveState();
      }
      clearIdleTimer();
      setUnlockError(null);
      setUnlockPin("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api, clearIdleTimer, clearSensitiveState]);

  const handleUnlock = useCallback(async () => {
    if (cooldownSeconds && cooldownSeconds > 0) {
      setUnlockError(`Too many attempts. Try again in ${cooldownSeconds}s.`);
      return;
    }
    try {
      setSecurityBusy(true);
      setUnlockError(null);
      const next = await api.journal.unlock(unlockPin);
      setSecurityState(next);
      if (!next.locked) {
        await initializeUnlocked();
        setUnlockPin("");
      }
    } catch (error) {
      setUnlockError(toErrorMessage(error));
      try {
        await refreshSecurityState();
      } catch {
        // Keep current state.
      }
    } finally {
      setSecurityBusy(false);
    }
  }, [api, cooldownSeconds, initializeUnlocked, refreshSecurityState, unlockPin]);

  const handleEnablePin = useCallback(
    async (pin: string) => {
      try {
        setSecurityBusy(true);
        await api.journal.enablePin(pin);
        await refreshSecurityState();
        setInfoMessage("Password protection enabled.");
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setSecurityBusy(false);
      }
    },
    [api, refreshSecurityState]
  );

  const handleChangePin = useCallback(
    async (currentPin: string, newPin: string) => {
      try {
        setSecurityBusy(true);
        await api.journal.changePin(currentPin, newPin);
        await refreshSecurityState();
        setInfoMessage("Password updated.");
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setSecurityBusy(false);
      }
    },
    [api, refreshSecurityState]
  );

  const handleDisablePin = useCallback(
    async (pin: string) => {
      try {
        setSecurityBusy(true);
        await api.journal.disablePin(pin);
        await refreshSecurityState();
        setInfoMessage("Password protection disabled.");
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setSecurityBusy(false);
      }
    },
    [api, refreshSecurityState]
  );

  const handleResetEncryptedData = useCallback(async () => {
    const confirmed = await requestResetDataConfirmation();
    if (!confirmed) {
      return;
    }
    try {
      setSecurityBusy(true);
      await api.journal.resetEncryptedData();
      await refreshSecurityState();
      setUnlockPin("");
      setUnlockError(null);
      await initialize();
      setInfoMessage("Encrypted data reset.");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setSecurityBusy(false);
    }
  }, [api, initialize, refreshSecurityState, requestResetDataConfirmation]);

  const handleTogglePinned = useCallback(
    async (pageId: string, nextPinned: boolean) => {
      try {
        await api.journal.setPagePinned(pageId, nextPinned);
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, refreshPages]
  );

  const handleRenamePage = useCallback(
    async (pageId: string, nextTitle: string) => {
      try {
        await api.journal.renamePage(pageId, nextTitle);
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, refreshPages]
  );

  const handleDeletePage = useCallback(
    async (pageId: string) => {
      const confirmed = await requestConfirm({
        title: "Move page to Trash?",
        message: "You can restore it later from the Trash tab.",
        confirmLabel: "Move to Trash"
      });
      if (!confirmed) {
        return;
      }

      try {
        await api.journal.movePageToTrash(pageId);
        if (activePageIdRef.current === pageId) {
          setActivePageId(null);
          setContent("<p></p>");
        }
        setSelectedPageIds((current) => current.filter((id) => id !== pageId));
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, refreshPages, requestConfirm]
  );

  const handleRestorePage = useCallback(
    async (pageId: string) => {
      try {
        await api.journal.restorePageFromTrash(pageId);
        setSelectedPageIds((current) => current.filter((id) => id !== pageId));
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, refreshPages]
  );

  const handleDeletePermanently = useCallback(
    async (pageId: string) => {
      const confirmed = await requestConfirm({
        title: "Delete permanently?",
        message: "This action cannot be undone.",
        confirmLabel: "Delete Permanently",
        danger: true
      });
      if (!confirmed) {
        return;
      }

      try {
        await api.journal.deletePagePermanently(pageId);
        if (activePageIdRef.current === pageId) {
          setActivePageId(null);
          setContent("<p></p>");
        }
        setSelectedPageIds((current) => current.filter((id) => id !== pageId));
        await refreshPages();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, refreshPages, requestConfirm]
  );

  const handleCreateBackup = useCallback(async () => {
    try {
      await api.journal.createBackup();
      await refreshCollections();
      setInfoMessage("Backup created.");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api, refreshCollections]);

  const handleRestoreBackup = useCallback(
    async (backupId: string) => {
      const confirmed = await requestConfirm({
        title: "Restore backup?",
        message: "Current pages and settings will be replaced with this backup.",
        confirmLabel: "Restore Backup",
        danger: true
      });
      if (!confirmed) {
        return;
      }

      try {
        await api.journal.restoreBackup(backupId);
        await initialize();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, initialize, requestConfirm]
  );

  const handleRefreshMemories = useCallback(async () => {
    try {
      const nextMemories = await api.journal.listOnThisDayMemories();
      setMemories(nextMemories);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api]);

  const handleOpenMemory = useCallback(
    async (pageId: string) => {
      try {
        setViewMode("pages");
        await handleSelectPage(pageId);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [handleSelectPage]
  );

  const handleGenerateReview = useCallback(
    async (period: "month" | "year", year: number, month?: number) => {
      try {
        const reviewPage = await api.journal.generateReview(period, year, month);
        await refreshPages();
        await openPage(reviewPage.id);
        setViewMode("pages");
        await handleRefreshMemories();
        setInfoMessage("Review generated.");
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, handleRefreshMemories, openPage, refreshPages]
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      try {
        let encryptedZipKey: string | undefined;
        if (format === "encrypted-zip") {
          const prompted = await requestZipKey("export");
          if (!prompted) {
            return;
          }
          encryptedZipKey = prompted;
        }

        const result = await api.journal.exportData(format, encryptedZipKey);
        if (!result) {
          return;
        }
        setInfoMessage(`Exported to ${result.filePath}`);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    [api, requestZipKey]
  );

  const handleImport = useCallback(async () => {
    try {
      const prompted = await requestZipKey("import");
      if (prompted === null) {
        return;
      }
      await api.journal.importData(prompted);
      await initialize();
      setInfoMessage("Import completed.");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [api, initialize, requestZipKey]);

  const minimizeWindow = useCallback(() => {
    void api.window.minimize();
  }, [api]);

  const toggleMaximize = useCallback(() => {
    void api.window
      .toggleMaximize()
      .then((state) => setWindowState(state))
      .catch((error) => setErrorMessage(toErrorMessage(error)));
  }, [api]);

  const closeWindow = useCallback(() => {
    void (async () => {
      try {
        await flushPendingSave();
        await api.window.close();
      } catch (error) {
        setErrorMessage(`Could not close window because pending changes failed to save: ${toErrorMessage(error)}`);
      }
    })();
  }, [api, flushPendingSave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isLocked) {
        return;
      }
      if (matchesShortcut(event, settings.shortcuts.newPage)) {
        event.preventDefault();
        void handleCreatePage();
      }
      if (matchesShortcut(event, settings.shortcuts.focusSearch)) {
        event.preventDefault();
        if (!activePageIdRef.current) {
          setInfoMessage("Open a page to search text.");
          return;
        }
        setViewMode("pages");
        setEditorFindRequestToken((current) => current + 1);
      }
      if (matchesShortcut(event, settings.shortcuts.quickSwitcher)) {
        event.preventDefault();
        setQuickSwitcherOpen(true);
      }
      if (matchesShortcut(event, settings.shortcuts.toggleSidebar)) {
        event.preventDefault();
        setIsSidebarOpen((current) => !current);
      }
      if (matchesShortcut(event, settings.shortcuts.openSettings)) {
        event.preventDefault();
        setViewMode("settings");
      }
      if (matchesShortcut(event, settings.shortcuts.lockApp) && securityState.pinEnabled) {
        event.preventDefault();
        void handleLockNow();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCreatePage, handleLockNow, isLocked, securityState.pinEnabled, settings.shortcuts]);

  useEffect(() => {
    if (!securityState.pinEnabled || securityState.locked || isLoading) {
      clearIdleTimer();
      return;
    }

    const idleMs = Math.max(1, settings.idleLockMinutes) * 60 * 1000;
    const resetTimer = () => {
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => {
        void handleLockNow();
      }, idleMs);
    };

    const activityEvents: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, resetTimer);
    }
    resetTimer();

    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, resetTimer);
      }
      clearIdleTimer();
    };
  }, [
    clearIdleTimer,
    handleLockNow,
    isLoading,
    securityState.locked,
    securityState.pinEnabled,
    settings.idleLockMinutes
  ]);

  useEffect(() => {
    if (!infoMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setInfoMessage(null);
    }, 2800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [infoMessage]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setErrorMessage(null);
    }, 6500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [errorMessage]);

  useEffect(
    () => () => {
      clearSaveTimer();
      clearIdleTimer();
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }
      if (resetDataResolverRef.current) {
        resetDataResolverRef.current(false);
        resetDataResolverRef.current = null;
      }
      const pending = pendingSaveRef.current;
      if (pending) {
        void persistPage(pending.pageId, pending.content);
      }
    },
    [clearIdleTimer, clearSaveTimer, persistPage]
  );

  useEffect(() => {
    if (!activePage) {
      return;
    }
    setTagsInput(activePage.tags.join(", "));
  }, [activePage]);

  const refreshActivePageHistory = useCallback(async () => {
    if (!activePageIdRef.current) {
      setHistoryItems([]);
      return;
    }

    const history = await api.journal.listPageHistory(activePageIdRef.current);
    setHistoryItems(history);
  }, [api]);

  useEffect(() => {
    if (!historyPanelOpen) {
      return;
    }

    void refreshActivePageHistory().catch((error) => setErrorMessage(toErrorMessage(error)));
  }, [historyPanelOpen, refreshActivePageHistory]);

  useEffect(() => {
    setTitleInput(activePage?.title ?? "");
  }, [activePage?.id, activePage?.title]);

  useEffect(() => {
    setHistoryPanelOpen(false);
    setHistoryPreviewId(null);
    setHistoryPreviewContent(null);
  }, [activePage?.id]);

  const commitActiveTitle = useCallback(async () => {
    if (!activePage) {
      return;
    }

    const normalized = titleInput.trim();
    const nextTitle = normalized.length > 0 ? normalized : UNTITLED_TITLE;
    if (nextTitle === activePage.title) {
      return;
    }

    await handleRenamePage(activePage.id, nextTitle);
  }, [activePage, handleRenamePage, titleInput]);

  const handlePreviewHistoryItem = useCallback(
    async (historyId: string) => {
      if (!activePage) return;
      if (historyPreviewId === historyId) {
        setHistoryPreviewId(null);
        setHistoryPreviewContent(null);
        return;
      }
      const result = await api.journal.getPageHistoryContent(activePage.id, historyId);
      setHistoryPreviewId(historyId);
      setHistoryPreviewContent(result.content);
    },
    [activePage, api, historyPreviewId]
  );

  const handleRestoreHistoryItem = useCallback(
    async (historyId: string) => {
      if (!activePage) return;

      const confirmed = await requestConfirm({
        title: "Restore this version?",
        message: "The current page content will be replaced with this version. A snapshot of the current content will be saved first.",
        confirmLabel: "Restore",
        danger: false
      });
      if (!confirmed) return;

      await api.journal.restorePageHistory(activePage.id, historyId);
      await openPage(activePage.id);
      await refreshPages();
      await refreshActivePageHistory();
      setHistoryPreviewId(null);
      setHistoryPreviewContent(null);
      setInfoMessage("Version restored.");
    },
    [activePage, api, openPage, refreshActivePageHistory, refreshPages, requestConfirm]
  );

  const handleDeleteHistoryItem = useCallback(
    async (historyId: string) => {
      if (!activePage) return;

      const confirmed = await requestConfirm({
        title: "Delete version?",
        message: "This version will be removed permanently.",
        confirmLabel: "Delete",
        danger: true
      });
      if (!confirmed) return;

      await api.journal.deletePageHistory(activePage.id, historyId);
      if (historyPreviewId === historyId) {
        setHistoryPreviewId(null);
        setHistoryPreviewContent(null);
      }
      await refreshActivePageHistory();
    },
    [activePage, api, historyPreviewId, refreshActivePageHistory, requestConfirm]
  );

  const handleDeleteMultipleHistoryItems = useCallback(
    async (historyIds: string[]) => {
      if (!activePage || historyIds.length === 0) return;

      const confirmed = await requestConfirm({
        title: `Delete ${historyIds.length} version${historyIds.length > 1 ? "s" : ""}?`,
        message: "These versions will be removed permanently.",
        confirmLabel: "Delete",
        danger: true
      });
      if (!confirmed) return;

      await api.journal.deleteMultiplePageHistory(activePage.id, historyIds);
      if (historyPreviewId && historyIds.includes(historyPreviewId)) {
        setHistoryPreviewId(null);
        setHistoryPreviewContent(null);
      }
      await refreshActivePageHistory();
    },
    [activePage, api, historyPreviewId, refreshActivePageHistory, requestConfirm]
  );

  const handleRenameHistoryItem = useCallback(
    async (historyId: string, name: string | null) => {
      if (!activePage) return;
      await api.journal.renamePageHistory(activePage.id, historyId, name);
      await refreshActivePageHistory();
    },
    [activePage, api, refreshActivePageHistory]
  );

  const handleDuplicateFromHistory = useCallback(
    async (historyId: string) => {
      if (!activePage) return;
      const newPage = await api.journal.duplicateFromHistory(activePage.id, historyId);
      await refreshPages();
      await openPage(newPage.id);
      setInfoMessage("Copy created from version.");
    },
    [activePage, api, openPage, refreshPages]
  );

  const handleClearHistory = useCallback(async () => {
    if (!activePage) return;

    const confirmed = await requestConfirm({
      title: "Clear all version history?",
      message: "All saved versions for this page will be deleted permanently.",
      confirmLabel: "Clear History",
      danger: true
    });
    if (!confirmed) return;

    await api.journal.clearPageHistory(activePage.id);
    await refreshActivePageHistory();
    setHistoryPreviewId(null);
    setHistoryPreviewContent(null);
    setInfoMessage("Version history cleared.");
  }, [activePage, api, refreshActivePageHistory, requestConfirm]);

  return (
    <div
      className={`app-shell theme-${settings.theme} ${settings.highContrast ? "theme-contrast" : ""}`}
      style={{ "--accent-color": settings.accentColor } as CSSProperties}
    >
      <TitleBar
        title={title}
        isSidebarOpen={isSidebarOpen}
        isExpanded={windowState.isMaximized || windowState.isFullScreen || windowState.isHtmlFullScreen}
        onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
        onMinimize={minimizeWindow}
        onToggleMaximize={toggleMaximize}
        onClose={closeWindow}
      />

      <div className={`content-area ${isNarrow ? "narrow" : ""}`}>
        {!isLocked && isNarrow && isSidebarOpen ? (
          <button
            aria-label="Close sidebar"
            className="sidebar-backdrop"
            type="button"
            onClick={() => setIsSidebarOpen(false)}
          />
        ) : null}

        {!isLocked ? (
          <Sidebar
            pages={pages}
            activePageId={activePageId}
            folders={folders}
            spellcheck={settings.spellcheck}
            isOpen={isSidebarOpen}
            isNarrow={isNarrow}
            viewMode={viewMode}
            searchQuery={searchQuery}
            searchScope={searchScope}
            sortMode={sortMode}
            folderFilter={folderFilter}
            tagFilter={tagFilter}
            selectedPageIds={selectedPageIds}
            onCreatePage={handleCreatePage}
            onSelectPage={handleSelectPage}
            onTogglePageSelection={handleTogglePageSelection}
            onSelectAllPages={handleSelectAllPages}
            onClearPageSelection={handleClearSelectedPages}
            onRenamePage={handleRenamePage}
            onDeletePage={handleDeletePage}
            onRestorePage={handleRestorePage}
            onDeletePermanently={handleDeletePermanently}
            onBulkMoveToTrash={handleBulkMoveToTrash}
            onBulkRestorePages={handleBulkRestorePages}
            onBulkDeletePermanently={handleBulkDeletePermanently}
            onBulkAssignFolder={handleBulkAssignFolder}
            onBulkAddTags={handleBulkAddTags}
            onOpenCreateFolderDialog={openCreateFolderDialog}
            onTogglePinned={handleTogglePinned}
            onChangeSearchQuery={setSearchQuery}
            onChangeSearchScope={setSearchScope}
            onChangeSortMode={setSortMode}
            onChangeFolderFilter={setFolderFilter}
            onChangeTagFilter={setTagFilter}
            onSwitchView={handleSwitchView}
          />
        ) : null}

        <main className="editor-pane">
          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
          {infoMessage ? <div className="info-banner">{infoMessage}</div> : null}
          {isLoading ? (
            <div className="status-view">Loading your journal...</div>
          ) : isLocked ? (
            <div className="lock-screen">
              <div className="lock-panel">
                <h2>Journal Locked</h2>
                <p>Enter your password to unlock.</p>
                <label className="lock-input-label">
                  <span>Password</span>
                  <input
                    type="password"
                    maxLength={64}
                    placeholder="4-64 characters, no spaces"
                    value={unlockPin}
                    disabled={securityBusy}
                    onChange={(event) => setUnlockPin(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }
                      event.preventDefault();
                      void handleUnlock();
                    }}
                  />
                </label>
                <div className="lock-meta">
                  <span>Failed attempts: {securityState.failedAttempts}</span>
                  {cooldownSeconds ? <span>Cooldown: {cooldownSeconds}s</span> : null}
                </div>
                {unlockError ? <div className="security-error">{unlockError}</div> : null}
                <div className="settings-actions">
                  <button
                    type="button"
                    disabled={securityBusy || (cooldownSeconds !== null && cooldownSeconds > 0) || unlockPin.length < 4}
                    onClick={() => void handleUnlock()}
                  >
                    Unlock
                  </button>
                  {securityState.allowResetFromLockScreen ? (
                    <button
                      type="button"
                      className="danger-btn"
                      disabled={securityBusy}
                      onClick={() => void handleResetEncryptedData()}
                    >
                      Forgot Password? Reset data
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : viewMode === "settings" ? (
            <SettingsPanel
              settings={settings}
              backups={backups}
              memories={memories}
              securityState={securityState}
              securityBusy={securityBusy}
              onUpdateSettings={(partial) => void handleUpdateSettings(partial)}
              onImportFonts={() => void handleImportFonts()}
              onRemoveImportedFont={(fontId) => void handleRemoveImportedFont(fontId)}
              onClearAllHistory={() => void handleClearAllHistory()}
              onCreateBackup={() => void handleCreateBackup()}
              onRestoreBackup={(backupId) => void handleRestoreBackup(backupId)}
              onRefreshMemories={() => void handleRefreshMemories()}
              onOpenMemory={(pageId) => void handleOpenMemory(pageId)}
              onGenerateReview={(period, year, month) => void handleGenerateReview(period, year, month)}
              onExport={(format) => void handleExport(format)}
              onImport={() => void handleImport()}
              onEnablePin={handleEnablePin}
              onChangePin={handleChangePin}
              onDisablePin={handleDisablePin}
              onLockNow={handleLockNow}
              onResetEncryptedData={handleResetEncryptedData}
              focusSection={settingsFocusSection}
              focusSectionToken={settingsFocusToken}
            />
          ) : activePage ? (
            <>
              <div className="editor-meta">
                <input
                  className="editor-title-input"
                  value={titleInput}
                  placeholder={UNTITLED_TITLE}
                  spellCheck={settings.spellcheck}
                  onFocus={(event) => selectAllInputText(event.currentTarget)}
                  onChange={(event) => setTitleInput(event.currentTarget.value)}
                  onBlur={() => {
                    void commitActiveTitle().catch((error) => setErrorMessage(toErrorMessage(error)));
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }

                    event.preventDefault();
                    void commitActiveTitle().catch((error) => setErrorMessage(toErrorMessage(error)));
                  }}
                />
                <div className="editor-meta-actions">
                  <select
                    value={activePage.folderId ?? ""}
                    onChange={(event) => {
                      const selectedValue = event.currentTarget.value;
                      if (selectedValue === CREATE_FOLDER_OPTION_VALUE) {
                        openCreateFolderDialog([activePage.id]);
                        return;
                      }

                      const value = selectedValue || null;
                      void api.journal
                        .setPageFolder(activePage.id, value)
                        .then(() => refreshPages())
                        .catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                  >
                    <option value="">No folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                    <option value={CREATE_FOLDER_OPTION_VALUE}>Create folder...</option>
                  </select>
                  <input
                    value={tagsInput}
                    placeholder="tags, comma, separated"
                    spellCheck={settings.spellcheck}
                    onChange={(event) => setTagsInput(event.currentTarget.value)}
                    onBlur={() => {
                      void api.journal
                        .setPageTags(activePage.id, parseTags(tagsInput))
                        .then(() => refreshPages())
                        .catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                  />
                  <button
                    type="button"
                    className={historyPanelOpen ? "active-toggle-btn" : undefined}
                    title={settings.historySnapshotsEnabled ? undefined : "History saving is off. Existing snapshots, if any, are still shown here."}
                    onClick={() => {
                      const nextOpen = !historyPanelOpen;
                      setHistoryPanelOpen(nextOpen);
                      if (!nextOpen) {
                        setHistoryPreviewId(null);
                        setHistoryPreviewContent(null);
                      }
                    }}
                  >
                    {settings.historySnapshotsEnabled ? `History (${historyItems.length})` : `History Off (${historyItems.length})`}
                  </button>
                </div>
              </div>

              <div className="editor-with-history">
                <div className="editor-main-area">
                  {historyPreviewContent !== null && (
                    <div className="vh-preview-banner">
                      Previewing version — read only
                      <button type="button" onClick={() => { setHistoryPreviewId(null); setHistoryPreviewContent(null); }}>
                        Exit preview
                      </button>
                    </div>
                  )}
                  <Editor
                    value={historyPreviewContent ?? content}
                    disabled={historyPreviewContent !== null || !activePageId}
                    settings={settings}
                    findRequestToken={editorFindRequestToken}
                    onChange={handleEditorChange}
                  />
                  <div className="editor-stats">
                    <span>
                      {activePage.wordCount} words, {activePage.charCount} characters, {activePage.readingMinutes} min read
                    </span>
                    <span>
                      Updated {new Date(activePage.updatedAt).toLocaleString()} | History:{" "}
                      {settings.historySnapshotsEnabled ? historyItems.length : `${historyItems.length} (saving off)`}
                    </span>
                  </div>
                </div>

                {historyPanelOpen && (
                  <VersionHistoryPanel
                    items={historyItems}
                    historyEnabled={settings.historySnapshotsEnabled}
                    previewingId={historyPreviewId}
                    onPreview={(id) => {
                      void handlePreviewHistoryItem(id).catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                    onRestore={(id) => {
                      void handleRestoreHistoryItem(id).catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                    onDelete={(id) => {
                      void handleDeleteHistoryItem(id).catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                    onDeleteMultiple={(ids) => {
                      void handleDeleteMultipleHistoryItems(ids).catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                    onRename={(id, name) => {
                      void handleRenameHistoryItem(id, name).catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                    onDuplicate={(id) => {
                      void handleDuplicateFromHistory(id).catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                    onClear={() => {
                      void handleClearHistory().catch((error) => setErrorMessage(toErrorMessage(error)));
                    }}
                    onClose={() => {
                      setHistoryPanelOpen(false);
                      setHistoryPreviewId(null);
                      setHistoryPreviewContent(null);
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="status-view">No page selected.</div>
          )}
        </main>
      </div>

      <QuickSwitcher
        pages={allPages.filter((page) => !page.deletedAt)}
        isOpen={!isLocked && quickSwitcherOpen}
        spellcheck={settings.spellcheck}
        onClose={() => setQuickSwitcherOpen(false)}
        onSelect={(pageId) => void handleSelectPage(pageId)}
      />
      <ConfirmDialog
        isOpen={confirmDialog !== null}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        confirmLabel={confirmDialog?.confirmLabel ?? "Confirm"}
        cancelLabel={confirmDialog?.cancelLabel ?? "Cancel"}
        danger={Boolean(confirmDialog?.danger)}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
      <FolderNameDialog
        isOpen={folderNameDialog !== null}
        onConfirm={(name) => void handleConfirmCreateFolder(name)}
        onCancel={() => setFolderNameDialog(null)}
      />
      <ResetDataDialog
        isOpen={resetDataDialogOpen}
        requiredPhrase={RESET_DATA_REQUIRED_PHRASE}
        waitSeconds={RESET_DATA_WAIT_SECONDS}
        onConfirm={() => resolveResetDataDialog(true)}
        onCancel={() => resolveResetDataDialog(false)}
      />
      <ZipKeyDialog
        isOpen={zipKeyDialog !== null}
        mode={zipKeyDialog?.mode ?? "import"}
        onConfirm={(zipKey) => resolveZipKeyDialog(zipKey)}
        onCancel={() => resolveZipKeyDialog(null)}
      />
    </div>
  );
}
