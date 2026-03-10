import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, CSSProperties, DragEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlignJustify,
  AlignCenter,
  AlignLeft,
  Bold,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Palette,
  Highlighter,
  Quote,
  Redo2,
  Table2,
  Type,
  Undo2,
  Underline
} from "lucide-react";

import { getSelectableFontFamilies } from "../../../shared/fonts";
import { normalizeJournalHtml } from "../../../shared/htmlSecurity";
import { normalizeExternalUrl, normalizeLinkInput } from "../../../shared/links";
import type { ImportedFont } from "../../../shared/types";
import { getSlashMenuPosition } from "../utils/slashMenuPosition";

interface EditorSettings {
  defaultFont: string;
  importedFonts: ImportedFont[];
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  spellcheck: boolean;
}

interface SlashCommand {
  id: string;
  label: string;
  run: () => void;
}

interface EditorProps {
  value: string;
  disabled: boolean;
  settings: EditorSettings;
  findRequestToken: number;
  onChange: (nextValue: string) => void;
}

interface SlashMenuState {
  left: number;
  top: number;
  bottom: number;
  query: string;
}

interface LinkContextMenuState {
  x: number;
  y: number;
  href: string;
}

interface ImageContextMenuState {
  x: number;
  y: number;
  imageId: string;
}

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  linked: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  blockStyle: "p" | "h1" | "h2" | "blockquote" | "pre";
  fontFamily: string;
  fontSize: string;
  outlined: boolean;
}

interface TextFormatSnapshot {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  blockStyle: "p" | "h1" | "h2" | "blockquote" | "pre";
  fontFamily: string;
  fontSizeMode: "default" | "fixed";
  fontSizePx: number | null;
  textColor: string;
  highlightColor: string;
  linkHref: string | null;
  outlined: boolean;
  outlineColor: string;
}

interface SerializedBoundary {
  path: number[];
  offset: number;
}

interface SerializedSelectionRange {
  start: SerializedBoundary;
  end: SerializedBoundary;
}

interface EditorSnapshot {
  html: string;
  selection: SerializedSelectionRange | null;
}

type ImageAlignment = "left" | "center" | "full";
type StylePopover = "text-color" | "highlight-color" | "outline" | "link" | null;

const IMAGE_DRAG_TYPE = "application/x-journal-image-id";
const DEFAULT_FONT_VALUE = "default";
const DEFAULT_FONT_SIZE_VALUE = "default";
const DEFAULT_FONT_SIZE_CSS_VARIABLE = "var(--journal-default-font-size)";
const FONT_SIZE_CARET_MARKER = "\u200B";
const FONT_SIZE_OPTIONS = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36];
const TEXT_COLOR_PRESETS = [
  "#ffffff",
  "#e6e7ea",
  "#c9d7ff",
  "#60a5fa",
  "#67e8f9",
  "#86efac",
  "#a7f3d0",
  "#fcd34d",
  "#fb923c",
  "#fca5a5",
  "#f472b6",
  "#c4b5fd",
  "#9ca3af",
  "#000000"
];
const HIGHLIGHT_COLOR_PRESETS = [
  "#364158",
  "#3b4b66",
  "#2f4858",
  "#1f5a44",
  "#27442c",
  "#5e5a1f",
  "#6a4f1e",
  "#5b3c2d",
  "#5a2c2c",
  "#4b2c5e",
  "#3a2f61",
  "#2e4b5f",
  "#5f5f5f",
  "#000000"
];
const OUTLINE_COLOR_PRESETS = [
  "#6d7e98",
  "#94a3b8",
  "#60a5fa",
  "#22d3ee",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#c084fc",
  "#ffffff",
  "#000000"
];
const TOOLBAR_POPOVER_WIDTH = 220;
const TOOLBAR_LINK_POPOVER_WIDTH = 300;
const MAX_EDITOR_SNAPSHOTS = 200;
const FIND_ALL_HIGHLIGHT_NAME = "journal-find-all";
const FIND_ACTIVE_HIGHLIGHT_NAME = "journal-find-active";
const BLOCKED_EDITOR_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
  "BASE",
  "FORM",
  "INPUT",
  "BUTTON",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "SVG",
  "MATH"
]);
const ALLOWED_EDITOR_TAGS = new Set([
  "A",
  "BLOCKQUOTE",
  "BR",
  "DIV",
  "H1",
  "H2",
  "HR",
  "IMG",
  "LI",
  "OL",
  "P",
  "PRE",
  "SPAN",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TFOOT",
  "TR",
  "UL"
]);
const GLOBAL_ALLOWED_ATTRIBUTES = new Set(["style"]);
const ALLOWED_ATTRIBUTES_BY_TAG = new Map<string, Set<string>>([
  ["A", new Set(["href", "target", "rel"])],
  ["IMG", new Set(["src", "alt", "title", "width", "height", "draggable", "data-journal-image-id"])],
  ["SPAN", new Set(["data-journal-font-mode", "data-journal-font-size-mode", "data-journal-outline"])],
  ["P", new Set(["data-journal-font-size-mode"])],
  ["H1", new Set(["data-journal-font-size-mode"])],
  ["H2", new Set(["data-journal-font-size-mode"])],
  ["BLOCKQUOTE", new Set(["data-journal-font-size-mode"])],
  ["PRE", new Set(["data-journal-font-size-mode"])],
  ["LI", new Set(["data-journal-font-size-mode"])],
  ["TD", new Set(["data-journal-font-size-mode", "colspan", "rowspan"])],
  ["TH", new Set(["data-journal-font-size-mode", "colspan", "rowspan"])],
  ["OL", new Set(["start"])]
]);
const ALLOWED_STYLE_PROPERTIES = new Set([
  "-webkit-text-stroke",
  "background-color",
  "color",
  "display",
  "float",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "margin",
  "max-width",
  "paint-order",
  "text-align",
  "text-decoration",
  "width"
]);
const DANGEROUS_STYLE_VALUE_PATTERN = /(expression\s*\(|url\s*\(|javascript:|vbscript:|@import|-moz-binding)/i;

interface CssHighlightsRegistry {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

function getSelectionRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  return selection.getRangeAt(0);
}

function getCaretRangeFromPoint(x: number, y: number): Range | null {
  const extendedDocument = document as Document & {
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
    caretPositionFromPoint?: (clientX: number, clientY: number) => { offsetNode: Node; offset: number } | null;
  };

  if (typeof extendedDocument.caretRangeFromPoint === "function") {
    return extendedDocument.caretRangeFromPoint(x, y);
  }

  if (typeof extendedDocument.caretPositionFromPoint === "function") {
    const caret = extendedDocument.caretPositionFromPoint(x, y);
    if (!caret) {
      return null;
    }

    const range = document.createRange();
    range.setStart(caret.offsetNode, caret.offset);
    range.collapse(true);
    return range;
  }

  return null;
}

function placeSelection(range: Range | null): void {
  if (!range) {
    return;
  }

  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

function getNodePath(root: Node, target: Node): number[] | null {
  if (root === target) {
    return [];
  }

  const path: number[] = [];
  let current: Node | null = target;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) {
      return null;
    }
    const index = Array.prototype.indexOf.call(parent.childNodes, current) as number;
    if (index < 0) {
      return null;
    }
    path.push(index);
    current = parent;
  }

  if (current !== root) {
    return null;
  }

  path.reverse();
  return path;
}

function resolveNodeFromPath(root: Node, path: number[]): Node | null {
  let current: Node | null = root;
  for (const index of path) {
    if (!current || !current.childNodes[index]) {
      return null;
    }
    current = current.childNodes[index];
  }
  return current;
}

function clampBoundaryOffset(node: Node, offset: number): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
  }
  return Math.max(0, Math.min(offset, node.childNodes.length));
}

function serializeSelectionRange(editor: HTMLDivElement): SerializedSelectionRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }

  const startPath = getNodePath(editor, range.startContainer);
  const endPath = getNodePath(editor, range.endContainer);
  if (!startPath || !endPath) {
    return null;
  }

  return {
    start: { path: startPath, offset: range.startOffset },
    end: { path: endPath, offset: range.endOffset }
  };
}

function restoreSerializedSelection(editor: HTMLDivElement, serialized: SerializedSelectionRange | null): boolean {
  if (!serialized) {
    return false;
  }

  const startNode = resolveNodeFromPath(editor, serialized.start.path);
  const endNode = resolveNodeFromPath(editor, serialized.end.path);
  if (!startNode || !endNode) {
    return false;
  }

  const nextRange = document.createRange();
  nextRange.setStart(startNode, clampBoundaryOffset(startNode, serialized.start.offset));
  nextRange.setEnd(endNode, clampBoundaryOffset(endNode, serialized.end.offset));
  placeSelection(nextRange);
  return true;
}

function createImageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `img-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

function ensureImageMeta(image: HTMLImageElement): string {
  const existingId = image.dataset.journalImageId;
  if (existingId) {
    image.draggable = true;
    return existingId;
  }

  const id = createImageId();
  image.dataset.journalImageId = id;
  image.draggable = true;
  return id;
}

function findImageById(editor: HTMLDivElement, imageId: string): HTMLImageElement | null {
  const images = Array.from(editor.querySelectorAll("img"));
  for (const image of images) {
    if (image instanceof HTMLImageElement && image.dataset.journalImageId === imageId) {
      return image;
    }
  }
  return null;
}

function commandState(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function getCurrentBlockStyle(): "p" | "h1" | "h2" | "blockquote" | "pre" {
  let value = "";
  try {
    value = String(document.queryCommandValue("formatBlock") ?? "").toLowerCase();
  } catch {
    return "p";
  }

  if (value.includes("h1")) {
    return "h1";
  }
  if (value.includes("h2")) {
    return "h2";
  }
  if (value.includes("blockquote")) {
    return "blockquote";
  }
  if (value.includes("pre")) {
    return "pre";
  }
  return "p";
}

function normalizeFontName(value: string): string {
  const normalized = value.replace(/["']/g, "").trim();
  if (!normalized) {
    return "";
  }

  const first = normalized.split(",")[0]?.trim() ?? "";
  return first;
}

function toSupportedFont(value: string, fontOptions: string[]): string {
  const normalized = normalizeFontName(value);
  if (!normalized || normalized.toLowerCase() === "inherit") {
    return DEFAULT_FONT_VALUE;
  }
  const matched = fontOptions.find((option) => option.toLowerCase() === normalized.toLowerCase());
  return matched ?? DEFAULT_FONT_VALUE;
}

function resolveBlockStyleFromElement(context: HTMLElement | null): "p" | "h1" | "h2" | "blockquote" | "pre" {
  const block = context?.closest("h1, h2, blockquote, pre");
  if (!block) {
    return "p";
  }
  if (block.tagName === "H1") {
    return "h1";
  }
  if (block.tagName === "H2") {
    return "h2";
  }
  if (block.tagName === "BLOCKQUOTE") {
    return "blockquote";
  }
  if (block.tagName === "PRE") {
    return "pre";
  }
  return "p";
}

function resolveFormatContextElement(editor: HTMLDivElement, source?: Range | Node | null): HTMLElement | null {
  if (source instanceof Range) {
    const node = source.startContainer;
    if (!editor.contains(node)) {
      return null;
    }
    return node instanceof HTMLElement ? node : node.parentElement;
  }

  if (source instanceof Node) {
    if (!editor.contains(source)) {
      return null;
    }
    return source instanceof HTMLElement ? source : source.parentElement;
  }

  const selection = window.getSelection();
  if (!selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
    return null;
  }
  return selection.anchorNode instanceof HTMLElement ? selection.anchorNode : selection.anchorNode.parentElement;
}

function getCurrentFontFamily(editor: HTMLDivElement, fontOptions: string[]): string {
  const selection = window.getSelection();
  if (!selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
    return DEFAULT_FONT_VALUE;
  }

  let element: HTMLElement | null =
    selection.anchorNode instanceof HTMLElement ? selection.anchorNode : selection.anchorNode.parentElement;

  while (element && element !== editor) {
    const inlineFont = normalizeFontName(element.style.fontFamily);
    if (inlineFont) {
      if (inlineFont.toLowerCase() === "inherit") {
        return DEFAULT_FONT_VALUE;
      }
      return toSupportedFont(inlineFont, fontOptions);
    }

    if (element.tagName.toLowerCase() === "font") {
      const face = normalizeFontName(element.getAttribute("face") ?? "");
      if (face) {
        if (face.toLowerCase() === "inherit") {
          return DEFAULT_FONT_VALUE;
        }
        return toSupportedFont(face, fontOptions);
      }
    }

    element = element.parentElement;
  }

  try {
    const commandValue = normalizeFontName(String(document.queryCommandValue("fontName") ?? ""));
    if (!commandValue || commandValue.toLowerCase() === "inherit") {
      return DEFAULT_FONT_VALUE;
    }
    return toSupportedFont(commandValue, fontOptions);
  } catch {
    return DEFAULT_FONT_VALUE;
  }
}

function parseLegacyHtmlFontSize(sizeValue: string): number | null {
  const normalized = sizeValue.trim();
  if (!/^[1-7]$/.test(normalized)) {
    return null;
  }
  const mapping: Record<string, number> = {
    "1": 10,
    "2": 13,
    "3": 16,
    "4": 18,
    "5": 24,
    "6": 32,
    "7": 48
  };
  return mapping[normalized] ?? null;
}

function parsePixelFontSize(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "inherit") {
    return null;
  }

  const matched = normalized.match(/^([0-9]*\.?[0-9]+)(?:px)?$/);
  if (!matched) {
    return null;
  }

  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCssFontSizePx(value: string, parent: HTMLElement): number | null {
  const direct = parsePixelFontSize(value);
  if (direct !== null) {
    return direct;
  }

  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "inherit") {
    return null;
  }

  const probe = document.createElement("span");
  probe.style.fontSize = normalized;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.textContent = ".";
  parent.appendChild(probe);
  const computed = parsePixelFontSize(window.getComputedStyle(probe).fontSize);
  probe.remove();
  return computed;
}

function resolveToolbarFontSizeValue(px: number, defaultFontSize: number): string {
  if (Math.abs(px - defaultFontSize) <= 0.75) {
    return DEFAULT_FONT_SIZE_VALUE;
  }

  let closest = FONT_SIZE_OPTIONS[0];
  let closestDistance = Math.abs(px - closest);
  for (const option of FONT_SIZE_OPTIONS) {
    const distance = Math.abs(px - option);
    if (distance < closestDistance) {
      closest = option;
      closestDistance = distance;
    }
  }

  return String(closest);
}

function getCurrentFontSize(editor: HTMLDivElement, defaultFontSize: number): string {
  const selection = window.getSelection();
  if (!selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
    return DEFAULT_FONT_SIZE_VALUE;
  }

  let element: HTMLElement | null =
    selection.anchorNode instanceof HTMLElement ? selection.anchorNode : selection.anchorNode.parentElement;
  while (element && element !== editor) {
    const inlineSize = resolveCssFontSizePx(element.style.fontSize, element.parentElement ?? editor);
    if (inlineSize !== null) {
      return resolveToolbarFontSizeValue(inlineSize, defaultFontSize);
    }

    if (element.tagName.toLowerCase() === "font") {
      const legacy = parseLegacyHtmlFontSize(element.getAttribute("size") ?? "");
      if (legacy !== null) {
        return resolveToolbarFontSizeValue(legacy, defaultFontSize);
      }
    }

    element = element.parentElement;
  }

  const context = findSelectionContextElement(editor);
  if (!context) {
    return DEFAULT_FONT_SIZE_VALUE;
  }

  const computedPx = parsePixelFontSize(window.getComputedStyle(context).fontSize);
  if (computedPx === null) {
    return DEFAULT_FONT_SIZE_VALUE;
  }

  return resolveToolbarFontSizeValue(computedPx, defaultFontSize);
}

function resolveFontFamilyFromContext(editor: HTMLDivElement, context: HTMLElement | null, fontOptions: string[]): string {
  let element = context;
  while (element && element !== editor) {
    const mode = element.dataset.journalFontMode;
    if (mode === "default") {
      return DEFAULT_FONT_VALUE;
    }
    if (mode === "fixed") {
      return toSupportedFont(element.style.fontFamily, fontOptions);
    }

    const inlineFont = normalizeFontName(element.style.fontFamily);
    if (inlineFont) {
      return toSupportedFont(inlineFont, fontOptions);
    }

    if (element.tagName.toLowerCase() === "font") {
      const face = normalizeFontName(element.getAttribute("face") ?? "");
      if (face) {
        return toSupportedFont(face, fontOptions);
      }
    }

    element = element.parentElement;
  }

  if (!context) {
    return DEFAULT_FONT_VALUE;
  }
  return toSupportedFont(window.getComputedStyle(context).fontFamily, fontOptions);
}

function resolveFontSizeFromContext(
  editor: HTMLDivElement,
  context: HTMLElement | null,
  defaultFontSize: number
): { mode: "default" | "fixed"; px: number | null } {
  let element = context;
  while (element && element !== editor) {
    const mode = element.dataset.journalFontSizeMode;
    if (mode === "default") {
      return { mode: "default", px: null };
    }
    if (mode === "fixed") {
      const px = resolveCssFontSizePx(element.style.fontSize, element.parentElement ?? editor);
      return { mode: "fixed", px: px ?? defaultFontSize };
    }

    const inlineSize = resolveCssFontSizePx(element.style.fontSize, element.parentElement ?? editor);
    if (inlineSize !== null) {
      return Math.abs(inlineSize - defaultFontSize) <= 0.75 ? { mode: "default", px: null } : { mode: "fixed", px: inlineSize };
    }

    if (element.tagName.toLowerCase() === "font") {
      const legacy = parseLegacyHtmlFontSize(element.getAttribute("size") ?? "");
      if (legacy !== null) {
        return Math.abs(legacy - defaultFontSize) <= 0.75 ? { mode: "default", px: null } : { mode: "fixed", px: legacy };
      }
    }

    element = element.parentElement;
  }

  if (!context) {
    return { mode: "default", px: null };
  }

  const computed = parsePixelFontSize(window.getComputedStyle(context).fontSize);
  if (computed === null || Math.abs(computed - defaultFontSize) <= 0.75) {
    return { mode: "default", px: null };
  }
  return { mode: "fixed", px: computed };
}

function resolveOutlineFromContext(context: HTMLElement | null): { outlined: boolean; color: string } {
  const outlineNode = context?.closest("span[data-journal-outline='1']");
  if (!isOutlineElement(outlineNode)) {
    return { outlined: false, color: "#6d7e98" };
  }

  const strokeValue = outlineNode.style.webkitTextStroke || "";
  const colorMatch = strokeValue.match(/(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|[a-zA-Z]+)/);
  return { outlined: true, color: colorMatch?.[0] ?? "#6d7e98" };
}

function resolveLinkElementFromNode(editor: HTMLDivElement, node: Node | null): HTMLAnchorElement | null {
  if (!node) {
    return null;
  }

  const element = node instanceof HTMLElement ? node : node.parentElement;
  if (!element) {
    return null;
  }

  const anchor = element.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || !editor.contains(anchor)) {
    return null;
  }

  return anchor;
}

function resolveLinkElement(editor: HTMLDivElement, source?: Range | Node | null): HTMLAnchorElement | null {
  if (source instanceof Range) {
    const start = resolveLinkElementFromNode(editor, source.startContainer);
    if (source.collapsed) {
      return start;
    }

    const end = resolveLinkElementFromNode(editor, source.endContainer);
    if (start && end && start === end) {
      return start;
    }
    return null;
  }

  if (source instanceof Node) {
    return resolveLinkElementFromNode(editor, source);
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  return resolveLinkElement(editor, selection.getRangeAt(0));
}

function resolveLinkHrefFromContext(editor: HTMLDivElement, source?: Range | Node | null): string | null {
  const link = resolveLinkElement(editor, source);
  if (!link) {
    return null;
  }

  const href = link.getAttribute("href") ?? "";
  return normalizeExternalUrl(href);
}

function applyLinkAttributes(anchor: HTMLAnchorElement): void {
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer");
}

function resolveTextFormatSnapshot(
  editor: HTMLDivElement,
  settings: EditorSettings,
  source?: Range | Node | null
): TextFormatSnapshot {
  const fontOptions = getSelectableFontFamilies(settings.importedFonts);
  const context = resolveFormatContextElement(editor, source);
  const computed = context ? window.getComputedStyle(context) : null;
  const fontSize = resolveFontSizeFromContext(editor, context, settings.fontSize);
  const outline = resolveOutlineFromContext(context);
  const underline = computed ? computed.textDecorationLine.includes("underline") : false;
  const bold = computed ? Number.parseInt(computed.fontWeight, 10) >= 600 || computed.fontWeight === "bold" : false;
  const italic = computed ? computed.fontStyle.includes("italic") || computed.fontStyle.includes("oblique") : false;
  const textColor = colorToHex(computed?.color ?? "#e6e7ea", "#e6e7ea");
  const highlight = colorToHex(computed?.backgroundColor ?? "transparent", "transparent");
  const linkHref = resolveLinkHrefFromContext(editor, source);

  return {
    bold,
    italic,
    underline,
    unorderedList: Boolean(context?.closest("ul")),
    orderedList: Boolean(context?.closest("ol")),
    blockStyle: resolveBlockStyleFromElement(context),
    fontFamily: resolveFontFamilyFromContext(editor, context, fontOptions),
    fontSizeMode: fontSize.mode,
    fontSizePx: fontSize.px,
    textColor,
    highlightColor: highlight,
    linkHref,
    outlined: outline.outlined,
    outlineColor: colorToHex(outline.color, "#6d7e98")
  };
}

function toToolbarStateFromSnapshot(snapshot: TextFormatSnapshot, defaultFontSize: number): ToolbarState {
  const toolbarFontSize =
    snapshot.fontSizeMode === "default" || snapshot.fontSizePx === null
      ? DEFAULT_FONT_SIZE_VALUE
      : resolveToolbarFontSizeValue(snapshot.fontSizePx, defaultFontSize);
  return {
    bold: snapshot.bold,
    italic: snapshot.italic,
    underline: snapshot.underline,
    linked: Boolean(snapshot.linkHref),
    unorderedList: snapshot.unorderedList,
    orderedList: snapshot.orderedList,
    blockStyle: snapshot.blockStyle,
    fontFamily: snapshot.fontFamily,
    fontSize: toolbarFontSize,
    outlined: snapshot.outlined
  };
}

function applyTextFormatAtCaret(range: Range, format: TextFormatSnapshot): boolean {
  if (!range.collapsed) {
    return false;
  }

  const wrapper = document.createElement("span");
  wrapper.dataset.journalFontMode = format.fontFamily === DEFAULT_FONT_VALUE ? "default" : "fixed";
  wrapper.style.fontFamily = format.fontFamily === DEFAULT_FONT_VALUE ? "inherit" : format.fontFamily;

  if (format.fontSizeMode === "default" || format.fontSizePx === null) {
    wrapper.dataset.journalFontSizeMode = "default";
    wrapper.style.fontSize = DEFAULT_FONT_SIZE_CSS_VARIABLE;
  } else {
    wrapper.dataset.journalFontSizeMode = "fixed";
    wrapper.style.fontSize = `${Math.round(format.fontSizePx)}px`;
  }

  wrapper.style.color = format.textColor;
  if (format.highlightColor !== "transparent") {
    wrapper.style.backgroundColor = format.highlightColor;
  }
  if (format.bold) {
    wrapper.style.fontWeight = "700";
  }
  if (format.italic) {
    wrapper.style.fontStyle = "italic";
  }
  if (format.underline) {
    wrapper.style.textDecoration = "underline";
  }
  if (format.outlined) {
    wrapper.dataset.journalOutline = "1";
    wrapper.style.webkitTextStroke = `1px ${format.outlineColor}`;
    wrapper.style.paintOrder = "stroke fill";
  }

  const marker = document.createTextNode(FONT_SIZE_CARET_MARKER);
  wrapper.appendChild(marker);
  range.insertNode(wrapper);

  const nextRange = document.createRange();
  nextRange.setStart(marker, marker.data.length);
  nextRange.collapse(true);
  placeSelection(nextRange);
  return true;
}

function readImageAlignment(image: HTMLImageElement): ImageAlignment {
  const width = image.style.width;
  const margin = image.style.margin;
  if (width === "100%") {
    return "full";
  }
  if (margin.includes("auto") && !margin.startsWith("0 auto 0 0")) {
    return "center";
  }
  return "left";
}

interface ToolbarButtonProps {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: JSX.Element;
}

function ToolbarButton({ active = false, label, onClick, children }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`toolbar-icon-btn ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface ToolbarMenuButtonProps {
  active?: boolean;
  label: string;
  color: string;
  onClick: () => void;
  children: JSX.Element;
}

