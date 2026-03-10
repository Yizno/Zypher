import type { JournalPageMeta, SortMode } from "./types";

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareAlphabetically(left: JournalPageMeta, right: JournalPageMeta): number {
  return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

function comparePinned(left: JournalPageMeta, right: JournalPageMeta): number {
  if (left.pinned === right.pinned) {
    return 0;
  }

  return left.pinned ? -1 : 1;
}

export function sortPages(pages: JournalPageMeta[], sortMode: SortMode): JournalPageMeta[] {
  return [...pages].sort((left, right) => {
    const pinned = comparePinned(left, right);
    if (pinned !== 0) {
      return pinned;
    }

    if (sortMode === "alphabetical") {
      return compareAlphabetically(left, right);
    }

    if (sortMode === "created") {
      return parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
    }

    return parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt);
  });
}

export function sortPagesByRecent(pages: JournalPageMeta[]): JournalPageMeta[] {
  return sortPages(pages, "recent");
}
