import { describe, expect, it } from "vitest";

import { sortPagesByRecent } from "./pageMeta";
import type { JournalPageMeta } from "./types";

describe("sortPagesByRecent", () => {
  it("sorts pages by updatedAt descending", () => {
    const pages: JournalPageMeta[] = [
      {
        id: "1",
        title: "First",
        preview: "",
        createdAt: "2026-02-20T11:00:00.000Z",
        updatedAt: "2026-02-20T11:00:00.000Z",
        deletedAt: null,
        pinned: false,
        tags: [],
        folderId: null,
        charCount: 0,
        wordCount: 0,
        readingMinutes: 0
      },
      {
        id: "2",
        title: "Second",
        preview: "",
        createdAt: "2026-02-20T12:00:00.000Z",
        updatedAt: "2026-02-20T14:00:00.000Z",
        deletedAt: null,
        pinned: true,
        tags: [],
        folderId: null,
        charCount: 0,
        wordCount: 0,
        readingMinutes: 0
      }
    ];

    const sorted = sortPagesByRecent(pages);
    expect(sorted.map((page) => page.id)).toEqual(["2", "1"]);
  });
});
