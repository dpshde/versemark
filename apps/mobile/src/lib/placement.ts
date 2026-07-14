/**
 * Pure placement helpers for the native canon timeline control.
 * Maps pointer/slider position → verse index via @versemark/core axis math.
 */
import {
  clampVerse,
  tToVerse,
  verseToT,
  bookSegmentAtT,
  bookSegments,
  testamentSeamT,
  TOTAL_VERSES,
  type BookSegment,
} from "@versemark/core";

export type PlacementHit = {
  verseIndex: number;
  t: number;
  book: BookSegment | null;
};

/** Fraction of band width → verse on the full canon (Genesis left / top). */
export function placeFromFraction(t: number): PlacementHit {
  const clamped = Math.min(1, Math.max(0, t));
  const verseIndex = tToVerse(clamped);
  const segments = bookSegments();
  return {
    verseIndex,
    t: verseToT(verseIndex),
    book: bookSegmentAtT(clamped, segments),
  };
}

/**
 * Pointer offset along the band axis (px) and band length (px) → verse.
 * Used by PanResponder / press handlers on the timeline.
 */
export function placeFromAxisPx(
  axisCoordPx: number,
  axisLengthPx: number
): PlacementHit {
  if (!(axisLengthPx > 0)) {
    return placeFromFraction(0.5);
  }
  const t = Math.min(1, Math.max(0, axisCoordPx / axisLengthPx));
  return placeFromFraction(t);
}

/** Verse index → 0..1 marker position on the full-canon rail. */
export function markerFraction(verseIndex: number): number {
  return verseToT(clampVerse(verseIndex));
}

/** OT | NT seam as 0..1 for painting the dual-band rail. */
export function testamentSeamFraction(): number {
  return testamentSeamT();
}

export function canonVerseCount(): number {
  return TOTAL_VERSES;
}

/** Shift a visible verse window without changing its span or leaving the canon. */
export function shiftVerseRange(
  start: number,
  end: number,
  deltaVerses: number
): { start: number; end: number; moved: number } {
  const safeStart = clampVerse(Math.round(start));
  const safeEnd = clampVerse(Math.max(safeStart, Math.round(end)));
  const span = safeEnd - safeStart;
  const maxStart = Math.max(1, TOTAL_VERSES - span);
  const nextStart = Math.max(1, Math.min(maxStart, safeStart + Math.round(deltaVerses)));
  return {
    start: nextStart,
    end: nextStart + span,
    moved: nextStart - safeStart,
  };
}
