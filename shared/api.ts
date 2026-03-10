import type {
  AppSettings,
  BackupItem,
  ExportFormat,
  ExportResult,
  ImportedFontAsset,
  JournalFolder,
  JournalPage,
  JournalPageMeta,
  JournalUpdateResult,
  MemoryReplayItem,
  PageHistoryItem,
  SearchFilters,
  SearchResult,
  SecurityState,
  SortMode,
  WindowMaximizeState
} from "./types";

export type WindowStateChangeListener = (state: WindowMaximizeState) => void;

export interface JournalApi {
  listPages: (includeTrashed?: boolean, sortMode?: SortMode) => Promise<JournalPageMeta[]>;
  searchPages: (filters: SearchFilters) => Promise<SearchResult[]>;
  createPage: (folderId?: string | null) => Promise<JournalPageMeta>;
  getPage: (pageId: string) => Promise<JournalPage>;
  updatePageContent: (pageId: string, content: string) => Promise<JournalUpdateResult>;
  renamePage: (pageId: string, title: string) => Promise<JournalPageMeta>;
  movePageToTrash: (pageId: string) => Promise<void>;
  restorePageFromTrash: (pageId: string) => Promise<void>;
  deletePagePermanently: (pageId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  setPagePinned: (pageId: string, pinned: boolean) => Promise<JournalPageMeta>;
  setPageTags: (pageId: string, tags: string[]) => Promise<JournalPageMeta>;
  setPageFolder: (pageId: string, folderId: string | null) => Promise<JournalPageMeta>;
  listFolders: () => Promise<JournalFolder[]>;
  createFolder: (name: string) => Promise<JournalFolder>;
  deleteFolder: (folderId: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  importFonts: () => Promise<AppSettings>;
  removeImportedFont: (fontId: string) => Promise<AppSettings>;
  listImportedFontAssets: () => Promise<ImportedFontAsset[]>;
  getSecurityState: () => Promise<SecurityState>;
  enablePin: (newPin: string) => Promise<void>;
  unlock: (pin: string) => Promise<SecurityState>;
  changePin: (currentPin: string, newPin: string) => Promise<void>;
  disablePin: (pin: string) => Promise<void>;
  lock: () => Promise<SecurityState>;
  resetEncryptedData: () => Promise<void>;
  listPageHistory: (pageId: string) => Promise<PageHistoryItem[]>;
  restorePageHistory: (pageId: string, historyId: string) => Promise<JournalUpdateResult>;
  deletePageHistory: (pageId: string, historyId: string) => Promise<void>;
  clearPageHistory: (pageId: string) => Promise<void>;
  clearAllHistory: () => Promise<void>;
  createBackup: () => Promise<BackupItem>;
  listBackups: () => Promise<BackupItem[]>;
  restoreBackup: (backupId: string) => Promise<void>;
  listOnThisDayMemories: () => Promise<MemoryReplayItem[]>;
  generateReview: (period: "month" | "year", year: number, month?: number) => Promise<JournalPageMeta>;
  exportData: (format: ExportFormat, encryptedZipKey?: string) => Promise<ExportResult | null>;
  importData: (encryptedZipKey?: string) => Promise<void>;
  getLastOpenedPageId: () => Promise<string | null>;
  setLastOpenedPageId: (pageId: string | null) => Promise<void>;
}

export interface WindowApi {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<WindowMaximizeState>;
  close: () => Promise<void>;
  isMaximized: () => Promise<WindowMaximizeState>;
  onStateChanged: (listener: WindowStateChangeListener) => () => void;
  openExternalLink: (url: string) => Promise<void>;
}

export interface JournalAppApi {
  journal: JournalApi;
  window: WindowApi;
}
