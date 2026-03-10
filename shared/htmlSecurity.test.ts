import { describe, expect, it } from "vitest";

import { normalizeJournalHtml } from "./htmlSecurity";

describe("html security", () => {
  it("keeps URL query separators stable for link attributes", () => {
    const source = '<p><a href="https://example.com/path?one=1&amp;two=2">Link</a></p>';

    const once = normalizeJournalHtml(source);
    const twice = normalizeJournalHtml(once);

    expect(once).toContain('href="https://example.com/path?one=1&amp;two=2"');
    expect(twice).toBe(once);
  });

  it("repairs previously over-escaped URI attributes", () => {
    const source =
      '<p><a href="https://example.com/path?one=1&amp;amp;two=2">Link</a><img src="https://img.example.com/a.png?x=3&amp;amp;y=4" /></p>';

    const normalized = normalizeJournalHtml(source);

    expect(normalized).toContain('href="https://example.com/path?one=1&amp;two=2"');
    expect(normalized).toContain('src="https://img.example.com/a.png?x=3&amp;y=4"');
    expect(normalized).not.toContain("&amp;amp;");
  });
});
