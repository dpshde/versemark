import { describe, it, expect } from "vitest";
import {
  buildShareString,
  distanceEmojiBand,
  hintEmoji,
} from "../src/lib/share";
import { TOTAL_VERSES } from "../src/lib/books";

describe("share string", () => {
  it("includes puzzle number and score in verses", () => {
    const s = buildShareString({
      puzzleNumber: 12,
      guessVerseIndex: 1000,
      trueVerseIndex: 1400,
      distance: 400,
      total: 1500,
      hintStep: 1,
    });
    expect(s).toContain("Canonmark #12");
    expect(s).toContain("400 v");
    expect(s).toContain("1500 pts");
    expect(s).toContain(hintEmoji(1));
  });

  it("practice rounds omit the puzzle number", () => {
    const s = buildShareString({
      puzzleNumber: null,
      guessVerseIndex: 100,
      trueVerseIndex: 200,
      distance: 100,
      total: 900,
      hintStep: 2,
    });
    expect(s.startsWith("Canonmark\n")).toBe(true);
    expect(s).not.toContain("#");
    expect(s).toContain("100 v");
  });

  it("distance band has expected length cells", () => {
    const band = distanceEmojiBand(1, TOTAL_VERSES, 7);
    expect(band.length).toBeGreaterThan(5);
    expect(band).toMatch(/\u2B1C|\uD83D\uDD35|\uD83D\uDCCC|\uD83C\uDFAF/);
  });
});
