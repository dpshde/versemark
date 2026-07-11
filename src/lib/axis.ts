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

/** Distance in verse-index units between Genesis 1:1 and Revelation 22:21. */
export const FULL_CANON_SPAN = TOTAL_VERSES - 1;

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

/**
 * Choose book-start landmarks for the overview rail.
 * Portrait uses a lower size floor and a minimum axis gap so phones get
 * denser anchors without stacked labels. Larger books win collisions.
 */
export function selectBookAnchors(
  segments: BookSegment[],
  options: {
    orientation: Orientation;
    span: number;
    axisPx: number;
    center: number;
    rangeStart: number;
    rangeEnd: number;
  }
): Array<BookSegment & { lenPx: number }> {
  const { orientation, span, axisPx, center, rangeStart, rangeEnd } = options;
  const isH = orientation === "horizontal";
  const minPx = isH ? 20 : 4;
  /** Portrait: tight but readable spacing for phone overview landmarks. */
  const minGap = isH ? 0 : 9;
  const safeSpan = Math.max(1, span);
  const safeAxis = Math.max(1, axisPx);
  const half = safeSpan / 2;

  const candidates: Array<BookSegment & { lenPx: number; axisPos: number }> = [];
  for (const seg of segments) {
    if (seg.startVerseIndex < rangeStart || seg.startVerseIndex > rangeEnd) {
      continue;
    }
    const verses = seg.endVerseIndex - seg.startVerseIndex + 1;
    const lenPx = (verses / safeSpan) * safeAxis;
    if (lenPx < minPx) continue;
    const axisPos =
      ((seg.startVerseIndex - (center - half)) / safeSpan) * safeAxis;
    candidates.push({ ...seg, lenPx, axisPos });
  }

  // Prefer longer books when two starts would collide.
  candidates.sort((a, b) => b.lenPx - a.lenPx || a.startVerseIndex - b.startVerseIndex);
  const accepted: Array<BookSegment & { lenPx: number; axisPos: number }> = [];
  for (const candidate of candidates) {
    if (
      minGap > 0 &&
      accepted.some((p) => Math.abs(p.axisPos - candidate.axisPos) < minGap)
    ) {
      continue;
    }
    accepted.push(candidate);
  }

  accepted.sort((a, b) => a.startVerseIndex - b.startVerseIndex);
  return accepted.map(({ axisPos: _axisPos, ...rest }) => rest);
}

export function testamentSeamT(): number {
  return verseToT(TESTAMENT_SEAM_AFTER);
}

/** Keep a viewport entirely inside the canon, with no blank endpoint padding. */
export function clampViewportToCanon(viewport: Viewport): Viewport {
  const span = Math.min(FULL_CANON_SPAN, Math.max(1, viewport.span));
  const half = span / 2;
  return {
    ...viewport,
    span,
    center: Math.min(
      TOTAL_VERSES - half,
      Math.max(1 + half, viewport.center)
    ),
  };
}

/** Zoom: smaller span = zoomed in. */
export function zoomViewport(
  viewport: Viewport,
  factor: number,
  focusVerse?: number
): Viewport {
  const focus = focusVerse ?? viewport.center;
  const nextSpan = Math.min(FULL_CANON_SPAN, Math.max(20, viewport.span / factor));
  return clampViewportToCanon({
    ...viewport,
    span: nextSpan,
    center: focus,
  });
}

export function panViewport(
  viewport: Viewport,
  deltaVerses: number
): Viewport {
  return clampViewportToCanon({
    ...viewport,
    center: viewport.center + deltaVerses,
  });
}

const SCRUB_RAMP_POINTS = [
  { holdMs: 0, multiplier: 1 },
  { holdMs: 650, multiplier: 1 },
  { holdMs: 1350, multiplier: 2.5 },
  { holdMs: 2200, multiplier: 7 },
  { holdMs: 3200, multiplier: 18 },
  { holdMs: 4500, multiplier: 80 },
] as const;

