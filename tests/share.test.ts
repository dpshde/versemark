import { describe, it, expect } from "vitest";
import {
  buildShareString,
  buildDailyShareString,
  formatShareDateForPuzzle,
  formatPoints,
} from "../src/lib/share";
import {
  localDatePartsForPuzzleNumber,
  puzzleNumberForLocalDate,
  DAILY_EPOCH,
} from "../src/lib/daily";

describe("share string", () => {
  it("daily: calendar date + pts units, quiet score line", () => {
    // Puzzle #12 = 2026-08-12
    const rounds = [
      {
        guessVerseIndex: 100,
        trueVerseIndex: 100,
        distance: 0,
        total: 980,
        hintStep: 1 as const,
      },
      {
        guessVerseIndex: 100,
        trueVerseIndex: 200,
        distance: 100,
        total: 720,
        hintStep: 1 as const,
      },
      {
        guessVerseIndex: 100,
        trueVerseIndex: 700,
        distance: 600,
        total: 310,
        hintStep: 2 as const,
      },
      {
        guessVerseIndex: 100,
        trueVerseIndex: 5000,
        distance: 4900,
        total: 90,
        hintStep: 3 as const,
      },
    ];
    const s = buildDailyShareString(12, rounds);
    expect(s).toMatch(
      /^Versemark 12 Aug 2026 · 2100 pts\n\n980 · 720 · 310 · 90\n\nhttps:\/\/versemark\.app\/d\/12\?s=980-\d+\.720-\d+\.310-600\.90-4900$/
    );
    expect(s).toContain("https://versemark.app");
    expect(s).not.toMatch(/⭐|✨/);
    expect(s).not.toMatch(/Versemark \d+ \d+$/m); // no bare puzzle# total
  });

  it("practice uses pts without a date", () => {
    const s = buildShareString({
      puzzleNumber: null,
      guessVerseIndex: 100,
      trueVerseIndex: 200,
      distance: 100,
      total: 900,
      hintStep: 2,
    });
    expect(s).toBe("Versemark · 900 pts\n\n900\n\nhttps://versemark.app");
  });

  it("single daily-style round uses date + pts", () => {
    const s = buildShareString({
      puzzleNumber: 1,
      guessVerseIndex: 1000,
      trueVerseIndex: 1400,
      distance: 400,
      total: 1500,
      hintStep: 1,
    });
    expect(s).toBe(
      "Versemark 1 Aug 2026 · 1500 pts\n\n1500\n\nhttps://versemark.app"
    );
  });

  it("formatPoints always includes unit", () => {
    expect(formatPoints(3600)).toBe("3600 pts");
  });

  it("puzzle number ↔ date round-trips through share label", () => {
    const n = puzzleNumberForLocalDate(2026, 8, 15);
    expect(n).toBe(15);
    expect(formatShareDateForPuzzle(n)).toBe("15 Aug 2026");
    const parts = localDatePartsForPuzzleNumber(n);
    expect(parts).toEqual({ year: 2026, month: 8, day: 15 });
    expect(localDatePartsForPuzzleNumber(1)).toEqual({
      year: DAILY_EPOCH.year,
      month: DAILY_EPOCH.month,
      day: DAILY_EPOCH.day,
    });
  });
});
