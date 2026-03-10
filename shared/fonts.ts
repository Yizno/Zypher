import type { ImportedFont, ImportedFontFormat } from "./types";

export const DEFAULT_FONT_FAMILY = "Segoe UI";
export const BUILT_IN_FONT_FAMILIES = [
  DEFAULT_FONT_FAMILY,
  "Merriweather",
  "Caveat",
  "Dancing Script",
  "Patrick Hand",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Arial",
  "Tahoma",
  "Courier New",
  "Consolas"
] as const;

const IMPORTED_FONT_FORMAT_BY_EXTENSION: Record<string, ImportedFontFormat> = {
  ".ttf": "truetype",
  ".otf": "opentype",
  ".woff": "woff",
  ".woff2": "woff2"
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findCaseInsensitiveMatch(value: string, options: Iterable<string>): string | null {
  const normalized = normalizeFontFamilyName(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const option of options) {
    if (normalizeFontFamilyName(option).toLowerCase() === normalized) {
      return option;
    }
  }

  return null;
}

export function normalizeFontFamilyName(value: string): string {
  return normalizeWhitespace(value.replace(/["']/g, ""));
}

export function normalizeImportedFontFamilyCandidate(value: string): string {
  const sanitized = normalizeWhitespace(value.replace(/["']/g, " ").replace(/[<>\\/:|?*\u0000-\u001f]+/g, " "));
  return sanitized.slice(0, 80) || "Imported Font";
}

export function getImportedFontFormatFromFileName(fileName: string): ImportedFontFormat | null {
  const normalized = fileName.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot < 0) {
    return null;
  }

  return IMPORTED_FONT_FORMAT_BY_EXTENSION[normalized.slice(lastDot)] ?? null;
}

export function getImportedFontExtensions(): string[] {
  return Object.keys(IMPORTED_FONT_FORMAT_BY_EXTENSION).map((extension) => extension.slice(1));
}

export function getSelectableFontFamilies(importedFonts: ImportedFont[] = []): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const font of [...BUILT_IN_FONT_FAMILIES, ...importedFonts.map((item) => item.family)]) {
    const normalized = normalizeFontFamilyName(font).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(font);
  }
  return results;
}

export function normalizeDefaultFontFamily(value: string | undefined, importedFonts: ImportedFont[] = []): string {
  const matched = findCaseInsensitiveMatch(value ?? "", getSelectableFontFamilies(importedFonts));
  return matched ?? DEFAULT_FONT_FAMILY;
}

export function makeUniqueImportedFontFamily(baseName: string, existingFamilies: Iterable<string>): string {
  const normalizedBase = normalizeImportedFontFamilyCandidate(baseName);
  const seen = new Set<string>();
  for (const family of existingFamilies) {
    const normalized = normalizeFontFamilyName(family).toLowerCase();
    if (normalized) {
      seen.add(normalized);
    }
  }

  if (!seen.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${normalizedBase} ${suffix}`;
    if (!seen.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${normalizedBase} ${Date.now()}`;
}

export function normalizeImportedFonts(value: unknown): ImportedFont[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: ImportedFont[] = [];
  const seenIds = new Set<string>();
  const seenFamilies = new Set<string>();
  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }

    const id = typeof item.id === "string" ? normalizeWhitespace(item.id) : "";
    const family = typeof item.family === "string" ? normalizeImportedFontFamilyCandidate(item.family) : "";
    const fileName =
      typeof item.fileName === "string" ? normalizeWhitespace(item.fileName.split(/[\\/]/).pop() ?? "") : "";
    const originalName = typeof item.originalName === "string" ? normalizeWhitespace(item.originalName) : fileName;
    const inferredFormat =
      typeof item.format === "string" && ["truetype", "opentype", "woff", "woff2"].includes(item.format)
        ? (item.format as ImportedFontFormat)
        : getImportedFontFormatFromFileName(fileName);
    const importedAt = typeof item.importedAt === "string" ? item.importedAt : new Date().toISOString();
    const normalizedFamily = family.toLowerCase();
    if (!id || !family || !fileName || !inferredFormat || seenIds.has(id) || seenFamilies.has(normalizedFamily)) {
      continue;
    }

    seenIds.add(id);
    seenFamilies.add(normalizedFamily);
    results.push({
      id,
      family,
      fileName,
      originalName,
      format: inferredFormat,
      importedAt
    });
  }

  return results;
}
