import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import type { SecurityState } from "../shared/types";

const ENCRYPTION_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const VERIFIER_LENGTH = 32;
const MIN_SELF_DESTRUCT_PIN_FAILURE_LIMIT = 1;
const MAX_SELF_DESTRUCT_PIN_FAILURE_LIMIT = 100;

export const PIN_PATTERN = /^[^\s]{4,64}$/;
export const DEFAULT_SELF_DESTRUCT_PIN_FAILURE_LIMIT = 15;

export interface EncryptionEnvelope {
  version: number;
  alg: string;
  iv: string;
  tag: string;
  data: string;
}

export interface KdfConfig {
  salt: string;
  keyLength: number;
  cost: number;
  blockSize: number;
  parallelization: number;
}

export interface SecurityMetadata {
  version: number;
  enabled: boolean;
  kdf: KdfConfig | null;
  verifier: EncryptionEnvelope | null;
  verifierDigest: string | null;
  failedAttempts: number;
  cooldownUntil: string | null;
  selfDestructOnFailedPin: boolean;
  selfDestructPinFailureLimit: number;
  allowResetFromLockScreen: boolean;
  legacyZipKeys: EncryptionEnvelope[];
}

export class SecurityError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SecurityError";
  }
}

function toBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

function fromBase64(input: string): Buffer {
  return Buffer.from(input, "base64");
}

export function createDisabledSecurityMetadata(): SecurityMetadata {
  return {
    version: ENCRYPTION_VERSION,
    enabled: false,
    kdf: null,
    verifier: null,
    verifierDigest: null,
    failedAttempts: 0,
    cooldownUntil: null,
    selfDestructOnFailedPin: false,
    selfDestructPinFailureLimit: DEFAULT_SELF_DESTRUCT_PIN_FAILURE_LIMIT,
    allowResetFromLockScreen: true,
    legacyZipKeys: []
  };
}

export function normalizeSelfDestructPinFailureLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SELF_DESTRUCT_PIN_FAILURE_LIMIT;
  }
  const normalized = Math.round(value);
  return Math.max(MIN_SELF_DESTRUCT_PIN_FAILURE_LIMIT, Math.min(MAX_SELF_DESTRUCT_PIN_FAILURE_LIMIT, normalized));
}

export function ensureValidPin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new SecurityError("INVALID_PIN_FORMAT", "Password must be 4-64 characters with no spaces.");
  }
}

export async function deriveKey(pin: string, kdf: KdfConfig): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      pin,
      fromBase64(kdf.salt),
      kdf.keyLength,
      {
        N: kdf.cost,
        r: kdf.blockSize,
        p: kdf.parallelization
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(key));
      }
    );
  });
}

export function encryptUtf8(plaintext: string, key: Buffer): EncryptionEnvelope {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: ENCRYPTION_VERSION,
    alg: ALGORITHM,
    iv: toBase64(iv),
    tag: toBase64(tag),
    data: toBase64(encrypted)
  };
}

export function decryptUtf8(envelope: EncryptionEnvelope, key: Buffer): string {
  if (envelope.version !== ENCRYPTION_VERSION || envelope.alg !== ALGORITHM) {
    throw new SecurityError("UNSUPPORTED_ENCRYPTION", "Unsupported encrypted payload version.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, fromBase64(envelope.iv));
    decipher.setAuthTag(fromBase64(envelope.tag));
    const decrypted = Buffer.concat([decipher.update(fromBase64(envelope.data)), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new SecurityError("DECRYPT_FAILED", "Failed to decrypt payload.");
  }
}

export function isEncryptionEnvelope(value: unknown): value is EncryptionEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EncryptionEnvelope>;
  return (
    typeof candidate.version === "number" &&
    typeof candidate.alg === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.data === "string"
  );
}

export async function createEnabledSecurityMetadata(pin: string): Promise<{ metadata: SecurityMetadata; key: Buffer }> {
  ensureValidPin(pin);
  const kdf: KdfConfig = {
    salt: toBase64(randomBytes(16)),
    keyLength: KEY_LENGTH,
    cost: 16_384,
    blockSize: 8,
    parallelization: 1
  };
  const key = await deriveKey(pin, kdf);
  const verifierRaw = toBase64(randomBytes(VERIFIER_LENGTH));
  const verifierDigest = createHash("sha256").update(verifierRaw, "utf8").digest();
  const verifier = encryptUtf8(verifierRaw, key);
  return {
    metadata: {
      version: ENCRYPTION_VERSION,
      enabled: true,
      kdf,
      verifier,
      verifierDigest: toBase64(verifierDigest),
      failedAttempts: 0,
      cooldownUntil: null,
      selfDestructOnFailedPin: false,
      selfDestructPinFailureLimit: DEFAULT_SELF_DESTRUCT_PIN_FAILURE_LIMIT,
      allowResetFromLockScreen: true,
      legacyZipKeys: []
    },
    key
  };
}

export async function verifyPin(metadata: SecurityMetadata, pin: string): Promise<Buffer | null> {
  if (!metadata.enabled || !metadata.kdf || !metadata.verifier || !metadata.verifierDigest) {
    return null;
  }

  let key: Buffer;
  try {
    key = await deriveKey(pin, metadata.kdf);
  } catch {
    return null;
  }

  let verifierRaw = "";
  try {
    verifierRaw = decryptUtf8(metadata.verifier, key);
  } catch {
    return null;
  }

  const actual = createHash("sha256").update(verifierRaw, "utf8").digest();
  const expected = fromBase64(metadata.verifierDigest);
  if (actual.length !== expected.length) {
    return null;
  }
  if (!timingSafeEqual(actual, expected)) {
    return null;
  }
  return key;
}

export function toSecurityState(metadata: SecurityMetadata, locked: boolean): SecurityState {
  return {
    pinEnabled: metadata.enabled,
    locked: metadata.enabled ? locked : false,
    cooldownUntil: metadata.cooldownUntil,
    failedAttempts: metadata.failedAttempts,
    allowResetFromLockScreen: metadata.allowResetFromLockScreen
  };
}
