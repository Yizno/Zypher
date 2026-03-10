import { describe, expect, it } from "vitest";

import { getSlashMenuPosition } from "./slashMenuPosition";

describe("getSlashMenuPosition", () => {
  it("keeps the slash menu below the caret when there is room", () => {
    expect(
      getSlashMenuPosition(
        { left: 120, top: 200, bottom: 220 },
        { width: 220, height: 160 },
        { width: 900, height: 700 }
      )
    ).toEqual({
      left: 120,
      top: 226,
      placement: "below"
    });
  });

  it("flips the slash menu above the caret near the bottom of the viewport", () => {
    expect(
      getSlashMenuPosition(
        { left: 120, top: 620, bottom: 640 },
        { width: 220, height: 160 },
        { width: 900, height: 700 }
      )
    ).toEqual({
      left: 120,
      top: 454,
      placement: "above"
    });
  });

  it("clamps the slash menu horizontally inside the viewport", () => {
    expect(
      getSlashMenuPosition(
        { left: 840, top: 200, bottom: 220 },
        { width: 220, height: 160 },
        { width: 900, height: 700 }
      )
    ).toEqual({
      left: 668,
      top: 226,
      placement: "below"
    });
  });
});
