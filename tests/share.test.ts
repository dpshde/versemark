import { describe, it, expect } from "vitest";
import {
  buildShareString,
  distanceEmojiBand,
  hintEmoji,
  buildDailyShareString,
} from "../src/lib/share";
import { TOTAL_VERSES } from "../src/lib/books";

describe("share string", () => {
  it("daily: Wordle-class header + blank line + grid, no URL/CTA", () => {
    const rounds = Array.from({ length: 4 }, (_, index) => ({
      guessVerseIndex: 1000 + index,
      trueVerseIndex: 1200 + index,
      distance: 200,
      total: 900,
      hintStep: 1 as const,
    }));
    const s = buildDailyShareString(12, rounds);
    const lines = s.split("\n");

    // Line 1: brand + day + compact total (notification preview)
    expect(lines[0]).toBe("Versemark 12 3600");
    // Blank line separates header from grid
    expect(lines[1]).toBe("");
    // Four visual rows, no per-row score noise
    expect(lines.slice(2)).toHaveLength(4);
    for (const row of lines.slice(2)) {
      expect(row).toMatch(hintEmoji(1));
      expect(row).not.toContain("pts");
    }
    // Self-contained: no link, no CTA
    expect(s).not.toContain("http");
    expect(s).not.toContain("beat");
    expect(s).not.toContain("Score to");
    expect(s).not.toMatch(/can you|install|download/i);
  });

  it("daily: same payload shape is pure text (clipboard-native)", () => {
    const s = buildDailyShareString(1, [
      {
        guessVerseIndex: 1,
        trueVerseIndex: 1,
        distance: 0,
        total: 2000,
        hintStep: 1,
      },
    ]);
    expect(s.startsWith("Versemark 1 2000\n\n")).toBe(true);
    expect(s).toContain("\uD83C\uDFAF"); // exact hit
  });

  it("single round: brand + score header, visual row, no URL", () => {
    const s = buildShareString({
      puzzleNumber: 12,
      guessVerseIndex: 1000,
      trueVerseIndex: 1400,
      distance: 400,
      total: 1500,
      hintStep: 1,
    });
    expect(s).toBe(
      `Versemark 12 1500\n\n${distanceEmojiBand(1000, 1400)} ${hintEmoji(1)}`
    );
    expect(s).not.toContain("http");
    expect(s).not.toContain("400 v");
  });

  it("practice rounds omit the day index", () => {
    const s = buildShareString({
      puzzleNumber: null,
      guessVerseIndex: 100,
      trueVerseIndex: 200,
      distance: 100,
      total: 900,
      hintStep: 2,
    });
    expect(s.startsWith("Versemark 900\n\n")).toBe(true);
    expect(s).not.toMatch(/Versemark \d+ \d+/); // no day index
    expect(s).toContain(hintEmoji(2));
    expect(s).not.toContain("http");
  });

  it("distance band has expected length cells", () => {
    const band = distanceEmojiBand(1, TOTAL_VERSES, 7);
    expect(band.length).toBeGreaterThan(5);
    expect(band).toMatch(/\u2B1C|\uD83D\uDD35|\uD83D\uDCCC|\uD83C\uDFAF/);
  });
});
