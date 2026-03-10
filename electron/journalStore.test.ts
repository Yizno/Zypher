import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalStore } from "./journalStore";
import { deriveKey, encryptUtf8, isEncryptionEnvelope } from "./security";

const tempDirs: string[] = [];
const PRIMARY_PASSWORD = "Alpha123!";
const SECONDARY_PASSWORD = "Beta5678!";
const WRONG_PASSWORD = "Wrongpass1!";

async function makeTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "journaling-app-"));
  tempDirs.push(tempDir);
  return tempDir;
}

async function rewritePageCreatedAt(tempDir: string, pageId: string, createdAt: string): Promise<void> {
  const indexPath = path.join(tempDir, "journal", "index.json");
  const raw = await fs.readFile(indexPath, "utf8");
  const parsed = JSON.parse(raw) as { pages?: Array<{ id: string; createdAt: string; updatedAt: string }> };
  const target = parsed.pages?.find((page) => page.id === pageId);
  if (!target) {
    throw new Error(`Missing page ${pageId}`);
  }
  target.createdAt = createdAt;
  target.updatedAt = createdAt;
  await fs.writeFile(indexPath, JSON.stringify(parsed, null, 2), "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, {
        recursive: true,
        force: true
      })
    )
  );
});

describe("JournalStore", () => {
  it("creates and loads pages", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);

    expect(await store.listPages()).toEqual([]);

    const created = await store.createPage();
    const loaded = await store.getPage(created.id);
    expect(loaded.content).toContain("<p>");
    expect(created.title).toBe("Untitled");
  });

  it("moves recently edited pages to the top", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const first = await store.createPage();
    const second = await store.createPage();

    await store.updatePageContent(first.id, "<p>first page</p>");
    const pages = await store.listPages();
    expect(pages[0]?.id).toBe(first.id);
    expect(pages[1]?.id).toBe(second.id);
  });

  it("does not auto-rename title from content changes", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const page = await store.createPage();

    await store.updatePageContent(page.id, "<p>this should not become title</p>");
    let pages = await store.listPages();
    expect(pages[0]?.title).toBe("Untitled");

    await store.renamePage(page.id, "Manual title");
    await store.updatePageContent(page.id, "<h1>new heading</h1><p>new body</p>");
    pages = await store.listPages();
    expect(pages[0]?.title).toBe("Manual title");
  });

  it("sanitizes dangerous HTML before storing page content", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const page = await store.createPage();

    await store.updatePageContent(
      page.id,
      `<p>safe</p><img src="x" onerror="alert('xss')" /><a href="javascript:alert(1)" onclick="alert(2)">click</a><script>alert(3)</script>`
    );

    const loaded = await store.getPage(page.id);
    expect(loaded.content).toContain("<p>safe</p>");
    expect(loaded.content.toLowerCase()).not.toContain("<script");
    expect(loaded.content.toLowerCase()).not.toContain("onerror=");
    expect(loaded.content.toLowerCase()).not.toContain("onclick=");
    expect(loaded.content.toLowerCase()).not.toContain("javascript:");
  });

  it("backs up and recreates invalid index files", async () => {
    const tempDir = await makeTempDir();
    const journalDir = path.join(tempDir, "journal");
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(path.join(journalDir, "index.json"), "{", "utf8");

    const store = new JournalStore(tempDir);
    expect(await store.listPages()).toEqual([]);

    const files = await fs.readdir(journalDir);
    expect(files.some((file) => file.startsWith("index.json.corrupt."))).toBe(true);
  });

  it("deletes individual history snapshots", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const page = await store.createPage();
    await store.updatePageContent(page.id, "<p>snapshot</p>");

    const history = await store.listPageHistory(page.id);
    expect(history.length).toBeGreaterThan(0);

    await store.deletePageHistory(page.id, history[0].id);
    const afterDelete = await store.listPageHistory(page.id);
    expect(afterDelete.some((entry) => entry.id === history[0].id)).toBe(false);
  });

  it("stops creating history snapshots when history saving is disabled", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 7, 12, 0, 0, 0));
      const tempDir = await makeTempDir();
      const store = new JournalStore(tempDir);
      const page = await store.createPage();

      await store.updateSettings({ historySnapshotsEnabled: false });
      await store.updatePageContent(page.id, "<p>no snapshot</p>");

      expect(await store.listPageHistory(page.id)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears history snapshots for every page", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 7, 12, 0, 0, 0));
      const tempDir = await makeTempDir();
      const store = new JournalStore(tempDir);
      const first = await store.createPage();
      const second = await store.createPage();

      await store.updatePageContent(first.id, "<p>first snapshot</p>");
      vi.setSystemTime(new Date(2026, 2, 7, 12, 0, 6, 0));
      await store.updatePageContent(second.id, "<p>second snapshot</p>");

      expect((await store.listPageHistory(first.id)).length).toBeGreaterThan(0);
      expect((await store.listPageHistory(second.id)).length).toBeGreaterThan(0);

      await store.clearAllHistory();

      expect(await store.listPageHistory(first.id)).toEqual([]);
      expect(await store.listPageHistory(second.id)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns On This Day memories for exactly 1, 2, and 5 years ago", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const oneYear = await store.createPage();
    const twoYears = await store.createPage();
    const fiveYears = await store.createPage();
    const ignored = await store.createPage();
    const trashed = await store.createPage();

    await store.renamePage(oneYear.id, "One Year");
    await store.renamePage(twoYears.id, "Two Years");
    await store.renamePage(fiveYears.id, "Five Years");
    await store.renamePage(ignored.id, "Ignored");
    await store.renamePage(trashed.id, "Trashed");

    await rewritePageCreatedAt(tempDir, oneYear.id, "2025-02-21T12:00:00");
    await rewritePageCreatedAt(tempDir, twoYears.id, "2024-02-21T12:00:00");
    await rewritePageCreatedAt(tempDir, fiveYears.id, "2021-02-21T12:00:00");
    await rewritePageCreatedAt(tempDir, ignored.id, "2023-02-21T12:00:00");
    await rewritePageCreatedAt(tempDir, trashed.id, "2025-02-21T12:00:00");
    await store.movePageToTrash(trashed.id);

    const memories = await store.listOnThisDayMemories("2026-02-21T12:00:00");
    expect(memories).toHaveLength(3);
    expect(memories.map((item) => item.yearOffset)).toEqual([1, 2, 5]);
    expect(memories.map((item) => item.title)).toEqual(["One Year", "Two Years", "Five Years"]);
  });

  it("generates deterministic monthly and yearly review pages", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const januaryA = await store.createPage();
    const januaryB = await store.createPage();
    const nextYear = await store.createPage();

    await store.renamePage(januaryA.id, "January Start");
    await store.renamePage(januaryB.id, "January End");
    await store.renamePage(nextYear.id, "Different Year");

    await store.updatePageContent(januaryA.id, "<p>alpha beta gamma delta</p>");
    await store.updatePageContent(januaryB.id, "<p>one two three</p>");
    await store.updatePageContent(nextYear.id, "<p>out of range</p>");

    await store.setPageTags(januaryA.id, ["work", "focus"]);
    await store.setPageTags(januaryB.id, ["focus"]);
    await store.setPageTags(nextYear.id, ["ignore"]);

    await rewritePageCreatedAt(tempDir, januaryA.id, "2024-01-05T10:00:00");
    await rewritePageCreatedAt(tempDir, januaryB.id, "2024-01-17T10:00:00");
    await rewritePageCreatedAt(tempDir, nextYear.id, "2025-01-17T10:00:00");

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 1, 1, 12, 0, 0, 0));
      const monthlyReview = await store.generateReview("month", 2024, 1);
      expect(monthlyReview.title).toContain("2024 Review");
      const monthlyPage = await store.getPage(monthlyReview.id);
      expect(monthlyPage.content).toContain("Entries created: <strong>2</strong>");
      expect(monthlyPage.content).toContain("Top Tags");
      expect(monthlyPage.content).toContain("Longest Entries");
      expect(monthlyPage.content).not.toContain("non-AI summary");

      vi.setSystemTime(new Date(2026, 0, 10, 12, 0, 0, 0));
      const yearlyReview = await store.generateReview("year", 2025);
      expect(yearlyReview.title).toBe("Year in Review 2025");
      const yearlyPage = await store.getPage(yearlyReview.id);
      expect(yearlyPage.content).toContain("Entries created: <strong>1</strong>");
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks reviews outside availability windows", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    await store.createPage();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 1, 10, 12, 0, 0, 0));
      await expect(store.generateReview("month", 2026, 2)).rejects.toThrowError("Monthly reviews are only available");
      await expect(store.generateReview("year", 2025)).rejects.toThrowError("Year in Review is only available");
    } finally {
      vi.useRealTimers();
    }
  });

  it("encrypts storage when password protection is enabled and blocks access while locked", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const page = await store.createPage();
    await store.updatePageContent(page.id, "<p>secret text</p>");

    await store.enablePin(PRIMARY_PASSWORD);
    const encryptedRaw = await fs.readFile(path.join(tempDir, "journal", "index.json"), "utf8");
    const encryptedParsed = JSON.parse(encryptedRaw) as unknown;
    expect(isEncryptionEnvelope(encryptedParsed)).toBe(true);

    await store.lock();
    await expect(store.listPages()).rejects.toThrowError("[LOCKED]");

    await expect(store.unlock(WRONG_PASSWORD)).rejects.toThrowError("Incorrect password.");
    await store.unlock(PRIMARY_PASSWORD);
    const pages = await store.listPages();
    expect(pages.length).toBeGreaterThan(0);
  });

  it("restores encrypted history snapshots when password protection is enabled", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const page = await store.createPage();
    await store.enablePin(PRIMARY_PASSWORD);

    await store.updatePageContent(page.id, "<p>first snap</p>");
    const history = await store.listPageHistory(page.id);
    expect(history.length).toBeGreaterThan(0);

    const historyPath = path.join(tempDir, "journal", "history", page.id, `${history[0].id}.json`);
    const historyRaw = await fs.readFile(historyPath, "utf8");
    const historyParsed = JSON.parse(historyRaw) as unknown;
    expect(isEncryptionEnvelope(historyParsed)).toBe(true);

    await store.updatePageContent(page.id, "<p>second content</p>");
    await store.restorePageHistory(page.id, history[0].id);

    const restored = await store.getPage(page.id);
    expect(restored.content).toContain("<p>first snap</p>");
  });

  it("applies cooldown after repeated failed unlock attempts", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    await store.createPage();
    await store.enablePin(PRIMARY_PASSWORD);
    await store.lock();

    for (let index = 0; index < 5; index += 1) {
      await expect(store.unlock(WRONG_PASSWORD)).rejects.toThrowError();
    }

    const state = await store.getSecurityState();
    expect(state.pinEnabled).toBe(true);
    expect(state.failedAttempts).toBe(5);
    expect(state.cooldownUntil).not.toBeNull();

    await expect(store.unlock(WRONG_PASSWORD)).rejects.toThrowError("Try again");
  });

  it("wipes all journal data when self-destruct failed password limit is reached", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const page = await store.createPage();
    await store.updatePageContent(page.id, "<p>sensitive</p>");
    await store.enablePin(PRIMARY_PASSWORD);
    await store.updateSettings({
      selfDestructOnFailedPin: true,
      selfDestructPinFailureLimit: 3
    });

    const imageDir = path.join(tempDir, "journal", "images");
    const imagePath = path.join(imageDir, "sample.bin");
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(imagePath, Buffer.from([1, 2, 3]));

    await store.lock();
    await expect(store.unlock(WRONG_PASSWORD)).rejects.toThrowError("Incorrect password.");
    await expect(store.unlock(WRONG_PASSWORD)).rejects.toThrowError("Incorrect password.");
    await expect(store.unlock(WRONG_PASSWORD)).rejects.toThrowError("All journal data has been wiped.");

    const state = await store.getSecurityState();
    expect(state.pinEnabled).toBe(false);

    const pages = await store.listPages();
    expect(pages).toEqual([]);

    await expect(fs.access(imagePath)).rejects.toThrowError();

    const settings = await store.getSettings();
    expect(settings.selfDestructOnFailedPin).toBe(false);
    expect(settings.selfDestructPinFailureLimit).toBe(15);
  });

  it("decrypts storage when password protection is disabled with the correct password", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    await store.createPage();
    await store.enablePin(PRIMARY_PASSWORD);

    await store.disablePin(PRIMARY_PASSWORD);

    const raw = await fs.readFile(path.join(tempDir, "journal", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    expect(isEncryptionEnvelope(parsed)).toBe(false);
    const state = await store.getSecurityState();
    expect(state.pinEnabled).toBe(false);
  });

  it("mirrors lock-screen reset visibility into security state and preserves it across password changes", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    await store.createPage();

    expect((await store.getSecurityState()).allowResetFromLockScreen).toBe(true);

    await store.updateSettings({ allowResetFromLockScreen: false });
    expect((await store.getSettings()).allowResetFromLockScreen).toBe(false);

    await store.enablePin(PRIMARY_PASSWORD);
    expect((await store.getSecurityState()).allowResetFromLockScreen).toBe(false);

    await store.lock();
    const lockedState = await store.getSecurityState();
    expect(lockedState.locked).toBe(true);
    expect(lockedState.allowResetFromLockScreen).toBe(false);

    await store.unlock(PRIMARY_PASSWORD);
    await store.changePin(PRIMARY_PASSWORD, SECONDARY_PASSWORD);
    expect((await store.getSecurityState()).allowResetFromLockScreen).toBe(false);
  });

  it("loads missing reset-visibility fields from older settings and security metadata with safe defaults", async () => {
    const settingsDir = await makeTempDir();
    let store = new JournalStore(settingsDir);
    await store.createPage();

    const indexPath = path.join(settingsDir, "journal", "index.json");
    const indexRaw = JSON.parse(await fs.readFile(indexPath, "utf8")) as {
      settings: Record<string, unknown>;
    };
    delete indexRaw.settings.allowResetFromLockScreen;
    await fs.writeFile(indexPath, JSON.stringify(indexRaw, null, 2), "utf8");

    store = new JournalStore(settingsDir);
    expect((await store.getSettings()).allowResetFromLockScreen).toBe(true);
    expect((await store.getSecurityState()).allowResetFromLockScreen).toBe(true);

    const securityDir = await makeTempDir();
    store = new JournalStore(securityDir);
    await store.createPage();
    await store.enablePin(PRIMARY_PASSWORD);
    await store.lock();

    const securityPath = path.join(securityDir, "journal", "security.json");
    const securityRaw = JSON.parse(await fs.readFile(securityPath, "utf8")) as Record<string, unknown>;
    delete securityRaw.allowResetFromLockScreen;
    await fs.writeFile(securityPath, JSON.stringify(securityRaw, null, 2), "utf8");

    store = new JournalStore(securityDir);
    expect((await store.getSecurityState()).allowResetFromLockScreen).toBe(true);
  });

  it("supports encrypted export/import roundtrip", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const created = await store.createPage();
    await store.renamePage(created.id, "Encrypted Export");
    await store.updatePageContent(created.id, "<p>encrypted roundtrip</p>");
    await store.enablePin(PRIMARY_PASSWORD);

    const exportResult = await store.exportData("json-encrypted");
    const exportedRaw = await fs.readFile(exportResult.filePath, "utf8");
    const exportedParsed = JSON.parse(exportedRaw) as { encrypted?: boolean };
    expect(exportedParsed.encrypted).toBe(true);

    await store.movePageToTrash(created.id);
    await store.deletePagePermanently(created.id);
    await store.importData(exportResult.filePath);

    const pages = await store.listPages();
    expect(pages.some((page) => page.title === "Encrypted Export")).toBe(true);
  });

  it("sanitizes content imported from JSON bundles", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const created = await store.createPage();
    await store.renamePage(created.id, "Imported");
    await store.updatePageContent(created.id, "<p>original</p>");

    const exportResult = await store.exportData("json");
    const raw = await fs.readFile(exportResult.filePath, "utf8");
    const parsed = JSON.parse(raw) as {
      index: { pages: Array<{ id: string }> };
      pages: Array<{ id: string; content: string }>;
    };
    parsed.pages = parsed.pages.map((page) =>
      page.id === created.id
        ? {
            ...page,
            content:
              `<p>imported</p><img src="x" onerror="alert(1)" />` +
              `<a href="javascript:alert(2)" onclick="alert(3)">bad</a><script>alert(4)</script>`
          }
        : page
    );

    const maliciousImportPath = path.join(tempDir, "malicious-import.json");
    await fs.writeFile(maliciousImportPath, JSON.stringify(parsed, null, 2), "utf8");
    await store.importData(maliciousImportPath);

    const imported = await store.getPage(created.id);
    expect(imported.content).toContain("<p>imported</p>");
    expect(imported.content.toLowerCase()).not.toContain("<script");
    expect(imported.content.toLowerCase()).not.toContain("onerror=");
    expect(imported.content.toLowerCase()).not.toContain("onclick=");
    expect(imported.content.toLowerCase()).not.toContain("javascript:");
  });

  it("rejects JSON imports with unsafe page IDs", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const created = await store.createPage();
    await store.updatePageContent(created.id, "<p>safe content</p>");

    const exportResult = await store.exportData("json");
    const raw = await fs.readFile(exportResult.filePath, "utf8");
    const parsed = JSON.parse(raw) as {
      index: { pages: Array<{ id: string }> };
      pages: Array<{ id: string; content: string }>;
    };

    const maliciousId = "..\\..\\outside";
    parsed.index.pages = parsed.index.pages.map((page) => (page.id === created.id ? { ...page, id: maliciousId } : page));
    parsed.pages = parsed.pages.map((page) => (page.id === created.id ? { ...page, id: maliciousId } : page));

    const maliciousImportPath = path.join(tempDir, "malicious-id-import.json");
    await fs.writeFile(maliciousImportPath, JSON.stringify(parsed, null, 2), "utf8");

    await expect(store.importData(maliciousImportPath)).rejects.toThrowError("Invalid import file.");
    await expect(fs.access(path.join(tempDir, "outside.json"))).rejects.toThrowError();
  });

  it("rejects unsafe page/history/backup IDs in file-system APIs", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const page = await store.createPage();

    await expect(store.listPageHistory("..\\..\\secret")).rejects.toThrowError("Invalid page id.");
    await expect(store.restorePageHistory(page.id, "..\\..\\snapshot")).rejects.toThrowError("Invalid history id.");
    await expect(store.deletePageHistory("..\\..", "to-delete")).rejects.toThrowError("Invalid page id.");
    await expect(store.restoreBackup("..\\..\\escape")).rejects.toThrowError("Invalid backup id.");
  });

  it("rejects JSON imports when active page metadata has no matching page payload", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const created = await store.createPage();
    await store.renamePage(created.id, "Active Page");
    await store.updatePageContent(created.id, "<p>active import payload</p>");

    const exportResult = await store.exportData("json");
    const raw = await fs.readFile(exportResult.filePath, "utf8");
    const parsed = JSON.parse(raw) as {
      pages: Array<{ id: string; content: string }>;
    };
    parsed.pages = parsed.pages.filter((page) => page.id !== created.id);

    const malformedImportPath = path.join(tempDir, "missing-active-page-content.json");
    await fs.writeFile(malformedImportPath, JSON.stringify(parsed, null, 2), "utf8");

    await expect(store.importData(malformedImportPath)).rejects.toThrowError("Invalid import file.");
  });

  it("imports JSON exports that omit trashed page payloads", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const activePage = await store.createPage();
    const trashedPage = await store.createPage();
    await store.renamePage(activePage.id, "Keep Me");
    await store.renamePage(trashedPage.id, "Trash Me");
    await store.updatePageContent(activePage.id, "<p>keep</p>");
    await store.updatePageContent(trashedPage.id, "<p>trash</p>");
    await store.movePageToTrash(trashedPage.id);

    const exportResult = await store.exportData("json");

    await store.deletePagePermanently(activePage.id);
    await store.deletePagePermanently(trashedPage.id);

    await store.importData(exportResult.filePath);

    const pages = await store.listPages(true);
    expect(pages.some((page) => page.id === activePage.id)).toBe(true);
    expect(pages.some((page) => page.id === trashedPage.id)).toBe(false);
  });

  it("supports encrypted ZIP export/import for full app data", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const created = await store.createPage();
    await store.renamePage(created.id, "Full Backup");
    await store.updatePageContent(created.id, "<p>full encrypted zip roundtrip</p>");
    await store.updateSettings({ theme: "graphite", defaultFont: "Georgia", fontSize: 19 });

    const imageDir = path.join(tempDir, "journal", "images");
    const imagePath = path.join(imageDir, "sample.bin");
    const imageBytes = Buffer.from([4, 8, 15, 16, 23, 42]);
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(imagePath, imageBytes);

    await store.enablePin(PRIMARY_PASSWORD);
    const exportPath = path.join(tempDir, "full-app-backup.zip");
    await store.exportData("encrypted-zip", exportPath, "backup-key-1234");

    await store.renamePage(created.id, "Mutated");
    await store.updateSettings({ theme: "matte", defaultFont: "Arial", fontSize: 14 });
    await fs.rm(imagePath, { force: true });

    await store.importData(exportPath, "backup-key-1234");
    await store.unlock(PRIMARY_PASSWORD);

    const pages = await store.listPages();
    expect(pages.some((page) => page.title === "Full Backup")).toBe(true);

    const settings = await store.getSettings();
    expect(settings.theme).toBe("graphite");
    expect(settings.defaultFont).toBe("Georgia");
    expect(settings.fontSize).toBe(19);

    const restoredImageBytes = await fs.readFile(imagePath);
    expect(Buffer.compare(restoredImageBytes, imageBytes)).toBe(0);
  });

  it("supports encrypted ZIP export/import when app password protection is disabled", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const created = await store.createPage();
    await store.renamePage(created.id, "No PIN Backup");
    await store.updatePageContent(created.id, "<p>plain install encrypted zip</p>");

    const exportPath = path.join(tempDir, "no-pin-encrypted.zip");
    await store.exportData("encrypted-zip", exportPath, "zip-key-no-pin");

    await store.renamePage(created.id, "Mutated");
    await store.importData(exportPath, "zip-key-no-pin");

    const pages = await store.listPages();
    expect(pages.some((page) => page.title === "No PIN Backup")).toBe(true);
  });

  it("imports, lists, and removes custom fonts", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const sourceFontPath = path.join(tempDir, "Example Serif.ttf");
    const sourceFontBytes = Buffer.from([0, 1, 2, 3, 4, 5]);
    await fs.writeFile(sourceFontPath, sourceFontBytes);

    const importedSettings = await store.importFonts([sourceFontPath]);
    expect(importedSettings.importedFonts).toHaveLength(1);
    expect(importedSettings.importedFonts[0].family).toBe("Example Serif");

    const fontAssets = await store.listImportedFontAssets();
    expect(fontAssets).toHaveLength(1);
    expect(fontAssets[0].fileUrl).toContain("/journal/fonts/");

    const copiedFontPath = path.join(tempDir, "journal", "fonts", importedSettings.importedFonts[0].fileName);
    const copiedFontBytes = await fs.readFile(copiedFontPath);
    expect(Buffer.compare(copiedFontBytes, sourceFontBytes)).toBe(0);

    const withCustomDefault = await store.updateSettings({ defaultFont: importedSettings.importedFonts[0].family });
    expect(withCustomDefault.defaultFont).toBe("Example Serif");

    const afterRemove = await store.removeImportedFont(importedSettings.importedFonts[0].id);
    expect(afterRemove.importedFonts).toEqual([]);
    expect(afterRemove.defaultFont).toBe("Segoe UI");
    await expect(fs.access(copiedFontPath)).rejects.toThrowError();
  });

  it("drops imported font settings when the copied font file is missing", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const sourceFontPath = path.join(tempDir, "Notebook Sans.otf");
    await fs.writeFile(sourceFontPath, Buffer.from([9, 8, 7, 6]));

    const importedSettings = await store.importFonts([sourceFontPath]);
    const copiedFontPath = path.join(tempDir, "journal", "fonts", importedSettings.importedFonts[0].fileName);
    await fs.rm(copiedFontPath, { force: true });

    const reloadedStore = new JournalStore(tempDir);
    const settings = await reloadedStore.getSettings();
    expect(settings.importedFonts).toEqual([]);
    expect(settings.defaultFont).toBe("Segoe UI");
  });

  it("rejects encrypted ZIP imports that attempt to restore security metadata", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    await store.createPage();

    const kdf = {
      salt: Buffer.from("0123456789abcdef").toString("base64"),
      keyLength: 32,
      cost: 16_384,
      blockSize: 8,
      parallelization: 1
    };
    const zipKey = "zip-key-security-test";
    const derivedKey = await deriveKey(zipKey, kdf);
    const fullBackup = {
      version: 2,
      createdAt: new Date().toISOString(),
      kind: "zypher-full-backup",
      files: [
        { path: "index.json", data: Buffer.from("{}", "utf8").toString("base64") },
        { path: "security.json", data: Buffer.from("{}", "utf8").toString("base64") }
      ]
    };
    const encryptedZipBundle = {
      version: 2,
      createdAt: new Date().toISOString(),
      kind: "zypher-encrypted-zip",
      encrypted: true,
      kdf,
      payload: encryptUtf8(JSON.stringify(fullBackup), derivedKey)
    };

    const zipPath = path.join(tempDir, "security-injection.zip");
    const zip = new AdmZip();
    zip.addFile("zypher-encrypted-backup.json", Buffer.from(JSON.stringify(encryptedZipBundle), "utf8"));
    await fs.writeFile(zipPath, zip.toBuffer());

    await expect(store.importData(zipPath, zipKey)).rejects.toThrowError("cannot modify security metadata");
  });

  it("imports encrypted ZIP backups created before a password change", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    const created = await store.createPage();
    await store.renamePage(created.id, "Pre-rotation backup");
    await store.updatePageContent(created.id, "<p>older encrypted backup</p>");

    await store.enablePin(PRIMARY_PASSWORD);
    const exportPath = path.join(tempDir, "legacy-import.zip");
    await store.exportData("encrypted-zip", exportPath, "legacy-zip-key");

    await store.changePin(PRIMARY_PASSWORD, SECONDARY_PASSWORD);
    await store.updatePageContent(created.id, "<p>newer content</p>");

    await store.importData(exportPath, "legacy-zip-key");

    const state = await store.getSecurityState();
    expect(state.pinEnabled).toBe(true);
    expect(state.locked).toBe(true);

    await expect(store.unlock(PRIMARY_PASSWORD)).rejects.toThrowError("Incorrect password.");
    await store.unlock(SECONDARY_PASSWORD);
    const pages = await store.listPages();
    expect(pages.some((page) => page.title === "Pre-rotation backup")).toBe(true);
  });

  it("rejects encrypted ZIP imports when the ZIP key is incorrect", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    await store.createPage();
    await store.enablePin(PRIMARY_PASSWORD);

    const exportPath = path.join(tempDir, "wrong-key.zip");
    await store.exportData("encrypted-zip", exportPath, "correct-zip-key");

    await expect(store.importData(exportPath, "wrong-zip-key")).rejects.toThrowError("ZIP key is incorrect");
  });

  it("resets encrypted data and clears security state", async () => {
    const tempDir = await makeTempDir();
    const store = new JournalStore(tempDir);
    await store.createPage();
    await store.enablePin(PRIMARY_PASSWORD);
    await store.lock();

    await store.resetEncryptedData();
    const state = await store.getSecurityState();
    expect(state.pinEnabled).toBe(false);

    const pages = await store.listPages();
    expect(pages).toEqual([]);
  });
});