function ToolbarMenuButton({ active = false, label, color, onClick, children }: ToolbarMenuButtonProps): JSX.Element {
  const menuStyle = useMemo(
    () =>
      ({
        "--toolbar-menu-color": color
      }) as CSSProperties,
    [color]
  );

  return (
    <button
      type="button"
      className={`toolbar-menu-btn ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      style={menuStyle}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
    >
      <span className="toolbar-menu-main">{children}</span>
      <ChevronDown className="toolbar-menu-caret" />
    </button>
  );
}

interface ColorSwatchButtonProps {
  color: string;
  label: string;
  onClick: (color: string) => void;
}

function ColorSwatchButton({ color, label, onClick }: ColorSwatchButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="toolbar-swatch-btn"
      aria-label={label}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => onClick(color)}
    >
      <span className="toolbar-swatch-dot" style={{ backgroundColor: color }} />
    </button>
  );
}

function sanitizeStyleValue(styleValue: string): string {
  const declarations = styleValue.split(";");
  const sanitizedDeclarations: string[] = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) {
      continue;
    }
    if (!ALLOWED_STYLE_PROPERTIES.has(property)) {
      continue;
    }
    if (DANGEROUS_STYLE_VALUE_PATTERN.test(value)) {
      continue;
    }
    if (/[\u0000-\u001F\u007F<>]/.test(value)) {
      continue;
    }

    sanitizedDeclarations.push(`${property}: ${value}`);
  }

  return sanitizedDeclarations.join("; ");
}

function sanitizeEditorUriAttribute(attribute: "href" | "src", value: string): string | null {
  const normalized = value.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  if (!normalized) {
    return null;
  }

  if (/^(?:javascript|vbscript):/i.test(normalized)) {
    return null;
  }

  if (normalized.toLowerCase().startsWith("data:")) {
    if (attribute !== "src" || !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i.test(normalized)) {
      return null;
    }
    return normalized;
  }

  if (/^(?:https?:|mailto:|tel:|blob:|#|\/|\.\/|\.\.\/)/i.test(normalized)) {
    return normalized;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function sanitizeEditorElementAttributes(element: HTMLElement): void {
  const tagName = element.tagName.toUpperCase();
  const allowedAttributes = ALLOWED_ATTRIBUTES_BY_TAG.get(tagName) ?? new Set<string>();
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on")) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (!GLOBAL_ALLOWED_ATTRIBUTES.has(name) && !allowedAttributes.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "style") {
      const sanitizedStyle = sanitizeStyleValue(attribute.value);
      if (!sanitizedStyle) {
        element.removeAttribute("style");
      } else {
        element.setAttribute("style", sanitizedStyle);
      }
      continue;
    }

    if (name === "href" || name === "src") {
      const sanitizedUri = sanitizeEditorUriAttribute(name, attribute.value);
      if (!sanitizedUri) {
        element.removeAttribute(attribute.name);
      } else {
        element.setAttribute(name, sanitizedUri);
      }
      continue;
    }

    if (name === "target") {
      element.setAttribute("target", "_blank");
      continue;
    }

    if (name === "rel") {
      element.setAttribute("rel", "noopener noreferrer");
      continue;
    }

    if (name === "draggable") {
      element.setAttribute("draggable", attribute.value === "false" ? "false" : "true");
      continue;
    }

    if (name === "data-journal-font-mode" && attribute.value !== "default" && attribute.value !== "fixed") {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "data-journal-font-size-mode" && attribute.value !== "default" && attribute.value !== "fixed") {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === "data-journal-outline" && attribute.value !== "1") {
      element.setAttribute(attribute.name, "1");
    }
  }

  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute("href");
    if (!href) {
      sanitizeEditorNodeTree(element);
      unwrapElement(element);
      return;
    }
    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "noopener noreferrer");
  }

  if (element instanceof HTMLImageElement) {
    const src = element.getAttribute("src");
    if (!src) {
      element.remove();
      return;
    }

    ensureImageMeta(element);
    if (!element.style.maxWidth) {
      element.style.maxWidth = "100%";
    }
  }
}

function sanitizeEditorNodeTree(root: Node & ParentNode): void {
  const children = Array.from(root.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }

    if (child.nodeType === Node.TEXT_NODE) {
      continue;
    }

    if (!(child instanceof HTMLElement)) {
      child.remove();
      continue;
    }

    const tagName = child.tagName.toUpperCase();
    if (BLOCKED_EDITOR_TAGS.has(tagName)) {
      child.remove();
      continue;
    }

    if (!ALLOWED_EDITOR_TAGS.has(tagName)) {
      sanitizeEditorNodeTree(child);
      while (child.firstChild) {
        root.insertBefore(child.firstChild, child);
      }
      child.remove();
      continue;
    }

    sanitizeEditorElementAttributes(child);
    if (!child.isConnected) {
      continue;
    }

    sanitizeEditorNodeTree(child);
  }
}

function normalizeEditorHtml(html: string): string {
  const normalizedSource = normalizeJournalHtml(html);
  const template = document.createElement("template");
  template.innerHTML = normalizedSource;
  sanitizeEditorNodeTree(template.content);
  const trimmed = template.innerHTML.replace(/[\u200B\uFEFF]/g, "").trim();
  return trimmed.length === 0 ? "<p></p>" : trimmed;
}

function insertHtmlAtCursor(html: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const lastChild = fragment.lastChild;
  range.insertNode(fragment);
  if (lastChild) {
    const after = document.createRange();
    after.setStartAfter(lastChild);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
  }
}

function insertNodeAtCursor(node: Node): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

function findNearestFontSizeSpan(node: Node | null, editor: HTMLElement): HTMLSpanElement | null {
  let element: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (element && element !== editor) {
    if (element instanceof HTMLSpanElement && (element.dataset.journalFontSizeMode === "default" || element.dataset.journalFontSizeMode === "fixed")) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function setFontSizeOnElement(element: HTMLElement, fontSizePx: number | null): void {
  if (fontSizePx === null) {
    element.dataset.journalFontSizeMode = "default";
    element.style.fontSize = DEFAULT_FONT_SIZE_CSS_VARIABLE;
    return;
  }

  element.dataset.journalFontSizeMode = "fixed";
  element.style.fontSize = `${Math.round(fontSizePx)}px`;
}

function hasRenderableContent(node: HTMLElement): boolean {
  const text = (node.textContent ?? "").replace(/[\u200B\uFEFF]/g, "").trim();
  if (text.length > 0) {
    return true;
  }
  return Boolean(node.querySelector("img,br,hr,table,ul,ol,li,blockquote,pre,h1,h2,p,div"));
}

function clearFontSizeFormatting(element: HTMLElement): void {
  if (element.tagName.toLowerCase() === "font") {
    element.removeAttribute("size");
  }
  if (element.style.fontSize) {
    element.style.fontSize = "";
  }
  if (element.style.lineHeight) {
    element.style.lineHeight = "";
  }
  if (element.dataset.journalFontSizeMode) {
    delete element.dataset.journalFontSizeMode;
  }
}

function clearDescendantFontSizeFormatting(container: HTMLElement): void {
  const descendants = Array.from(
    container.querySelectorAll<HTMLElement>("span[data-journal-font-size-mode], [style*='font-size'], [style*='line-height'], font")
  );
  for (const descendant of descendants) {
    clearFontSizeFormatting(descendant);
  }
}

function tryApplyFontSizeToExistingSizedRun(editor: HTMLDivElement, range: Range, fontSizePx: number | null): boolean {
  if (range.collapsed) {
    return false;
  }

  const startSized = findNearestFontSizeSpan(range.startContainer, editor);
  const endSized = findNearestFontSizeSpan(range.endContainer, editor);
  if (!startSized || startSized !== endSized) {
    return false;
  }

  const fullRange = document.createRange();
  fullRange.selectNodeContents(startSized);
  const coversWholeRun =
    range.compareBoundaryPoints(Range.START_TO_START, fullRange) === 0 && range.compareBoundaryPoints(Range.END_TO_END, fullRange) === 0;
  if (coversWholeRun) {
    setFontSizeOnElement(startSized, fontSizePx);
    placeSelection(fullRange);
    return true;
  }

  if (!startSized.contains(range.startContainer) || !startSized.contains(range.endContainer)) {
    return false;
  }

  const selectedFragment = range.extractContents();
  const splitMarker = document.createTextNode("");
  range.insertNode(splitMarker);

  const beforeSpan = startSized.cloneNode(false) as HTMLSpanElement;
  const selectedSpan = startSized.cloneNode(false) as HTMLSpanElement;
  const afterSpan = startSized.cloneNode(false) as HTMLSpanElement;
  setFontSizeOnElement(selectedSpan, fontSizePx);
  selectedSpan.appendChild(selectedFragment);

  while (startSized.firstChild && startSized.firstChild !== splitMarker) {
    beforeSpan.appendChild(startSized.firstChild);
  }
  splitMarker.remove();
  while (startSized.firstChild) {
    afterSpan.appendChild(startSized.firstChild);
  }

  const parent = startSized.parentNode;
  if (!parent) {
    return false;
  }

  if (hasRenderableContent(beforeSpan)) {
    parent.insertBefore(beforeSpan, startSized);
  }
  parent.insertBefore(selectedSpan, startSized);
  if (hasRenderableContent(afterSpan)) {
    parent.insertBefore(afterSpan, startSized);
  }
  startSized.remove();

  const nextRange = document.createRange();
  nextRange.selectNodeContents(selectedSpan);
  placeSelection(nextRange);
  return true;
}

function applyInlineFontSizeToRange(range: Range, fontSizePx: number | null): boolean {
  const preview = range.cloneContents();
  if (
    preview.querySelector(
      "p,div,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,li,table,thead,tbody,tfoot,tr,td,th"
    )
  ) {
    return false;
  }

  const fragment = range.extractContents();
  const elements = Array.from(fragment.querySelectorAll("*"));
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    clearFontSizeFormatting(element);
  }

  const wrapper = document.createElement("span");
  setFontSizeOnElement(wrapper, fontSizePx);
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);

  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  placeSelection(nextRange);
  return true;
}

function applyInlineFontSizeAtCaret(range: Range, fontSizePx: number | null): boolean {
  if (!range.collapsed) {
    return false;
  }

  const wrapper = document.createElement("span");
  setFontSizeOnElement(wrapper, fontSizePx);

  const marker = document.createTextNode(FONT_SIZE_CARET_MARKER);
  wrapper.appendChild(marker);
  range.insertNode(wrapper);

  const nextRange = document.createRange();
  nextRange.setStart(marker, marker.data.length);
  nextRange.collapse(true);
  placeSelection(nextRange);
  return true;
}

function applyFontSizeToIntersectingBlocks(editor: HTMLDivElement, range: Range, fontSizePx: number | null): boolean {
  const blocks = Array.from(editor.querySelectorAll<HTMLElement>("p,div,h1,h2,blockquote,pre,li,td,th")).filter((node) => {
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  });

  if (!blocks.length) {
    return false;
  }

  for (const block of blocks) {
    setFontSizeOnElement(block, fontSizePx);
    clearDescendantFontSizeFormatting(block);
  }

  return true;
}

function normalizeEditorFonts(editor: HTMLDivElement, appliedFontSizePx?: number | null): void {
  const fontElements = Array.from(editor.querySelectorAll("font"));
  for (const node of fontElements) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const replacement = document.createElement("span");
    while (node.firstChild) {
      replacement.appendChild(node.firstChild);
    }

    const face = normalizeFontName(node.getAttribute("face") ?? "");
    if (!face || face.toLowerCase() === "inherit") {
      replacement.dataset.journalFontMode = "default";
      replacement.style.fontFamily = "inherit";
    } else {
      replacement.dataset.journalFontMode = "fixed";
      replacement.style.fontFamily = face;
    }

    const legacySize = node.getAttribute("size");
    if (legacySize) {
      if (legacySize === "7" && appliedFontSizePx !== undefined) {
        if (appliedFontSizePx === null) {
          replacement.dataset.journalFontSizeMode = "default";
          replacement.style.fontSize = DEFAULT_FONT_SIZE_CSS_VARIABLE;
        } else {
          replacement.dataset.journalFontSizeMode = "fixed";
          replacement.style.fontSize = `${Math.round(appliedFontSizePx)}px`;
        }
      } else {
        const px = parseLegacyHtmlFontSize(legacySize);
        if (px === null) {
          replacement.dataset.journalFontSizeMode = "default";
          replacement.style.fontSize = DEFAULT_FONT_SIZE_CSS_VARIABLE;
        } else {
          replacement.dataset.journalFontSizeMode = "fixed";
          replacement.style.fontSize = `${px}px`;
        }
      }
    }

    node.replaceWith(replacement);
  }

  const spans = Array.from(editor.querySelectorAll("span[style*='font-family'], span[data-journal-font-mode]"));
  for (const node of spans) {
    if (!(node instanceof HTMLSpanElement)) {
      continue;
    }

    const fontFamily = normalizeFontName(node.style.fontFamily);
    if (!fontFamily || fontFamily.toLowerCase() === "inherit") {
      node.dataset.journalFontMode = "default";
      node.style.fontFamily = "inherit";
    } else {
      node.dataset.journalFontMode = "fixed";
      node.style.fontFamily = fontFamily;
    }
  }

  const sizedSpans = Array.from(editor.querySelectorAll("span[style*='font-size'], span[data-journal-font-size-mode]"));
  for (const node of sizedSpans) {
    if (!(node instanceof HTMLSpanElement)) {
      continue;
    }

    const rawInlineSize = node.style.fontSize;
    const normalizedInlineSize = rawInlineSize.trim().toLowerCase();
    const declaredDefault = node.dataset.journalFontSizeMode === "default";
    const inlineDefault =
      normalizedInlineSize === "inherit" ||
      normalizedInlineSize === DEFAULT_FONT_SIZE_CSS_VARIABLE.toLowerCase();

    if (declaredDefault || inlineDefault) {
      node.dataset.journalFontSizeMode = "default";
      node.style.fontSize = DEFAULT_FONT_SIZE_CSS_VARIABLE;
      continue;
    }

    let fontSizePx = resolveCssFontSizePx(rawInlineSize, node.parentElement ?? editor);
    if (fontSizePx === null && rawInlineSize && appliedFontSizePx !== undefined && appliedFontSizePx !== null) {
      fontSizePx = appliedFontSizePx;
    }

    if (fontSizePx === null) {
      node.dataset.journalFontSizeMode = "default";
      node.style.fontSize = DEFAULT_FONT_SIZE_CSS_VARIABLE;
    } else {
      node.dataset.journalFontSizeMode = "fixed";
      node.style.fontSize = `${Math.round(fontSizePx)}px`;
    }
  }

  const sizedContainers = Array.from(editor.querySelectorAll<HTMLSpanElement>("span[data-journal-font-size-mode]"));
  for (const node of sizedContainers) {
    const directTextContent = Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? "")
      .join("")
      .replace(/[\u200B\uFEFF]/g, "")
      .trim();
    if (directTextContent.length > 0) {
      continue;
    }

    const elementChildren = Array.from(node.children).filter((child): child is HTMLSpanElement => child instanceof HTMLSpanElement);
    if (elementChildren.length === 0) {
      if ((node.textContent ?? "").replace(/[\u200B\uFEFF]/g, "").trim().length === 0) {
        node.remove();
      }
      continue;
    }

    const allChildrenSized = elementChildren.every(
      (child) => child.dataset.journalFontSizeMode === "default" || child.dataset.journalFontSizeMode === "fixed"
    );
    const onlySpanChildren = Array.from(node.children).every((child) => child instanceof HTMLSpanElement);
    if (allChildrenSized && onlySpanChildren) {
      node.dataset.journalFontSizeMode = "default";
      node.style.fontSize = DEFAULT_FONT_SIZE_CSS_VARIABLE;
    }

    if (elementChildren.length === 1 && onlySpanChildren && node.style.fontFamily === "" && node.dataset.journalFontMode !== "fixed") {
      node.replaceWith(elementChildren[0]);
    }
  }
}

function normalizeEditorBlockStructure(editor: HTMLDivElement): void {
  const allowedBlocks = new Set(["P", "H1", "H2", "BLOCKQUOTE", "PRE", "UL", "OL", "TABLE", "HR"]);
  const children = Array.from(editor.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      const content = child.textContent ?? "";
      if (!content.trim()) {
        child.remove();
        continue;
      }
      const paragraph = document.createElement("p");
      paragraph.textContent = content;
      editor.replaceChild(paragraph, child);
      continue;
    }

    if (!(child instanceof HTMLElement)) {
      continue;
    }

    if (child.tagName === "DIV") {
      const paragraph = document.createElement("p");
      while (child.firstChild) {
        paragraph.appendChild(child.firstChild);
      }
      child.replaceWith(paragraph);
      continue;
    }

    if (!allowedBlocks.has(child.tagName)) {
      const paragraph = document.createElement("p");
      paragraph.appendChild(child.cloneNode(true));
      child.replaceWith(paragraph);
    }
  }

  if (!editor.childNodes.length) {
    editor.innerHTML = "<p></p>";
  }
}

function normalizeLineHeightArtifacts(editor: HTMLDivElement): void {
  const elements = Array.from(editor.querySelectorAll<HTMLElement>("*"));
  for (const node of elements) {
    if (node.style.lineHeight) {
      node.style.lineHeight = "";
    }
  }
}

function normalizeEditorLinks(editor: HTMLDivElement): void {
  const links = Array.from(editor.querySelectorAll("a"));
  for (const link of links) {
    if (!(link instanceof HTMLAnchorElement)) {
      continue;
    }

    const normalized = normalizeLinkInput(link.getAttribute("href") ?? "");
    if (!normalized) {
      unwrapElement(link);
      continue;
    }

    link.setAttribute("href", normalized);
    applyLinkAttributes(link);
  }
}

function normalizeEditorContent(editor: HTMLDivElement, appliedFontSizePx?: number | null): void {
  sanitizeEditorNodeTree(editor);
  normalizeEditorFonts(editor, appliedFontSizePx);
  normalizeEditorLinks(editor);
  normalizeEditorBlockStructure(editor);
  normalizeLineHeightArtifacts(editor);
}

function findSelectionContextElement(editor: HTMLDivElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
    return null;
  }

  return selection.anchorNode instanceof HTMLElement ? selection.anchorNode : selection.anchorNode.parentElement;
}

function isOutlineElement(element: Element | null): element is HTMLSpanElement {
  return element instanceof HTMLSpanElement && element.dataset.journalOutline === "1";
}

function getOutlineState(editor: HTMLDivElement): { outlined: boolean; color: string } {
  const context = findSelectionContextElement(editor);
  return resolveOutlineFromContext(context);
}

function unwrapElement(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function colorToHex(colorValue: string, fallback = "#6d7e98"): string {
  const normalized = colorValue.trim();
  if (!normalized) {
    return fallback;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const [r, g, b] = normalized.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const probe = document.createElement("span");
  probe.style.color = normalized;
  document.body.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();

  const match = resolved.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/i);
  if (!match) {
    return fallback;
  }
  if (typeof match[4] === "string" && Number(match[4]) === 0) {
    return fallback;
  }

  const toHex = (value: string) => Number(value).toString(16).padStart(2, "0");
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand-based fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let success = false;
  try {
    success = document.execCommand("copy");
  } catch {
    success = false;
  }

  textarea.remove();
  return success;
}

async function copyImageSrcToClipboard(src: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  const clipboardItemConstructor = (globalThis as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
  if (clipboard && typeof clipboard.write === "function" && clipboardItemConstructor) {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const mimeType = blob.type || "image/png";
      const item = new clipboardItemConstructor({ [mimeType]: blob });
      await clipboard.write([item as never]);
      return true;
    } catch {
      // Fall through to URL/data URI copy fallback.
    }
  }

  return copyTextToClipboard(src);
}

function isTypingKey(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1;
}

function ensureCaretInsideEditableBlock(editor: HTMLDivElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (!range.collapsed || range.startContainer !== editor) {
    return;
  }

  const preferredChild = editor.childNodes[Math.min(range.startOffset, Math.max(editor.childNodes.length - 1, 0))] ?? editor.firstChild;
  let target: Node | null = preferredChild;

  if (target instanceof HTMLElement) {
    const block = target.closest("p, h1, h2, blockquote, pre, li, td, th") ?? target.querySelector("p, h1, h2, blockquote, pre, li, td, th");
    target = block ?? target;
  }

  if (!target) {
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    editor.appendChild(paragraph);
    target = paragraph;
  }

  const nextRange = document.createRange();
  if (target.nodeType === Node.TEXT_NODE) {
    nextRange.setStart(target, target.textContent?.length ?? 0);
  } else if (target instanceof HTMLElement) {
    nextRange.selectNodeContents(target);
    nextRange.collapse(false);
  } else {
    nextRange.setStart(editor, editor.childNodes.length);
  }

  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function getActiveTableCell(): HTMLTableCellElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const node = selection.anchorNode;
  if (!node) {
    return null;
  }

  const element = node instanceof HTMLElement ? node : node.parentElement;
  if (!element) {
    return null;
  }

  return element.closest("td, th");
}

function getCssHighlightsRegistry(): CssHighlightsRegistry | null {
  const cssWithHighlights = CSS as unknown as { highlights?: CssHighlightsRegistry };
  return cssWithHighlights.highlights ?? null;
}

function collectTextMatches(editor: HTMLDivElement, query: string): Range[] {
  if (!query) {
    return [];
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const matches: Range[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);

  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      const textValue = current.data;
      const normalizedText = textValue.toLocaleLowerCase();
      let searchFrom = 0;

      while (searchFrom <= normalizedText.length - normalizedQuery.length) {
        const foundAt = normalizedText.indexOf(normalizedQuery, searchFrom);
        if (foundAt < 0) {
          break;
        }

        const matchRange = document.createRange();
        matchRange.setStart(current, foundAt);
        matchRange.setEnd(current, foundAt + normalizedQuery.length);
        matches.push(matchRange);
        searchFrom = foundAt + normalizedQuery.length;
      }
    }

    current = walker.nextNode();
  }

  return matches;
}

function scrollRangeIntoView(range: Range): void {
  const container = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
  container?.scrollIntoView({ block: "center", inline: "nearest" });
}

export default function Editor({ value, disabled, settings, findRequestToken, onChange }: EditorProps): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const lastEditorRangeRef = useRef<Range | null>(null);
  const undoSnapshotsRef = useRef<EditorSnapshot[]>([]);
  const redoSnapshotsRef = useRef<EditorSnapshot[]>([]);
  const isApplyingHistoryRef = useRef(false);
  const stylePopoverRef = useRef<StylePopover>(null);
  const linkContextTargetRef = useRef<HTMLAnchorElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textColorAnchorRef = useRef<HTMLDivElement>(null);
  const highlightAnchorRef = useRef<HTMLDivElement>(null);
  const outlineAnchorRef = useRef<HTMLDivElement>(null);
  const linkAnchorRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkTextInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLUListElement>(null);
  const findMatchesRef = useRef<Range[]>([]);
  const findMatchIndexRef = useRef(-1);
  const hoveredFormatRef = useRef<TextFormatSnapshot | null>(null);
  const hoveredRangeRef = useRef<Range | null>(null);
  const typingFormatRef = useRef<TextFormatSnapshot | null>(null);
  const pendingTypingFormatApplyRef = useRef(false);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [slashMenuPosition, setSlashMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [linkContextMenu, setLinkContextMenu] = useState<LinkContextMenuState | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenuState | null>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [selectedImageAlignment, setSelectedImageAlignment] = useState<ImageAlignment>("center");
  const [imageRect, setImageRect] = useState<DOMRect | null>(null);
  const [dropCaret, setDropCaret] = useState<{ left: number; top: number; height: number } | null>(null);
  const [tableAction, setTableAction] = useState("");
  const [textColor, setTextColor] = useState("#e6e7ea");
  const [highlightColor, setHighlightColor] = useState("#364158");
  const [outlineColor, setOutlineColor] = useState("#6d7e98");
  const [activeLinkHref, setActiveLinkHref] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkTextDraft, setLinkTextDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [stylePopover, setStylePopover] = useState<StylePopover>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatchCount, setFindMatchCount] = useState(0);
  const [findMatchIndex, setFindMatchIndex] = useState(-1);
  const [toolbarState, setToolbarState] = useState<ToolbarState>({
    bold: false,
    italic: false,
    underline: false,
    linked: false,
    unorderedList: false,
    orderedList: false,
    blockStyle: "p",
    fontFamily: DEFAULT_FONT_VALUE,
    fontSize: DEFAULT_FONT_SIZE_VALUE,
    outlined: false
  });
  const availableFontOptions = useMemo(() => getSelectableFontFamilies(settings.importedFonts), [settings.importedFonts]);

  const buildEditorSnapshot = useCallback((normalizedHtml?: string): EditorSnapshot | null => {
    const editor = editorRef.current;
    if (!editor) {
      return null;
    }

    return {
      html: normalizedHtml ?? normalizeEditorHtml(editor.innerHTML),
      selection: serializeSelectionRange(editor)
    };
  }, []);

  const resetEditorHistory = useCallback(
    (normalizedHtml?: string) => {
      const snapshot = buildEditorSnapshot(normalizedHtml);
      if (!snapshot) {
        return;
      }

      undoSnapshotsRef.current = [snapshot];
      redoSnapshotsRef.current = [];
    },
    [buildEditorSnapshot]
  );

  const commitEditorSnapshot = useCallback(
    (normalizedHtml?: string) => {
      if (isApplyingHistoryRef.current) {
        return;
      }

      const snapshot = buildEditorSnapshot(normalizedHtml);
      if (!snapshot) {
        return;
      }

      const undoSnapshots = undoSnapshotsRef.current;
      const latest = undoSnapshots[undoSnapshots.length - 1];
      if (latest && latest.html === snapshot.html) {
        undoSnapshots[undoSnapshots.length - 1] = snapshot;
        return;
      }

      undoSnapshots.push(snapshot);
      if (undoSnapshots.length > MAX_EDITOR_SNAPSHOTS) {
        undoSnapshots.splice(0, undoSnapshots.length - MAX_EDITOR_SNAPSHOTS);
      }
      redoSnapshotsRef.current = [];
    },
    [buildEditorSnapshot]
  );

  const emitChange = useCallback(
    (options?: { recordHistory?: boolean }) => {
      if (!editorRef.current) {
        return;
      }

      const normalized = normalizeEditorHtml(editorRef.current.innerHTML);
      if (options?.recordHistory !== false) {
        commitEditorSnapshot(normalized);
      }
      onChange(normalized);
    },
    [commitEditorSnapshot, onChange]
  );

  const updateImageOverlay = useCallback(() => {
    if (!selectedImage) {
      setImageRect(null);
      return;
    }

    setImageRect(selectedImage.getBoundingClientRect());
  }, [selectedImage]);

  const refreshToolbarState = useCallback((source?: Range | Node | null) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const snapshot = resolveTextFormatSnapshot(editor, settings, source);
    typingFormatRef.current = snapshot;
    setToolbarState(toToolbarStateFromSnapshot(snapshot, settings.fontSize));
    setTextColor(snapshot.textColor);
    setHighlightColor(snapshot.highlightColor === "transparent" ? "#364158" : snapshot.highlightColor);
    setOutlineColor(snapshot.outlineColor);
    setActiveLinkHref((current) => {
      if (snapshot.linkHref) {
        return snapshot.linkHref;
      }
      if (stylePopoverRef.current === "link") {
        return current;
      }
      return null;
    });
  }, [settings]);

  const syncEditorImages = useCallback(() => {
    if (!editorRef.current) {
      return;
    }

    const root = editorRef.current;
    const images = root.querySelectorAll("img");
    images.forEach((image) => {
      if (image instanceof HTMLImageElement) {
        ensureImageMeta(image);
        if (!image.style.maxWidth) {
          image.style.maxWidth = "100%";
        }
      }
    });

    normalizeEditorContent(root);
  }, []);

  useEffect(() => {
    stylePopoverRef.current = stylePopover;
  }, [stylePopover]);

  const captureEditorSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return;
    }

    lastEditorRangeRef.current = range.cloneRange();
  }, []);

  const restoreEditorSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const savedRange = lastEditorRangeRef.current;
    if (!savedRange) {
      return;
    }

    if (!editor.contains(savedRange.startContainer) || !editor.contains(savedRange.endContainer)) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(savedRange.cloneRange());
  }, []);

  const applyEditorSnapshot = useCallback(
    (snapshot: EditorSnapshot) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      isApplyingHistoryRef.current = true;
      try {
        editor.innerHTML = snapshot.html;
        syncEditorImages();
        if (!restoreSerializedSelection(editor, snapshot.selection)) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          placeSelection(range);
          ensureCaretInsideEditableBlock(editor);
        }

        editor.focus();
        captureEditorSelection();
        refreshToolbarState();
        emitChange({ recordHistory: false });
      } finally {
        isApplyingHistoryRef.current = false;
      }
    },
    [captureEditorSelection, emitChange, refreshToolbarState, syncEditorImages]
  );

  const undoEditorChange = useCallback(() => {
    if (disabled) {
      return;
    }

    const undoSnapshots = undoSnapshotsRef.current;
    if (undoSnapshots.length <= 1) {
      return;
    }

    const current = undoSnapshots.pop();
    if (current) {
      redoSnapshotsRef.current.push(current);
    }

    const previous = undoSnapshots[undoSnapshots.length - 1];
    if (previous) {
      applyEditorSnapshot(previous);
    }
  }, [applyEditorSnapshot, disabled]);

  const redoEditorChange = useCallback(() => {
    if (disabled) {
      return;
    }

    const redoSnapshots = redoSnapshotsRef.current;
    if (redoSnapshots.length === 0) {
      return;
    }

    const next = redoSnapshots.pop();
    if (!next) {
      return;
    }

    undoSnapshotsRef.current.push(next);
    if (undoSnapshotsRef.current.length > MAX_EDITOR_SNAPSHOTS) {
      undoSnapshotsRef.current.splice(0, undoSnapshotsRef.current.length - MAX_EDITOR_SNAPSHOTS);
    }
    applyEditorSnapshot(next);
  }, [applyEditorSnapshot, disabled]);

  const focusFindInput = useCallback(() => {
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
  }, []);

  const restoreFindInputFocus = useCallback((selectionStart: number | null, selectionEnd: number | null) => {
    window.setTimeout(() => {
      const input = findInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      if (selectionStart === null || selectionEnd === null) {
        return;
      }

      try {
        input.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        // Ignore unsupported selection APIs.
      }
    }, 0);
  }, []);

  const clearFindHighlights = useCallback(() => {
    const registry = getCssHighlightsRegistry();
    if (!registry) {
      return;
    }

    registry.delete(FIND_ALL_HIGHLIGHT_NAME);
    registry.delete(FIND_ACTIVE_HIGHLIGHT_NAME);
  }, []);

  const updateFindHighlights = useCallback(
    (matches: Range[], activeIndex: number) => {
      const registry = getCssHighlightsRegistry();
      if (!registry) {
        return;
      }

      clearFindHighlights();
      if (matches.length === 0) {
        return;
      }

      const highlightConstructor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
      if (!highlightConstructor) {
        return;
      }

      registry.set(FIND_ALL_HIGHLIGHT_NAME, new highlightConstructor(...matches.map((match) => match.cloneRange())));
      if (activeIndex >= 0 && activeIndex < matches.length) {
        registry.set(FIND_ACTIVE_HIGHLIGHT_NAME, new highlightConstructor(matches[activeIndex].cloneRange()));
      }
    },
    [clearFindHighlights]
  );

  const runFind = useCallback(
    (query: string, preferredIndex = 0) => {
      const editor = editorRef.current;
      if (!editor || !query) {
        findMatchesRef.current = [];
        findMatchIndexRef.current = -1;
        setFindMatchCount(0);
        setFindMatchIndex(-1);
        clearFindHighlights();
        return;
      }

      const matches = collectTextMatches(editor, query);
      findMatchesRef.current = matches;
      setFindMatchCount(matches.length);

      if (matches.length === 0) {
        findMatchIndexRef.current = -1;
        setFindMatchIndex(-1);
        clearFindHighlights();
        return;
      }

      const nextIndex = preferredIndex >= 0 && preferredIndex < matches.length ? preferredIndex : 0;
      findMatchIndexRef.current = nextIndex;
      setFindMatchIndex(nextIndex);
      updateFindHighlights(matches, nextIndex);
    },
    [clearFindHighlights, updateFindHighlights]
  );

  const moveFindMatch = useCallback(
    (direction: 1 | -1, keepInputFocus = false) => {
      const matches = findMatchesRef.current;
      const totalMatches = matches.length;
      if (totalMatches === 0) {
        return;
      }

      const input = findInputRef.current;
      const selectionStart = input?.selectionStart ?? null;
      const selectionEnd = input?.selectionEnd ?? null;
      const current = findMatchIndexRef.current;
      const fromIndex = current >= 0 ? current : direction > 0 ? -1 : 0;
      const nextIndex = (fromIndex + direction + totalMatches) % totalMatches;
      findMatchIndexRef.current = nextIndex;
      setFindMatchIndex(nextIndex);
      updateFindHighlights(matches, nextIndex);
      scrollRangeIntoView(matches[nextIndex]);
      if (keepInputFocus) {
        restoreFindInputFocus(selectionStart, selectionEnd);
      }
    },
    [restoreFindInputFocus, updateFindHighlights]
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    clearFindHighlights();
    editorRef.current?.focus();
  }, [clearFindHighlights]);

  useEffect(() => {
    updateImageOverlay();
    window.addEventListener("resize", updateImageOverlay);
    window.addEventListener("scroll", updateImageOverlay, true);
    return () => {
      window.removeEventListener("resize", updateImageOverlay);
      window.removeEventListener("scroll", updateImageOverlay, true);
    };
  }, [updateImageOverlay]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const normalizedValue = normalizeEditorHtml(value);
    const normalizedCurrent = normalizeEditorHtml(editor.innerHTML);
    if (normalizedCurrent !== normalizedValue) {
      editor.innerHTML = normalizedValue;
      syncEditorImages();
      resetEditorHistory(normalizedValue);
    } else if (undoSnapshotsRef.current.length === 0) {
      resetEditorHistory(normalizedValue);
    }

    refreshToolbarState();
  }, [refreshToolbarState, resetEditorHistory, syncEditorImages, value]);

  useEffect(() => {
    if (!findOpen) {
      clearFindHighlights();
      return;
    }

    runFind(findQuery, findMatchIndexRef.current);
  }, [clearFindHighlights, findOpen, findQuery, runFind, value]);

  useEffect(() => {
    if (findRequestToken <= 0 || disabled) {
      return;
    }

    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!findQuery && editor && selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!range.collapsed && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
        const selectedText = selection.toString().trim();
        if (selectedText && selectedText.length <= 120) {
          setFindQuery(selectedText);
        }
      }
    }

    setFindOpen(true);
    focusFindInput();
  }, [disabled, findRequestToken, focusFindInput]);

  useEffect(() => {
    return () => {
      clearFindHighlights();
    };
  }, [clearFindHighlights]);

  useEffect(() => {
    const onSelectionChange = () => {
      captureEditorSelection();
      refreshToolbarState();
      updateImageOverlay();
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [captureEditorSelection, refreshToolbarState, updateImageOverlay]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      const nextEditor = editorRef.current;
      if (!nextEditor) {
        return;
      }
      const hoverRange = getCaretRangeFromPoint(event.clientX, event.clientY);
      if (!hoverRange || !nextEditor.contains(hoverRange.startContainer)) {
        return;
      }
      hoveredRangeRef.current = hoverRange.cloneRange();
      hoveredFormatRef.current = resolveTextFormatSnapshot(nextEditor, settings, hoverRange);
    };

    const onMouseLeave = () => {
      hoveredRangeRef.current = null;
      hoveredFormatRef.current = null;
    };

    editor.addEventListener("mousemove", onMouseMove);
    editor.addEventListener("mouseleave", onMouseLeave);
    return () => {
      editor.removeEventListener("mousemove", onMouseMove);
      editor.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [settings]);

  useEffect(() => {
    if (!stylePopover) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (toolbarRef.current?.contains(target)) {
        return;
      }
      if (popoverRef.current?.contains(target)) {
        return;
      }

      setStylePopover(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStylePopover(null);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [stylePopover]);

  useEffect(() => {
    if (!linkContextMenu) {
      return;
    }

    const closeMenu = () => {
      setLinkContextMenu(null);
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeMenu();
        return;
      }

      if (target.closest(".editor-link-context-menu")) {
        return;
      }
      closeMenu();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [linkContextMenu]);

  useEffect(() => {
    if (!imageContextMenu) {
      return;
    }

    const closeMenu = () => {
      setImageContextMenu(null);
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeMenu();
        return;
      }

      if (target.closest(".editor-image-context-menu")) {
        return;
      }
      closeMenu();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [imageContextMenu]);

  useEffect(() => {
    if (stylePopover !== "link") {
      return;
    }

    setLinkError(null);
    const timer = window.setTimeout(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [stylePopover]);

  useEffect(() => {
    if (!stylePopover) {
      return;
    }

    const getAnchor = (): HTMLDivElement | null => {
      if (stylePopover === "text-color") {
        return textColorAnchorRef.current;
      }
      if (stylePopover === "highlight-color") {
        return highlightAnchorRef.current;
      }
      if (stylePopover === "link") {
        return linkAnchorRef.current;
      }
      return outlineAnchorRef.current;
    };

    const getPopoverWidth = (): number => (stylePopover === "link" ? TOOLBAR_LINK_POPOVER_WIDTH : TOOLBAR_POPOVER_WIDTH);

    const updatePosition = () => {
      const anchor = getAnchor();
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const popoverWidth = getPopoverWidth();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
      const top = rect.bottom + 8;
      setPopoverPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [stylePopover]);

  const applyCommand = useCallback(
    (command: string, commandValue?: string) => {
      if (disabled) {
        return;
      }

      restoreEditorSelection();
      document.execCommand(command, false, commandValue);
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editorRef.current?.focus();
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const applyFontFamily = useCallback(
    (fontFamily: string) => {
      if (disabled) {
        return;
      }

      restoreEditorSelection();
      document.execCommand("styleWithCSS", false, "true");
      const nextFont = fontFamily === DEFAULT_FONT_VALUE ? "inherit" : fontFamily;
      document.execCommand("fontName", false, nextFont);
      if (editorRef.current) {
        normalizeEditorContent(editorRef.current);
      }
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editorRef.current?.focus();
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const applyFontSize = useCallback(
    (fontSizeValue: string) => {
      if (disabled) {
        return;
      }

      restoreEditorSelection();
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      const appliedPx =
        fontSizeValue === DEFAULT_FONT_SIZE_VALUE ? null : Number.isFinite(Number(fontSizeValue)) ? Number(fontSizeValue) : null;

      let appliedInline = false;
      const activeSelection = window.getSelection();
      if (activeSelection && activeSelection.rangeCount > 0) {
        const activeRange = activeSelection.getRangeAt(0);
        if (activeRange.collapsed) {
          appliedInline = applyInlineFontSizeAtCaret(activeRange, appliedPx);
        } else {
          appliedInline = tryApplyFontSizeToExistingSizedRun(editor, activeRange, appliedPx);
          if (!appliedInline) {
            appliedInline = applyInlineFontSizeToRange(activeRange, appliedPx);
          }
          if (!appliedInline) {
            appliedInline = applyFontSizeToIntersectingBlocks(editor, activeRange, appliedPx);
          }
        }
      }
      if (!appliedInline) {
        return;
      }

      normalizeEditorContent(editor, appliedPx);
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editor.focus();
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const applyTextColor = useCallback(
    (color: string) => {
      if (disabled) {
        return;
      }

      restoreEditorSelection();
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, color);
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editorRef.current?.focus();
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const applyHighlightColor = useCallback(
    (color: string) => {
      if (disabled) {
        return;
      }

      restoreEditorSelection();
      document.execCommand("styleWithCSS", false, "true");
      const didApplyHilite = document.execCommand("hiliteColor", false, color);
      if (!didApplyHilite) {
        document.execCommand("backColor", false, color);
      }
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editorRef.current?.focus();
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const applyLinkToSelection = useCallback(
    (inputValue: string, displayText?: string): boolean => {
      if (disabled || !editorRef.current) {
        return false;
      }

      const normalized = normalizeLinkInput(inputValue);
      if (!normalized) {
        setLinkError("Enter a valid link.");
        return false;
      }

      setLinkError(null);
      const cleanedDisplayText = (displayText ?? "").trim();
      restoreEditorSelection();
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }

      const range = selection.getRangeAt(0);
      if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
        return false;
      }

      if (range.collapsed) {
        const existingLink = resolveLinkElement(editor, range);
        if (existingLink) {
          existingLink.setAttribute("href", normalized);
          applyLinkAttributes(existingLink);
          if (cleanedDisplayText) {
            existingLink.textContent = cleanedDisplayText;
          }
        } else {
          const anchor = document.createElement("a");
          anchor.setAttribute("href", normalized);
          applyLinkAttributes(anchor);
          anchor.textContent = cleanedDisplayText || normalized;
          insertNodeAtCursor(anchor);
        }
      } else {
        const selectedText = range.toString().trim();
        if (cleanedDisplayText && cleanedDisplayText !== selectedText) {
          const anchor = document.createElement("a");
          anchor.setAttribute("href", normalized);
          applyLinkAttributes(anchor);
          anchor.textContent = cleanedDisplayText;
          range.deleteContents();
          range.insertNode(anchor);
          const nextRange = document.createRange();
          nextRange.selectNodeContents(anchor);
          placeSelection(nextRange);
        } else {
          document.execCommand("createLink", false, normalized);
          const linkedNodes = Array.from(editor.querySelectorAll("a[href]")).filter((node) => {
            try {
              return range.intersectsNode(node);
            } catch {
              return false;
            }
          });
          for (const node of linkedNodes) {
            if (node instanceof HTMLAnchorElement) {
              node.setAttribute("href", normalized);
              applyLinkAttributes(node);
            }
          }
        }
      }

      normalizeEditorContent(editor);
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editor.focus();
      return true;
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const removeLinkFromSelection = useCallback((targetLink?: HTMLAnchorElement | null) => {
    if (disabled || !editorRef.current) {
      return;
    }

    const editor = editorRef.current;
    if (targetLink && editor.contains(targetLink)) {
      unwrapElement(targetLink);
      normalizeEditorContent(editor);
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editor.focus();
      return;
    }

    restoreEditorSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return;
    }

    if (range.collapsed) {
      const link = resolveLinkElement(editor, range);
      if (!link) {
        return;
      }
      unwrapElement(link);
    } else {
      document.execCommand("unlink", false);
    }

    normalizeEditorContent(editor);
    emitChange();
    refreshToolbarState();
    captureEditorSelection();
    editor.focus();
  }, [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]);

  const openExternalLink = useCallback(async (inputValue: string | null) => {
    const normalized = inputValue ? normalizeExternalUrl(inputValue) : null;
    if (!normalized) {
      return;
    }

    if (window.journalApp?.window.openExternalLink) {
      try {
        await window.journalApp.window.openExternalLink(normalized);
        return;
      } catch {
        // Fall back to browser open below.
      }
    }

    window.open(normalized, "_blank", "noopener,noreferrer");
  }, []);

  const copyLink = useCallback(async (inputValue: string | null) => {
    const normalized = inputValue ? normalizeExternalUrl(inputValue) : null;
    if (!normalized) {
      return;
    }

    await copyTextToClipboard(normalized);
  }, []);

  const toggleTextOutline = useCallback(
    (color: string) => {
      if (disabled || !editorRef.current) {
        return;
      }

      restoreEditorSelection();
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);
      const outlineState = getOutlineState(editor);
      if (!range.collapsed && !outlineState.outlined) {
        const wrapper = document.createElement("span");
        wrapper.dataset.journalOutline = "1";
        wrapper.style.webkitTextStroke = `1px ${color}`;
        wrapper.style.paintOrder = "stroke fill";

        try {
          range.surroundContents(wrapper);
        } catch {
          const fragment = range.extractContents();
          wrapper.appendChild(fragment);
          range.insertNode(wrapper);
        }

        const after = document.createRange();
        after.selectNodeContents(wrapper);
        selection.removeAllRanges();
        selection.addRange(after);
      } else {
        const targets = Array.from(editor.querySelectorAll("span[data-journal-outline='1']")).filter((element) =>
          range.intersectsNode(element)
        );

        if (targets.length === 0) {
          const context = findSelectionContextElement(editor);
          const closest = context?.closest("span[data-journal-outline='1']");
          if (closest instanceof HTMLElement) {
            targets.push(closest);
          }
        }

        for (const target of targets) {
          if (target instanceof HTMLElement) {
            unwrapElement(target);
          }
        }
      }

      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editor.focus();
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const updateOutlineColor = useCallback(
    (color: string) => {
      if (disabled || !editorRef.current) {
        return;
      }

      restoreEditorSelection();
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);
      const targets = Array.from(editor.querySelectorAll("span[data-journal-outline='1']")).filter((element) =>
        range.intersectsNode(element)
      );
      if (targets.length === 0) {
        const context = findSelectionContextElement(editor);
        const closest = context?.closest("span[data-journal-outline='1']");
        if (closest instanceof HTMLSpanElement) {
          targets.push(closest);
        }
      }

      if (targets.length === 0) {
        return;
      }

      for (const target of targets) {
        if (target instanceof HTMLSpanElement) {
          target.style.webkitTextStroke = `1px ${color}`;
          target.style.paintOrder = "stroke fill";
        }
      }

      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editor.focus();
    },
    [captureEditorSelection, disabled, emitChange, refreshToolbarState, restoreEditorSelection]
  );

  const toggleStylePopover = useCallback(
    (next: Exclude<StylePopover, null>) => {
      captureEditorSelection();
      setStylePopover((current) => (current === next ? null : next));
    },
    [captureEditorSelection]
  );

  const toggleLinkPopover = useCallback(() => {
    captureEditorSelection();
    const editor = editorRef.current;
    const selection = window.getSelection();
    const selectedHref = editor ? resolveLinkHrefFromContext(editor) : null;
    const selectedText = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).toString().trim() : "";
    const selectedLink = editor ? resolveLinkElement(editor) : null;
    setLinkDraft(selectedHref ?? "");
    setLinkTextDraft((selectedLink?.textContent ?? selectedText).trim());
    setLinkError(null);
    setImageContextMenu(null);
    setLinkContextMenu(null);
    setStylePopover((current) => (current === "link" ? null : "link"));
  }, [captureEditorSelection]);

  const applyLinkFromPopover = useCallback(() => {
    if (applyLinkToSelection(linkDraft, linkTextDraft)) {
      setStylePopover(null);
    }
  }, [applyLinkToSelection, linkDraft, linkTextDraft]);

  const openCurrentLink = useCallback(async () => {
    const draftHref = normalizeLinkInput(linkDraft);
    const href = draftHref ?? activeLinkHref;
    await openExternalLink(href);
  }, [activeLinkHref, linkDraft, openExternalLink]);

  const copyCurrentLink = useCallback(async () => {
    const draftHref = normalizeLinkInput(linkDraft);
    const href = draftHref ?? activeLinkHref;
    await copyLink(href);
  }, [activeLinkHref, copyLink, linkDraft]);

  const openContextMenuLink = useCallback(async () => {
    if (!linkContextMenu) {
      return;
    }

    await openExternalLink(linkContextMenu.href);
    setLinkContextMenu(null);
  }, [linkContextMenu, openExternalLink]);

  const copyContextMenuLink = useCallback(async () => {
    if (!linkContextMenu) {
      return;
    }

    await copyLink(linkContextMenu.href);
    setLinkContextMenu(null);
  }, [copyLink, linkContextMenu]);

  const copyContextMenuImage = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !imageContextMenu) {
      return;
    }

    const image = findImageById(editor, imageContextMenu.imageId);
    if (!image) {
      setImageContextMenu(null);
      return;
    }

    await copyImageSrcToClipboard(image.src);
    setImageContextMenu(null);
  }, [imageContextMenu]);

  const deleteContextMenuImage = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !imageContextMenu) {
      return;
    }

    const image = findImageById(editor, imageContextMenu.imageId);
    if (!image) {
      setImageContextMenu(null);
      return;
    }

    const deletedImageId = image.dataset.journalImageId;
    image.remove();
    if (selectedImage && selectedImage.dataset.journalImageId === deletedImageId) {
      setSelectedImage(null);
      setImageRect(null);
    }
    emitChange();
    refreshToolbarState();
    captureEditorSelection();
    editor.focus();
    setImageContextMenu(null);
  }, [captureEditorSelection, emitChange, imageContextMenu, refreshToolbarState, selectedImage]);

  const editContextMenuLink = useCallback(() => {
    const editor = editorRef.current;
    const target = linkContextTargetRef.current;
    if (!editor || !target || !editor.contains(target)) {
      setLinkContextMenu(null);
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(target);
    placeSelection(range);
    captureEditorSelection();
    setLinkDraft(target.getAttribute("href") ?? "");
    setLinkTextDraft((target.textContent ?? "").trim());
    setLinkError(null);
    setImageContextMenu(null);
    setStylePopover("link");
    setLinkContextMenu(null);
  }, [captureEditorSelection]);

  const removeContextMenuLink = useCallback(() => {
    removeLinkFromSelection(linkContextTargetRef.current);
    setLinkContextMenu(null);
  }, [removeLinkFromSelection]);

  const toggleBlockStyle = useCallback(
    (target: "blockquote" | "pre") => {
      const currentStyle = getCurrentBlockStyle();
      const nextStyle = currentStyle === target ? "<p>" : `<${target}>`;
      applyCommand("formatBlock", nextStyle);
    },
    [applyCommand]
  );

  const insertImage = useCallback(
    (dataUrl: string) => {
      restoreEditorSelection();
      const imageId = createImageId();
      insertHtmlAtCursor(
        `<img data-journal-image-id="${imageId}" draggable="true" src="${dataUrl}" style="max-width: 100%; width: 320px; display:block; margin: 0 auto;" />`
      );
      syncEditorImages();
      emitChange();
      refreshToolbarState();
      captureEditorSelection();
      editorRef.current?.focus();
    },
    [captureEditorSelection, emitChange, refreshToolbarState, restoreEditorSelection, syncEditorImages]
  );

  const insertTable = useCallback(() => {
    restoreEditorSelection();
    const table = `
      <table class="journal-table">
        <thead>
          <tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr>
        </thead>
        <tbody>
          <tr><td>Row 1</td><td></td><td></td></tr>
          <tr><td>Row 2</td><td></td><td></td></tr>
        </tbody>
      </table>
      <p></p>
    `;
    insertHtmlAtCursor(table);
    emitChange();
    refreshToolbarState();
    captureEditorSelection();
    editorRef.current?.focus();
  }, [captureEditorSelection, emitChange, refreshToolbarState, restoreEditorSelection]);

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      { id: "h1", label: "Heading 1", run: () => applyCommand("formatBlock", "<h1>") },
      { id: "h2", label: "Heading 2", run: () => applyCommand("formatBlock", "<h2>") },
      { id: "bold", label: "Bold", run: () => applyCommand("bold") },
      { id: "italic", label: "Italic", run: () => applyCommand("italic") },
      { id: "quote", label: "Quote", run: () => toggleBlockStyle("blockquote") },
      { id: "code", label: "Code block", run: () => toggleBlockStyle("pre") },
      { id: "ul", label: "Bullet list", run: () => applyCommand("insertUnorderedList") },
      { id: "ol", label: "Numbered list", run: () => applyCommand("insertOrderedList") },
      { id: "table", label: "Insert table", run: insertTable },
      { id: "image", label: "Insert image", run: () => imageInputRef.current?.click() }
    ],
    [applyCommand, insertTable, toggleBlockStyle]
  );

  const tableActions = useMemo(
    () => ({
      addRow: () => {
        const cell = getActiveTableCell();
        const row = cell?.parentElement as HTMLTableRowElement | null;
        const table = row?.closest("table");
        if (!row || !table) {
          return;
        }

        const newRow = table.insertRow(row.rowIndex + 1);
        for (let index = 0; index < row.cells.length; index += 1) {
          const nextCell = newRow.insertCell(index);
          nextCell.textContent = "";
        }
        emitChange();
      },
      removeRow: () => {
        const cell = getActiveTableCell();
        const row = cell?.parentElement as HTMLTableRowElement | null;
        if (!row) {
          return;
        }

        const table = row.closest("table");
        if (!table || table.rows.length <= 1) {
          return;
        }

        row.remove();
        emitChange();
      },
      addColumn: () => {
        const cell = getActiveTableCell();
        if (!cell) {
          return;
        }

        const row = cell.parentElement as HTMLTableRowElement | null;
        const table = row?.closest("table");
        if (!table) {
          return;
        }

        const columnIndex = cell.cellIndex + 1;
        for (const currentRow of Array.from(table.rows)) {
          const inserted = currentRow.insertCell(columnIndex);
          inserted.textContent = "";
        }
        emitChange();
      },
      removeColumn: () => {
        const cell = getActiveTableCell();
        if (!cell) {
          return;
        }

        const row = cell.parentElement as HTMLTableRowElement | null;
        const table = row?.closest("table");
        if (!table) {
          return;
        }

        const columnIndex = cell.cellIndex;
        const headerLength = table.rows[0]?.cells.length ?? 0;
        if (headerLength <= 1) {
          return;
        }

        for (const currentRow of Array.from(table.rows)) {
          currentRow.deleteCell(columnIndex);
        }
        emitChange();
      }
    }),
    [emitChange]
  );

  const filteredSlashCommands = useMemo(() => {
    if (!slashMenu) {
      return [];
    }

    const query = slashMenu.query.toLowerCase().trim();
    if (!query) {
      return slashCommands;
    }

    return slashCommands.filter((command) => command.id.includes(query) || command.label.toLowerCase().includes(query));
  }, [slashCommands, slashMenu]);

  useEffect(() => {
    if (!slashMenu || filteredSlashCommands.length === 0) {
      setSlashMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const menuElement = slashMenuRef.current;
      if (!menuElement) {
        return;
      }

      const rect = menuElement.getBoundingClientRect();
      const position = getSlashMenuPosition(
        {
          left: slashMenu.left,
          top: slashMenu.top,
          bottom: slashMenu.bottom
        },
        {
          width: rect.width,
          height: rect.height
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        }
      );
      setSlashMenuPosition({
        left: position.left,
        top: position.top
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [filteredSlashCommands.length, slashMenu]);

  const handleInput = useCallback(() => {
    captureEditorSelection();
    syncEditorImages();
    emitChange();
    refreshToolbarState();
    const selection = window.getSelection();
    const range = getSelectionRange();
    if (!selection || !range || !editorRef.current || !selection.isCollapsed) {
      setSlashMenu(null);
      return;
    }

    const clone = range.cloneRange();
    clone.selectNodeContents(editorRef.current);
    clone.setEnd(range.endContainer, range.endOffset);
    const textBeforeCursor = clone.toString();
    const match = textBeforeCursor.match(/\/([a-z0-9-]*)$/i);
    if (!match) {
      setSlashMenu(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    setSlashMenu({
      left: rect.left,
      top: rect.top,
      bottom: rect.bottom,
      query: match[1] ?? ""
    });
  }, [captureEditorSelection, emitChange, refreshToolbarState, syncEditorImages]);

  const handleBeforeInput = useCallback(
    (event: FormEvent<HTMLDivElement>) => {
      const nativeEvent = event.nativeEvent as InputEvent;
      if (nativeEvent.inputType === "historyUndo") {
        event.preventDefault();
        undoEditorChange();
        return;
      }
      if (nativeEvent.inputType === "historyRedo") {
        event.preventDefault();
        redoEditorChange();
      }
    },
    [redoEditorChange, undoEditorChange]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      if (findOpen && event.key === "Escape") {
        event.preventDefault();
        closeFind();
        return;
      }

      const isFindNextShortcut =
        event.key === "F3" || ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "g");
      if (isFindNextShortcut) {
        event.preventDefault();
        moveFindMatch(event.shiftKey ? -1 : 1);
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;
      const normalizedKey = event.key.toLowerCase();
      if (isModifierPressed && !event.altKey && normalizedKey === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoEditorChange();
        } else {
          undoEditorChange();
        }
        return;
      }
      if (isModifierPressed && !event.altKey && !event.shiftKey && normalizedKey === "y") {
        event.preventDefault();
        redoEditorChange();
        return;
      }

      if (isTypingKey(event)) {
        ensureCaretInsideEditableBlock(editor);
      }

      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        const picked =
          hoveredFormatRef.current ??
          resolveTextFormatSnapshot(editor, settings, hoveredRangeRef.current ?? getSelectionRange());
        hoveredFormatRef.current = picked;
        typingFormatRef.current = picked;
        pendingTypingFormatApplyRef.current = true;
        setToolbarState(toToolbarStateFromSnapshot(picked, settings.fontSize));
        setTextColor(picked.textColor);
        setHighlightColor(picked.highlightColor === "transparent" ? "#364158" : picked.highlightColor);
        setOutlineColor(picked.outlineColor);
        return;
      }

      if (pendingTypingFormatApplyRef.current && isTypingKey(event)) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && typingFormatRef.current) {
          const range = selection.getRangeAt(0);
          if (range.collapsed && editor.contains(range.startContainer)) {
            applyTextFormatAtCaret(range, typingFormatRef.current);
            pendingTypingFormatApplyRef.current = false;
            captureEditorSelection();
            refreshToolbarState();
          }
        }
      }

      if (!slashMenu) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSlashMenu(null);
        return;
      }

      if (event.key === "Enter") {
        const command = filteredSlashCommands[0];
        if (command) {
          event.preventDefault();
          command.run();
          setSlashMenu(null);
        }
      }
    },
    [
      captureEditorSelection,
      closeFind,
      filteredSlashCommands,
      findOpen,
      moveFindMatch,
      redoEditorChange,
      refreshToolbarState,
      settings,
      slashMenu,
      undoEditorChange
    ]
  );

  const handleImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
      for (const file of list) {
        const url = await readImageAsDataUrl(file);
        if (url) {
          insertImage(url);
        }
      }
    },
    [insertImage]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLDivElement>) => {
      const plainText = event.clipboardData.getData("text/plain").trim();
      if (plainText && editorRef.current) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const inEditor =
            editorRef.current.contains(range.startContainer) && editorRef.current.contains(range.endContainer);
          const normalizedLink = normalizeLinkInput(plainText);
          if (inEditor && normalizedLink) {
            event.preventDefault();
            captureEditorSelection();
            if (range.collapsed) {
              applyLinkToSelection(normalizedLink, plainText);
            } else {
              applyLinkToSelection(normalizedLink);
            }
            return;
          }
        }
      }

      const html = event.clipboardData.getData("text/html");
      if (html) {
        event.preventDefault();
        insertHtmlAtCursor(normalizeEditorHtml(html));
        syncEditorImages();
        emitChange();
        refreshToolbarState();
        return;
      }

      const files = event.clipboardData.files;
      if (!files || files.length === 0) {
        return;
      }

      const hasImage = Array.from(files).some((file) => file.type.startsWith("image/"));
      if (!hasImage) {
        return;
      }

      event.preventDefault();
      await handleImageFiles(files);
    },
    [applyLinkToSelection, captureEditorSelection, emitChange, handleImageFiles, refreshToolbarState, syncEditorImages]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const hasInternalImage = Array.from(event.dataTransfer.types).includes(IMAGE_DRAG_TYPE);
    const hasImageFile = Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"));
    if (!hasInternalImage && !hasImageFile) {
      return;
    }

    event.preventDefault();
    const range = getCaretRangeFromPoint(event.clientX, event.clientY);
    const rect = range?.getBoundingClientRect();
    const editorBounds = editorRef.current?.getBoundingClientRect();
    setDropCaret({
      left: rect && rect.left > 0 ? rect.left : event.clientX,
      top: rect && rect.top > 0 ? rect.top : Math.max(event.clientY - 10, editorBounds?.top ?? event.clientY - 10),
      height: Math.max(rect?.height ?? 0, 20)
    });
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      const hasInternalImage = Array.from(event.dataTransfer.types).includes(IMAGE_DRAG_TYPE);
      const hasImageFile = Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"));
      if (!hasInternalImage && !hasImageFile) {
        return;
      }

      event.preventDefault();
      setDropCaret(null);

      const range = getCaretRangeFromPoint(event.clientX, event.clientY);
      placeSelection(range);

      const internalImageId = event.dataTransfer.getData(IMAGE_DRAG_TYPE);
      if (internalImageId && editorRef.current) {
        const draggedImage = findImageById(editorRef.current, internalImageId);
        if (draggedImage) {
          insertNodeAtCursor(draggedImage);
          setSelectedImage(draggedImage);
          setSelectedImageAlignment(readImageAlignment(draggedImage));
          emitChange();
          refreshToolbarState();
          updateImageOverlay();
          return;
        }
      }

      if (!event.dataTransfer.files || event.dataTransfer.files.length === 0) {
        return;
      }

      await handleImageFiles(event.dataTransfer.files);
    },
    [emitChange, handleImageFiles, refreshToolbarState, updateImageOverlay]
  );

  const alignSelectedImage = useCallback(
    (alignment: ImageAlignment) => {
      if (!selectedImage) {
        return;
      }

      selectedImage.style.display = "block";
      if (alignment === "left") {
        selectedImage.style.margin = "0 auto 0 0";
        if (!selectedImage.style.width || selectedImage.style.width === "100%") {
          selectedImage.style.width = "320px";
        }
      } else if (alignment === "center") {
        selectedImage.style.margin = "0 auto";
        if (!selectedImage.style.width || selectedImage.style.width === "100%") {
          selectedImage.style.width = "320px";
        }
      } else {
        selectedImage.style.margin = "0";
        selectedImage.style.width = "100%";
      }

      setSelectedImageAlignment(alignment);
      emitChange();
      updateImageOverlay();
    },
    [emitChange, selectedImage, updateImageOverlay]
  );

  const startImageResize = useCallback(
    (startEvent: React.MouseEvent<HTMLDivElement>) => {
      if (!selectedImage) {
        return;
      }

      startEvent.preventDefault();
      const image = selectedImage;
      const startX = startEvent.clientX;
      const startWidth = image.getBoundingClientRect().width;

      const onMouseMove = (event: MouseEvent) => {
        const delta = event.clientX - startX;
        const nextWidth = Math.max(120, startWidth + delta);
        image.style.width = `${Math.round(nextWidth)}px`;
        image.style.maxWidth = "100%";
        updateImageOverlay();
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        emitChange();
        updateImageOverlay();
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [emitChange, selectedImage, updateImageOverlay]
  );

  const editorStyle: CSSProperties = {
    "--journal-default-font-size": `${settings.fontSize}px`,
    "--journal-editor-line-height": String(settings.lineHeight),
    fontFamily: settings.defaultFont,
    fontSize: DEFAULT_FONT_SIZE_CSS_VARIABLE,
    lineHeight: "var(--journal-editor-line-height)",
    tabSize: settings.tabSize
  };
  const normalizedDraftLink = normalizeLinkInput(linkDraft);
  const actionableLink = normalizedDraftLink ?? activeLinkHref;
  const findStatusLabel = findQuery
    ? findMatchCount > 0
      ? findMatchIndex >= 0
        ? `${findMatchIndex + 1} / ${findMatchCount}`
        : `${findMatchCount} matches`
      : "0 matches"
    : "Type to search";

  return (
    <div className="rich-editor-shell">
      <div ref={toolbarRef} className="editor-toolbar compact-toolbar">
        <div className="toolbar-group">
          <ToolbarButton label="Undo" onClick={undoEditorChange}>
            <Undo2 />
          </ToolbarButton>
          <ToolbarButton label="Redo" onClick={redoEditorChange}>
            <Redo2 />
          </ToolbarButton>
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-group">
          <select
            className="toolbar-select"
            value={toolbarState.blockStyle}
            aria-label="Block style"
            title="Block style"
            onMouseDown={() => {
              captureEditorSelection();
            }}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "h1") {
                applyCommand("formatBlock", "<h1>");
              } else if (value === "h2") {
                applyCommand("formatBlock", "<h2>");
              } else if (value === "blockquote") {
                applyCommand("formatBlock", "<blockquote>");
              } else if (value === "pre") {
                applyCommand("formatBlock", "<pre>");
              } else {
                applyCommand("formatBlock", "<p>");
              }
            }}
          >
            <option value="p">Normal text</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="blockquote">Quote</option>
            <option value="pre">Code block</option>
          </select>
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-group">
          <select
            className="toolbar-select toolbar-select-font"
            value={toolbarState.fontFamily}
            aria-label="Font family"
            title="Font family"
            onMouseDown={() => {
              captureEditorSelection();
            }}
            onChange={(event) => {
              applyFontFamily(event.currentTarget.value);
            }}
          >
            <option value={DEFAULT_FONT_VALUE}>Default ({settings.defaultFont})</option>
            {availableFontOptions.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
          <select
            className="toolbar-select toolbar-select-size"
            value={toolbarState.fontSize}
            aria-label="Text size"
            title="Text size"
            onMouseDown={() => {
              captureEditorSelection();
            }}
            onChange={(event) => {
              applyFontSize(event.currentTarget.value);
            }}
          >
            <option value={DEFAULT_FONT_SIZE_VALUE}>Default ({settings.fontSize}px)</option>
            {FONT_SIZE_OPTIONS.map((size) => (
              <option key={size} value={String(size)}>
                {size}px
              </option>
            ))}
          </select>
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-group">
          <div ref={textColorAnchorRef} className="toolbar-popover-anchor">
            <ToolbarMenuButton
              active={stylePopover === "text-color"}
              label="Text color"
              color={textColor}
              onClick={() => {
                toggleStylePopover("text-color");
              }}
            >
              <Palette />
            </ToolbarMenuButton>
          </div>

          <div ref={highlightAnchorRef} className="toolbar-popover-anchor">
            <ToolbarMenuButton
              active={stylePopover === "highlight-color"}
              label="Highlight"
              color={highlightColor}
              onClick={() => {
                toggleStylePopover("highlight-color");
              }}
            >
              <Highlighter />
            </ToolbarMenuButton>
          </div>

          <div ref={outlineAnchorRef} className="toolbar-popover-anchor">
            <ToolbarMenuButton
              active={toolbarState.outlined || stylePopover === "outline"}
              label="Outline style"
              color={outlineColor}
              onClick={() => {
                toggleStylePopover("outline");
              }}
            >
              <Type />
            </ToolbarMenuButton>
          </div>
        </div>

        {stylePopover
          ? createPortal(
              <div
                ref={popoverRef}
                className={`toolbar-popover toolbar-popover-floating ${stylePopover === "link" ? "toolbar-popover-link" : ""}`}
                style={{
                  top: `${popoverPosition.top}px`,
                  left: `${popoverPosition.left}px`
                }}
              >
                {stylePopover === "text-color" ? (
                  <>
                    <div className="toolbar-popover-title">Text color</div>
                    <div className="toolbar-swatch-grid">
                      {TEXT_COLOR_PRESETS.map((color) => (
                        <ColorSwatchButton
                          key={color}
                          color={color}
                          label={`Use ${color}`}
                          onClick={(nextColor) => {
                            setTextColor(nextColor);
                            applyTextColor(nextColor);
                            setStylePopover(null);
                          }}
                        />
                      ))}
                    </div>
                    <label className="toolbar-popover-row">
                      <span>Custom</span>
                      <input
                        className="toolbar-popover-color-input"
                        type="color"
                        value={textColor}
                        onMouseDown={() => {
                          captureEditorSelection();
                        }}
                        onFocus={() => {
                          captureEditorSelection();
                        }}
                        onInput={(event) => {
                          setTextColor(event.currentTarget.value);
                        }}
                        onChange={(event) => {
                          const nextColor = event.currentTarget.value;
                          setTextColor(nextColor);
                          window.setTimeout(() => {
                            applyTextColor(nextColor);
                          }, 0);
                        }}
                      />
                    </label>
                  </>
                ) : null}

                {stylePopover === "highlight-color" ? (
                  <>
                    <div className="toolbar-popover-title">Highlight</div>
                    <div className="toolbar-swatch-grid">
                      {HIGHLIGHT_COLOR_PRESETS.map((color) => (
                        <ColorSwatchButton
                          key={color}
                          color={color}
                          label={`Use ${color}`}
                          onClick={(nextColor) => {
                            setHighlightColor(nextColor);
                            applyHighlightColor(nextColor);
                            setStylePopover(null);
                          }}
                        />
                      ))}
                    </div>
                    <label className="toolbar-popover-row">
                      <span>Custom</span>
                      <input
                        className="toolbar-popover-color-input"
                        type="color"
                        value={highlightColor}
                        onMouseDown={() => {
                          captureEditorSelection();
                        }}
                        onFocus={() => {
                          captureEditorSelection();
                        }}
                        onInput={(event) => {
                          setHighlightColor(event.currentTarget.value);
                        }}
                        onChange={(event) => {
                          const nextColor = event.currentTarget.value;
                          setHighlightColor(nextColor);
                          window.setTimeout(() => {
                            applyHighlightColor(nextColor);
                          }, 0);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="toolbar-popover-action"
                      onClick={() => {
                        applyHighlightColor("transparent");
                        setStylePopover(null);
                      }}
                    >
                      Clear highlight
                    </button>
                  </>
                ) : null}

                {stylePopover === "outline" ? (
                  <>
                    <div className="toolbar-popover-title">Text outline</div>
                    <div className="toolbar-swatch-grid">
                      {OUTLINE_COLOR_PRESETS.map((color) => (
                        <ColorSwatchButton
                          key={color}
                          color={color}
                          label={`Use ${color}`}
                          onClick={(nextColor) => {
                            setOutlineColor(nextColor);
                            if (toolbarState.outlined) {
                              updateOutlineColor(nextColor);
                            }
                          }}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="toolbar-popover-action"
                      onClick={() => {
                        toggleTextOutline(outlineColor);
                        setStylePopover(null);
                      }}
                    >
                      {toolbarState.outlined ? "Disable outline" : "Enable outline"}
                    </button>
                    <label className="toolbar-popover-row">
                      <span>Outline color</span>
                      <input
                        className="toolbar-popover-color-input"
                        type="color"
                        value={outlineColor}
                        onMouseDown={() => {
                          captureEditorSelection();
                        }}
                        onFocus={() => {
                          captureEditorSelection();
                        }}
                        onInput={(event) => {
                          setOutlineColor(event.currentTarget.value);
                        }}
                        onChange={(event) => {
                          const nextColor = event.currentTarget.value;
                          setOutlineColor(nextColor);
                          if (toolbarState.outlined) {
                            window.setTimeout(() => {
                              updateOutlineColor(nextColor);
                            }, 0);
                          }
                        }}
                      />
                    </label>
                  </>
                ) : null}

                {stylePopover === "link" ? (
                  <>
                    <div className="toolbar-popover-title">Link</div>
                    <label className="toolbar-popover-column">
                      <span className="toolbar-popover-label">Text</span>
                      <input
                        ref={linkTextInputRef}
                        className="toolbar-popover-text-input"
                        type="text"
                        value={linkTextDraft}
                        placeholder="Display text"
                        onMouseDown={() => {
                          captureEditorSelection();
                        }}
                        onFocus={() => {
                          captureEditorSelection();
                        }}
                        onChange={(event) => {
                          setLinkTextDraft(event.currentTarget.value);
                        }}
                      />
                    </label>
                    <label className="toolbar-popover-column">
                      <span className="toolbar-popover-label">URL</span>
                      <input
                        ref={linkInputRef}
                        className="toolbar-popover-text-input"
                        type="text"
                        value={linkDraft}
                        placeholder="https://example.com"
                        onMouseDown={() => {
                          captureEditorSelection();
                        }}
                        onFocus={() => {
                          captureEditorSelection();
                        }}
                        onChange={(event) => {
                          setLinkDraft(event.currentTarget.value);
                          if (linkError) {
                            setLinkError(null);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyLinkFromPopover();
                          }
                        }}
                      />
                    </label>
                    {linkError ? <div className="toolbar-popover-error">{linkError}</div> : null}
                    <div className="toolbar-popover-actions">
                      <button type="button" className="toolbar-popover-action" onClick={applyLinkFromPopover}>
                        Apply link
                      </button>
                      <button
                        type="button"
                        className="toolbar-popover-action"
                        disabled={!actionableLink}
                        onClick={() => {
                          void openCurrentLink();
                        }}
                      >
                        <ExternalLink />
                        Open link
                      </button>
                      <button
                        type="button"
                        className="toolbar-popover-action"
                        disabled={!actionableLink}
                        onClick={() => {
                          void copyCurrentLink();
                        }}
                      >
                        <Copy />
                        Copy link
                      </button>
                      <button
                        type="button"
                        className="toolbar-popover-action"
                        disabled={!activeLinkHref && !toolbarState.linked}
                        onClick={() => {
                          removeLinkFromSelection();
                          setStylePopover(null);
                        }}
                      >
                        <Link2Off />
                        Remove link
                      </button>
                    </div>
                  </>
                ) : null}
              </div>,
              document.body
            )
          : null}

        <span className="toolbar-divider" />

        <div className="toolbar-group">
          <ToolbarButton active={toolbarState.bold} label="Bold" onClick={() => applyCommand("bold")}>
            <Bold />
          </ToolbarButton>
          <ToolbarButton active={toolbarState.italic} label="Italic" onClick={() => applyCommand("italic")}>
            <Italic />
          </ToolbarButton>
          <ToolbarButton active={toolbarState.underline} label="Underline" onClick={() => applyCommand("underline")}>
            <Underline />
          </ToolbarButton>
          <div ref={linkAnchorRef} className="toolbar-popover-anchor">
            <ToolbarButton active={toolbarState.linked || stylePopover === "link"} label="Link" onClick={toggleLinkPopover}>
              <Link2 />
            </ToolbarButton>
          </div>
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-group">
          <ToolbarButton
            active={toolbarState.unorderedList}
            label="Bulleted list"
            onClick={() => applyCommand("insertUnorderedList")}
          >
            <List />
          </ToolbarButton>
          <ToolbarButton
            active={toolbarState.orderedList}
            label="Numbered list"
            onClick={() => applyCommand("insertOrderedList")}
          >
            <ListOrdered />
          </ToolbarButton>
          <ToolbarButton
            active={toolbarState.blockStyle === "blockquote"}
            label="Quote"
            onClick={() => toggleBlockStyle("blockquote")}
          >
            <Quote />
          </ToolbarButton>
          <ToolbarButton active={toolbarState.blockStyle === "pre"} label="Code block" onClick={() => toggleBlockStyle("pre")}>
            <Code2 />
          </ToolbarButton>
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-group">
          <ToolbarButton label="Insert table" onClick={insertTable}>
            <Table2 />
          </ToolbarButton>
          <select
            className="toolbar-select toolbar-select-small"
            value={tableAction}
            aria-label="Table actions"
            title="Table actions"
            onMouseDown={() => {
              captureEditorSelection();
            }}
            onChange={(event) => {
              restoreEditorSelection();
              const action = event.currentTarget.value;
              setTableAction("");
              if (action === "add-row") {
                tableActions.addRow();
              } else if (action === "remove-row") {
                tableActions.removeRow();
              } else if (action === "add-col") {
                tableActions.addColumn();
              } else if (action === "remove-col") {
                tableActions.removeColumn();
              }
              captureEditorSelection();
              refreshToolbarState();
            }}
          >
            <option value="">Table actions</option>
            <option value="add-row">Add row</option>
            <option value="remove-row">Remove row</option>
            <option value="add-col">Add column</option>
            <option value="remove-col">Remove column</option>
          </select>
          <ToolbarButton label="Insert image" onClick={() => imageInputRef.current?.click()}>
            <ImagePlus />
          </ToolbarButton>
        </div>
      </div>

      {findOpen ? (
        <div className="editor-find-bar" role="search">
          <input
            ref={findInputRef}
            className="editor-find-input"
            type="text"
            value={findQuery}
            placeholder="Find in note"
            spellCheck={false}
            onChange={(event) => {
              findMatchIndexRef.current = -1;
              setFindMatchIndex(-1);
              setFindQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                moveFindMatch(event.shiftKey ? -1 : 1, true);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeFind();
              }
            }}
          />
          <span className={`editor-find-status ${findMatchCount === 0 && findQuery ? "is-empty" : ""}`}>{findStatusLabel}</span>
          <button type="button" className="editor-find-btn" disabled={findMatchCount === 0} onClick={() => moveFindMatch(-1, true)}>
            Prev
          </button>
          <button type="button" className="editor-find-btn" disabled={findMatchCount === 0} onClick={() => moveFindMatch(1, true)}>
            Next
          </button>
          <button type="button" className="editor-find-btn" onClick={closeFind}>
            Close
          </button>
        </div>
      ) : null}

      <input
        ref={imageInputRef}
        className="hidden-input"
        accept="image/*"
        type="file"
        onChange={async (event) => {
          if (!event.currentTarget.files) {
            return;
          }
          await handleImageFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />

      <div
        ref={editorRef}
        className={`editor-content ${disabled ? "disabled" : ""}`}
        contentEditable={!disabled}
        spellCheck={settings.spellcheck}
        style={editorStyle}
        suppressContentEditableWarning
        onBeforeInput={handleBeforeInput}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (editorRef.current) {
            ensureCaretInsideEditableBlock(editorRef.current);
          }
        }}
        onMouseUp={() => {
          captureEditorSelection();
          refreshToolbarState();
        }}
        onPaste={(event) => {
          void handlePaste(event);
        }}
        onDragStart={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLImageElement)) {
            return;
          }

          const imageId = ensureImageMeta(target);
          event.dataTransfer.setData(IMAGE_DRAG_TYPE, imageId);
          event.dataTransfer.effectAllowed = "move";
          setSelectedImage(target);
          setSelectedImageAlignment(readImageAlignment(target));
          setImageRect(target.getBoundingClientRect());
        }}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          const relatedTarget = event.relatedTarget;
          if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
            return;
          }
          setDropCaret(null);
        }}
        onDrop={(event) => {
          void handleDrop(event);
        }}
        onDragEnd={() => {
          setDropCaret(null);
        }}
        onContextMenu={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) {
            setLinkContextMenu(null);
            setImageContextMenu(null);
            return;
          }

          const clickedImage = target.closest("img");
          if (clickedImage instanceof HTMLImageElement) {
            event.preventDefault();
            const imageId = ensureImageMeta(clickedImage);
            setSelectedImage(clickedImage);
            setSelectedImageAlignment(readImageAlignment(clickedImage));
            setImageRect(clickedImage.getBoundingClientRect());
            setStylePopover(null);
            setLinkContextMenu(null);
            setImageContextMenu({
              x: event.clientX,
              y: event.clientY,
              imageId
            });
            return;
          }

          const clickedLink = target.closest("a[href]");
          if (!(clickedLink instanceof HTMLAnchorElement)) {
            setLinkContextMenu(null);
            setImageContextMenu(null);
            return;
          }

          const normalized = normalizeExternalUrl(clickedLink.getAttribute("href") ?? "");
          if (!normalized) {
            setLinkContextMenu(null);
            setImageContextMenu(null);
            return;
          }

          event.preventDefault();
          linkContextTargetRef.current = clickedLink;
          setStylePopover(null);
          setImageContextMenu(null);
          setLinkContextMenu({
            x: event.clientX,
            y: event.clientY,
            href: normalized
          });
        }}
        onClick={(event) => {
          setLinkContextMenu(null);
          setImageContextMenu(null);
          const target = event.target;
          if (target instanceof Element) {
            const clickedLink = target.closest("a[href]");
            if (clickedLink instanceof HTMLAnchorElement && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void openExternalLink(clickedLink.getAttribute("href"));
              return;
            }
          }

          if (target instanceof HTMLImageElement) {
            ensureImageMeta(target);
            setSelectedImage(target);
            setSelectedImageAlignment(readImageAlignment(target));
            setImageRect(target.getBoundingClientRect());
          } else {
            setSelectedImage(null);
            setImageRect(null);
          }
          captureEditorSelection();
          refreshToolbarState();
        }}
      />

      {dropCaret ? (
        <div className="editor-drop-caret" style={{ left: dropCaret.left, top: dropCaret.top, height: dropCaret.height }} />
      ) : null}

      {slashMenu && filteredSlashCommands.length > 0 ? (
        <ul
          ref={slashMenuRef}
          className="slash-menu"
          style={{
            left: slashMenuPosition?.left ?? slashMenu.left,
            top: slashMenuPosition?.top ?? slashMenu.bottom + 6
          }}
        >
          {filteredSlashCommands.slice(0, 8).map((command) => (
            <li key={command.id}>
              <button
                type="button"
                onClick={() => {
                  command.run();
                  setSlashMenu(null);
                }}
              >
                {command.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {linkContextMenu ? (
        <div className="editor-link-context-menu" style={{ left: linkContextMenu.x, top: linkContextMenu.y }}>
          <button
            type="button"
            onClick={() => {
              void openContextMenuLink();
            }}
          >
            Open link
          </button>
          <button
            type="button"
            onClick={() => {
              void copyContextMenuLink();
            }}
          >
            Copy link
          </button>
          <button type="button" onClick={editContextMenuLink}>
            Edit link
          </button>
          <button type="button" onClick={removeContextMenuLink}>
            Remove link
          </button>
        </div>
      ) : null}

      {imageContextMenu ? (
        <div className="editor-link-context-menu editor-image-context-menu" style={{ left: imageContextMenu.x, top: imageContextMenu.y }}>
          <button
            type="button"
            onClick={() => {
              void copyContextMenuImage();
            }}
          >
            Copy image
          </button>
          <button type="button" onClick={deleteContextMenuImage}>
            Delete image
          </button>
        </div>
      ) : null}

      {selectedImage && imageRect ? (
        <>
          <div className="image-resize-handle" style={{ left: imageRect.right - 8, top: imageRect.bottom - 8 }} onMouseDown={startImageResize} />
          <div className="image-toolbar" style={{ left: imageRect.left, top: imageRect.top - 40 }}>
            <ToolbarButton
              active={selectedImageAlignment === "left"}
              label="Align image left"
              onClick={() => alignSelectedImage("left")}
            >
              <AlignLeft />
            </ToolbarButton>
            <ToolbarButton
              active={selectedImageAlignment === "center"}
              label="Align image center"
              onClick={() => alignSelectedImage("center")}
            >
              <AlignCenter />
            </ToolbarButton>
            <ToolbarButton
              active={selectedImageAlignment === "full"}
              label="Make image full width"
              onClick={() => alignSelectedImage("full")}
            >
              <AlignJustify />
            </ToolbarButton>
          </div>
        </>
      ) : null}
    </div>
  );
}