/** Smooth, staged acceleration for a held edge-scrub gesture. */
export function scrubRampMultiplier(holdMs: number): number {
  const elapsed = Math.max(0, holdMs);
  for (let i = 1; i < SCRUB_RAMP_POINTS.length; i += 1) {
    const previous = SCRUB_RAMP_POINTS[i - 1];
    const next = SCRUB_RAMP_POINTS[i];
    if (elapsed > next.holdMs) continue;
    const duration = next.holdMs - previous.holdMs;
    if (duration <= 0) return next.multiplier;
    const raw = (elapsed - previous.holdMs) / duration;
    const t = Math.min(1, Math.max(0, raw));
    const eased = t * t * (3 - 2 * t);
    return previous.multiplier +
      (next.multiplier - previous.multiplier) * eased;
  }
  return SCRUB_RAMP_POINTS[SCRUB_RAMP_POINTS.length - 1].multiplier;
}

/** Verse velocity for edge scrubbing at the current zoom scale. */
export function scrubVersesPerSecond(span: number, holdMs: number): number {
  const safeSpan = Math.max(1, span);
  const precision = safeSpan <= 120;
  const base = precision ? 3 : Math.max(20, safeSpan * 0.04);
  const cap = precision ? 240 : Math.max(200, safeSpan * 1.25);
  return Math.min(cap, base * scrubRampMultiplier(holdMs));
}

/**
 * Default zoom: full-canon overview on every orientation so the map
 * reads at a glance; players zoom in when placing.
 */
export function defaultSpanForOrientation(_orientation: Orientation): number {
  return FULL_CANON_SPAN;
}

export function defaultViewport(
  orientation: Orientation,
  axisPx: number,
  crossPx: number
): Viewport {
  return clampViewportToCanon({
    center: (TOTAL_VERSES + 1) / 2,
    span: defaultSpanForOrientation(orientation),
    orientation,
    axisPx,
    crossPx,
  });
}

/** Full canon overview (zoom off). */
export function viewportFullCanon(viewport: Viewport): Viewport {
  return clampViewportToCanon({
    ...viewport,
    center: (TOTAL_VERSES + 1) / 2,
    span: FULL_CANON_SPAN,
  });
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
    FULL_CANON_SPAN,
    Math.max(minSpan, width * pad)
  );
  const mid = (lo + hi) / 2;
  return clampViewportToCanon({
    ...viewport,
    center: mid,
    span,
  });
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

/**
 * Local view after the player's broad placement.
 * Span targets ~5–6 average chapters (~26 verses each) — a shotgun
 * neighborhood for fine placement, not a single-chapter microscope.
 */
export function viewportForPrecision(
  viewport: Viewport,
  focusVerse: number
): Viewport {
  const focus = clampVerse(focusVerse);
  return viewportForRange(viewport, focus - 75, focus + 75, {
    pad: 1,
    minSpan: 150,
  });
}

/** Left padding (px) before the portrait rail so notches/labels own the right. */
export const PORTRAIT_RAIL_INSET = 14;

/** Hit width (px) for the mobile full-canon quick-scroll track. */
export const QUICK_SCROLL_HIT = 28;

/**
 * Cross-axis (x) center of the vertical rail: hug the left of the free band
 * so book/chapter/selection labels and notches all sit to the right.
 */
export function portraitRailCross(
  width: number,
  startInset: number,
  endInset: number,
  railThick: number
): number {
  const free = Math.max(48, width - startInset - endInset);
  const thick = Math.max(1, railThick);
  const maxCross = startInset + free - thick / 2 - 4;
  const hugged = startInset + PORTRAIT_RAIL_INSET + thick / 2;
  return Math.min(maxCross, Math.max(startInset + thick / 2, hugged));
}

/** Whether a portrait pointer x falls in the right-edge quick-scroll zone. */
export function isQuickScrollHit(
  x: number,
  width: number,
  hitWidth: number = QUICK_SCROLL_HIT
): boolean {
  const zone = Math.max(12, Math.min(hitWidth, width * 0.2));
  return x >= width - zone;
}

/**
 * Map a free-band axis coordinate to a verse on the full canon
 * (Genesis at origin, Revelation at origin + length).
 */
export function quickScrollVerse(
  axisPos: number,
  freeOrigin: number,
  freeLength: number
): number {
  const length = Math.max(1, freeLength);
  const t = (axisPos - freeOrigin) / length;
  return tToVerse(t);
}
