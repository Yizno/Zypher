import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";

import {
  DEFAULT_FONT_FAMILY,
  getImportedFontFormatFromFileName,
  getSelectableFontFamilies,
  makeUniqueImportedFontFamily,
  normalizeDefaultFontFamily,
  normalizeImportedFontFamilyCandidate,
  normalizeImportedFonts
} from "../shared/fonts";
import { normalizeJournalHtml } from "../shared/htmlSecurity";
import { computeCounts, derivePreview, stripHtml, UNTITLED_TITLE } from "../shared/journalText";
import { sortPages } from "../shared/pageMeta";
import {
  formatAccessDate,
  getNextMonthlyReviewAccessDate,
  getNextYearlyReviewAccessDate,
  getReviewTags,
  isMonthlyReviewAccessDate,
  isYearlyReviewAccessDate
} from "../shared/reviewWindows";
import type {
  AppSettings,
  BackupItem,
  ExportFormat,
  ExportResult,
  ImportedFont,
  ImportedFontAsset,
  JournalFolder,
  JournalIndex,
  JournalPage,
  JournalPageMeta,
  JournalUpdateResult,
  MemoryReplayItem,
  PageHistoryContent,
  PageHistoryItem,
  SearchFilters,
  SearchResult,
  SecurityState,
  SortMode
} from "../shared/types";
import {
  DEFAULT_SELF_DESTRUCT_PIN_FAILURE_LIMIT,
  type EncryptionEnvelope,
  type KdfConfig,
  type SecurityMetadata,
  SecurityError,
  createDisabledSecurityMetadata,
  createEnabledSecurityMetadata,
  decryptUtf8,
  deriveKey,
  ensureValidPin,
  encryptUtf8,
  isEncryptionEnvelope,
  normalizeSelfDestructPinFailureLimit,
  toSecurityState,
  verifyPin
} from "./security";

const INDEX_VERSION = 2;
const AUTO_BACKUP_INTERVAL_MS = 1000 * 60 * 30;
const HISTORY_LIMIT_PER_PAGE = 50;
const HISTORY_SNAPSHOT_MIN_INTERVAL_MS = 5000;
const MAX_LEGACY_ZIP_KEYS = 24;
const MAX_IMPORT_PAGE_COUNT = 10_000;
const MAX_IMPORT_PAGE_CONTENT_LENGTH = 2_000_000;
const MAX_ENCRYPTED_ZIP_FILE_COUNT = 5_000;
const MAX_ENCRYPTED_ZIP_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ENCRYPTED_ZIP_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_IMPORTED_FONT_FILE_BYTES = 20 * 1024 * 1024;
const SECURITY_METADATA_FILENAME = "security.json";
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LEGACY_ENCRYPTED_ZIP_IMPORT_ERROR =
  "This encrypted ZIP backup uses legacy in-app security metadata and cannot be imported safely. Export a fresh encrypted ZIP backup from the latest app version.";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "matte",
  accentColor: "#6d7e98",
  highContrast: false,
  defaultFont: DEFAULT_FONT_FAMILY,
  importedFonts: [],
  fontSize: 16,
  lineHeight: 1.65,
  tabSize: 2,
  spellcheck: true,
  autosaveDelayMs: 500,
  historySnapshotsEnabled: true,
  idleLockMinutes: 10,
  selfDestructOnFailedPin: false,
  selfDestructPinFailureLimit: DEFAULT_SELF_DESTRUCT_PIN_FAILURE_LIMIT,
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

interface StoredPageFile {
  id: string;
  content: string;
}

interface BackupBundle {
  version: number;
  createdAt: string;
  index: JournalIndex;
  pages: StoredPageFile[];
}

interface EncryptedExportBundle {
  version: number;
  createdAt: string;
  encrypted: true;
  payload: EncryptionEnvelope;
}

interface FullBackupFile {
  path: string;
  data: string;
}

interface FullBackupBundle {
  version: number;
  createdAt: string;
  kind: "zypher-full-backup";
  files: FullBackupFile[];
}

interface EncryptedZipBundle {
  version: number;
  createdAt: string;
  kind: "zypher-encrypted-zip";
  encrypted: true;
  kdf: KdfConfig | null;
  payload: EncryptionEnvelope;
}

const ENCRYPTED_ZIP_ENTRY = "zypher-encrypted-backup.json";
const ON_THIS_DAY_YEAR_OFFSETS = [1, 2, 5] as const;
const ZIP_KEY_MIN_LENGTH = 4;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))];
}

function parseTimestamp(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function cloneEnvelope(envelope: EncryptionEnvelope | null): EncryptionEnvelope | null {
  if (!envelope) {
    return null;
  }
  return {
    version: envelope.version,
    alg: envelope.alg,
    iv: envelope.iv,
    tag: envelope.tag,
    data: envelope.data
  };
}

function cloneSecurityMetadata(metadata: SecurityMetadata): SecurityMetadata {
  return {
    version: metadata.version,
    enabled: metadata.enabled,
    kdf: metadata.kdf
      ? {
          salt: metadata.kdf.salt,
          keyLength: metadata.kdf.keyLength,
          cost: metadata.kdf.cost,
          blockSize: metadata.kdf.blockSize,
          parallelization: metadata.kdf.parallelization
        }
      : null,
    verifier: cloneEnvelope(metadata.verifier),
    verifierDigest: metadata.verifierDigest,
    failedAttempts: metadata.failedAttempts,
    cooldownUntil: metadata.cooldownUntil,
    selfDestructOnFailedPin: metadata.selfDestructOnFailedPin,
    selfDestructPinFailureLimit: metadata.selfDestructPinFailureLimit,
    allowResetFromLockScreen: metadata.allowResetFromLockScreen,
    legacyZipKeys: metadata.legacyZipKeys.map((envelope) => ({
      version: envelope.version,
      alg: envelope.alg,
      iv: envelope.iv,
      tag: envelope.tag,
      data: envelope.data
    }))
  };
}

function parseKdfConfig(input: unknown): KdfConfig | null {
  if (!isObject(input)) {
    return null;
  }

  const salt = typeof input.salt === "string" ? input.salt : "";
  const keyLength = typeof input.keyLength === "number" ? input.keyLength : 32;
  const cost = typeof input.cost === "number" ? input.cost : 16_384;
  const blockSize = typeof input.blockSize === "number" ? input.blockSize : 8;
  const parallelization = typeof input.parallelization === "number" ? input.parallelization : 1;

  if (!salt || !Number.isFinite(keyLength) || !Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelization)) {
    return null;
  }

  return {
    salt,
    keyLength,
    cost,
    blockSize,
    parallelization
  };
}

function createZipKdfConfig(): KdfConfig {
  return {
    salt: randomBytes(16).toString("base64"),
    keyLength: 32,
    cost: 16_384,
    blockSize: 8,
    parallelization: 1
  };
}

function normalizeEncryptedZipKey(encryptedZipKey: string | undefined): string {
  const normalized = encryptedZipKey ?? "";
  if (normalized.length < ZIP_KEY_MIN_LENGTH) {
    throw new SecurityError("ZIP_KEY_REQUIRED", `Encrypted ZIP key must be at least ${ZIP_KEY_MIN_LENGTH} characters.`);
  }
  return normalized;
}

function safeFileId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function mergeSettings(partial: Partial<AppSettings>, current: AppSettings): AppSettings {
  const importedFonts = normalizeImportedFonts(partial.importedFonts ?? current.importedFonts);
  return {
    ...current,
    ...partial,
    defaultFont: normalizeDefaultFontFamily(
      typeof partial.defaultFont === "string" ? partial.defaultFont : current.defaultFont,
      importedFonts
    ),
    importedFonts,
    fontSize: Number.isFinite(partial.fontSize) ? Math.max(12, Math.min(30, partial.fontSize ?? current.fontSize)) : current.fontSize,
    lineHeight: Number.isFinite(partial.lineHeight)
      ? Math.max(1.2, Math.min(2.2, partial.lineHeight ?? current.lineHeight))
      : current.lineHeight,
    tabSize: Number.isFinite(partial.tabSize) ? Math.max(1, Math.min(8, partial.tabSize ?? current.tabSize)) : current.tabSize,
    autosaveDelayMs: Number.isFinite(partial.autosaveDelayMs)
      ? Math.max(200, Math.min(5000, partial.autosaveDelayMs ?? current.autosaveDelayMs))
      : current.autosaveDelayMs,
    historySnapshotsEnabled:
      typeof partial.historySnapshotsEnabled === "boolean" ? partial.historySnapshotsEnabled : current.historySnapshotsEnabled,
    idleLockMinutes: Number.isFinite(partial.idleLockMinutes)
      ? Math.max(1, Math.min(180, partial.idleLockMinutes ?? current.idleLockMinutes))
      : current.idleLockMinutes,
    selfDestructOnFailedPin:
      typeof partial.selfDestructOnFailedPin === "boolean" ? partial.selfDestructOnFailedPin : current.selfDestructOnFailedPin,
    selfDestructPinFailureLimit: Number.isFinite(partial.selfDestructPinFailureLimit)
      ? normalizeSelfDestructPinFailureLimit(partial.selfDestructPinFailureLimit ?? current.selfDestructPinFailureLimit)
      : current.selfDestructPinFailureLimit,
    allowResetFromLockScreen:
      typeof partial.allowResetFromLockScreen === "boolean" ? partial.allowResetFromLockScreen : current.allowResetFromLockScreen,
    launchPopupsEnabled:
      typeof partial.launchPopupsEnabled === "boolean" ? partial.launchPopupsEnabled : current.launchPopupsEnabled,
    shortcuts: {
      ...current.shortcuts,
      ...(partial.shortcuts ?? {})
    }
  };
}

export class JournalStore {
  private readonly journalDir: string;
  private readonly pagesDir: string;
  private readonly historyDir: string;
  private readonly backupsDir: string;
  private readonly exportsDir: string;
  private readonly fontsDir: string;
  private readonly indexPath: string;
  private readonly securityPath: string;
  private readyPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly historySnapshotAt = new Map<string, number>();
  private securityMeta: SecurityMetadata = createDisabledSecurityMetadata();
  private unlockedKey: Buffer | null = null;

  constructor(basePath: string) {
    this.journalDir = path.join(basePath, "journal");
    this.pagesDir = path.join(this.journalDir, "pages");
    this.historyDir = path.join(this.journalDir, "history");
    this.backupsDir = path.join(this.journalDir, "backups");
    this.exportsDir = path.join(this.journalDir, "exports");
    this.fontsDir = path.join(this.journalDir, "fonts");
    this.indexPath = path.join(this.journalDir, "index.json");
    this.securityPath = path.join(this.journalDir, "security.json");
  }

