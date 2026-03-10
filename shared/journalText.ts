export const UNTITLED_TITLE = "Untitled";

const TAG_PATTERN = /<[^>]*>/g;
const BLOCK_BREAK_PATTERN = /<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre|tr|table|ul|ol)>/gi;
const CELL_BREAK_PATTERN = /<\/(td|th)>/gi;

export function stripHtml(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_BREAK_PATTERN, "\n")
    .replace(CELL_BREAK_PATTERN, " ")
    .replace(TAG_PATTERN, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n");
}

export function deriveTitle(content: string): string {
  const plainText = stripHtml(content);
  const firstLine = plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return UNTITLED_TITLE;
  }

  return firstLine.slice(0, 80);
}

export function derivePreview(content: string, maxLength = 120): string {
  const normalized = stripHtml(content).replace(/\s+/g, " ").trim();
  return normalized.slice(0, maxLength);
}

export function computeCounts(content: string): { charCount: number; wordCount: number; readingMinutes: number } {
  const plainText = stripHtml(content).replace(/\s+/g, " ").trim();
  const charCount = plainText.length;
  const words = plainText.length === 0 ? [] : plainText.split(" ").filter((word) => word.length > 0);
  const wordCount = words.length;
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 200 || 0));

  return {
    charCount,
    wordCount,
    readingMinutes: wordCount === 0 ? 0 : readingMinutes
  };
}
