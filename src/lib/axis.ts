/**
 * Pure placement / viewport math for the verse-level canon axis.
 * Orientation is a transform: vertical (portrait) or horizontal (wide).
 */
import {
  BOOKS,
  TOTAL_VERSES,
  TESTAMENT_SEAM_AFTER,
  bookChapterVerseFromIndex,
} from "./books";

export type Orientation = "vertical" | "horizontal";

/** UI zoom presets for the canon timeline. */
export type ZoomPreset = "ot" | "nt" | "book";

/** OT: Gen–Mal. NT: Mat–Rev. */
export const OT_END = TESTAMENT_SEAM_AFTER;
export const NT_START = TESTAMENT_SEAM_AFTER + 1;

export interface Viewport {
  /** Axis position of the view center in verse-index units (1..TOTAL_VERSES). */
  center: number;
  /**
   * How many verses fit across the full band length of the canvas.
   * Smaller = more zoomed in. Full-canon overview ≈ TOTAL_VERSES.
   */
  span: number;
  orientation: Orientation;
  /** Pixel size along the band axis. */
  axisPx: number;
  /** Pixel size perpendicular to the band. */
  crossPx: number;
}

export interface HitResult {
  verseIndex: number;
  /** 0..1 position along band from Genesis. */
  t: number;
}

/** Clamp verse index to valid range. */
export function clampVerse(index: number): number {
  return Math.min(TOTAL_VERSES, Math.max(1, Math.round(index)));
}

/** @deprecated Use clampVerse. */
export function clampChapter(index: number): number {
  return clampVerse(index);
}

/** Map verse index → 0..1 along the full canon. */
export function verseToT(verseIndex: number): number {
  return (clampVerse(verseIndex) - 1) / (TOTAL_VERSES - 1);
}

/** @deprecated Use verseToT. */
export function chapterToT(index: number): number {
  return verseToT(index);
}

/** Map 0..1 → verse index. */
export function tToVerse(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clampVerse(1 + clamped * (TOTAL_VERSES - 1));
}

/** @deprecated Use tToVerse. */
export function tToChapter(t: number): number {
  return tToVerse(t);
}

/**
 * Convert a pointer position on the band canvas to a verse index.
 * For vertical: y along axis (Genesis at top, y=0).
 * For horizontal: x along axis (Genesis at left, x=0).
 */
export function hitTestVerse(
  axisCoordPx: number,
  viewport: Viewport
): HitResult {
  const { center, span, axisPx } = viewport;
  const half = span / 2;
  const tLocal = axisCoordPx / axisPx; // 0..1 within viewport
  const verse = center - half + tLocal * span;
  const verseIndex = clampVerse(verse);
  return { verseIndex, t: verseToT(verseIndex) };
}

/** @deprecated Use hitTestVerse. */
export function hitTestChapter(
  axisCoordPx: number,
  viewport: Viewport
): { chapterIndex: number; t: number } {
  const h = hitTestVerse(axisCoordPx, viewport);
  return { chapterIndex: h.verseIndex, t: h.t };
}

/** Verse index → pixel coordinate along the band axis for a viewport. */
export function verseToAxisPx(
  verseIndex: number,
  viewport: Viewport
): number {
  const { center, span, axisPx } = viewport;
  const half = span / 2;
  const rel = (verseIndex - (center - half)) / span;
  return rel * axisPx;
}

/** @deprecated Use verseToAxisPx. */
export function chapterToAxisPx(
  index: number,
  viewport: Viewport
): number {
  return verseToAxisPx(index, viewport);
}

export function visibleRange(viewport: Viewport): {
  start: number;
  end: number;
} {
  const half = viewport.span / 2;
  return {
    start: clampVerse(viewport.center - half),
    end: clampVerse(viewport.center + half),
  };
}

export interface BookSegment {
  osis: string;
  name: string;
  genre: string;
  startVerseIndex: number;
  endVerseIndex: number;
  /** 0..1 of full canon (verse-weighted). */
  t0: number;
  t1: number;
}

export function bookSegments(): BookSegment[] {
  return BOOKS.map((b) => ({
    osis: b.osis,
    name: b.name,
    genre: b.genre,
    startVerseIndex: b.startVerseIndex,
    endVerseIndex: b.endVerseIndex,
    t0: verseToT(b.startVerseIndex),
    t1: verseToT(b.endVerseIndex),
  }));
}

export function testamentSeamT(): number {
  return verseToT(TESTAMENT_SEAM_AFTER);
}

/** Zoom: smaller span = zoomed in. */
export function zoomViewport(
  viewport: Viewport,
  factor: number,
  focusVerse?: number
): Viewport {
  const focus = focusVerse ?? viewport.center;
  const nextSpan = Math.min(
    TOTAL_VERSES * 1.05,
    Math.max(20, viewport.span / factor)
  );
  return {
    ...viewport,
    span: nextSpan,
    center: clampVerse(focus),
  };
}

export function panViewport(
  viewport: Viewport,
  deltaVerses: number
): Viewport {
  return {
    ...viewport,
    center: clampVerse(viewport.center + deltaVerses),
  };
}

export function defaultViewport(
  orientation: Orientation,
  axisPx: number,
  crossPx: number
): Viewport {
  return {
    center: Math.round(TOTAL_VERSES / 2),
    span: TOTAL_VERSES,
    orientation,
    axisPx,
    crossPx,
  };
}

/** Full canon overview (zoom off). */
export function viewportFullCanon(viewport: Viewport): Viewport {
  return {
    ...viewport,
    center: Math.round(TOTAL_VERSES / 2),
    span: TOTAL_VERSES,
  };
}

/**
 * Fit a verse range into the viewport with a little end padding.
 * Short ranges get a minimum span so neighbors stay visible.
 */
export function viewportForRange(
  viewport: Viewport,
  startVerse: number,
  endVerse: number,
  options: { pad?: number; minSpan?: number } = {}
): Viewport {
  const pad = options.pad ?? 1.08;
  const minSpan = options.minSpan ?? 60;
  const lo = clampVerse(Math.min(startVerse, endVerse));
  const hi = clampVerse(Math.max(startVerse, endVerse));
  const width = hi - lo + 1;
  const span = Math.min(
    TOTAL_VERSES * 1.05,
    Math.max(minSpan, width * pad)
  );
  const mid = (lo + hi) / 2;
  return {
    ...viewport,
    center: clampVerse(mid),
    span,
  };
}

/**
 * Apply a zoom preset.
 * - ot / nt: whole testament
 * - book: book containing `focusVerse` (falls back to viewport center)
 */
export function viewportForZoomPreset(
  viewport: Viewport,
  preset: ZoomPreset,
  focusVerse?: number
): Viewport {
  if (preset === "ot") {
    return viewportForRange(viewport, 1, OT_END, { pad: 1.04, minSpan: 200 });
  }
  if (preset === "nt") {
    return viewportForRange(viewport, NT_START, TOTAL_VERSES, {
      pad: 1.06,
      minSpan: 120,
    });
  }
  const focus = clampVerse(focusVerse ?? viewport.center);
  const loc = bookChapterVerseFromIndex(focus);
  if (!loc) {
    return viewportForRange(viewport, focus - 30, focus + 30, {
      pad: 1,
      minSpan: 60,
    });
  }
  const { book } = loc;
  return viewportForRange(
    viewport,
    book.startVerseIndex,
    book.endVerseIndex,
    { pad: 1.15, minSpan: 80 }
  );
}
