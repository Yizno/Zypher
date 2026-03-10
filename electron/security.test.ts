import { describe, expect, it } from "vitest";

import {
  PIN_PATTERN,
  createEnabledSecurityMetadata,
  decryptUtf8,
  ensureValidPin,
  encryptUtf8,
  verifyPin
} from "./security";

describe("security", () => {
  it("validates password format", () => {
    expect(PIN_PATTERN.test("abcd1234")).toBe(true);
    expect(PIN_PATTERN.test("Symbols!234")).toBe(true);
    expect(PIN_PATTERN.test("Ab1!")).toBe(true);
    expect(() => ensureValidPin("abc")).toThrowError("Password must be 4-64 characters with no spaces.");
    expect(() => ensureValidPin("has space")).toThrowError("Password must be 4-64 characters with no spaces.");
    expect(() => ensureValidPin("a".repeat(65))).toThrowError("Password must be 4-64 characters with no spaces.");
  });

  it("encrypts and decrypts with AES-GCM", async () => {
    const { key } = await createEnabledSecurityMetadata("abcd1234");
    const payload = encryptUtf8("hello-world", key);
    expect(decryptUtf8(payload, key)).toBe("hello-world");
  });

  it("rejects wrong password verifier checks", async () => {
    const { metadata } = await createEnabledSecurityMetadata("abcd1234");
    const wrong = await verifyPin(metadata, "wrongpass1");
    expect(wrong).toBeNull();

    const correct = await verifyPin(metadata, "abcd1234");
    expect(correct).not.toBeNull();
  });

  it("fails authentication when ciphertext is tampered", async () => {
    const { key } = await createEnabledSecurityMetadata("abcd1234");
    const payload = encryptUtf8("tamper-me", key);
    payload.data = Buffer.from("tamper-me-2", "utf8").toString("base64");
    expect(() => decryptUtf8(payload, key)).toThrowError("Failed to decrypt payload.");
  });
});