  async listPages(includeTrashed = false, sortMode: SortMode = "recent"): Promise<JournalPageMeta[]> {
    await this.ensureReady();
    const index = await this.readIndex();
    const filtered = includeTrashed ? index.pages : index.pages.filter((page) => !page.deletedAt);
    return sortPages(filtered, sortMode);
  }

  async searchPages(filters: SearchFilters): Promise<SearchResult[]> {
    await this.ensureReady();
    const index = await this.readIndex();
    const normalizedQuery = filters.query.trim().toLowerCase();
    const tags = normalizeTags(filters.tags);
    const start = parseTimestamp(filters.startDate);
    const end = parseTimestamp(filters.endDate);

    const candidates = index.pages.filter((page) => {
      if (!filters.includeTrashed && page.deletedAt) {
        return false;
      }

      if (filters.folderId && page.folderId !== filters.folderId) {
        return false;
      }

      if (tags.length > 0 && !tags.every((tag) => page.tags.includes(tag))) {
        return false;
      }

      const updatedAt = parseTimestamp(page.updatedAt);
      if (start > 0 && updatedAt < start) {
        return false;
      }

      if (end > 0 && updatedAt > end + 1000 * 60 * 60 * 24) {
        return false;
      }

      return true;
    });

    const results: SearchResult[] = candidates
      .map((page) => {
        const titleLower = page.title.toLowerCase();
        const previewLower = page.preview.toLowerCase();
        const matchTitle = normalizedQuery.length === 0 || titleLower.includes(normalizedQuery);
        const matchPreview = normalizedQuery.length === 0 || previewLower.includes(normalizedQuery);

        if (filters.scope === "title" && !matchTitle) {
          return null;
        }

        if (filters.scope === "content" && !matchPreview) {
          return null;
        }

        if (filters.scope === "all" && normalizedQuery.length > 0 && !matchTitle && !matchPreview) {
          return null;
        }

        return {
          page,
          matchTitle,
          matchPreview
        };
      })
      .filter((result): result is SearchResult => result !== null);

    const sorted = sortPages(
      results.map((entry) => entry.page),
      filters.sortMode
    );
    const byId = new Map(results.map((entry) => [entry.page.id, entry]));
    return sorted.map((page) => byId.get(page.id)!).filter(Boolean);
  }

  async createPage(folderId: string | null = null): Promise<JournalPageMeta> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const now = new Date().toISOString();
      const pageId = randomUUID();
      const meta: JournalPageMeta = {
        id: pageId,
        title: UNTITLED_TITLE,
        preview: "",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        pinned: false,
        tags: [],
        folderId,
        charCount: 0,
        wordCount: 0,
        readingMinutes: 0
      };

      index.pages = [meta, ...index.pages.filter((page) => page.id !== pageId)];
      index.lastOpenedPageId = pageId;

