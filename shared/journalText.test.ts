import { describe, expect, it } from "vitest";

import { derivePreview, deriveTitle, stripHtml, UNTITLED_TITLE } from "./journalText";

describe("journal text helpers", () => {
  it("returns untitled for empty content", () => {
    expect(deriveTitle("")).toBe(UNTITLED_TITLE);
    expect(deriveTitle("   \n\t")).toBe(UNTITLED_TITLE);
  });

  it("uses first non-empty line as title", () => {
    expect(deriveTitle("<p></p><p>First line</p><p>Second line</p>")).toBe("First line");
  });

  it("normalizes whitespace for preview", () => {
    expect(derivePreview("<p>hello    world</p><p>more</p>")).toBe("hello world more");
  });

  it("strips html tags", () => {
    expect(stripHtml("<h1>Hi</h1><p>there</p>")).toContain("Hi");
  });

  it("does not insert spaces inside words split by inline tags", () => {
    expect(derivePreview("<p>curre<span>ntly</span> in alpha</p>")).toBe("currently in alpha");
  });
});
