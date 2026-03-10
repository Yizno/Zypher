import type { JournalPageMeta } from "./types";

export interface MonthlyReviewTarget {
  period: "month";
  year: number;
  month: number;
}

export interface YearlyReviewTarget {
  period: "year";
  year: number;
}

export type ReviewTarget = MonthlyReviewTarget | YearlyReviewTarget;

export function isMonthlyReviewAccessDate(date: Date): boolean {
  const day = date.getDate();
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return day === 1 || day === lastDay;
}

export function getNextMonthlyReviewAccessDate(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (day < lastDay) {
    return new Date(year, month, lastDay, 12, 0, 0, 0);
  }
  return new Date(year, month + 1, 1, 12, 0, 0, 0);
}

export function isYearlyReviewAccessDate(date: Date): boolean {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 11) {
    return day >= 17;
  }
  if (month === 0) {
    return day <= 15;
  }
  return false;
}

export function getNextYearlyReviewAccessDate(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 11 && day < 17) {
    return new Date(year, 11, 17, 12, 0, 0, 0);
  }
  if (month === 0 && day > 15) {
    return new Date(year, 11, 17, 12, 0, 0, 0);
  }
  if (month >= 1 && month <= 10) {
    return new Date(year, 11, 17, 12, 0, 0, 0);
  }
  return new Date(year + 1, 0, 1, 12, 0, 0, 0);
}

export function formatAccessDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

export function getMonthlyReviewTarget(date: Date): MonthlyReviewTarget {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (date.getDate() === 1) {
    const previousMonth = new Date(year, month - 1, 1);
    return {
      period: "month",
      year: previousMonth.getFullYear(),
      month: previousMonth.getMonth() + 1
    };
  }

  return {
    period: "month",
    year,
    month: month + 1
  };
}

export function getYearlyReviewTarget(date: Date): YearlyReviewTarget {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 0 && day <= 15) {
    return {
      period: "year",
      year: year - 1
    };
  }

  return {
    period: "year",
    year
  };
}

export function getDefaultReviewSelection(date: Date): { year: number; month: number } {
  const target = getMonthlyReviewTarget(date);
  return {
    year: target.year,
    month: target.month
  };
}

export function getLaunchReviewReminderTargets(date: Date): ReviewTarget[] {
  const targets: ReviewTarget[] = [];
  if (isMonthlyReviewAccessDate(date)) {
    targets.push(getMonthlyReviewTarget(date));
  }
  if (isYearlyReviewAccessDate(date)) {
    targets.push(getYearlyReviewTarget(date));
  }
  return targets;
}

export function getReviewTags(target: ReviewTarget): string[] {
  if (target.period === "year") {
    return ["review", "year-in-review", String(target.year)];
  }

  return ["review", "monthly-review", String(target.year), `month-${String(target.month).padStart(2, "0")}`];
}

export function matchesReviewTarget(
  page: Pick<JournalPageMeta, "deletedAt" | "tags">,
  target: ReviewTarget
): boolean {
  if (page.deletedAt) {
    return false;
  }

  const pageTags = new Set(page.tags.map((tag) => tag.toLowerCase()));
  return getReviewTags(target).every((tag) => pageTags.has(tag.toLowerCase()));
}