      await this.writePageFile(pageId, "<p></p>");
      await this.writeIndex(index);
      return meta;
    });
  }

  async getPage(pageId: string): Promise<JournalPage> {
    await this.ensureReady();
    const index = await this.readIndex();
    if (!index.pages.some((page) => page.id === pageId)) {
      throw new Error(`Page not found: ${pageId}`);
    }

    const content = await this.readPageFile(pageId);
    return {
      id: pageId,
      content
    };
  }

  async updatePageContent(pageId: string, content: string): Promise<JournalUpdateResult> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      const sanitizedContent = normalizeJournalHtml(content);

      const result = this.applyContentToMeta(meta, sanitizedContent);
      await this.writePageFile(pageId, sanitizedContent);
      await this.recordHistorySnapshot(pageId, sanitizedContent, index.settings.historySnapshotsEnabled);
      index.pages = sortPages(index.pages, "recent");

      await this.maybeAutoBackup(index);
      await this.writeIndex(index);
      return result;
    });
  }

  async renamePage(pageId: string, title: string): Promise<JournalPageMeta> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      meta.title = title.trim().slice(0, 120) || UNTITLED_TITLE;
      meta.updatedAt = new Date().toISOString();
      index.pages = sortPages(index.pages, "recent");
      await this.writeIndex(index);
      return meta;
    });
  }

  async movePageToTrash(pageId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      meta.deletedAt = new Date().toISOString();
      meta.updatedAt = meta.deletedAt;
      if (index.lastOpenedPageId === pageId) {
        index.lastOpenedPageId = null;
      }
      await this.writeIndex(index);
    });
  }

  async restorePageFromTrash(pageId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      meta.deletedAt = null;
      meta.updatedAt = new Date().toISOString();
      index.pages = sortPages(index.pages, "recent");
      await this.writeIndex(index);
    });
  }

  async deletePagePermanently(pageId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      index.pages = index.pages.filter((page) => page.id !== pageId);
      if (index.lastOpenedPageId === pageId) {
        index.lastOpenedPageId = null;
      }

      await this.deletePageArtifacts(pageId);
      await this.writeIndex(index);
    });
  }

  async emptyTrash(): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const trashedIds = index.pages.filter((page) => page.deletedAt).map((page) => page.id);
      index.pages = index.pages.filter((page) => !page.deletedAt);
      if (index.lastOpenedPageId && trashedIds.includes(index.lastOpenedPageId)) {
        index.lastOpenedPageId = null;
      }

      await Promise.all(trashedIds.map((id) => this.deletePageArtifacts(id)));
      await this.writeIndex(index);
    });
  }

  async setPagePinned(pageId: string, pinned: boolean): Promise<JournalPageMeta> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      meta.pinned = pinned;
      await this.writeIndex(index);
      return meta;
    });
  }

  async setPageTags(pageId: string, tags: string[]): Promise<JournalPageMeta> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      meta.tags = normalizeTags(tags);
      meta.updatedAt = new Date().toISOString();
      await this.writeIndex(index);
      return meta;
    });
  }

  async setPageFolder(pageId: string, folderId: string | null): Promise<JournalPageMeta> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      if (folderId && !index.folders.some((folder) => folder.id === folderId)) {
        throw new Error("Folder not found.");
      }

      meta.folderId = folderId;
      meta.updatedAt = new Date().toISOString();
      await this.writeIndex(index);
      return meta;
    });
  }

  async listFolders(): Promise<JournalFolder[]> {
    await this.ensureReady();
    const index = await this.readIndex();
    return [...index.folders].sort((left, right) => left.name.localeCompare(right.name));
  }

  async createFolder(name: string): Promise<JournalFolder> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const normalizedName = name.trim();
      if (!normalizedName) {
        throw new Error("Folder name cannot be empty.");
      }

      if (index.folders.some((folder) => folder.name.toLowerCase() === normalizedName.toLowerCase())) {
        throw new Error("Folder already exists.");
      }

      const folder: JournalFolder = {
        id: randomUUID(),
        name: normalizedName,
        createdAt: new Date().toISOString()
      };
      index.folders.push(folder);
      await this.writeIndex(index);
      return folder;
    });
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      index.folders = index.folders.filter((folder) => folder.id !== folderId);
      index.pages = index.pages.map((page) => ({
        ...page,
        folderId: page.folderId === folderId ? null : page.folderId
      }));
      await this.writeIndex(index);
    });
  }

  async getSettings(): Promise<AppSettings> {
    await this.ensureReady();
    const index = await this.readIndex();
    return index.settings;
  }

  async updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      index.settings = mergeSettings(partial, index.settings);
      await this.writeIndex(index);
      if (
        partial.selfDestructOnFailedPin !== undefined ||
        partial.selfDestructPinFailureLimit !== undefined ||
        partial.allowResetFromLockScreen !== undefined
      ) {
        this.syncSecuritySettings(index.settings);
        await this.writeSecurityMetadata();
      }
      return index.settings;
    });
  }

  async importFonts(filePaths: string[]): Promise<AppSettings> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const uniqueFilePaths = [...new Set(filePaths.map((filePath) => filePath.trim()).filter(Boolean))];
      const index = await this.readIndex();
      if (uniqueFilePaths.length === 0) {
        return index.settings;
      }

      const nextImportedFonts = [...index.settings.importedFonts];
      const existingFamilies = getSelectableFontFamilies(nextImportedFonts);
      for (const sourcePath of uniqueFilePaths) {
        const sourceStat = await fs.stat(sourcePath);
        if (!sourceStat.isFile()) {
          throw new Error("Selected font is not a file.");
        }
        if (sourceStat.size <= 0 || sourceStat.size > MAX_IMPORTED_FONT_FILE_BYTES) {
          throw new Error("Imported fonts must be between 1 byte and 20 MB.");
        }

        const originalName = path.basename(sourcePath);
        const format = getImportedFontFormatFromFileName(originalName);
        if (!format) {
          throw new Error("Unsupported font file. Import a .ttf, .otf, .woff, or .woff2 font.");
        }

        const fontBytes = await fs.readFile(sourcePath);
        const fontId = randomUUID();
        const fileName = `${fontId}${path.extname(originalName).toLowerCase()}`;
        const family = makeUniqueImportedFontFamily(
          normalizeImportedFontFamilyCandidate(path.parse(originalName).name),
          existingFamilies
        );
        existingFamilies.push(family);
        await this.atomicWriteBuffer(path.join(this.fontsDir, fileName), fontBytes);
        nextImportedFonts.push({
          id: fontId,
          family,
          fileName,
          originalName,
          format,
          importedAt: new Date().toISOString()
        });
      }

      index.settings = mergeSettings({ importedFonts: nextImportedFonts }, index.settings);
      await this.writeIndex(index);
      return index.settings;
    });
  }

  async removeImportedFont(fontId: string): Promise<AppSettings> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const safeFontId = this.requireSafeFontId(fontId);
      const index = await this.readIndex();
      const target = index.settings.importedFonts.find((font) => font.id === safeFontId);
      if (!target) {
        return index.settings;
      }

      index.settings = mergeSettings(
        {
          importedFonts: index.settings.importedFonts.filter((font) => font.id !== safeFontId),
          defaultFont: index.settings.defaultFont === target.family ? DEFAULT_FONT_FAMILY : index.settings.defaultFont
        },
        index.settings
      );
      await fs.rm(this.getImportedFontFilePath(target), { force: true });
      await this.writeIndex(index);
      return index.settings;
    });
  }

  async listImportedFontAssets(): Promise<ImportedFontAsset[]> {
    await this.ensureReady();
    const index = await this.readIndex();
    return index.settings.importedFonts.map((font) => ({
      ...font,
      fileUrl: pathToFileURL(this.getImportedFontFilePath(font)).toString()
    }));
  }

  async getSecurityState(): Promise<SecurityState> {
    await this.ensureReady(true);
    return toSecurityState(this.securityMeta, this.isLocked());
  }

  async enablePin(newPin: string): Promise<void> {
    return this.withWriteLock(async () => {
      await this.ensureReady(true);
      if (this.securityMeta.enabled) {
        throw new SecurityError("PIN_ALREADY_ENABLED", "Password protection is already enabled.");
      }

      ensureValidPin(newPin);
      const index = await this.readIndex();
      const { metadata, key } = await createEnabledSecurityMetadata(newPin);
      metadata.selfDestructOnFailedPin = index.settings.selfDestructOnFailedPin;
      metadata.selfDestructPinFailureLimit = normalizeSelfDestructPinFailureLimit(index.settings.selfDestructPinFailureLimit);
      metadata.allowResetFromLockScreen = index.settings.allowResetFromLockScreen;
      await this.encryptAllStorageFiles(key);
      this.securityMeta = metadata;
      this.unlockedKey = key;
      await this.writeSecurityMetadata();
    });
  }

  async unlock(pin: string): Promise<SecurityState> {
    return this.withWriteLock(async () => {
      await this.ensureReady(true);
      if (!this.securityMeta.enabled) {
        return toSecurityState(this.securityMeta, false);
      }

      const now = Date.now();
      const cooldownUntil = parseTimestamp(this.securityMeta.cooldownUntil);
      if (cooldownUntil > now) {
        const seconds = Math.max(1, Math.ceil((cooldownUntil - now) / 1000));
        throw new SecurityError("PIN_COOLDOWN", `Too many failed attempts. Try again in ${seconds}s.`);
      }

      const key = await verifyPin(this.securityMeta, pin);
      if (!key) {
        await this.registerFailedPinAttempt();
        throw new SecurityError("INVALID_PIN", "Incorrect password.");
      }

      this.unlockedKey = key;
      this.securityMeta.failedAttempts = 0;
      this.securityMeta.cooldownUntil = null;
      await this.writeSecurityMetadata();
      return toSecurityState(this.securityMeta, this.isLocked());
    });
  }

  async changePin(currentPin: string, newPin: string): Promise<void> {
    return this.withWriteLock(async () => {
      await this.ensureReady(true);
      if (!this.securityMeta.enabled) {
        throw new SecurityError("PIN_NOT_ENABLED", "Password protection is not enabled.");
      }

      ensureValidPin(newPin);
      const oldKey = await verifyPin(this.securityMeta, currentPin);
      if (!oldKey) {
        await this.registerFailedPinAttempt();
        throw new SecurityError("INVALID_PIN", "Incorrect current password.");
      }

      const previousSelfDestructOnFailedPin = this.securityMeta.selfDestructOnFailedPin;
      const previousSelfDestructPinFailureLimit = this.securityMeta.selfDestructPinFailureLimit;
      const previousAllowResetFromLockScreen = this.securityMeta.allowResetFromLockScreen;
      const { metadata, key: newKey } = await createEnabledSecurityMetadata(newPin);
      const legacyZipKeys = this.buildLegacyZipKeyEnvelopesForNewKey(oldKey, newKey);
      await this.reencryptAllStorageFiles(oldKey, newKey);
      this.securityMeta = metadata;
      this.securityMeta.selfDestructOnFailedPin = previousSelfDestructOnFailedPin;
      this.securityMeta.selfDestructPinFailureLimit = normalizeSelfDestructPinFailureLimit(previousSelfDestructPinFailureLimit);
      this.securityMeta.allowResetFromLockScreen = previousAllowResetFromLockScreen;
      this.securityMeta.legacyZipKeys = legacyZipKeys;
      this.unlockedKey = newKey;
      await this.writeSecurityMetadata();
    });
  }

  async disablePin(pin: string): Promise<void> {
    return this.withWriteLock(async () => {
      await this.ensureReady(true);
      if (!this.securityMeta.enabled) {
        return;
      }

      const key = await verifyPin(this.securityMeta, pin);
      if (!key) {
        await this.registerFailedPinAttempt();
        throw new SecurityError("INVALID_PIN", "Incorrect password.");
      }

      await this.decryptAllStorageFiles(key);
      const index = await this.readIndex();
      this.securityMeta = createDisabledSecurityMetadata();
      this.securityMeta.allowResetFromLockScreen = index.settings.allowResetFromLockScreen;
      this.unlockedKey = null;
      await this.writeSecurityMetadata();
    });
  }

  async lock(): Promise<SecurityState> {
    return this.withWriteLock(async () => {
      await this.ensureReady(true);
      this.unlockedKey = null;
      return toSecurityState(this.securityMeta, this.isLocked());
    });
  }

  async resetEncryptedData(): Promise<void> {
    return this.withWriteLock(async () => {
      await this.ensureReady(true);
      await this.wipeAllJournalData();
    });
  }

  async listPageHistory(pageId: string): Promise<PageHistoryItem[]> {
    await this.ensureReady();
    const directory = this.getHistoryPageDir(pageId);
    await fs.mkdir(directory, { recursive: true });
    const files = await fs.readdir(directory);
    const names = await this.readHistoryNames(directory);
    const withStats = await Promise.all(
      files
        .filter((name) => name.endsWith(".json") && name !== "_names.json")
        .map(async (name) => {
          const filePath = path.join(directory, name);
          const stat = await fs.stat(filePath);
          const id = name.replace(/\.json$/i, "");
          return {
            id,
            createdAt: stat.mtime.toISOString(),
            name: names[id] ?? null
          };
        })
    );
    return withStats.sort((left, right) => parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt));
  }

  async getPageHistoryContent(pageId: string, historyId: string): Promise<PageHistoryContent> {
    await this.ensureReady();
    const historyPath = path.join(this.getHistoryPageDir(pageId), `${this.requireSafeHistoryId(historyId)}.json`);
    const raw = await this.readJournalFile(historyPath);
    const parsed = JSON.parse(raw) as StoredPageFile;
    return { id: historyId, content: typeof parsed.content === "string" ? parsed.content : "" };
  }

  async renamePageHistory(pageId: string, historyId: string, name: string | null): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      this.requireSafeHistoryId(historyId);
      const directory = this.getHistoryPageDir(pageId);
      const names = await this.readHistoryNames(directory);
      if (name === null || name.trim().length === 0) {
        delete names[historyId];
      } else {
        names[historyId] = name.trim();
      }
      await this.writeHistoryNames(directory, names);
    });
  }

  async duplicateFromHistory(pageId: string, historyId: string): Promise<JournalPageMeta> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const historyPath = path.join(this.getHistoryPageDir(pageId), `${this.requireSafeHistoryId(historyId)}.json`);
      const raw = await this.readJournalFile(historyPath);
      const parsed = JSON.parse(raw) as StoredPageFile;
      const content = typeof parsed.content === "string" ? parsed.content : "";

      const index = await this.readIndex();
      const sourceMeta = this.getMetaOrThrow(index, pageId);
      const newId = randomUUID();
      const now = new Date().toISOString();
      const { charCount, wordCount, readingMinutes } = computeCounts(stripHtml(content));
      const newMeta: JournalPageMeta = {
        id: newId,
        title: `${sourceMeta.title} (copy)`,
        preview: derivePreview(content),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        pinned: false,
        tags: [...sourceMeta.tags],
        folderId: sourceMeta.folderId,
        charCount,
        wordCount,
        readingMinutes
      };
      index.pages.unshift(newMeta);
      await this.writePageFile(newId, content);
      await this.writeIndex(index);
      return newMeta;
    });
  }

  async deleteMultiplePageHistory(pageId: string, historyIds: string[]): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const directory = this.getHistoryPageDir(pageId);
      const names = await this.readHistoryNames(directory);
      let namesChanged = false;
      await Promise.all(
        historyIds.map(async (historyId) => {
          const safeId = this.requireSafeHistoryId(historyId);
          const historyPath = path.join(directory, `${safeId}.json`);
          await fs.rm(historyPath, { force: true });
          if (names[historyId]) {
            delete names[historyId];
            namesChanged = true;
          }
        })
      );
      if (namesChanged) {
        await this.writeHistoryNames(directory, names);
      }
    });
  }

  async restorePageHistory(pageId: string, historyId: string): Promise<JournalUpdateResult> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const historyPath = path.join(this.getHistoryPageDir(pageId), `${this.requireSafeHistoryId(historyId)}.json`);
      const raw = await this.readJournalFile(historyPath);
      const parsed = JSON.parse(raw) as StoredPageFile;
      const content = typeof parsed.content === "string" ? parsed.content : "";

      const index = await this.readIndex();
      const meta = this.getMetaOrThrow(index, pageId);
      const result = this.applyContentToMeta(meta, content);

      await this.writePageFile(pageId, content);
      await this.recordHistorySnapshot(pageId, content, index.settings.historySnapshotsEnabled);
      await this.writeIndex(index);
      return result;
    });
  }

  async deletePageHistory(pageId: string, historyId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const directory = this.getHistoryPageDir(pageId);
      const safeId = this.requireSafeHistoryId(historyId);
      await fs.rm(path.join(directory, `${safeId}.json`), { force: true });
      const names = await this.readHistoryNames(directory);
      if (names[historyId]) {
        delete names[historyId];
        await this.writeHistoryNames(directory, names);
      }
    });
  }

  async clearPageHistory(pageId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const directory = this.getHistoryPageDir(pageId);
      let files: string[] = [];
      try {
        files = await fs.readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw error;
      }

      await Promise.all(
        files.filter((name) => name.endsWith(".json")).map((name) => fs.rm(path.join(directory, name), { force: true }))
      );
    });
  }

  async clearAllHistory(): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      await fs.rm(this.historyDir, { recursive: true, force: true });
      await fs.mkdir(this.historyDir, { recursive: true });
      this.historySnapshotAt.clear();
    });
  }

  async createBackup(): Promise<BackupItem> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      const backup = await this.writeBackupBundle(index);
      await this.writeIndex(index);
      return backup;
    });
  }

  async listBackups(): Promise<BackupItem[]> {
    await this.ensureReady();
    await fs.mkdir(this.backupsDir, { recursive: true });
    const files = await fs.readdir(this.backupsDir);
    const items = await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const filePath = path.join(this.backupsDir, name);
          let createdAt = new Date((await fs.stat(filePath)).mtimeMs).toISOString();
          try {
            const bundle = await this.readBackupBundle(filePath);
            createdAt = bundle.createdAt;
          } catch {
            // Keep file mtime fallback.
          }

          return {
            id: name.replace(/\.json$/i, ""),
            createdAt,
            filePath
          };
        })
    );
    return items.sort((left, right) => parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt));
  }

  async restoreBackup(backupId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const backupPath = path.join(this.backupsDir, `${this.requireSafeBackupId(backupId)}.json`);
      const bundle = await this.readBackupBundle(backupPath);

      await this.writeBundleToStorage(bundle);
    });
  }

  async listOnThisDayMemories(referenceDate?: string): Promise<MemoryReplayItem[]> {
    await this.ensureReady();
    const index = await this.readIndex();
    const baseDate = referenceDate ? new Date(referenceDate) : new Date();
    const now = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    const currentYear = now.getFullYear();

    const items: MemoryReplayItem[] = [];
    for (const page of index.pages) {
      if (page.deletedAt) {
        continue;
      }

      const created = new Date(page.createdAt);
      if (Number.isNaN(created.getTime())) {
        continue;
      }
      if (created.getMonth() !== currentMonth || created.getDate() !== currentDay) {
        continue;
      }

      const yearOffset = currentYear - created.getFullYear();
      if (!ON_THIS_DAY_YEAR_OFFSETS.includes(yearOffset as (typeof ON_THIS_DAY_YEAR_OFFSETS)[number])) {
        continue;
      }

      items.push({
        id: `${yearOffset}-${page.id}`,
        pageId: page.id,
        title: page.title,
        preview: page.preview,
        createdAt: page.createdAt,
        yearOffset
      });
    }

    return items.sort((left, right) => {
      if (left.yearOffset !== right.yearOffset) {
        return left.yearOffset - right.yearOffset;
      }
      return parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
    });
  }

  async generateReview(period: "month" | "year", year: number, month?: number): Promise<JournalPageMeta> {
    return this.withWriteLock(async () => {
      await this.ensureReady();
      const now = new Date();
      if (period === "month" && !isMonthlyReviewAccessDate(now)) {
        const nextDate = getNextMonthlyReviewAccessDate(now);
        throw new Error(
          `Monthly reviews are only available on the first or last day of a month. Next available: ${formatAccessDate(nextDate)}.`
        );
      }
      if (period === "year" && !isYearlyReviewAccessDate(now)) {
        const nextDate = getNextYearlyReviewAccessDate(now);
        throw new Error(
          `Year in Review is only available from the last 15 days of December to the first 15 days of January. Next available: ${formatAccessDate(nextDate)}.`
        );
      }

      const normalizedYear = Math.trunc(year);
      if (!Number.isFinite(normalizedYear) || normalizedYear < 1970 || normalizedYear > 9999) {
        throw new Error("Invalid year.");
      }

      let normalizedMonth: number | null = null;
      if (period === "month") {
        const monthValue = Math.trunc(Number(month));
        if (!Number.isFinite(monthValue) || monthValue < 1 || monthValue > 12) {
          throw new Error("Invalid month.");
        }
        normalizedMonth = monthValue;
      }

      const rangeStart =
        period === "year" ? new Date(normalizedYear, 0, 1) : new Date(normalizedYear, (normalizedMonth ?? 1) - 1, 1);
      const rangeEnd =
        period === "year" ? new Date(normalizedYear + 1, 0, 1) : new Date(normalizedYear, normalizedMonth ?? 1, 1);
      const startMs = rangeStart.getTime();
      const endMs = rangeEnd.getTime();

      const index = await this.readIndex();
      const entries = index.pages
        .filter((page) => !page.deletedAt)
        .filter((page) => {
          const createdMs = Date.parse(page.createdAt);
          return !Number.isNaN(createdMs) && createdMs >= startMs && createdMs < endMs;
        })
        .sort((left, right) => parseTimestamp(left.createdAt) - parseTimestamp(right.createdAt));

      const totalWords = entries.reduce((sum, page) => sum + page.wordCount, 0);
      const totalChars = entries.reduce((sum, page) => sum + page.charCount, 0);
      const averageWords = entries.length > 0 ? Math.round(totalWords / entries.length) : 0;

      const tagCounts = new Map<string, number>();
      const dayCounts = new Map<string, number>();
      for (const page of entries) {
        for (const tag of page.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
        const dayKey = new Date(page.createdAt).toISOString().slice(0, 10);
        dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);
      }

      const topTags = [...tagCounts.entries()]
        .sort((left, right) => (right[1] !== left[1] ? right[1] - left[1] : left[0].localeCompare(right[0])))
        .slice(0, 8);
      const longestEntries = [...entries]
        .sort((left, right) => (right.wordCount !== left.wordCount ? right.wordCount - left.wordCount : parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt)))
        .slice(0, 5);
      const mostActiveDay = [...dayCounts.entries()].sort((left, right) => right[1] - left[1])[0] ?? null;
      const firstEntry = entries[0] ?? null;
      const lastEntry = entries[entries.length - 1] ?? null;
      const reviewCreatedAt = new Date().toISOString();
      const reviewTitle =
        period === "year"
          ? `Year in Review ${normalizedYear}`
          : `${rangeStart.toLocaleString(undefined, { month: "long" })} ${normalizedYear} Review`;

      const contentParts: string[] = [];
      contentParts.push(`<h1>${escapeHtml(reviewTitle)}</h1>`);
      contentParts.push(`<p>Auto-generated on ${escapeHtml(new Date(reviewCreatedAt).toLocaleString())} from your journal metadata.</p>`);

      if (entries.length === 0) {
        contentParts.push("<p>No entries were created during this period.</p>");
      } else {
        const overviewItems = [
          `Entries created: <strong>${entries.length.toLocaleString()}</strong>`,
          `Words written: <strong>${totalWords.toLocaleString()}</strong>`,
          `Characters written: <strong>${totalChars.toLocaleString()}</strong>`,
          `Average words per entry: <strong>${averageWords.toLocaleString()}</strong>`
        ];
        if (firstEntry) {
          overviewItems.push(`First entry: <strong>${escapeHtml(firstEntry.title)}</strong> (${new Date(firstEntry.createdAt).toLocaleDateString()})`);
        }
        if (lastEntry) {
          overviewItems.push(`Most recent entry: <strong>${escapeHtml(lastEntry.title)}</strong> (${new Date(lastEntry.createdAt).toLocaleDateString()})`);
        }
        if (mostActiveDay) {
          const activeDay = new Date(`${mostActiveDay[0]}T12:00:00`);
          overviewItems.push(
            `Most active day: <strong>${escapeHtml(activeDay.toLocaleDateString())}</strong> (${mostActiveDay[1]} entries)`
          );
        }

        contentParts.push("<h2>Overview</h2>");
        contentParts.push(`<ul>${overviewItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);

        if (topTags.length > 0) {
          contentParts.push("<h2>Top Tags</h2>");
          contentParts.push(
            `<ul>${topTags
              .map(([tag, count]) => `<li><strong>${escapeHtml(tag)}</strong>: ${count}</li>`)
              .join("")}</ul>`
          );
        }

        if (longestEntries.length > 0) {
          contentParts.push("<h2>Longest Entries</h2>");
          contentParts.push(
            `<ol>${longestEntries
              .map(
                (page) =>
                  `<li><strong>${escapeHtml(page.title)}</strong> (${page.wordCount.toLocaleString()} words, ${new Date(page.createdAt).toLocaleDateString()})</li>`
              )
              .join("")}</ol>`
          );
        }
      }

      const reviewContent = contentParts.join("");
      const reviewId = randomUUID();
      const reviewCounts = computeCounts(reviewContent);
      const reviewMeta: JournalPageMeta = {
        id: reviewId,
        title: reviewTitle,
        preview: derivePreview(reviewContent),
        createdAt: reviewCreatedAt,
        updatedAt: reviewCreatedAt,
        deletedAt: null,
        pinned: false,
        tags: normalizeTags(
          getReviewTags(
            period === "year"
              ? { period: "year", year: normalizedYear }
              : { period: "month", year: normalizedYear, month: normalizedMonth ?? 1 }
          )
        ),
        folderId: null,
        charCount: reviewCounts.charCount,
        wordCount: reviewCounts.wordCount,
        readingMinutes: reviewCounts.readingMinutes
      };

      index.pages = [reviewMeta, ...index.pages.filter((page) => page.id !== reviewId)];
      index.lastOpenedPageId = reviewId;

      await this.writePageFile(reviewId, reviewContent);
      await this.writeIndex(index);
      return reviewMeta;
    });
  }

  async exportData(format: ExportFormat, destinationPath?: string, encryptedZipKey?: string): Promise<ExportResult> {
    await this.ensureReady();
    await fs.mkdir(this.exportsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = this.getExportExtension(format);
    const filename = `journal-export-${timestamp}.${extension}`;
    const filePath = this.normalizeExportPath(format, destinationPath ?? path.join(this.exportsDir, filename));

    if (format === "encrypted-zip") {
      await this.writeEncryptedZipExport(filePath, encryptedZipKey);
      return {
        filePath,
        format
      };
    }

    const index = await this.readIndex();
    const pages = await Promise.all(index.pages.filter((page) => !page.deletedAt).map((page) => this.getPage(page.id)));

    let output = "";
    if (format === "json" || format === "json-encrypted") {
      const jsonBundle: BackupBundle = {
        version: INDEX_VERSION,
        createdAt: new Date().toISOString(),
        index,
        pages
      };
      const plainBundle = JSON.stringify(jsonBundle, null, 2);
      if (format === "json-encrypted") {
        if (!this.securityMeta.enabled || !this.unlockedKey) {
          throw new SecurityError("PIN_NOT_ENABLED", "Enable password protection and unlock before creating encrypted export.");
        }
        const encryptedBundle: EncryptedExportBundle = {
          version: INDEX_VERSION,
          createdAt: new Date().toISOString(),
          encrypted: true,
          payload: encryptUtf8(plainBundle, this.unlockedKey)
        };
        output = JSON.stringify(encryptedBundle, null, 2);
      } else {
        output = plainBundle;
      }
    } else if (format === "html") {
      const sections = pages
        .map((page) => {
          const meta = index.pages.find((item) => item.id === page.id);
          return `<section><h2>${meta?.title ?? UNTITLED_TITLE}</h2>${page.content}</section>`;
        })
        .join("\n");
      output = `<!doctype html><html><body>${sections}</body></html>`;
    } else {
      output = pages
        .map((page) => {
          const meta = index.pages.find((item) => item.id === page.id);
          const text = stripHtml(page.content);
          return `# ${meta?.title ?? UNTITLED_TITLE}\n\n${text}`;
        })
        .join("\n\n---\n\n");
    }

    await this.atomicWriteFile(filePath, output);
    return {
      filePath,
      format
    };
  }

  async importData(filePath: string, encryptedZipKey?: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      if (path.extname(filePath).toLowerCase() === ".zip") {
        await this.importEncryptedZip(filePath, encryptedZipKey);
        return;
      }

      const rawImport = await fs.readFile(filePath, "utf8");
      let bundle: BackupBundle;
      try {
        const parsed = JSON.parse(rawImport) as unknown;
        if (
          isObject(parsed) &&
          parsed.encrypted === true &&
          isEncryptionEnvelope((parsed as { payload?: unknown }).payload)
        ) {
          if (!this.securityMeta.enabled || !this.unlockedKey) {
            throw new SecurityError("LOCKED", "Unlock the app before importing encrypted data.");
          }
          const decrypted = this.decryptEncryptedImportPayload((parsed as { payload: EncryptionEnvelope }).payload);
          if (!decrypted) {
            throw new Error("Failed to decrypt encrypted backup. Check the password/key used to create the backup.");
          }
          bundle = this.parseBackupBundle(decrypted);
        } else {
          bundle = this.parseBackupBundle(rawImport);
        }
      } catch (error) {
        if (error instanceof SecurityError) {
          throw error;
        }
        if (error instanceof Error && error.message.startsWith("Failed to decrypt encrypted backup")) {
          throw error;
        }
        throw new Error("Invalid import file.");
      }

      await this.writeBackupBundle(await this.readIndex(), "pre-import");
      await this.writeBundleToStorage(bundle);
    });
  }

  async getLastOpenedPageId(): Promise<string | null> {
    await this.ensureReady();
    const index = await this.readIndex();
    return index.lastOpenedPageId;
  }

  async setLastOpenedPageId(pageId: string | null): Promise<void> {
    await this.withWriteLock(async () => {
      await this.ensureReady();
      const index = await this.readIndex();
      if (index.lastOpenedPageId === pageId) {
        return;
      }

      if (pageId && !index.pages.some((page) => page.id === pageId && !page.deletedAt)) {
        return;
      }

      index.lastOpenedPageId = pageId;
      await this.writeIndex(index);
    });
  }

  private applyContentToMeta(meta: JournalPageMeta, content: string): JournalUpdateResult {
    const now = new Date().toISOString();
    const title = meta.title;
    const preview = derivePreview(content);
    const counts = computeCounts(content);

    meta.updatedAt = now;
    meta.preview = preview;
    meta.charCount = counts.charCount;
    meta.wordCount = counts.wordCount;
    meta.readingMinutes = counts.readingMinutes;

    return {
      updatedAt: now,
      title,
      preview,
      charCount: counts.charCount,
      wordCount: counts.wordCount,
      readingMinutes: counts.readingMinutes
    };
  }

  private async ensureReady(allowLocked = false): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.bootstrap().catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }

    await this.readyPromise;
    if (!allowLocked) {
      this.assertUnlocked();
    }
  }

  private async bootstrap(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.pagesDir, { recursive: true }),
      fs.mkdir(this.historyDir, { recursive: true }),
      fs.mkdir(this.backupsDir, { recursive: true }),
      fs.mkdir(this.exportsDir, { recursive: true }),
      fs.mkdir(this.fontsDir, { recursive: true })
    ]);

    await this.loadSecurityMetadata();
    if (this.securityMeta.enabled) {
      this.unlockedKey = null;
      return;
    }

    try {
      const index = await this.readIndex();
      await this.writeIndex(index);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        await this.backupCorruptIndex();
      }

      await this.writeIndex(this.createEmptyIndex());
    }
  }

  private async backupCorruptIndex(): Promise<void> {
    try {
      await fs.access(this.indexPath);
    } catch {
      return;
    }

    const backupPath = `${this.indexPath}.corrupt.${Date.now()}`;
    await fs.rename(this.indexPath, backupPath);
  }

  private createEmptyIndex(): JournalIndex {
    return {
      version: INDEX_VERSION,
      lastOpenedPageId: null,
      pages: [],
      folders: [],
      settings: mergeSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS),
      lastAutoBackupAt: null
    };
  }

  private normalizeMeta(meta: Partial<JournalPageMeta>): JournalPageMeta {
    const now = new Date().toISOString();
    return {
      id: typeof meta.id === "string" ? meta.id : randomUUID(),
      title: typeof meta.title === "string" && meta.title.trim().length > 0 ? meta.title : UNTITLED_TITLE,
      preview: typeof meta.preview === "string" ? meta.preview : "",
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : now,
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : now,
      deletedAt: typeof meta.deletedAt === "string" ? meta.deletedAt : null,
      pinned: Boolean(meta.pinned),
      tags: Array.isArray(meta.tags) ? normalizeTags(meta.tags) : [],
      folderId: typeof meta.folderId === "string" ? meta.folderId : null,
      charCount: typeof meta.charCount === "number" ? meta.charCount : 0,
      wordCount: typeof meta.wordCount === "number" ? meta.wordCount : 0,
      readingMinutes: typeof meta.readingMinutes === "number" ? meta.readingMinutes : 0
    };
  }

  private async readIndex(): Promise<JournalIndex> {
    let raw = "";
    try {
      raw = await this.readJournalFile(this.indexPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      const empty = this.createEmptyIndex();
      await this.writeIndex(empty);
      return empty;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!isObject(parsed)) {
      throw new Error("Invalid index format.");
    }

    if (typeof parsed.version === "number" && parsed.version >= INDEX_VERSION) {
      const pages = Array.isArray(parsed.pages) ? parsed.pages.map((page) => this.normalizeMeta(page as JournalPageMeta)) : [];
      const folders = Array.isArray(parsed.folders)
        ? (parsed.folders.filter((folder) => isObject(folder) && typeof folder.id === "string" && typeof folder.name === "string") as JournalFolder[])
        : [];
      const settings = isObject(parsed.settings)
        ? await this.normalizeStoredSettings(parsed.settings as Partial<AppSettings>)
        : await this.normalizeStoredSettings(DEFAULT_SETTINGS);
      const lastOpenedPageId = typeof parsed.lastOpenedPageId === "string" ? parsed.lastOpenedPageId : null;
      const lastAutoBackupAt = typeof parsed.lastAutoBackupAt === "string" ? parsed.lastAutoBackupAt : null;

      return {
        version: INDEX_VERSION,
        lastOpenedPageId,
        pages,
        folders,
        settings,
        lastAutoBackupAt
      };
    }

    const legacyPages = Array.isArray(parsed.pages) ? parsed.pages : [];
    const now = new Date().toISOString();
    const migratedPages: JournalPageMeta[] = legacyPages.map((page) => {
      const legacy = page as Record<string, unknown>;
      const normalized = this.normalizeMeta({
        id: typeof legacy.id === "string" ? legacy.id : randomUUID(),
        title: typeof legacy.title === "string" ? legacy.title : UNTITLED_TITLE,
        preview: typeof legacy.preview === "string" ? legacy.preview : "",
        createdAt: typeof legacy.createdAt === "string" ? legacy.createdAt : now,
        updatedAt: typeof legacy.updatedAt === "string" ? legacy.updatedAt : now
      });
      return normalized;
    });

    return {
      version: INDEX_VERSION,
      lastOpenedPageId: typeof parsed.lastOpenedPageId === "string" ? parsed.lastOpenedPageId : null,
      pages: migratedPages,
      folders: [],
      settings: await this.normalizeStoredSettings(DEFAULT_SETTINGS),
      lastAutoBackupAt: null
    };
  }

  private async writeIndex(index: JournalIndex): Promise<void> {
    const settings = await this.normalizeStoredSettings(index.settings);
    const normalized: JournalIndex = {
      version: INDEX_VERSION,
      lastOpenedPageId: index.lastOpenedPageId,
      pages: index.pages.map((page) => this.normalizeMeta(page)),
      folders: [...index.folders],
      settings,
      lastAutoBackupAt: index.lastAutoBackupAt
    };

    await this.writeJournalFile(this.indexPath, JSON.stringify(normalized, null, 2));
  }

  private toSafeEntityId(value: string): string | null {
    const normalized = value.trim();
    if (!SAFE_ENTITY_ID_PATTERN.test(normalized)) {
      return null;
    }
    return normalized;
  }

  private requireSafePageId(pageId: string): string {
    const normalized = this.toSafeEntityId(pageId);
    if (!normalized) {
      throw new Error("Invalid page id.");
    }
    return normalized;
  }

  private requireSafeHistoryId(historyId: string): string {
    const normalized = this.toSafeEntityId(historyId);
    if (!normalized) {
      throw new Error("Invalid history id.");
    }
    return normalized;
  }

  private requireSafeFontId(fontId: string): string {
    const normalized = this.toSafeEntityId(fontId);
    if (!normalized) {
      throw new Error("Invalid font id.");
    }
    return normalized;
  }

  private getImportedFontFilePath(font: ImportedFont): string {
    return path.join(this.fontsDir, path.basename(font.fileName));
  }

  private async syncImportedFontsWithStorage(settings: AppSettings): Promise<AppSettings> {
    const existingFonts: ImportedFont[] = [];
    for (const font of settings.importedFonts) {
      try {
        await fs.access(this.getImportedFontFilePath(font));
        existingFonts.push(font);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }

    const defaultFont = normalizeDefaultFontFamily(settings.defaultFont, existingFonts);
    if (existingFonts.length === settings.importedFonts.length && defaultFont === settings.defaultFont) {
      return settings;
    }

    return {
      ...settings,
      defaultFont,
      importedFonts: existingFonts
    };
  }

  private async normalizeStoredSettings(settings: Partial<AppSettings> | AppSettings): Promise<AppSettings> {
    return this.syncImportedFontsWithStorage(mergeSettings(settings, DEFAULT_SETTINGS));
  }

  private requireSafeBackupId(backupId: string): string {
    const normalized = this.toSafeEntityId(backupId);
    if (!normalized) {
      throw new Error("Invalid backup id.");
    }
    return normalized;
  }

  private getPagePath(pageId: string): string {
    return path.join(this.pagesDir, `${this.requireSafePageId(pageId)}.json`);
  }

  private getLegacyPagePath(pageId: string): string {
    return path.join(this.pagesDir, `${this.requireSafePageId(pageId)}.txt`);
  }

  private getHistoryPageDir(pageId: string): string {
    return path.join(this.historyDir, this.requireSafePageId(pageId));
  }

  private async readHistoryNames(directory: string): Promise<Record<string, string>> {
    try {
      const raw = await fs.readFile(path.join(directory, "_names.json"), "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // file doesn't exist or is invalid
    }
    return {};
  }

  private async writeHistoryNames(directory: string, names: Record<string, string>): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "_names.json"), JSON.stringify(names), "utf-8");
  }

  private async readPageFile(pageId: string): Promise<string> {
    const jsonPath = this.getPagePath(pageId);
    try {
      const raw = await this.readJournalFile(jsonPath);
      const parsed = JSON.parse(raw) as StoredPageFile;
      if (typeof parsed.content === "string") {
        return normalizeJournalHtml(parsed.content);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const legacyPath = this.getLegacyPagePath(pageId);
    try {
      const legacy = await fs.readFile(legacyPath, "utf8");
      const migrated = `<p>${legacy.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`;
      await this.writePageFile(pageId, migrated);
      return migrated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    return "<p></p>";
  }

  private async writePageFile(pageId: string, content: string): Promise<void> {
    const sanitizedContent = normalizeJournalHtml(content);
    const file: StoredPageFile = {
      id: pageId,
      content: sanitizedContent
    };
    await this.writeJournalFile(this.getPagePath(pageId), JSON.stringify(file));
  }

  private async deletePageArtifacts(pageId: string): Promise<void> {
    await Promise.all([
      fs.rm(this.getPagePath(pageId), { force: true }),
      fs.rm(this.getLegacyPagePath(pageId), { force: true }),
      fs.rm(this.getHistoryPageDir(pageId), { recursive: true, force: true })
    ]);
  }

  private getMetaOrThrow(index: JournalIndex, pageId: string): JournalPageMeta {
    const meta = index.pages.find((page) => page.id === pageId);
    if (!meta) {
      throw new Error(`Page not found: ${pageId}`);
    }

    return meta;
  }

  private async recordHistorySnapshot(pageId: string, content: string, historySnapshotsEnabled: boolean): Promise<void> {
    if (!historySnapshotsEnabled) {
      return;
    }

    const now = Date.now();
    const lastSnapshotAt = this.historySnapshotAt.get(pageId) ?? 0;
    if (now - lastSnapshotAt < HISTORY_SNAPSHOT_MIN_INTERVAL_MS) {
      return;
    }
    this.historySnapshotAt.set(pageId, now);

    const directory = this.getHistoryPageDir(pageId);
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${safeFileId("history")}.json`);
    await this.writeJournalFile(filePath, JSON.stringify({ id: pageId, content }));

    const snapshots = (await fs.readdir(directory))
      .filter((name) => name.endsWith(".json") && name !== "_names.json")
      .sort((left, right) => right.localeCompare(left));

    if (snapshots.length > HISTORY_LIMIT_PER_PAGE) {
      const toRemove = snapshots.slice(HISTORY_LIMIT_PER_PAGE);
      await Promise.all(toRemove.map((file) => fs.rm(path.join(directory, file), { force: true })));
    }
  }

  private async maybeAutoBackup(index: JournalIndex): Promise<void> {
    const now = Date.now();
    const last = parseTimestamp(index.lastAutoBackupAt);
    if (now - last < AUTO_BACKUP_INTERVAL_MS) {
      return;
    }

    const backup = await this.writeBackupBundle(index, "auto");
    index.lastAutoBackupAt = backup.createdAt;
  }

  private async writeBackupBundle(index: JournalIndex, prefix = "backup"): Promise<BackupItem> {
    await fs.mkdir(this.backupsDir, { recursive: true });
    const createdAt = new Date().toISOString();
    const id = safeFileId(prefix);
    const filePath = path.join(this.backupsDir, `${id}.json`);
    const pages = await Promise.all(index.pages.map((meta) => this.readPageFile(meta.id).then((content) => ({ id: meta.id, content }))));

    const bundle: BackupBundle = {
      version: INDEX_VERSION,
      createdAt,
      index: {
        ...index,
        pages: index.pages.map((page) => this.normalizeMeta(page)),
        settings: mergeSettings(index.settings, DEFAULT_SETTINGS)
      },
      pages
    };

    await this.writeJournalFile(filePath, JSON.stringify(bundle));

    return {
      id,
      createdAt,
      filePath
    };
  }

  private async readBackupBundle(filePath: string): Promise<BackupBundle> {
    const raw = await this.readJournalFile(filePath);
    return this.parseBackupBundle(raw);
  }

  private parseBackupBundle(raw: string): BackupBundle {
    const parsed = JSON.parse(raw) as BackupBundle;
    if (!isObject(parsed) || !isObject(parsed.index) || !Array.isArray(parsed.pages)) {
      throw new Error("Invalid backup file.");
    }

    const index = parsed.index as JournalIndex;
    const rawIndexPages = Array.isArray(index.pages) ? index.pages.map((meta) => this.normalizeMeta(meta)) : [];
    if (rawIndexPages.length > MAX_IMPORT_PAGE_COUNT || parsed.pages.length > MAX_IMPORT_PAGE_COUNT) {
      throw new Error("Import file contains too many pages.");
    }

    const seenIndexPageIds = new Set<string>();
    for (const page of rawIndexPages) {
      const safePageId = this.toSafeEntityId(page.id);
      if (!safePageId || seenIndexPageIds.has(safePageId)) {
        throw new Error("Import file contains invalid page metadata.");
      }
      page.id = safePageId;
      seenIndexPageIds.add(safePageId);
    }

    const pagePayloadById = new Map<string, StoredPageFile>();
    for (const item of parsed.pages) {
      if (!isObject(item) || typeof item.id !== "string" || typeof item.content !== "string") {
        throw new Error("Import file contains invalid page content.");
      }

      const pageId = this.toSafeEntityId(item.id);
      const content = normalizeJournalHtml(item.content);
      if (!pageId || content.length > MAX_IMPORT_PAGE_CONTENT_LENGTH) {
        throw new Error("Import file contains invalid page content.");
      }
      if (!seenIndexPageIds.has(pageId)) {
        throw new Error("Import file contains page content without matching metadata.");
      }
      if (pagePayloadById.has(pageId)) {
        throw new Error("Import file contains duplicate page content.");
      }

      pagePayloadById.set(pageId, { id: pageId, content });
    }

    const missingActivePageContent = rawIndexPages.some((page) => !page.deletedAt && !pagePayloadById.has(page.id));
    if (missingActivePageContent) {
      throw new Error("Import file is missing content for one or more active pages.");
    }

    const normalizedIndexPages = rawIndexPages.filter((page) => pagePayloadById.has(page.id));
    const normalizedPages = normalizedIndexPages.map((page) => pagePayloadById.get(page.id)!);
    const allowedPageIds = new Set(normalizedIndexPages.map((page) => page.id));

    const normalizedFolders = Array.isArray(index.folders)
      ? index.folders
          .filter((folder): folder is JournalFolder => {
            if (!isObject(folder) || typeof folder.id !== "string" || typeof folder.name !== "string") {
              return false;
            }
            return folder.id.trim().length > 0 && folder.name.trim().length > 0 && folder.name.length <= 120;
          })
          .map((folder) => ({
            id: folder.id,
            name: folder.name.trim(),
            createdAt: typeof folder.createdAt === "string" ? folder.createdAt : new Date().toISOString()
          }))
      : [];

    const lastOpenedPageId =
      typeof index.lastOpenedPageId === "string" ? this.toSafeEntityId(index.lastOpenedPageId) : null;
    const normalizedLastOpenedPageId = lastOpenedPageId && allowedPageIds.has(lastOpenedPageId) ? lastOpenedPageId : null;

    return {
      version: INDEX_VERSION,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      index: {
        version: INDEX_VERSION,
        lastOpenedPageId: normalizedLastOpenedPageId,
        pages: normalizedIndexPages,
        folders: normalizedFolders,
        settings: mergeSettings(index.settings ?? {}, DEFAULT_SETTINGS),
        lastAutoBackupAt: typeof index.lastAutoBackupAt === "string" ? index.lastAutoBackupAt : null
      },
      pages: normalizedPages
    };
  }

  private getExportExtension(format: ExportFormat): string {
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

  private normalizeExportPath(format: ExportFormat, filePath: string): string {
    const extension = `.${this.getExportExtension(format)}`;
    if (path.extname(filePath).toLowerCase() === extension) {
      return filePath;
    }
    return `${filePath}${extension}`;
  }

  private async writeEncryptedZipExport(filePath: string, encryptedZipKey?: string): Promise<void> {
    const normalizedKey = normalizeEncryptedZipKey(encryptedZipKey);
    const kdf = createZipKdfConfig();
    const zipKey = await deriveKey(normalizedKey, kdf);
    const fullBackup: FullBackupBundle = {
      version: INDEX_VERSION,
      createdAt: new Date().toISOString(),
      kind: "zypher-full-backup",
      files: await this.captureFullBackupFiles()
    };
    const encryptedBundle: EncryptedZipBundle = {
      version: INDEX_VERSION,
      createdAt: new Date().toISOString(),
      kind: "zypher-encrypted-zip",
      encrypted: true,
      kdf,
      payload: encryptUtf8(JSON.stringify(fullBackup), zipKey)
    };

    const zip = new AdmZip();
    zip.addFile(ENCRYPTED_ZIP_ENTRY, Buffer.from(JSON.stringify(encryptedBundle, null, 2), "utf8"));
    await this.atomicWriteBuffer(filePath, zip.toBuffer());
  }

  private async captureFullBackupFiles(): Promise<FullBackupFile[]> {
    const files = await this.collectFilesRecursively(this.journalDir);
    const bundleFiles = await Promise.all(
      files.map(async (filePath) => {
        const relativePath = path.relative(this.journalDir, filePath).split(path.sep).join("/");
        if (relativePath.toLowerCase() === SECURITY_METADATA_FILENAME) {
          return null;
        }

        let data: Buffer;
        if (relativePath.toLowerCase().endsWith(".json")) {
          const plaintext = await this.readJournalFile(filePath);
          data = Buffer.from(plaintext, "utf8");
        } else {
          data = await fs.readFile(filePath);
        }

        return {
          path: relativePath,
          data: data.toString("base64")
        };
      })
    );

    const filtered = bundleFiles.filter((entry): entry is FullBackupFile => entry !== null);
    filtered.sort((left, right) => left.path.localeCompare(right.path));
    return filtered;
  }

  private parseEncryptedZipBundle(raw: string): EncryptedZipBundle {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isObject(parsed) ||
      parsed.kind !== "zypher-encrypted-zip" ||
      parsed.encrypted !== true ||
      !isEncryptionEnvelope((parsed as { payload?: unknown }).payload)
    ) {
      throw new Error("Invalid encrypted ZIP import file.");
    }

    const kdf = parseKdfConfig((parsed as { kdf?: unknown }).kdf);

    return {
      version: typeof parsed.version === "number" ? parsed.version : INDEX_VERSION,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      kind: "zypher-encrypted-zip",
      encrypted: true,
      kdf,
      payload: (parsed as { payload: EncryptionEnvelope }).payload
    };
  }

  private parseFullBackupBundle(raw: string): FullBackupBundle {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || parsed.kind !== "zypher-full-backup" || !Array.isArray(parsed.files)) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    const files = parsed.files
      .filter((entry) => isObject(entry) && typeof entry.path === "string" && typeof entry.data === "string")
      .map((entry) => ({
        path: (entry as { path: string }).path,
        data: (entry as { data: string }).data
      }));
    if (files.length === 0) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    return {
      version: typeof parsed.version === "number" ? parsed.version : INDEX_VERSION,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      kind: "zypher-full-backup",
      files
    };
  }

  private decodeBase64ImportPayload(data: string): Buffer {
    const normalized = data.trim();
    if (normalized.length === 0) {
      return Buffer.alloc(0);
    }
    if (/[^A-Za-z0-9+/=]/.test(normalized)) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    const decoded = Buffer.from(normalized, "base64");
    const canonicalInput = normalized.replace(/=+$/, "");
    const canonicalDecoded = decoded.toString("base64").replace(/=+$/, "");
    if (canonicalInput !== canonicalDecoded) {
      throw new Error("Invalid encrypted ZIP payload.");
    }
    return decoded;
  }

  private validateEncryptedZipRestorePlan(fullBackup: FullBackupBundle): Array<{ destination: string; relativePath: string; data: Buffer }> {
    if (fullBackup.files.length === 0 || fullBackup.files.length > MAX_ENCRYPTED_ZIP_FILE_COUNT) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    const plan: Array<{ destination: string; relativePath: string; data: Buffer }> = [];
    const seenPaths = new Set<string>();
    let totalBytes = 0;
    let hasIndexFile = false;

    for (const file of fullBackup.files) {
      const relativePath = file.path.replace(/\\/g, "/").trim();
      if (!relativePath) {
        throw new Error("Invalid encrypted ZIP payload.");
      }

      if (relativePath.toLowerCase() === SECURITY_METADATA_FILENAME) {
        throw new Error("Encrypted ZIP imports cannot modify security metadata.");
      }

      const destination = this.resolveSafeImportPath(relativePath);
      const normalizedDestination = destination.toLowerCase();
      if (seenPaths.has(normalizedDestination)) {
        throw new Error("Invalid encrypted ZIP payload.");
      }
      seenPaths.add(normalizedDestination);

      const decoded = this.decodeBase64ImportPayload(file.data);
      if (decoded.length > MAX_ENCRYPTED_ZIP_FILE_BYTES) {
        throw new Error("Encrypted ZIP import file is too large.");
      }
      totalBytes += decoded.length;
      if (totalBytes > MAX_ENCRYPTED_ZIP_TOTAL_BYTES) {
        throw new Error("Encrypted ZIP import exceeds the maximum supported size.");
      }

      if (relativePath.toLowerCase() === "index.json") {
        hasIndexFile = true;
      }

      if (relativePath.toLowerCase().endsWith(".json")) {
        const rawJson = decoded.toString("utf8");
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          throw new Error("Invalid encrypted ZIP payload.");
        }

        if (isEncryptionEnvelope(parsed)) {
          throw new Error(LEGACY_ENCRYPTED_ZIP_IMPORT_ERROR);
        }
      }

      plan.push({
        destination,
        relativePath,
        data: decoded
      });
    }

    if (!hasIndexFile) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    return plan;
  }

  private resolveSafeImportPath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, "/").trim();
    if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0 || segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    const destination = path.resolve(this.journalDir, ...segments);
    const journalRoot = path.resolve(this.journalDir);
    const journalPrefix = `${journalRoot}${path.sep}`.toLowerCase();
    if (!destination.toLowerCase().startsWith(journalPrefix)) {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    return destination;
  }

  private async importEncryptedZip(filePath: string, encryptedZipKey?: string): Promise<void> {
    let encryptedZip: EncryptedZipBundle;
    try {
      const zip = new AdmZip(filePath);
      const entry = zip.getEntry(ENCRYPTED_ZIP_ENTRY);
      if (!entry) {
        throw new Error("Invalid encrypted ZIP import file.");
      }
      encryptedZip = this.parseEncryptedZipBundle(entry.getData().toString("utf8"));
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new Error("Invalid encrypted ZIP import file.");
    }

    let fullBackup: FullBackupBundle;
    let decrypted: string | null = null;
    if (encryptedZip.kdf) {
      const normalizedKey = normalizeEncryptedZipKey(encryptedZipKey);
      let derivedZipKey: Buffer;
      try {
        derivedZipKey = await deriveKey(normalizedKey, encryptedZip.kdf);
      } catch {
        throw new Error("Invalid encrypted ZIP key setup.");
      }

      try {
        decrypted = decryptUtf8(encryptedZip.payload, derivedZipKey);
      } catch {
        throw new Error("Failed to decrypt encrypted ZIP backup. The ZIP key is incorrect.");
      }
    } else {
      if (!this.unlockedKey) {
        throw new SecurityError("LOCKED", "Unlock the app before importing this backup.");
      }
      decrypted = this.decryptEncryptedImportPayload(encryptedZip.payload);
      if (!decrypted) {
        throw new Error("Failed to decrypt encrypted ZIP backup. Check the ZIP key used when it was exported.");
      }
    }

    if (!decrypted) {
      throw new Error("Failed to decrypt encrypted ZIP backup.");
    }

    try {
      fullBackup = this.parseFullBackupBundle(decrypted);
    } catch {
      throw new Error("Invalid encrypted ZIP payload.");
    }

    const restorePlan = this.validateEncryptedZipRestorePlan(fullBackup);
    const previousSecurityMeta = cloneSecurityMetadata(this.securityMeta);
    const previousUnlockedKey = this.unlockedKey ? Buffer.from(this.unlockedKey) : null;
    if (previousSecurityMeta.enabled && !previousUnlockedKey) {
      throw new SecurityError("LOCKED", "Unlock the app before importing this backup.");
    }

    await fs.rm(this.journalDir, { recursive: true, force: true });
    await fs.mkdir(this.journalDir, { recursive: true });

    for (const file of restorePlan) {
      const destination = file.destination;
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await this.atomicWriteBuffer(destination, file.data);
    }

    this.historySnapshotAt.clear();
    this.securityMeta = cloneSecurityMetadata(previousSecurityMeta);
    this.unlockedKey = previousUnlockedKey ? Buffer.from(previousUnlockedKey) : null;
    await this.writeSecurityMetadata();

    if (this.securityMeta.enabled && this.unlockedKey) {
      await this.encryptAllStorageFiles(this.unlockedKey);
      const index = await this.readIndex();
      index.settings.selfDestructOnFailedPin = this.securityMeta.selfDestructOnFailedPin;
      index.settings.selfDestructPinFailureLimit = normalizeSelfDestructPinFailureLimit(
        this.securityMeta.selfDestructPinFailureLimit
      );
      index.settings.allowResetFromLockScreen = this.securityMeta.allowResetFromLockScreen;
      await this.writeIndex(index);
    }

    this.readyPromise = null;
    await this.ensureReady(true);
  }

  private async writeBundleToStorage(bundle: BackupBundle): Promise<void> {
    await fs.mkdir(this.pagesDir, { recursive: true });
    await fs.mkdir(this.historyDir, { recursive: true });
    const existingPages = await fs.readdir(this.pagesDir);
    await Promise.all(existingPages.map((name) => fs.rm(path.join(this.pagesDir, name), { force: true, recursive: true })));

    const pageIds = new Set(bundle.index.pages.map((page) => page.id));
    await Promise.all(
      bundle.pages
        .filter((page) => pageIds.has(page.id))
        .map((page) => this.writePageFile(page.id, page.content))
    );

    const nextIndex: JournalIndex = {
      ...bundle.index,
      settings: mergeSettings(bundle.index.settings, DEFAULT_SETTINGS)
    };
    if (this.securityMeta.enabled) {
      nextIndex.settings.selfDestructOnFailedPin = this.securityMeta.selfDestructOnFailedPin;
      nextIndex.settings.selfDestructPinFailureLimit = normalizeSelfDestructPinFailureLimit(
        this.securityMeta.selfDestructPinFailureLimit
      );
      nextIndex.settings.allowResetFromLockScreen = this.securityMeta.allowResetFromLockScreen;
    }

    await this.writeIndex(nextIndex);
  }

  private async loadSecurityMetadata(): Promise<void> {
    try {
      const raw = await fs.readFile(this.securityPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SecurityMetadata>;
      if (!isObject(parsed)) {
        this.securityMeta = createDisabledSecurityMetadata();
        await this.writeSecurityMetadata();
        return;
      }

      const enabled = Boolean(parsed.enabled);
      const kdf = isObject(parsed.kdf)
        ? {
            salt: typeof parsed.kdf.salt === "string" ? parsed.kdf.salt : "",
            keyLength: typeof parsed.kdf.keyLength === "number" ? parsed.kdf.keyLength : 32,
            cost: typeof parsed.kdf.cost === "number" ? parsed.kdf.cost : 16_384,
            blockSize: typeof parsed.kdf.blockSize === "number" ? parsed.kdf.blockSize : 8,
            parallelization: typeof parsed.kdf.parallelization === "number" ? parsed.kdf.parallelization : 1
          }
        : null;
      const verifier = isEncryptionEnvelope(parsed.verifier) ? parsed.verifier : null;
      const verifierDigest = typeof parsed.verifierDigest === "string" ? parsed.verifierDigest : null;
      const legacyZipKeys = Array.isArray(parsed.legacyZipKeys)
        ? parsed.legacyZipKeys.filter((item): item is EncryptionEnvelope => isEncryptionEnvelope(item))
        : [];

      this.securityMeta = {
        version: typeof parsed.version === "number" ? parsed.version : 1,
        enabled,
        kdf: enabled ? kdf : null,
        verifier: enabled ? verifier : null,
        verifierDigest: enabled ? verifierDigest : null,
        failedAttempts: typeof parsed.failedAttempts === "number" ? Math.max(0, parsed.failedAttempts) : 0,
        cooldownUntil: typeof parsed.cooldownUntil === "string" ? parsed.cooldownUntil : null,
        selfDestructOnFailedPin: typeof parsed.selfDestructOnFailedPin === "boolean" ? parsed.selfDestructOnFailedPin : false,
        selfDestructPinFailureLimit: normalizeSelfDestructPinFailureLimit(
          typeof parsed.selfDestructPinFailureLimit === "number"
            ? parsed.selfDestructPinFailureLimit
            : DEFAULT_SELF_DESTRUCT_PIN_FAILURE_LIMIT
        ),
        allowResetFromLockScreen:
          typeof parsed.allowResetFromLockScreen === "boolean" ? parsed.allowResetFromLockScreen : true,
        legacyZipKeys
      };
      if (enabled && (!this.securityMeta.kdf || !this.securityMeta.verifier || !this.securityMeta.verifierDigest)) {
        throw new Error("Invalid security metadata.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.securityMeta = createDisabledSecurityMetadata();
        await this.writeSecurityMetadata();
        return;
      }
      throw error;
    }
  }

  private async writeSecurityMetadata(): Promise<void> {
    await this.atomicWriteFile(this.securityPath, JSON.stringify(this.securityMeta, null, 2));
  }

  private isLocked(): boolean {
    return this.securityMeta.enabled && !this.unlockedKey;
  }

  private assertUnlocked(): void {
    if (this.securityMeta.enabled && !this.unlockedKey) {
      throw new SecurityError("LOCKED", "[LOCKED] App is locked.");
    }
  }

  private syncSecuritySettings(settings: AppSettings): void {
    this.securityMeta.selfDestructOnFailedPin = settings.selfDestructOnFailedPin;
    this.securityMeta.selfDestructPinFailureLimit = normalizeSelfDestructPinFailureLimit(settings.selfDestructPinFailureLimit);
    this.securityMeta.allowResetFromLockScreen = settings.allowResetFromLockScreen;
  }

  private parseLegacyZipKey(raw: string, expectedLength: number): Buffer | null {
    const normalized = raw.trim();
    if (!normalized) {
      return null;
    }

    try {
      const decoded = Buffer.from(normalized, "base64");
      if (decoded.length !== expectedLength) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  private collectLegacyZipKeys(decryptionKey: Buffer): Buffer[] {
    if (!Array.isArray(this.securityMeta.legacyZipKeys) || this.securityMeta.legacyZipKeys.length === 0) {
      return [];
    }

    const keys: Buffer[] = [];
    const seen = new Set<string>();
    for (const envelope of this.securityMeta.legacyZipKeys) {
      try {
        const plaintext = decryptUtf8(envelope, decryptionKey);
        const decoded = this.parseLegacyZipKey(plaintext, decryptionKey.length);
        if (!decoded) {
          continue;
        }
        const encoded = decoded.toString("base64");
        if (seen.has(encoded)) {
          continue;
        }
        seen.add(encoded);
        keys.push(decoded);
      } catch {
        // Ignore invalid legacy keys.
      }
    }

    return keys;
  }

  private buildLegacyZipKeyEnvelopesForNewKey(oldKey: Buffer, newKey: Buffer): EncryptionEnvelope[] {
    const known = this.collectLegacyZipKeys(oldKey);
    const all = [oldKey, ...known];
    const unique = new Map<string, Buffer>();
    for (const key of all) {
      unique.set(key.toString("base64"), key);
    }

    return [...unique.values()]
      .slice(0, MAX_LEGACY_ZIP_KEYS)
      .map((key) => encryptUtf8(key.toString("base64"), newKey));
  }

  private getEncryptedImportCandidateKeys(): Buffer[] {
    if (!this.unlockedKey) {
      return [];
    }

    const keys: Buffer[] = [this.unlockedKey];
    const seen = new Set<string>([this.unlockedKey.toString("base64")]);
    for (const key of this.collectLegacyZipKeys(this.unlockedKey)) {
      const encoded = key.toString("base64");
      if (seen.has(encoded)) {
        continue;
      }
      seen.add(encoded);
      keys.push(key);
    }

    return keys;
  }

  private decryptEncryptedImportPayload(payload: EncryptionEnvelope): string | null {
    for (const key of this.getEncryptedImportCandidateKeys()) {
      try {
        return decryptUtf8(payload, key);
      } catch {
        // Try next key.
      }
    }
    return null;
  }

  private async wipeAllJournalData(): Promise<void> {
    await fs.rm(this.journalDir, { recursive: true, force: true });
    await Promise.all([
      fs.mkdir(this.pagesDir, { recursive: true }),
      fs.mkdir(this.historyDir, { recursive: true }),
      fs.mkdir(this.backupsDir, { recursive: true }),
      fs.mkdir(this.exportsDir, { recursive: true }),
      fs.mkdir(this.fontsDir, { recursive: true })
    ]);

    this.historySnapshotAt.clear();
    this.securityMeta = createDisabledSecurityMetadata();
    this.unlockedKey = null;
    await this.writeSecurityMetadata();
    await this.writeIndex(this.createEmptyIndex());
  }

  private async registerFailedPinAttempt(): Promise<void> {
    const next = this.securityMeta.failedAttempts + 1;
    this.securityMeta.failedAttempts = next;
    if (
      this.securityMeta.selfDestructOnFailedPin &&
      next >= normalizeSelfDestructPinFailureLimit(this.securityMeta.selfDestructPinFailureLimit)
    ) {
      await this.wipeAllJournalData();
      throw new SecurityError("SELF_DESTRUCT_TRIGGERED", "Too many failed password attempts. All journal data has been wiped.");
    }

    if (next >= 5) {
      const penalties = [30, 60, 120, 300];
      const index = Math.min(next - 5, penalties.length - 1);
      this.securityMeta.cooldownUntil = new Date(Date.now() + penalties[index] * 1000).toISOString();
    }
    await this.writeSecurityMetadata();
  }

  private async readJournalFile(filePath: string, keyOverride?: Buffer | null): Promise<string> {
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }

    if (!isEncryptionEnvelope(parsed)) {
      return raw;
    }

    const key = keyOverride ?? this.unlockedKey;
    if (!key) {
      throw new SecurityError("LOCKED", "[LOCKED] App is locked.");
    }
    return decryptUtf8(parsed, key);
  }

  private async writeJournalFile(filePath: string, plaintext: string, keyOverride?: Buffer | null): Promise<void> {
    if (!this.securityMeta.enabled) {
      await this.atomicWriteFile(filePath, plaintext);
      return;
    }

    const key = keyOverride ?? this.unlockedKey;
    if (!key) {
      throw new SecurityError("LOCKED", "[LOCKED] App is locked.");
    }
    const envelope = encryptUtf8(plaintext, key);
    await this.atomicWriteFile(filePath, JSON.stringify(envelope));
  }

  private async collectFilesRecursively(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.collectFilesRecursively(full)));
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
    return files;
  }

  private async collectJsonFilesRecursively(directory: string): Promise<string[]> {
    const files = await this.collectFilesRecursively(directory);
    return files.filter((filePath) => filePath.endsWith(".json"));
  }

  private async getEncryptableStorageFiles(): Promise<string[]> {
    const files: string[] = [];
    try {
      await fs.access(this.indexPath);
      files.push(this.indexPath);
    } catch {
      // ignore
    }

    for (const directory of [this.pagesDir, this.historyDir, this.backupsDir]) {
      try {
        files.push(...(await this.collectJsonFilesRecursively(directory)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }

    return files;
  }

  private async encryptAllStorageFiles(key: Buffer): Promise<void> {
    const files = await this.getEncryptableStorageFiles();
    for (const filePath of files) {
      const raw = await fs.readFile(filePath, "utf8");
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = null;
      }
      if (isEncryptionEnvelope(parsed)) {
        continue;
      }
      const encrypted = JSON.stringify(encryptUtf8(raw, key));
      await this.atomicWriteFile(filePath, encrypted);
    }
  }

  private async decryptAllStorageFiles(key: Buffer): Promise<void> {
    const files = await this.getEncryptableStorageFiles();
    for (const filePath of files) {
      const raw = await fs.readFile(filePath, "utf8");
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = null;
      }
      if (!isEncryptionEnvelope(parsed)) {
        continue;
      }
      const decrypted = decryptUtf8(parsed, key);
      await this.atomicWriteFile(filePath, decrypted);
    }
  }

  private async reencryptAllStorageFiles(oldKey: Buffer, newKey: Buffer): Promise<void> {
    const files = await this.getEncryptableStorageFiles();
    for (const filePath of files) {
      const raw = await fs.readFile(filePath, "utf8");
      let plain = raw;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (isEncryptionEnvelope(parsed)) {
          plain = decryptUtf8(parsed, oldKey);
        }
      } catch {
        plain = raw;
      }
      const encrypted = JSON.stringify(encryptUtf8(plain, newKey));
      await this.atomicWriteFile(filePath, encrypted);
    }
  }

  private async atomicWriteFile(filePath: string, content: string): Promise<void> {
    await this.atomicWriteBuffer(filePath, Buffer.from(content, "utf8"));
  }

  private async atomicWriteBuffer(filePath: string, content: Buffer): Promise<void> {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });

    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, content);

    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fs.rename(tempPath, filePath);
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") {
          break;
        }

        if (attempt >= 3) {
          try {
            await fs.rm(filePath, { force: true });
          } catch {
            // Keep retrying rename.
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }

    try {
      await fs.writeFile(filePath, content);
      await fs.rm(tempPath, { force: true });
      return;
    } catch {
      await fs.rm(tempPath, { force: true });
      throw lastError instanceof Error ? lastError : new Error("Failed to write file.");
    }
  }

  private withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }
}
