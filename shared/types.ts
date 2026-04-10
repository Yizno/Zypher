export type SearchScope = "all" | "title" | "content";
export type SortMode = "recent" | "created" | "alphabetical";
export type ThemeMode = "matte" | "graphite" | "high-contrast";
export type ExportFormat = "json" | "json-encrypted" | "encrypted-zip" | "html" | "txt" | "md";
export type ImportedFontFormat = "truetype" | "opentype" | "woff" | "woff2";

export interface JournalPageMeta {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  pinned: boolean;
  tags: string[];
  folderId: string | null;
  charCount: number;
  wordCount: number;
  readingMinutes: number;
}

export interface JournalPage {
  id: string;
  content: string;
}

export interface JournalIndex {
  version: number;
  lastOpenedPageId: string | null;
  pages: JournalPageMeta[];
  folders: JournalFolder[];
  settings: AppSettings;
  lastAutoBackupAt: string | null;
}

export interface JournalUpdateResult {
  updatedAt: string;
  title: string;
  preview: string;
  charCount: number;
  wordCount: number;
  readingMinutes: number;
}

export interface JournalFolder {
  id: string;
  name: string;
  createdAt: string;
}

export interface ShortcutSettings {
  newPage: string;
  focusSearch: string;
  quickSwitcher: string;
  toggleSidebar: string;
  openSettings: string;
  lockApp: string;
}

export interface ImportedFont {
  id: string;
  family: string;
  fileName: string;
  originalName: string;
  format: ImportedFontFormat;
  importedAt: string;
}

export interface ImportedFontAsset extends ImportedFont {
  fileUrl: string;
}

export interface AppSettings {
  theme: ThemeMode;
  accentColor: string;
  highContrast: boolean;
  defaultFont: string;
  importedFonts: ImportedFont[];
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  spellcheck: boolean;
  autosaveDelayMs: number;
  historySnapshotsEnabled: boolean;
  idleLockMinutes: number;
  selfDestructOnFailedPin: boolean;
  selfDestructPinFailureLimit: number;
  allowResetFromLockScreen: boolean;
  openLastPageOnLaunch: boolean;
  sidebarOpenByDefault: boolean;
  launchPopupsEnabled: boolean;
  shortcuts: ShortcutSettings;
}

export interface SearchFilters {
  query: string;
  scope: SearchScope;
  startDate: string | null;
  endDate: string | null;
  sortMode: SortMode;
  folderId: string | null;
  tags: string[];
  includeTrashed?: boolean;
}

export interface SearchResult {
  page: JournalPageMeta;
  matchTitle: boolean;
  matchPreview: boolean;
}

export interface MemoryReplayItem {
  id: string;
  pageId: string;
  title: string;
  preview: string;
  createdAt: string;
  yearOffset: number;
}

export interface PageHistoryItem {
  id: string;
  createdAt: string;
  name: string | null;
}

export interface PageHistoryContent {
  id: string;
  content: string;
}

export interface BackupItem {
  id: string;
  createdAt: string;
  filePath: string;
}

export interface ExportResult {
  filePath: string;
  format: ExportFormat;
}

export interface WindowMaximizeState {
  isMaximized: boolean;
  isFullScreen: boolean;
  isHtmlFullScreen: boolean;
}

export interface SecurityState {
  pinEnabled: boolean;
  locked: boolean;
  cooldownUntil: string | null;
  failedAttempts: number;
  allowResetFromLockScreen: boolean;
}
