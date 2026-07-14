import { describe, it, expect } from "vitest";
import {
  placeFromFraction,
  placeFromAxisPx,
  markerFraction,
  testamentSeamFraction,
  canonVerseCount,
  shiftVerseRange,
} from "../src/lib/placement";
import {
  tToVerse,
  verseToT,
  clampVerse,
  TOTAL_VERSES,
  bookSegmentAtT,
} from "@versemark/core";

describe("placement (real core axis)", () => {
  it("maps mid-rail to midpoint verse via core tToVerse", () => {
    const hit = placeFromFraction(0.5);
    expect(hit.verseIndex).toBe(tToVerse(0.5));
    expect(hit.t).toBe(verseToT(hit.verseIndex));
    expect(hit.book).not.toBeNull();
  });

  it("Genesis edge and Revelation edge", () => {
    const gen = placeFromFraction(0);
    expect(gen.verseIndex).toBe(1);
    expect(gen.book?.osis).toBe("GEN");

    const rev = placeFromFraction(1);
    expect(rev.verseIndex).toBe(TOTAL_VERSES);
    expect(rev.book?.osis).toBe("REV");
  });

  it("placeFromAxisPx is linear with band width", () => {
    const width = 390;
    const mid = placeFromAxisPx(width / 2, width);
    expect(mid.verseIndex).toBe(placeFromFraction(0.5).verseIndex);

    const left = placeFromAxisPx(0, width);
    expect(left.verseIndex).toBe(1);

    const right = placeFromAxisPx(width, width);
    expect(right.verseIndex).toBe(TOTAL_VERSES);
  });

  it("markerFraction round-trips with core verseToT", () => {
    const v = 15000;
    expect(markerFraction(v)).toBe(verseToT(clampVerse(v)));
  });

  it("testament seam is between OT and NT books", () => {
    const seam = testamentSeamFraction();
    expect(seam).toBeGreaterThan(0.4);
    expect(seam).toBeLessThan(0.9);
    const atSeam = bookSegmentAtT(seam);
    // Seam is last OT verse boundary — book should be OT or first NT
    expect(atSeam).not.toBeNull();
  });

  it("canon verse count matches core", () => {
    expect(canonVerseCount()).toBe(TOTAL_VERSES);
  });

  it("shifts a precision range without changing its span", () => {
    expect(shiftVerseRange(100, 250, 40)).toEqual({ start: 140, end: 290, moved: 40 });
    expect(shiftVerseRange(1, 151, -80)).toEqual({ start: 1, end: 151, moved: 0 });
    expect(shiftVerseRange(TOTAL_VERSES - 150, TOTAL_VERSES, 80)).toEqual({
      start: TOTAL_VERSES - 150,
      end: TOTAL_VERSES,
      moved: 0,
    });
  });
});
