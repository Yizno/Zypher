const ZERO_WIDTH_PATTERN = /[\u200B\uFEFF]/g;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const EVENT_HANDLER_ATTRIBUTE_PATTERN = /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_TAG_NAMES = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "svg",
  "math",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option"
];
const DANGEROUS_BLOCK_TAG_PATTERN = new RegExp(
  `<\\s*(${DANGEROUS_TAG_NAMES.join("|")})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`,
  "gi"
);
const DANGEROUS_INLINE_TAG_PATTERN = new RegExp(`<\\s*(${DANGEROUS_TAG_NAMES.join("|")})\\b[^>]*\\/?>`, "gi");
const DANGEROUS_PROTOCOL_PATTERN = /^(?:javascript|vbscript):/i;
const SAFE_URL_SCHEME_PATTERN = /^(?:https?:|mailto:|tel:|blob:|#|\/|\.\/|\.\.\/)/i;
const DATA_IMAGE_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i;
const URI_ATTRIBUTE_PATTERN = /\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const ENCODED_AMPERSAND_PATTERN = /&(amp|#38|#x26);/gi;

function decodeAmpersandEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 6; pass += 1) {
    const next = decoded.replace(ENCODED_AMPERSAND_PATTERN, "&");
    if (next === decoded) {
      return decoded;
    }
    decoded = next;
  }
  return decoded;
}

function sanitizeUriValue(attribute: "href" | "src", value: string): string | null {
  const normalized = value.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  if (!normalized) {
    return null;
  }

  if (DANGEROUS_PROTOCOL_PATTERN.test(normalized)) {
    return null;
  }

  if (normalized.toLowerCase().startsWith("data:")) {
    if (attribute !== "src" || !DATA_IMAGE_PATTERN.test(normalized)) {
      return null;
    }
    return normalized;
  }

  if (SAFE_URL_SCHEME_PATTERN.test(normalized)) {
    return normalized;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function sanitizeUriAttributes(html: string): string {
  return html.replace(URI_ATTRIBUTE_PATTERN, (full, attributeName: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
    const attribute = attributeName.toLowerCase() as "href" | "src";
    const rawValue = doubleQuoted ?? singleQuoted ?? bare ?? "";
    const decodedValue = decodeAmpersandEntities(rawValue);
    const sanitized = sanitizeUriValue(attribute, decodedValue);
    if (!sanitized) {
      return "";
    }
    return ` ${attribute}="${escapeAttribute(sanitized)}"`;
  });
}

function stripDangerousTags(html: string): string {
  let output = html;
  for (let index = 0; index < 4; index += 1) {
    const next = output.replace(DANGEROUS_BLOCK_TAG_PATTERN, "");
    if (next === output) {
      break;
    }
    output = next;
  }
  return output.replace(DANGEROUS_INLINE_TAG_PATTERN, "");
}

export function sanitizeJournalHtml(input: string): string {
  const source = typeof input === "string" ? input : "";
  const withoutZeroWidth = source.replace(ZERO_WIDTH_PATTERN, "");
  const withoutComments = withoutZeroWidth.replace(COMMENT_PATTERN, "");
  const withoutDangerousTags = stripDangerousTags(withoutComments);
  const withoutEventHandlers = withoutDangerousTags.replace(EVENT_HANDLER_ATTRIBUTE_PATTERN, "");
  return sanitizeUriAttributes(withoutEventHandlers);
}

export function normalizeJournalHtml(input: string): string {
  const trimmed = sanitizeJournalHtml(input).trim();
  return trimmed.length === 0 ? "<p></p>" : trimmed;
}
