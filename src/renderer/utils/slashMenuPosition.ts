export interface SlashMenuAnchor {
  left: number;
  top: number;
  bottom: number;
}

export interface SlashMenuSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SlashMenuPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

const VIEWPORT_MARGIN = 12;
const ANCHOR_OFFSET = 6;

export function getSlashMenuPosition(
  anchor: SlashMenuAnchor,
  menu: SlashMenuSize,
  viewport: ViewportSize
): SlashMenuPosition {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - menu.width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(anchor.left, VIEWPORT_MARGIN), maxLeft);
  const belowTop = anchor.bottom + ANCHOR_OFFSET;
  const belowBottom = belowTop + menu.height;
  const shouldFlipAbove = belowBottom > viewport.height - VIEWPORT_MARGIN;

  if (!shouldFlipAbove) {
    return {
      left,
      top: Math.max(VIEWPORT_MARGIN, belowTop),
      placement: "below"
    };
  }

  return {
    left,
    top: Math.max(VIEWPORT_MARGIN, anchor.top - menu.height - ANCHOR_OFFSET),
    placement: "above"
  };
}

