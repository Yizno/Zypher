import { describe, expect, it } from "vitest";

import { normalizeExternalUrl, normalizeLinkInput } from "./links";

describe("links", () => {
  it("accepts supported direct URLs", () => {
    expect(normalizeExternalUrl("https://example.com/test?q=1")).toBe("https://example.com/test?q=1");
    expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeExternalUrl("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(normalizeExternalUrl("tel:+18005551234")).toBe("tel:+18005551234");
  });

  it("rejects unsupported schemes", () => {
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("ftp://example.com/file.txt")).toBeNull();
  });

  it("normalizes plain inputs for links", () => {
    expect(normalizeLinkInput("example.com")).toBe("https://example.com/");
    expect(normalizeLinkInput("example.com:3000/path")).toBe("https://example.com:3000/path");
    expect(normalizeLinkInput("localhost:5173")).toBe("https://localhost:5173/");
    expect(normalizeLinkInput("hello@example.com")).toBe("mailto:hello@example.com");
    expect(normalizeLinkInput("//example.com/path")).toBe("https://example.com/path");
  });

  it("rejects invalid or unsafe link input", () => {
    expect(normalizeLinkInput("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkInput("customscheme:value")).toBeNull();
    expect(normalizeLinkInput(" ")).toBeNull();
    expect(normalizeLinkInput("https://exa mple.com")).toBeNull();
  });
});
