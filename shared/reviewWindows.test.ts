import { describe, expect, it } from "vitest";

import {
  getDefaultReviewSelection,
  getLaunchReviewReminderTargets,
  getMonthlyReviewTarget,
  getReviewTags,
  getYearlyReviewTarget,
  matchesReviewTarget
} from "./reviewWindows";

describe("reviewWindows", () => {
  it("targets the just-ended monthly review on day one", () => {
    expect(getMonthlyReviewTarget(new Date(2026, 0, 1, 12, 0, 0, 0))).toEqual({
      period: "month",
      year: 2025,
      month: 12
    });
  });

  it("targets the current monthly review on month end", () => {
    expect(getMonthlyReviewTarget(new Date(2026, 1, 28, 12, 0, 0, 0))).toEqual({
      period: "month",
      year: 2026,
      month: 2
    });
  });

  it("targets the just-ended yearly review during early January", () => {
    expect(getYearlyReviewTarget(new Date(2026, 0, 10, 12, 0, 0, 0))).toEqual({
      period: "year",
      year: 2025
    });
  });

  it("returns both reminder targets when both windows are active", () => {
    expect(getLaunchReviewReminderTargets(new Date(2026, 0, 1, 12, 0, 0, 0))).toEqual([
      { period: "month", year: 2025, month: 12 },
      { period: "year", year: 2025 }
    ]);
  });

  it("aligns the default review selection with the monthly target", () => {
    expect(getDefaultReviewSelection(new Date(2026, 0, 1, 12, 0, 0, 0))).toEqual({
      year: 2025,
      month: 12
    });
  });

  it("matches review targets by tags and ignores trashed review pages", () => {
    const monthlyTarget = { period: "month", year: 2026, month: 2 } as const;
    const yearlyTarget = { period: "year", year: 2025 } as const;

    expect(
      matchesReviewTarget(
        {
          deletedAt: null,
          tags: getReviewTags(monthlyTarget)
        },
        monthlyTarget
      )
    ).toBe(true);

    expect(
      matchesReviewTarget(
        {
          deletedAt: null,
          tags: getReviewTags(yearlyTarget)
        },
        yearlyTarget
      )
    ).toBe(true);

    expect(
      matchesReviewTarget(
        {
          deletedAt: "2026-02-28T12:00:00.000Z",
          tags: getReviewTags(monthlyTarget)
        },
        monthlyTarget
      )
    ).toBe(false);
  });
});
