const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const HAS_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const HOST_PORT_PATTERN = /^(localhost|[a-z0-9.-]+):\d{1,5}(?:\/|$)/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function normalizeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const parsed = tryParseUrl(trimmed);
  if (!parsed || !ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname) {
    return null;
  }

  return parsed.toString();
}

export function normalizeLinkInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const direct = normalizeExternalUrl(trimmed);
  if (direct) {
    return direct;
  }

  const hasUnknownScheme = HAS_SCHEME_PATTERN.test(trimmed) && !HOST_PORT_PATTERN.test(trimmed);
  if (hasUnknownScheme) {
    return null;
  }

  if (EMAIL_PATTERN.test(trimmed)) {
    return normalizeExternalUrl(`mailto:${trimmed}`);
  }

  if (trimmed.startsWith("//")) {
    return normalizeExternalUrl(`https:${trimmed}`);
  }

  return normalizeExternalUrl(`https://${trimmed}`);
}
