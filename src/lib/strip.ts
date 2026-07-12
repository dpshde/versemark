/**
 * Canvas 2D canon-timeline renderer — fully procedural, no image assets.
 *
 * The canon renders as a clean timeline rail with genre-tinted book segments.
 * The 1D verse axis maps to position along the rail (straight, no meander).
 */
import {
  type Viewport,
  type Orientation,
  type ZoomPreset,
  FULL_CANON_SPAN,
  OT_END,
  bookSegments,
  verseToAxisPx,
  hitTestVerse,
  clampVerse,
  defaultViewport,
  defaultSpanForOrientation,
  panViewport,
  scrubVersesPerSecond,
  zoomViewport,
  pinchZoomFactor,
  coastVelocityAfter,
  edgeZoneFraction,
  clampViewportToCanon,
  viewportForZoomPreset,
  viewportForPrecision,
  viewportForRange,
  viewportFullCanon,
} from "./axis";
import {
  TOTAL_VERSES,
  TESTAMENT_SEAM_AFTER,
  bookChapterVerseFromIndex,
  formatVerseLabel,
  routeBibleUrl,
} from "./books";
import { hapticLight, hapticSelection } from "./haptics";
import { resolvedTheme } from "./theme";

/* ———— Constants ———— */

const SERIF = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif';
const REVEAL_MS = 800;
const PRECISION_ZOOM_MS = 220;
/** Span at or below this counts as precision (must cover viewportForPrecision). */
const PRECISION_THRESHOLD = 180;
const NOTCH_GAP = 8;
const ACTIVE_NOTCH_LENGTH = 28;

/**
 * Always keep these start-anchors on the full-canon overview even when the
 * book is short in pixels — otherwise Epistles vanish after Acts, and History
 * opens / closes as a blank band.
 * History: Joshua → Ezra. Letters: Romans → Ephesians → Hebrews; Revelation closes.
 */
export const OVERVIEW_LANDMARK_OSIS = new Set([
  "JOS",
  "EZR",
  "ROM",
  "EPH",
  "HEB",
  "REV",
]);

/**
 * History "volume 2" books — skip so the overview keeps one label per arc
 * (Joshua → 1 Samuel → 1 Kings → 1 Chronicles) instead of paired clutter.
 */
export const OVERVIEW_SKIP_OSIS = new Set([
  "JDG",
  "2SA",
  "2KI",
  "2CH",
]);

/** Whether a book earns a name label on the overview rail. */
export function isOverviewBookLabelCandidate(
  lenPx: number,
  osis: string,
  orientation: Orientation
): boolean {
  if (OVERVIEW_SKIP_OSIS.has(osis)) return false;
  if (OVERVIEW_LANDMARK_OSIS.has(osis)) return true;
  // Wide overview has room below the rail for denser History packing;
  // portrait stays stricter so the left column doesn't crowd.
  return lenPx >= (orientation === "horizontal" ? 12 : 14);
}

export interface OverviewLabelCandidate {
  osis: string;
  name: string;
  axis: number;
  lenPx: number;
  landmark: boolean;
}

/**
 * Pick overview labels: landmarks first (so Epistles aren't crowded out),
 * then ordinary long books into remaining gaps.
 */
export function pickOverviewBookLabels<T extends OverviewLabelCandidate>(
  candidates: T[],
  minGap: number
): T[] {
  const kept: T[] = [];
  const fits = (c: T) =>
    kept.every((k) => Math.abs(k.axis - c.axis) >= minGap);

  const landmarks = candidates
    .filter((c) => c.landmark)
    .sort((a, b) => a.axis - b.axis);
  for (const c of landmarks) {
    if (fits(c)) kept.push(c);
  }

  const ordinary = candidates
    .filter((c) => !c.landmark)
    .sort((a, b) => a.axis - b.axis);
  for (const c of ordinary) {
    if (fits(c)) kept.push(c);
  }

  return kept.sort((a, b) => a.axis - b.axis);
}

/** Fallbacks when CSS variables are unavailable (tests / SSR). */
const FALLBACK = {
  accent: "#b85a20",
  accentDeep: "#8f4516",
  success: "#5a8a3a",
  successDeep: "#3f6a28",
  ink: "#2f2a25",
  ink2: "#6e655a",
  ink3: "#9a9088",
  rail: "#e8e4de",
  bg: "#faf8f4",
  genre: {
    law: "#7fbf7a",
    history: "#c4844a",
    poetry: "#a88fd4",
    prophets: "#d4724a",
    gospels: "#d4898a",
    epistles: "#5fafa8",
  } as Record<string, string>,
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/** Live palette from design tokens (tracks light/dark). */
function palette() {
  return {
    accent: cssVar("--accent", FALLBACK.accent),
    accentDeep: cssVar("--accent-deep", FALLBACK.accentDeep),
    success: cssVar("--success", FALLBACK.success),
    successDeep: cssVar("--success", FALLBACK.successDeep),
    ink: cssVar("--ink", FALLBACK.ink),
    ink2: cssVar("--ink-2", FALLBACK.ink2),
    ink3: cssVar("--ink-3", FALLBACK.ink3),
    rail: cssVar("--rail", FALLBACK.rail),
    bg: cssVar("--bg", FALLBACK.bg),
    genre(genre: string): string {
      const key = `--genre-${genre}`;
      return cssVar(key, FALLBACK.genre[genre] ?? FALLBACK.rail);
    },
  };
}

/** Selected verse callout: white in dark for contrast on the rail. */
function selectionTextColor(light: string): string {
  return resolvedTheme() === "dark" ? "#ffffff" : light;
}

/* ———— Types ———— */

export interface StripState {
  viewport: Viewport;
  provisionalGuess: number | null;
  lockedGuess: number | null;
  trueVerse: number | null;
  revealed: boolean;
}

interface Point { x: number; y: number }

/** Precomputed YOU/TRUE chip box (portrait pair layout). */
interface ResultChipLayout {
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

/** Hit target for a result chip → route.bible link overlay. */
interface ResultLinkHit {
  verseIndex: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
  role: string;
}

/* ———— Class ———— */

/** Reserved bands so the rail sits in free space between HUD chrome. */
export interface ChromeInsets {
  top: number;
  bottom: number;
  start: number;
  end: number;
}

export class CanonStrip {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: StripState;
  private dpr = 1;
  private canvasW = 0;
  private canvasH = 0;
  /** Theme-aware colors, refreshed each paint. */
  private colors = palette();
  private dragging = false;
  /** While true, drag moves the marker; edge zones may auto-scroll. */
  private placing = false;
  /** Free-pan mode after reveal (or explicit pan without a marker). */
  private panning = false;
  private lastAxis = 0;
  private hoverVerse: number | null = null;
  private activePointerType: string | null = null;
  /** Live pointer positions for pinch (pointerId → client coords + axis). */
  private pointers = new Map<
    number,
    { clientX: number; clientY: number; axis: number }
  >();
  private pinching = false;
  private pinchStartDist = 0;
  private pinchStartSpan = 0;
  private pinchFocusVerse = 1;
  /** Recent axis samples for flick / coast velocity (ms, axisPx). */
  private moveSamples: Array<{ t: number; axis: number }> = [];
  private coastRaf = 0;
  private coastVelocity = 0;
  private coastLastFrame = 0;
  private onGuessChange: ((ch: number | null) => void) | null = null;
  private onGuessCommit: (() => void) | null = null;
  private onFreeViewChange: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private animFrame = 0;
  private viewportAnimFrame = 0;
  /** Broad view captured immediately before automatic verse-precision zoom. */
  private prePrecisionViewport: Viewport | null = null;
  private edgeScrollRaf = 0;
  private edgeScrollDirection = 0;
  private edgeScrollHoldStart = 0;
  private edgeScrollLastFrame = 0;
  private edgeScrollCarry = 0;
  private revealStart = 0;
  private revealProgress = 0;
  /** Insets in CSS px (canvas layout space) for verse / dock chrome. */
  private chrome: ChromeInsets = { top: 0, bottom: 0, start: 0, end: 0 };
  /** Result-page YOU/TRUE chip boxes for DOM link overlays. */
  private resultLinkHits: ResultLinkHit[] = [];
  private linkLayer: HTMLDivElement | null = null;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    const orient = this.detectOrientation();
    this.state = {
      viewport: defaultViewport(orient, 300, 120),
      provisionalGuess: null,
      lockedGuess: null,
      trueVerse: null,
      revealed: false,
    };
    this.bind();
    this.resize();
    this.syncAccessibility();
  }

  private detectOrientation(): Orientation {
    return window.innerWidth >= 720 ? "horizontal" : "vertical";
  }

  setOnGuessChange(cb: (ch: number | null) => void): void {
    this.onGuessChange = cb;
  }

  setOnGuessCommit(cb: () => void): void {
    this.onGuessCommit = cb;
  }

  setOnFreeViewChange(cb: () => void): void {
    this.onFreeViewChange = cb;
  }

  /** Place the rail in the free band between top/bottom (or side) chrome. */
  setChromeInsets(insets: Partial<ChromeInsets>): void {
    this.chrome = { ...this.chrome, ...insets };
    // Recompute axisPx so hit-testing and drawing stay inside the free band
    this.syncViewportMetrics();
    this.render();
  }

  /**
   * Jump to a zoom preset. Book zoom focuses the provisional guess when set,
   * otherwise the current viewport center.
   */
  setZoomPreset(preset: ZoomPreset, focusVerse?: number): void {
    this.stopViewportAnimation();
    this.prePrecisionViewport = null;
    const focus =
      focusVerse ??
      this.state.provisionalGuess ??
      this.state.lockedGuess ??
      this.state.viewport.center;
    this.state.viewport = viewportForZoomPreset(
      this.state.viewport,
      preset,
      focus
    );
    this.render();
  }

  /** Restore full-canon overview (all zoom presets off). */
  clearZoom(): void {
    this.stopViewportAnimation();
    this.prePrecisionViewport = null;
    this.state.viewport = viewportFullCanon(this.state.viewport);
    this.onFreeViewChange?.();
    this.render();
  }

  isPrecisionView(): boolean {
    return this.state.viewport.span <= PRECISION_THRESHOLD;
  }

  /** True while a pointer is actively placing/dragging the marker. */
  isPlacing(): boolean {
    return this.placing;
  }

  /** Return to the broad view captured before automatic precision zoom. */
  zoomOutFromPrecision(): void {
    if (!this.isPrecisionView()) return;
    this.stopViewportAnimation();
    this.state.viewport = this.prePrecisionViewport
      ? { ...this.prePrecisionViewport }
      : viewportFullCanon(this.state.viewport);
    this.prePrecisionViewport = null;
    this.onFreeViewChange?.();
    this.render();
  }

  getState(): Readonly<StripState> { return this.state; }
  getProvisionalGuess(): number | null { return this.state.provisionalGuess; }

  setProvisionalGuess(ch: number | null): void {
    this.stopViewportAnimation();
    this.stopCoast();
    this.state.provisionalGuess = ch == null ? null : clampVerse(ch);
    // Keyboard / programmatic jumps: keep the marker inside the precision window.
    if (
      this.state.provisionalGuess != null &&
      this.isPrecisionView() &&
      !this.placing &&
      !this.dragging
    ) {
      const half = this.state.viewport.span / 2;
      const lo = this.state.viewport.center - half;
      const hi = this.state.viewport.center + half;
      const v = this.state.provisionalGuess;
      if (v < lo + 4 || v > hi - 4) {
        this.state.viewport = clampViewportToCanon({
          ...this.state.viewport,
          center: v,
        });
      }
    }
    this.syncAccessibility();
    this.onGuessChange?.(this.state.provisionalGuess);
    this.render();
  }

  /**
   * Place the marker from a typed reference and sync the map to verse precision
   * around that verse. First entry from a broad view animates in; further typed
   * changes snap the precision window so the rail follows typing.
   */
  focusGuessFromText(verseIndex: number): void {
    const v = clampVerse(verseIndex);
    this.state.provisionalGuess = v;
    this.syncAccessibility();
    this.onGuessChange?.(v);

    const target = viewportForPrecision(this.state.viewport, v);
    if (this.isPrecisionView()) {
      this.stopViewportAnimation();
      this.state.viewport = target;
      this.render();
      return;
    }
    this.prePrecisionViewport = { ...this.state.viewport };
    this.animateToViewport(target);
  }

  lockGuess(): number | null {
    if (this.state.provisionalGuess == null) return null;
    this.state.lockedGuess = this.state.provisionalGuess;
    return this.state.lockedGuess;
  }

  reveal(trueVerseIndex: number): void {
    this.stopViewportAnimation();
    this.state.trueVerse = clampVerse(trueVerseIndex);
    this.state.revealed = true;
    // Zoom to the testament that holds the answer (OT or NT). Cross-testament
    // misses open the full canon so both markers stay on the map.
    this.prePrecisionViewport = null;
    this.state.viewport = this.viewportForResult(
      this.state.lockedGuess ?? this.state.trueVerse,
      this.state.trueVerse
    );
    this.onFreeViewChange?.();
    this.syncAccessibility();
    this.startRevealAnimation();
    this.render();
  }

  /**
   * Result framing by testament: OT or NT for same-side guesses; full canon
   * when guess and truth straddle the seam (so both markers remain visible).
   */
  private viewportForResult(guess: number, truth: number): Viewport {
    const guessOt = guess <= OT_END;
    const truthOt = truth <= OT_END;
    if (guessOt === truthOt) {
      return viewportForZoomPreset(
        this.state.viewport,
        truthOt ? "ot" : "nt"
      );
    }
    // Cross-testament miss — show the whole span covering both pins
    return viewportForRange(
      this.state.viewport,
      Math.min(guess, truth),
      Math.max(guess, truth),
      { pad: 1.06, minSpan: 400 }
    );
  }

  resetForRound(): void {
    this.stopViewportAnimation();
    this.state.provisionalGuess = null;
    this.state.lockedGuess = null;
    this.state.trueVerse = null;
    this.state.revealed = false;
    this.revealProgress = 0;
    const o = this.state.viewport.orientation;
    this.state.viewport = {
      ...this.state.viewport,
      center: (TOTAL_VERSES + 1) / 2,
      span: defaultSpanForOrientation(o),
    };
    this.onGuessChange?.(null);
    this.render();
  }

  /* ———— Reveal animation ———— */

  private startRevealAnimation(): void {
    cancelAnimationFrame(this.animFrame);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.revealProgress = 1;
      this.render();
      return;
    }
    this.revealStart = performance.now();
    this.revealProgress = 0;
    const tick = (now: number) => {
      const raw = Math.min(1, (now - this.revealStart) / REVEAL_MS);
      this.revealProgress = easeOutCubic(raw);
      this.render();
      if (raw < 1) this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  /** Ease the viewport toward a target (span + center). Snaps under reduced motion. */
  private animateToViewport(target: Viewport): void {
    const fromSpan = this.state.viewport.span;
    const fromCenter = this.state.viewport.center;
    this.stopViewportAnimation();

    if (
      Math.abs(fromSpan - target.span) < 1 &&
      Math.abs(fromCenter - target.center) < 0.5
    ) {
      this.state.viewport = {
        ...this.state.viewport,
        center: target.center,
        span: target.span,
      };
      this.onFreeViewChange?.();
      this.render();
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.state.viewport = {
        ...this.state.viewport,
        center: target.center,
        span: target.span,
      };
      this.onFreeViewChange?.();
      this.render();
      return;
    }

    const started = performance.now();
    const tick = (now: number): void => {
      const raw = Math.min(1, (now - started) / PRECISION_ZOOM_MS);
      const eased = easeOutCubic(raw);
      // Keep live axisPx/crossPx from resize; only tween span + center.
      this.state.viewport = {
        ...this.state.viewport,
        center: fromCenter + (target.center - fromCenter) * eased,
        span: fromSpan + (target.span - fromSpan) * eased,
      };
      this.render();
      if (raw < 1) {
        this.viewportAnimFrame = requestAnimationFrame(tick);
      } else {
        this.state.viewport = {
          ...this.state.viewport,
          center: target.center,
          span: target.span,
        };
        this.viewportAnimFrame = 0;
        this.onFreeViewChange?.();
        this.render();
      }
    };
    this.viewportAnimFrame = requestAnimationFrame(tick);
  }

  /* ———— Input binding ———— */

  private bind(): void {
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);

    /** Axis coord in content-band space (0…axisPx), not full canvas. */
    const axisCoord = (e: PointerEvent): number => {
      const rect = this.canvas.getBoundingClientRect();
      const band = this.contentAxis();
      const raw =
        this.state.viewport.orientation === "vertical"
          ? e.clientY - rect.top
          : e.clientX - rect.left;
      return Math.min(band.length, Math.max(0, raw - band.origin));
    };

    const rememberPointer = (e: PointerEvent): void => {
      this.pointers.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
        axis: axisCoord(e),
      });
    };

    const endGesture = (opts?: { coast?: boolean }): void => {
      const wasPlacing = this.placing;
      const shouldCoast = opts?.coast === true;
      const coastV = shouldCoast ? this.sampleCoastVelocity() : 0;
      this.dragging = false;
      this.placing = false;
      this.panning = false;
      this.activePointerType = null;
      this.pinching = false;
      this.pinchStartDist = 0;
      this.moveSamples = [];
      this.canvas.classList.remove("is-placing");
      this.stopEdgeScroll();
      if (shouldCoast && Math.abs(coastV) > 0.008) {
        this.startCoast(coastV);
      } else {
        this.render();
      }
      // Lift ends rough-place — progressive chrome (zoom bar) can appear now.
      if (wasPlacing) {
        this.onGuessChange?.(this.state.provisionalGuess);
      }
    };

    /*
     * Pointer model:
     * - Playing: finger owns the marker (tap or drag to place/adjust).
     *   Scroll only when the finger sits in an edge zone so the pointer
     *   would otherwise leave the visible span (edge auto-pan).
     * - Two fingers: pinch zoom around the midpoint verse.
     * - Revealed: free drag pans the timeline.
     */
    this.canvas.addEventListener("pointerdown", (e) => {
      rememberPointer(e);
      this.stopCoast();
      this.stopViewportAnimation();
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore capture failures on some browsers */
      }

      if (this.pointers.size >= 2 && !this.state.revealed) {
        this.beginPinch();
        return;
      }

      if (e.isPrimary === false) return;
      this.canvas.focus({ preventScroll: true });
      this.dragging = true;
      this.hoverVerse = null;
      this.activePointerType = e.pointerType;
      this.lastAxis = axisCoord(e);
      this.moveSamples = [{ t: performance.now(), axis: this.lastAxis }];

      if (!this.state.revealed) {
        this.placing = true;
        this.panning = false;
        this.canvas.classList.add("is-placing");
        hapticLight();
        this.setProvisionalGuess(
          hitTestVerse(this.lastAxis, this.state.viewport).verseIndex
        );
        this.startEdgeScroll();
      } else {
        this.placing = false;
        this.panning = true;
      }
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (this.pointers.has(e.pointerId)) {
        rememberPointer(e);
      }

      if (this.pinching && this.pointers.size >= 2) {
        this.applyPinch();
        return;
      }

      const axis = axisCoord(e);
      if (!this.dragging) {
        if (!this.state.revealed && e.pointerType !== "touch") {
          const nextHover = hitTestVerse(axis, this.state.viewport).verseIndex;
          if (nextHover !== this.hoverVerse) {
            this.hoverVerse = nextHover;
            this.render();
          }
        }
        return;
      }
      const deltaPx = axis - this.lastAxis;
      this.lastAxis = axis;
      this.recordMoveSample(axis);

      if (this.panning) {
        const cpp = this.state.viewport.span / this.state.viewport.axisPx;
        this.state.viewport = panViewport(
          this.state.viewport,
          -deltaPx * cpp
        );
        this.render();
        return;
      }

      if (this.placing) {
        // Marker follows the finger; edge scroll runs on the rAF loop.
        const next = hitTestVerse(axis, this.state.viewport).verseIndex;
        if (
          this.activePointerType === "touch" &&
          this.isPrecisionView() &&
          next !== this.state.provisionalGuess
        ) {
          hapticSelection();
        }
        this.setProvisionalGuess(next);
      }
    });

    this.canvas.addEventListener("pointerup", (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pinching) {
        if (this.pointers.size < 2) {
          this.pinching = false;
          this.pinchStartDist = 0;
          // Resume single-finger place if one finger remains.
          if (this.pointers.size === 1 && !this.state.revealed) {
            const remaining = [...this.pointers.values()][0];
            this.dragging = true;
            this.placing = true;
            this.panning = false;
            this.activePointerType = "touch";
            this.lastAxis = remaining.axis;
            this.canvas.classList.add("is-placing");
            this.startEdgeScroll();
          }
        }
        this.onFreeViewChange?.();
        this.render();
        return;
      }

      const shouldAutoZoom =
        !this.state.revealed &&
        this.placing &&
        this.state.provisionalGuess != null &&
        this.state.viewport.span > PRECISION_THRESHOLD;
      const shouldCoast =
        !this.state.revealed &&
        this.placing &&
        this.isPrecisionView() &&
        this.activePointerType === "touch";
      const focus = this.state.provisionalGuess;
      endGesture({ coast: shouldCoast && !shouldAutoZoom });
      if (shouldAutoZoom && focus != null) {
        this.autoZoomForPrecision(focus);
      }
    });

    this.canvas.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      this.pinching = false;
      endGesture();
    });

    this.canvas.addEventListener("pointerleave", () => {
      if (this.dragging || this.pinching) return;
      this.hoverVerse = null;
      this.render();
    });

    this.canvas.addEventListener("focus", () => this.render());
    this.canvas.addEventListener("blur", () => this.render());

    this.canvas.addEventListener("keydown", (e) => {
      if (this.state.revealed) return;
      const step = e.shiftKey ? 10 : 1;
      const current = this.state.provisionalGuess ?? this.state.viewport.center;
      let next: number | null = null;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = current - step;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") next = current + step;
      if (e.key === "PageUp") next = current - 100;
      if (e.key === "PageDown") next = current + 100;
      if (e.key === "Home") next = 1;
      if (e.key === "End") next = TOTAL_VERSES;
      if ((e.key === "Enter" || e.key === " ") && this.state.provisionalGuess != null) {
        e.preventDefault();
        this.onGuessCommit?.();
        return;
      }
      if (next != null) {
        e.preventDefault();
        this.hoverVerse = null;
        this.setProvisionalGuess(next);
      }
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.stopViewportAnimation();
        this.stopCoast();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const focus = this.state.provisionalGuess ?? this.state.viewport.center;
        this.state.viewport = zoomViewport(this.state.viewport, factor, focus);
        this.onFreeViewChange?.();
        this.render();
      },
      { passive: false }
    );

    window.addEventListener("resize", () => {
      const o = this.detectOrientation();
      if (o !== this.state.viewport.orientation) {
        this.stopViewportAnimation();
        const prev = this.state.viewport.orientation;
        // Adopting a new default span only when leaving/entering portrait
        // from a default-like zoom, so user zooms aren't clobbered mid-play.
        const wasDefault =
          Math.abs(
            this.state.viewport.span - defaultSpanForOrientation(prev)
          ) < 2;
        this.state.viewport = {
          ...this.state.viewport,
          orientation: o,
          span: wasDefault
            ? defaultSpanForOrientation(o)
            : this.state.viewport.span,
        };
        this.resize();
      } else {
        this.resize();
      }
    });
  }

  private beginPinch(): void {
    if (this.pointers.size < 2) return;
    this.stopEdgeScroll();
    this.stopCoast();
    this.dragging = false;
    this.placing = false;
    this.panning = false;
    this.pinching = true;
    this.canvas.classList.remove("is-placing");
    const [a, b] = [...this.pointers.values()];
    this.pinchStartDist = Math.hypot(
      b.clientX - a.clientX,
      b.clientY - a.clientY
    );
    this.pinchStartSpan = this.state.viewport.span;
    const midAxis = (a.axis + b.axis) / 2;
    this.pinchFocusVerse = hitTestVerse(midAxis, this.state.viewport).verseIndex;
  }

  private applyPinch(): void {
    if (this.pointers.size < 2 || this.pinchStartDist <= 0) return;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const factor = pinchZoomFactor(this.pinchStartDist, dist);
    // factor > 1 → fingers apart → zoom in (smaller span)
    const nextSpan = Math.min(
      FULL_CANON_SPAN,
      Math.max(20, this.pinchStartSpan / factor)
    );
    this.state.viewport = clampViewportToCanon({
      ...this.state.viewport,
      center: this.pinchFocusVerse,
      span: nextSpan,
    });
    this.render();
  }

  private recordMoveSample(axis: number): void {
    const t = performance.now();
    this.moveSamples.push({ t, axis });
    while (this.moveSamples.length > 6) this.moveSamples.shift();
    while (
      this.moveSamples.length > 2 &&
      t - this.moveSamples[0].t > 80
    ) {
      this.moveSamples.shift();
    }
  }

  /** Verses/ms from recent drag samples (precision flick). */
  private sampleCoastVelocity(): number {
    if (this.moveSamples.length < 2) return 0;
    const first = this.moveSamples[0];
    const last = this.moveSamples[this.moveSamples.length - 1];
    const dt = last.t - first.t;
    if (dt < 12) return 0;
    const cpp = this.state.viewport.span / Math.max(1, this.state.viewport.axisPx);
    // Finger down the rail → positive axis → toward Revelation
    return ((last.axis - first.axis) * cpp) / dt;
  }

  private startCoast(velocity: number): void {
    this.stopCoast();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.render();
      return;
    }
    this.coastVelocity = velocity;
    this.coastLastFrame = performance.now();
    const tick = (now: number): void => {
      if (this.dragging || this.pinching) {
        this.coastRaf = 0;
        return;
      }
      const dt = Math.min(40, Math.max(0, now - this.coastLastFrame));
      this.coastLastFrame = now;
      this.coastVelocity = coastVelocityAfter(this.coastVelocity, dt);
      if (Math.abs(this.coastVelocity) < 0.002) {
        this.coastRaf = 0;
        this.coastVelocity = 0;
        // Snap to nearest verse after coast
        if (this.state.provisionalGuess != null) {
          this.setProvisionalGuess(this.state.provisionalGuess);
        } else {
          this.render();
        }
        return;
      }
      const deltaVerses = this.coastVelocity * dt;
      if (this.state.provisionalGuess != null && !this.state.revealed) {
        const next = clampVerse(this.state.provisionalGuess + deltaVerses);
        if (next !== this.state.provisionalGuess) {
          hapticSelection();
          this.state.provisionalGuess = next;
          this.syncAccessibility();
          this.onGuessChange?.(next);
        }
        // Keep the precision window centered on the coasting marker
        if (this.isPrecisionView()) {
          this.state.viewport = {
            ...this.state.viewport,
            center: next,
          };
        }
      } else {
        this.state.viewport = panViewport(this.state.viewport, deltaVerses);
      }
      this.render();
      this.coastRaf = requestAnimationFrame(tick);
    };
    this.coastRaf = requestAnimationFrame(tick);
  }

  private stopCoast(): void {
    if (this.coastRaf) {
      cancelAnimationFrame(this.coastRaf);
      this.coastRaf = 0;
    }
    this.coastVelocity = 0;
  }

  /** Continuous edge auto-scroll while holding the finger in a rim zone. */
  private startEdgeScroll(): void {
    this.stopEdgeScroll();
    this.edgeScrollLastFrame = performance.now();
    const tick = (now: number): void => {
      if (!this.dragging || !this.placing) {
        this.edgeScrollRaf = 0;
        this.resetEdgeScrollRamp();
        return;
      }
      const deltaMs = Math.min(50, Math.max(0, now - this.edgeScrollLastFrame));
      this.edgeScrollLastFrame = now;
      this.applyEdgeScroll(this.lastAxis, now, deltaMs);
      this.edgeScrollRaf = requestAnimationFrame(tick);
    };
    this.edgeScrollRaf = requestAnimationFrame(tick);
  }

  private stopEdgeScroll(): void {
    if (this.edgeScrollRaf) {
      cancelAnimationFrame(this.edgeScrollRaf);
      this.edgeScrollRaf = 0;
    }
    this.resetEdgeScrollRamp();
    this.edgeScrollLastFrame = 0;
  }

  private resetEdgeScrollRamp(): void {
    this.edgeScrollDirection = 0;
    this.edgeScrollHoldStart = 0;
    this.edgeScrollCarry = 0;
  }

  /** Transition from broad canon placement into a verse-resolvable ruler. */
  private autoZoomForPrecision(focusVerse: number): void {
    this.prePrecisionViewport = { ...this.state.viewport };
    this.animateToViewport(viewportForPrecision(this.state.viewport, focusVerse));
  }

  private stopViewportAnimation(): void {
    if (this.viewportAnimFrame) {
      cancelAnimationFrame(this.viewportAnimFrame);
      this.viewportAnimFrame = 0;
    }
  }

  /**
   * If the pointer is in the top/bottom (or start/end) edge zone of the axis,
   * pan the viewport so the drag can continue past the current view.
   * Then re-hit-test so the marker stays under the finger.
   */
  private applyEdgeScroll(
    axisPxPos: number,
    now: number,
    deltaMs: number
  ): void {
    const { axisPx, span } = this.state.viewport;
    if (axisPx <= 0 || span >= FULL_CANON_SPAN) {
      this.resetEdgeScrollRamp();
      return;
    }

    const zone =
      axisPx *
      edgeZoneFraction({
        precision: this.isPrecisionView(),
        hasMarker: this.state.provisionalGuess != null,
      });
    let dir = 0; // -1 toward Genesis, +1 toward Revelation
    let intensity = 0;

    if (axisPxPos < zone) {
      dir = -1;
      intensity = (zone - axisPxPos) / zone; // 0 at zone edge → 1 at canvas start
    } else if (axisPxPos > axisPx - zone) {
      dir = 1;
      intensity = (axisPxPos - (axisPx - zone)) / zone;
    }

    if (dir === 0 || intensity <= 0) {
      this.resetEdgeScrollRamp();
      return;
    }

    if (dir !== this.edgeScrollDirection) {
      this.edgeScrollDirection = dir;
      this.edgeScrollHoldStart = now;
      this.edgeScrollCarry = 0;
    }

    // Depth controls intent; hold duration controls fast-forward acceleration.
    const depth = intensity * intensity;
    const holdMs = now - this.edgeScrollHoldStart;
    const velocity = scrubVersesPerSecond(span, holdMs);
    const requestedDelta =
      dir * velocity * depth * (deltaMs / 1000) + this.edgeScrollCarry;
    const wholeDelta =
      requestedDelta < 0
        ? Math.ceil(requestedDelta)
        : Math.floor(requestedDelta);
    this.edgeScrollCarry = requestedDelta - wholeDelta;
    if (wholeDelta === 0) return;

    const before = this.state.viewport.center;
    this.state.viewport = panViewport(this.state.viewport, wholeDelta);
    this.onFreeViewChange?.();
    if (this.state.viewport.center === before) {
      this.edgeScrollCarry = 0;
      return;
    }

    // Keep the marker under the stationary finger as content slides
    const next = hitTestVerse(axisPxPos, this.state.viewport).verseIndex;
    if (
      this.activePointerType === "touch" &&
      this.isPrecisionView() &&
      next !== this.state.provisionalGuess
    ) {
      hapticSelection();
    }
    this.setProvisionalGuess(next);
  }

  resize(): void {
    // Do not cancel viewport animations here — showing guess tools / verse reflow
    // resizes the mid-row board and must not abort autoZoomForPrecision.
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = parent.clientWidth || 320;
    const h = parent.clientHeight || 200;
    this.canvasW = w;
    this.canvasH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    this.state.viewport = {
      ...this.state.viewport,
      orientation: this.detectOrientation(),
    };
    this.syncViewportMetrics();
    this.syncAccessibility();
    this.render();
  }

  /**
   * Keep viewport.axisPx / crossPx aligned with the content band so
   * markers stay clear of the soft edge fades.
   */
  private syncViewportMetrics(): void {
    const o = this.state.viewport.orientation;
    const band = this.contentAxis();
    this.state.viewport = {
      ...this.state.viewport,
      axisPx: band.length,
      crossPx: o === "vertical" ? this.canvasW : this.canvasH,
    };
  }

  destroy(): void {
    this.ro?.disconnect();
    cancelAnimationFrame(this.animFrame);
    this.stopViewportAnimation();
    this.stopEdgeScroll();
    this.stopCoast();
    this.clearResultLinks();
    this.linkLayer?.remove();
    this.linkLayer = null;
  }

  /* ———— Geometry ———— */

  /**
   * Soft wash at canvas ends (pairs with HUD card gradients).
   * Keep a thin free-band pad for the fade; content inset is minimal so
   * the rail reads tall on mobile without sitting under the wash.
   */
  private static readonly EDGE_FADE_PX = 18;
  private static readonly MARKER_EDGE_CLEARANCE = 6;
  private static readonly CONTENT_EDGE_INSET = 4;
  private static readonly AXIS_EDGE_PAD =
    CanonStrip.EDGE_FADE_PX + CanonStrip.MARKER_EDGE_CLEARANCE;

  /** Outer free band — fades live in the margin outside this. */
  private freeAxis(): { origin: number; length: number } {
    const o = this.state.viewport.orientation;
    const pad = CanonStrip.AXIS_EDGE_PAD;
    if (o === "vertical") {
      const origin = this.chrome.top + pad;
      const length = Math.max(
        48,
        this.canvasH - this.chrome.top - this.chrome.bottom - pad * 2
      );
      return { origin, length };
    }
    const origin = this.chrome.start + pad;
    const length = Math.max(
      48,
      this.canvasW - this.chrome.start - this.chrome.end - pad * 2
    );
    return { origin, length };
  }

  /**
   * Inner band used for verse↔pixel mapping, rail, and markers.
   * Inset from freeAxis so the selection never sits in the soft edge.
   */
  private contentAxis(): { origin: number; length: number } {
    const free = this.freeAxis();
    const inset = CanonStrip.CONTENT_EDGE_INSET;
    return {
      origin: free.origin + inset,
      length: Math.max(48, free.length - inset * 2),
    };
  }

  /**
   * Cross-axis center of the free band (between chrome insets).
   * Horizontal rail: y. Vertical rail: x.
   */
  private railCross(w: number, h: number): number {
    const { top, bottom, start, end } = this.chrome;
    if (this.state.viewport.orientation === "horizontal") {
      const free = Math.max(48, h - top - bottom);
      return top + free * 0.5;
    }
    const free = Math.max(48, w - start - end);
    return start + free * 0.5;
  }

  private railThick(): number {
    // Coarse pointers get a fatter visual rail (~48–64px hit corridor feel).
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches;
    const max = coarse ? 22 : 16;
    const min = coarse ? 12 : 8;
    const frac = coarse ? 0.085 : 0.06;
    return Math.max(min, Math.min(this.state.viewport.crossPx * frac, max));
  }

  /** Verse → screen position on a straight rail (inside the content band). */
  private railPoint(ch: number, w: number, h: number): Point {
    const vp = this.state.viewport;
    const band = this.contentAxis();
    const axis =
      band.origin +
      Math.min(band.length, Math.max(0, verseToAxisPx(ch, vp)));
    const cross = this.railCross(w, h);
    if (vp.orientation === "horizontal") {
      return { x: axis, y: cross };
    }
    return { x: cross, y: axis };
  }

  private visibleRange(): { start: number; end: number } {
    const half = this.state.viewport.span / 2;
    return {
      start: Math.max(1, Math.floor(this.state.viewport.center - half) - 2),
      end: Math.min(TOTAL_VERSES, Math.ceil(this.state.viewport.center + half) + 2),
    };
  }

  private chPx(a: number, b: number): number {
    const vp = this.state.viewport;
    return (Math.abs(b - a) / vp.span) * vp.axisPx;
  }

  /* ———— Render ———— */

  render(): void {
    this.colors = palette();
    // Always paint in full canvas CSS pixels. axisPx is the free-band length
    // (inset from header/footer) and must NOT be used as canvas height — that
    // left uncleared trails of marker labels under the dock.
    const w = this.canvasW || this.state.viewport.crossPx;
    const h = this.canvasH || this.state.viewport.axisPx;
    const resultView = this.state.revealed;

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.resultLinkHits = [];

    this.drawBackground(w, h);
    // Soft clip with label slack so end-of-band markers aren't cropped.
    this.ctx.save();
    this.clipToFreeBand(w, h, 12);
    // Always keep genre-tinted segments — they orient you on the close-up
    this.drawBookSegments(w, h);
    // Result: keep seam when visible for orientation.
    // Book names stay off so marker labels aren't crowded.
    this.drawSeam(w, h);
    if (!resultView) {
      this.drawBookLabels(w, h);
    }
    this.ctx.restore();

    // Soft fades into verse / dock chrome (pairs with the HUD card gradients).
    // Painted before selection so the active marker never sits under the wash.
    this.drawEdgeFades(w, h);

    if (resultView && this.state.trueVerse != null) {
      const guess = this.state.lockedGuess;
      const truth = this.state.trueVerse;
      if (guess != null && guess !== truth) {
        this.drawConnector(guess, truth, w, h);
        // Landscape: opposite sides along the rail. Portrait: YOU left / TRUE
        // right of the rail (coordinated layout so long refs never flip
        // onto the same side and stack).
        const isH = this.state.viewport.orientation === "horizontal";
        if (isH) {
          const guessAbove = guess < truth;
          this.drawGuessMarker(
            guess,
            w,
            h,
            true,
            guessAbove ? "above" : "below"
          );
          this.drawTrueMarker(
            truth,
            w,
            h,
            guessAbove ? "below" : "above"
          );
        } else {
          const guessPt = this.railPoint(guess, w, h);
          const truePt = this.railPoint(truth, w, h);
          const pair = this.layoutPortraitResultPair(
            guessPt,
            truePt,
            formatVerseLabel(guess),
            formatVerseLabel(truth),
            w,
            h
          );
          this.drawGuessMarker(guess, w, h, true, "above", false, pair.you);
          this.drawTrueMarker(truth, w, h, "below", pair.truth);
        }
      } else {
        // Perfect hit (or missing guess) — single true marker
        this.drawTrueMarker(truth, w, h, "above");
        if (guess != null && guess === truth) {
          // Accent ring under the true diamond to mark "you were here"
          this.drawGuessMarker(guess, w, h, false);
        }
      }
    } else if (this.state.provisionalGuess != null) {
      const lifted = this.placing && this.activePointerType === "touch";
      this.drawGuessMarker(this.state.provisionalGuess, w, h, true, "above", lifted);
      if (lifted) {
        this.drawMagnifier(this.state.provisionalGuess, w, h);
      }
    }

    if (
      !resultView &&
      this.hoverVerse != null &&
      this.hoverVerse !== this.state.provisionalGuess
    ) {
      this.drawHoverMarker(this.hoverVerse, w, h);
    }

    if (!resultView && this.canvas.matches(":focus-visible")) {
      this.drawFocusIndicator(
        this.state.provisionalGuess ?? this.state.viewport.center,
        w,
        h
      );
    }

    this.syncResultLinks();
  }

  /**
   * Clip drawing to the free band, with optional slack so marker labels at the
   * band edge aren't hard-cropped.
   */
  private clipToFreeBand(w: number, h: number, slack = 0): void {
    const free = this.freeAxis();
    const { ctx } = this;
    ctx.beginPath();
    if (this.state.viewport.orientation === "vertical") {
      ctx.rect(0, free.origin - slack, w, free.length + slack * 2);
    } else {
      ctx.rect(free.origin - slack, 0, free.length + slack * 2, h);
    }
    ctx.clip();
  }

  /**
   * Soft fades at the canvas edges so the rail eases into the verse/dock
   * gradients. Drawn in the margin outside the free band (and therefore
   * outside the content band) so the selection cannot sit under the wash.
   */
  private drawEdgeFades(w: number, h: number): void {
    const { ctx } = this;
    const fade = CanonStrip.EDGE_FADE_PX;
    const free = this.freeAxis();
    const bg = this.colors.bg;

    ctx.save();
    if (this.state.viewport.orientation === "vertical") {
      const topH = Math.min(fade, free.origin);
      if (topH > 0) {
        const topGrad = ctx.createLinearGradient(0, 0, 0, topH);
        topGrad.addColorStop(0, bg);
        topGrad.addColorStop(1, withAlpha(bg, 0));
        ctx.fillStyle = topGrad;
        ctx.fillRect(0, 0, w, topH);
      }

      const freeEnd = free.origin + free.length;
      const botH = Math.min(fade, Math.max(0, h - freeEnd));
      if (botH > 0) {
        const botStart = h - botH;
        const botGrad = ctx.createLinearGradient(0, botStart, 0, h);
        botGrad.addColorStop(0, withAlpha(bg, 0));
        botGrad.addColorStop(1, bg);
        ctx.fillStyle = botGrad;
        ctx.fillRect(0, botStart, w, botH);
      }
    } else {
      const startW = Math.min(fade, free.origin);
      if (startW > 0) {
        const startGrad = ctx.createLinearGradient(0, 0, startW, 0);
        startGrad.addColorStop(0, bg);
        startGrad.addColorStop(1, withAlpha(bg, 0));
        ctx.fillStyle = startGrad;
        ctx.fillRect(0, 0, startW, h);
      }

      const freeEnd = free.origin + free.length;
      const endW = Math.min(fade, Math.max(0, w - freeEnd));
      if (endW > 0) {
        const endStart = w - endW;
        const endGrad = ctx.createLinearGradient(endStart, 0, w, 0);
        endGrad.addColorStop(0, withAlpha(bg, 0));
        endGrad.addColorStop(1, bg);
        ctx.fillStyle = endGrad;
        ctx.fillRect(endStart, 0, endW, h);
      }
    }
    ctx.restore();
  }

  /* ———— 1. Background ———— */

  private drawBackground(w: number, h: number): void {
    const { ctx } = this;
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, w, h);
  }

  /* ———— 2. Rail + book segments ———— */

  private drawBookSegments(w: number, h: number): void {
    const { ctx } = this;
    const vp = this.state.viewport;
    const range = this.visibleRange();
    const isH = vp.orientation === "horizontal";
    const thick = this.railThick();
    const cross = this.railCross(w, h);
    const band = this.contentAxis();

    // Rail base — content band (inset from soft fades)
    ctx.fillStyle = this.colors.rail;
    if (isH) {
      ctx.fillRect(band.origin, cross - thick / 2, band.length, thick);
    } else {
      ctx.fillRect(cross - thick / 2, band.origin, thick, band.length);
    }

    // Genre segments — full color in overview; slightly softer in precision
    // so a single-genre close-up doesn't turn into a solid slab.
    const precision = vp.span <= PRECISION_THRESHOLD;
    for (const seg of bookSegments()) {
      if (seg.endVerseIndex < range.start || seg.startVerseIndex > range.end) continue;
      const from = Math.max(seg.startVerseIndex, range.start);
      const to = Math.min(seg.endVerseIndex, range.end);
      const fromPx = this.railPoint(from, w, h);
      const toPx = this.railPoint(to + 1, w, h);
      const len = isH ? toPx.x - fromPx.x : toPx.y - fromPx.y;
      if (len < 1) continue;

      const tint = this.colors.genre(seg.genre);
      ctx.save();
      ctx.globalAlpha = precision ? 0.9 : 1;
      ctx.fillStyle = tint;
      if (isH) {
        ctx.fillRect(fromPx.x, cross - thick / 2, len, thick);
      } else {
        ctx.fillRect(cross - thick / 2, fromPx.y, thick, len);
      }
      ctx.restore();
    }

    if (!precision) {
      this.drawGenreLabels(range, w, h, cross, isH);
    }

    if (vp.span <= PRECISION_THRESHOLD) {
      this.drawChapterLabels(range, w, h, cross, thick, isH);
      this.drawVerseNotches(range, w, h, cross, thick, isH);
    }
  }

  /** Quiet orientation labels centered inside contiguous genre bands. */
  private drawGenreLabels(
    range: { start: number; end: number },
    w: number,
    h: number,
    cross: number,
    isH: boolean
  ): void {
    const groups: Array<{ genre: string; start: number; end: number }> = [];
    for (const seg of bookSegments()) {
      const current = groups[groups.length - 1];
      if (current?.genre === seg.genre) {
        current.end = seg.endVerseIndex;
      } else {
        groups.push({
          genre: seg.genre,
          start: seg.startVerseIndex,
          end: seg.endVerseIndex,
        });
      }
    }

    const { ctx } = this;
    ctx.save();
    // Light: dark ink on mid-light tints. Dark: soft white on mid-dark bands.
    ctx.font = `700 7.5px ${SERIF}`;
    ctx.fillStyle =
      resolvedTheme() === "dark"
        ? "rgba(255, 255, 255, 0.82)"
        : "rgba(47, 42, 37, 0.42)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, "1px");

    for (const group of groups) {
      if (group.end < range.start || group.start > range.end) continue;
      const start = Math.max(group.start, range.start);
      const end = Math.min(group.end, range.end);
      const lengthPx = this.chPx(start, end + 1);
      const label = group.genre.toUpperCase();
      if (lengthPx < Math.max(48, ctx.measureText(label).width + 20)) continue;
      const p = this.railPoint((start + end) / 2, w, h);
      ctx.save();
      if (isH) {
        ctx.fillText(label, p.x, cross, lengthPx - 12);
      } else {
        ctx.translate(cross, p.y);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0, lengthPx - 12);
      }
      ctx.restore();
    }

    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /** Label every sufficiently visible chapter through one collision-bounded path. */
  private drawChapterLabels(
    range: { start: number; end: number },
    w: number,
    h: number,
    cross: number,
    thick: number,
    isH: boolean
  ): void {
    const chapters: Array<{
      osis: string;
      bookName: string;
      chapter: number;
      start: number;
      end: number;
    }> = [];

    for (let verseIndex = range.start; verseIndex <= range.end; verseIndex += 1) {
      const loc = bookChapterVerseFromIndex(verseIndex);
      if (!loc) continue;
      const key = `${loc.book.osis}:${loc.chapter}`;
      const current = chapters[chapters.length - 1];
      if (current && `${current.osis}:${current.chapter}` === key) {
        current.end = verseIndex;
      } else {
        chapters.push({
          osis: loc.book.osis,
          bookName: loc.book.name,
          chapter: loc.chapter,
          start: verseIndex,
          end: verseIndex,
        });
      }
    }

    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = this.colors.ink2;
    ctx.globalAlpha = 0.9;
    ctx.font = `600 10px ${SERIF}`;
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, "0.6px");

    const minGap = isH ? 18 : 15;
    let lastKept = -Infinity;

    for (const chapter of chapters) {
      const lengthPx = this.chPx(chapter.start, chapter.end + 1);
      const selected =
        this.state.provisionalGuess != null &&
        this.state.provisionalGuess >= chapter.start &&
        this.state.provisionalGuess <= chapter.end;
      // Always retain the selected chapter as a stable orientation anchor.
      // The live verse reference may overlap it briefly; continuity while
      // scrubbing is more useful than collision avoidance here.
      if (!selected && lengthPx < 20) {
        continue;
      }

      // Anchor at chapter start (same as overview book labels), not mid-span.
      const p = this.railPoint(chapter.start, w, h);
      const axis = isH ? p.x : p.y;
      if (!selected && axis - lastKept < minGap) continue;
      lastKept = axis;

      const label = `${chapter.bookName} ${chapter.chapter}`.toUpperCase();
      if (isH) {
        // Wide: below the rail with the notch ruler (same side).
        const free = this.freeAxis();
        const labelX = Math.min(
          free.origin + free.length - 8,
          Math.max(free.origin + 8, p.x)
        );
        const y =
          cross + thick / 2 + NOTCH_GAP + ACTIVE_NOTCH_LENGTH + 6;
        const available = Math.max(
          40,
          (this.canvasH || h) - y - this.chrome.bottom - 4
        );
        ctx.save();
        ctx.translate(labelX, y);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, 0, available);
        ctx.restore();
      } else {
        // Portrait: chapter names left of the rail (with the notch ruler).
        const x =
          cross - thick / 2 - NOTCH_GAP - ACTIVE_NOTCH_LENGTH - 10;
        // Top baseline at chapter start → name begins on the chapter, not above it.
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(label, x, p.y + 1, Math.max(48, x - 6));
      }
    }

    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /**
   * One snap notch per verse. The ruler sits beside the rail, following the
   * supplied reference: short neutral ticks, longer milestones, dark active.
   */
  private drawVerseNotches(
    range: { start: number; end: number },
    w: number,
    h: number,
    cross: number,
    thick: number,
    isH: boolean
  ): void {
    const { ctx } = this;
    ctx.save();

    for (let verseIndex = range.start; verseIndex <= range.end; verseIndex += 1) {
      const p = this.railPoint(verseIndex, w, h);
      const loc = bookChapterVerseFromIndex(verseIndex);
      const chapterStart = loc?.verse === 1;
      const milestone = loc != null && loc.verse % 5 === 0;
      const selected = verseIndex === this.state.provisionalGuess;
      const hovered = verseIndex === this.hoverVerse;
      const length = selected
        ? ACTIVE_NOTCH_LENGTH
        : chapterStart
          ? 22
          : milestone
            ? 16
            : hovered
              ? 14
              : 10;
      ctx.strokeStyle = selected ? this.colors.ink : chapterStart ? this.colors.ink2 : this.colors.ink3;
      ctx.globalAlpha = selected ? 1 : chapterStart ? 0.62 : milestone ? 0.45 : hovered ? 0.38 : 0.28;
      ctx.lineWidth = selected ? 2.5 : chapterStart ? 1.5 : 1;
      ctx.beginPath();
      if (isH) {
        const start = cross + thick / 2 + NOTCH_GAP;
        ctx.moveTo(p.x, start);
        ctx.lineTo(p.x, start + length);
      } else {
        // Portrait: notches on the left of the rail (book/chapter column).
        const start = cross - thick / 2 - NOTCH_GAP;
        ctx.moveTo(start, p.y);
        ctx.lineTo(start - length, p.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ———— 3. Testament seam ———— */

  private drawSeam(w: number, h: number): void {
    const { ctx } = this;
    const vp = this.state.viewport;
    const range = this.visibleRange();
    const seam = TESTAMENT_SEAM_AFTER + 0.5;
    if (seam < range.start - 4 || seam > range.end + 4) return;

    const p = this.railPoint(seam, w, h);
    const thick = this.railThick();
    const isH = vp.orientation === "horizontal";

    ctx.strokeStyle = this.colors.ink3;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    if (isH) {
      ctx.moveTo(p.x, p.y - thick);
      ctx.lineTo(p.x, p.y + thick);
    } else {
      ctx.moveTo(p.x - thick, p.y);
      ctx.lineTo(p.x + thick, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (this.chPx(seam - 6, seam + 6) > 70) {
      ctx.fillStyle = this.colors.ink3;
      ctx.font = `italic 9px ${SERIF}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labelY = isH ? p.y + thick + 16 : p.y;
      const labelX = isH ? p.x : p.x + thick + 16;
      ctx.fillText("OT / NT", labelX, labelY);
    }
  }

  /* ———— 4. Book labels ———— */

  private drawBookLabels(w: number, h: number): void {
    const { ctx } = this;
    const vp = this.state.viewport;
    const range = this.visibleRange();
    const isH = vp.orientation === "horizontal";
    const thick = this.railThick();
    /** Gap from rail edge to label (px). */
    const gap = 6;
    /** Minimum spacing between book-name anchors along the rail. */
    // Wide hangs labels below (tighter). Portrait: 12 keeps Joshua without
    // crowding 1 Samuel / 1 Kings / 1 Chronicles.
    const minGap = isH ? 10 : 12;

    // Chapter labels own the precision view; avoid a competing book label.
    if (vp.span <= PRECISION_THRESHOLD) return;

    type Candidate = OverviewLabelCandidate & { p: Point };
    const candidates: Candidate[] = [];
    for (const seg of bookSegments()) {
      // Anchor at the book start — skip if that edge isn't on-screen
      if (
        seg.startVerseIndex < range.start ||
        seg.startVerseIndex > range.end
      ) {
        continue;
      }
      const lenPx = this.chPx(seg.startVerseIndex, seg.endVerseIndex + 1);
      // Keep short books quiet, but retain enough landmarks to navigate the
      // full-canon overview — including several through the Epistles.
      if (!isOverviewBookLabelCandidate(lenPx, seg.osis, vp.orientation)) {
        continue;
      }
      const p = this.railPoint(seg.startVerseIndex, w, h);
      candidates.push({
        osis: seg.osis,
        name: seg.name,
        axis: isH ? p.x : p.y,
        p,
        lenPx,
        landmark: OVERVIEW_LANDMARK_OSIS.has(seg.osis),
      });
    }

    const kept = pickOverviewBookLabels(candidates, minGap);

    ctx.save();
    ctx.font = `600 9px ${SERIF}`;
    setLetterSpacing(ctx, "0.5px");
    ctx.textBaseline = "middle";

    for (const c of kept) {
      // Longer books stay fullest; short landmarks still need readable contrast.
      const alpha = Math.min(1, 0.78 + (c.lenPx - 14) / 280);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.colors.ink2;
      ctx.save();
      if (isH) {
        // Wide: below the rail at book start (same side as precision notches).
        ctx.translate(c.p.x, c.p.y + thick / 2 + gap);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = "left";
        ctx.fillText(c.name.toUpperCase(), 0, 0);
      } else {
        // Portrait: book names always left of the rail (selection owns the right).
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(
          c.name.toUpperCase(),
          c.p.x - thick / 2 - gap,
          c.p.y + 1
        );
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /* ———— 5. Edge labels (removed) ———— */
  // Overview start/end chips ("GENESIS 1" / "REVELATION 22") cluttered the
  // book-name column; book + genre labels carry orientation instead.

  /* ———— 6. Guess marker ———— */

  private drawGuessMarker(
    ch: number,
    w: number,
    h: number,
    withLabel: boolean,
    labelSide: "above" | "below" = "above",
    lifted = false,
    chipLayout?: ResultChipLayout
  ): void {
    const { ctx } = this;
    const p = this.railPoint(ch, w, h);
    const result = this.state.revealed;

    // White pin while placing; revealed YOU stays accent vs TRUE green.
    ctx.fillStyle = result ? this.colors.accent : "#ffffff";
    diamond(ctx, p.x, p.y, result ? 9 : lifted ? 8 : 6);
    ctx.fill();
    if (result) {
      // White inner ring so the pin reads against the rail
      ctx.strokeStyle = this.colors.bg;
      ctx.lineWidth = 1.5;
      diamond(ctx, p.x, p.y, 9);
      ctx.stroke();
      ctx.fillStyle = this.colors.accent;
      diamond(ctx, p.x, p.y, 6.5);
      ctx.fill();
    } else {
      // Hairline so the white diamond reads on light rails.
      ctx.strokeStyle = this.colors.ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      diamond(ctx, p.x, p.y, lifted ? 8 : 6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (withLabel) {
      if (result) {
        this.drawResultLabel(
          ch,
          "You",
          p,
          w,
          h,
          this.colors.accentDeep,
          labelSide,
          chipLayout
        );
      } else {
        this.drawSelectionLabel(ch, p, this.placing, lifted);
      }
    }
  }

  private drawHoverMarker(ch: number, w: number, h: number): void {
    const { ctx } = this;
    const p = this.railPoint(ch, w, h);
    ctx.save();
    ctx.strokeStyle = this.colors.ink2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    diamond(ctx, p.x, p.y, 5);
    ctx.stroke();
    ctx.restore();
  }

  private drawFocusIndicator(ch: number, w: number, h: number): void {
    if (this.state.provisionalGuess != null) return;
    const { ctx } = this;
    const p = this.railPoint(ch, w, h);
    ctx.save();
    ctx.strokeStyle = this.colors.accent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    diamond(ctx, p.x, p.y, 6);
    ctx.stroke();
    ctx.restore();
  }

  /* ———— 7. True marker ———— */

  private drawTrueMarker(
    ch: number,
    w: number,
    h: number,
    labelSide: "above" | "below" = "above",
    chipLayout?: ResultChipLayout
  ): void {
    const { ctx } = this;
    const p = this.railPoint(ch, w, h);
    const k = this.state.revealed ? Math.max(this.revealProgress, 0.05) : 1;

    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = this.colors.success;
    diamond(ctx, p.x, p.y, 9 + 2 * (1 - k));
    ctx.fill();
    ctx.strokeStyle = this.colors.bg;
    ctx.lineWidth = 1.5;
    diamond(ctx, p.x, p.y, 9);
    ctx.stroke();
    ctx.fillStyle = this.colors.success;
    diamond(ctx, p.x, p.y, 6.5);
    ctx.fill();
    ctx.restore();

    if (k > 0.5) {
      ctx.save();
      ctx.globalAlpha = k;
      this.drawResultLabel(
        ch,
        "True",
        p,
        w,
        h,
        this.colors.successDeep,
        labelSide,
        chipLayout
      );
      ctx.restore();
    }
  }

  /* ———— 8. Marker label ———— */

  /**
   * Selection callout:
   * - Wide: compact rotated ref at the pin (pre-experiment landscape).
   * - Portrait scrubbing: compact upright full ref at the pin (right of rail).
   * - Portrait settled: large rotated full ref on the right of the rail.
   */
  private drawSelectionLabel(
    verseIndex: number,
    p: Point,
    scrubbing: boolean,
    lifted = false
  ): void {
    const text = formatVerseLabel(verseIndex).toUpperCase();
    if (this.state.viewport.orientation === "horizontal") {
      this.drawWidePinLabel(text, p, lifted);
      return;
    }
    if (scrubbing) {
      this.drawScrubPinLabel(text, p, lifted);
      return;
    }
    this.drawSettledRefLabel(text, p, lifted);
  }

  /** Wide: compact rotated reference at the pin, above (notches/chapters own below). */
  private drawWidePinLabel(text: string, p: Point, lifted: boolean): void {
    const { ctx } = this;
    const offset = this.railThick() / 2 + NOTCH_GAP;

    ctx.save();
    ctx.fillStyle = selectionTextColor(this.colors.accentDeep);
    ctx.font = `600 ${lifted ? 12 : 10}px ${SERIF}`;
    setLetterSpacing(ctx, "0.5px");
    ctx.textBaseline = "middle";

    const y = p.y - offset;
    const available = Math.max(40, y - this.chrome.top - 4);
    ctx.translate(p.x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "left";
    ctx.fillText(text, 0, 0, available);

    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /** Compact upright reference right of the pin — portrait scrub only. */
  private drawScrubPinLabel(text: string, p: Point, lifted: boolean): void {
    const { ctx } = this;
    const offset = this.railThick() / 2 + NOTCH_GAP + 6;
    const w = this.canvasW || this.state.viewport.crossPx;

    ctx.save();
    ctx.fillStyle = selectionTextColor(this.colors.accentDeep);
    ctx.font = `700 ${lifted ? 16 : 14}px ${SERIF}`;
    setLetterSpacing(ctx, "0.4px");
    ctx.textBaseline = "middle";

    const x = p.x + offset - 6;
    ctx.textAlign = "left";
    ctx.fillText(text, x, p.y, Math.max(48, w - x - 4));

    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /**
   * Large rotated full reference on the right of the portrait rail.
   * +90° so letter bases face the rail; books/notches keep the left.
   */
  private drawSettledRefLabel(text: string, p: Point, lifted: boolean): void {
    const { ctx } = this;
    const size = lifted ? 36 : 30;
    const band = this.contentAxis();
    const axisMid = band.origin + band.length / 2;
    const w = this.canvasW || this.state.viewport.crossPx;

    ctx.save();
    ctx.fillStyle = selectionTextColor(this.colors.accentDeep);
    ctx.font = `600 ${size}px ${SERIF}`;
    setLetterSpacing(ctx, "0.06em");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const x = Math.min(w - 20, p.x + this.railThick() / 2 + 24);
    ctx.translate(x, axisMid);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(text, 0, 0, Math.max(96, band.length * 0.9));

    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /**
   * Touch loupe: magnified local neighborhood offset from the finger so the
   * verse under the thumb stays readable (mobile-first ADR).
   */
  private drawMagnifier(focusVerse: number, w: number, h: number): void {
    const { ctx } = this;
    const isH = this.state.viewport.orientation === "horizontal";
    const p = this.railPoint(focusVerse, w, h);
    const r = 58;
    // Offset away from typical thumb occlusion and book-name column.
    const cx = isH
      ? Math.min(w - r - 8, Math.max(r + 8, p.x))
      : Math.min(w - r - 10, p.x + r + 28);
    const cy = isH
      ? Math.max(r + 8 + this.chrome.top, p.y - r - 36)
      : Math.min(
          h - r - 8 - this.chrome.bottom,
          Math.max(r + 8 + this.chrome.top, p.y - 28)
        );

    const halfSpan = this.state.viewport.span > PRECISION_THRESHOLD ? 28 : 12;
    const startV = clampVerse(focusVerse - halfSpan);
    const endV = clampVerse(focusVerse + halfSpan);
    const span = Math.max(1, endV - startV);

    ctx.save();
    // Soft shadow
    ctx.beginPath();
    ctx.arc(cx + 1, cy + 2, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(47, 42, 37, 0.12)";
    ctx.fill();

    // Lens disk
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = this.colors.bg;
    ctx.fill();
    ctx.strokeStyle = this.colors.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
    ctx.clip();

    // Mini rail through the lens
    const thick = 10;
    ctx.fillStyle = this.colors.rail;
    if (isH) {
      ctx.fillRect(cx - r, cy - thick / 2, r * 2, thick);
    } else {
      ctx.fillRect(cx - thick / 2, cy - r, thick, r * 2);
    }

    const loc = bookChapterVerseFromIndex(focusVerse);
    if (loc) {
      ctx.fillStyle = this.colors.genre(loc.book.genre);
      if (isH) {
        ctx.fillRect(cx - r, cy - thick / 2, r * 2, thick);
      } else {
        ctx.fillRect(cx - thick / 2, cy - r, thick, r * 2);
      }
    }

    // Verse notches across the lens
    ctx.strokeStyle = this.colors.ink3;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    for (let v = startV; v <= endV; v += 1) {
      const t = (v - startV) / span;
      if (isH) {
        const x = cx - r + t * r * 2;
        const long = v === focusVerse;
        ctx.beginPath();
        ctx.moveTo(x, cy + (long ? thick / 2 + 2 : thick / 2));
        ctx.lineTo(x, cy + (long ? thick / 2 + 14 : thick / 2 + 7));
        ctx.stroke();
      } else {
        const y = cy - r + t * r * 2;
        const long = v === focusVerse;
        ctx.beginPath();
        ctx.moveTo(cx + (long ? thick / 2 + 2 : thick / 2), y);
        ctx.lineTo(cx + (long ? thick / 2 + 14 : thick / 2 + 7), y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Center diamond
    ctx.fillStyle = "#ffffff";
    diamond(ctx, cx, cy, 7);
    ctx.fill();
    ctx.strokeStyle = this.colors.ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    diamond(ctx, cx, cy, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Label inside lens
    const label = formatVerseLabel(focusVerse);
    ctx.fillStyle = selectionTextColor(this.colors.accentDeep);
    ctx.font = `600 11px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (isH) {
      ctx.fillText(label, cx, cy + thick / 2 + 22, r * 1.6);
    } else {
      ctx.fillText(label, cx, cy + r - 16, r * 1.6);
    }

    ctx.restore();

    // Outer ring after clip restore
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = selectionTextColor(this.colors.accentDeep);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Natural size of a YOU/TRUE result chip (before side-fit shrink). */
  private measureResultChip(verseLabel: string, role: string): {
    bw: number;
    bh: number;
    ref: string;
    roleText: string;
  } {
    const { ctx } = this;
    // Match .result-ref-link typography (section-label + compact ref).
    const ref = verseLabel.toUpperCase();
    const roleText = role.toUpperCase();
    ctx.save();
    ctx.font = `600 12.5px ${SERIF}`;
    setLetterSpacing(ctx, "0.3px");
    const refW = ctx.measureText(ref).width;
    ctx.font = `600 11px ${SERIF}`;
    setLetterSpacing(ctx, "0.7px");
    const roleW = ctx.measureText(roleText).width;
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    const padX = 10;
    const padY = 7;
    const gap = 3;
    const roleH = 12;
    const refH = 15;
    return {
      bw: Math.max(refW, roleW) + padX * 2,
      bh: padY * 2 + roleH + gap + refH,
      ref,
      roleText,
    };
  }

  /**
   * Portrait pair layout: YOU always left of the rail, TRUE always right.
   * Long refs shrink into their half instead of flipping sides (which caused
   * stacked/overlapping chips on close or mid-distance misses).
   * When pin Ys are near enough that chips would still collide, push apart.
   */
  private layoutPortraitResultPair(
    guessPt: Point,
    truePt: Point,
    guessLabel: string,
    trueLabel: string,
    w: number,
    _h: number
  ): { you: ResultChipLayout; truth: ResultChipLayout } {
    const free = this.freeAxis();
    const crossGap = this.railThick() / 2 + 12;
    const youM = this.measureResultChip(guessLabel, "You");
    const trueM = this.measureResultChip(trueLabel, "True");
    const minChipW = 56;
    const edge = 4;
    const yGap = 8;

    const placeBeside = (
      pin: Point,
      naturalW: number,
      bh: number,
      side: "left" | "right"
    ): ResultChipLayout => {
      // Prefer the pin's rail x so both chips bookend the same spine.
      const railX = pin.x;
      let bw: number;
      let bx: number;
      if (side === "left") {
        const rightEdge = railX - crossGap;
        const maxBw = Math.max(minChipW, rightEdge - edge);
        bw = Math.min(naturalW, maxBw);
        bx = rightEdge - bw;
        if (bx < edge) {
          bx = edge;
          bw = Math.max(minChipW, Math.min(bw, rightEdge - edge));
        }
      } else {
        const leftEdge = railX + crossGap;
        const maxBw = Math.max(minChipW, w - edge - leftEdge);
        bw = Math.min(naturalW, maxBw);
        bx = leftEdge;
        if (bx + bw > w - edge) {
          bw = Math.max(minChipW, Math.min(bw, w - edge - leftEdge));
          bx = Math.min(leftEdge, w - edge - bw);
          // Never cross onto the left half of the rail.
          if (bx < leftEdge) bx = leftEdge;
        }
      }
      let by = pin.y - bh / 2;
      by = Math.min(
        free.origin + free.length - bh - 2,
        Math.max(free.origin + 2, by)
      );
      return { bx, by, bw, bh };
    };

    const you = placeBeside(guessPt, youM.bw, youM.bh, "left");
    const truth = placeBeside(truePt, trueM.bw, trueM.bh, "right");

    // Vertical separation when chips still collide (near-miss pins).
    const overlapY =
      you.by < truth.by + truth.bh + yGap &&
      truth.by < you.by + you.bh + yGap;
    if (overlapY) {
      const youCenter = you.by + you.bh / 2;
      const trueCenter = truth.by + truth.bh / 2;
      // Keep relative order of pins; if equal, YOU above TRUE.
      const youFirst =
        guessPt.y < truePt.y - 0.5 ||
        (Math.abs(guessPt.y - truePt.y) <= 0.5 && youCenter <= trueCenter);
      const top = youFirst ? you : truth;
      const bot = youFirst ? truth : you;
      const needed = top.by + top.bh + yGap;
      if (bot.by < needed) {
        const push = needed - bot.by;
        bot.by += push;
        const maxBy = free.origin + free.length - bot.bh - 2;
        if (bot.by > maxBy) {
          const overflow = bot.by - maxBy;
          bot.by = maxBy;
          top.by = Math.max(free.origin + 2, top.by - overflow);
        }
      }
    }

    return { you, truth };
  }

  /**
   * Result-page callout stem + hit box.
   * Chip chrome lives in the DOM (.result-ref-link) so it shares panel /
   * button material with achievements. Canvas only draws the hairline stem.
   * Portrait: YOU left / TRUE right via layoutPortraitResultPair.
   */
  private drawResultLabel(
    verseIndex: number,
    role: string,
    p: Point,
    w: number,
    h: number,
    ink: string,
    side: "above" | "below" = "above",
    chipLayout?: ResultChipLayout
  ): void {
    const { ctx } = this;
    const free = this.freeAxis();
    const isV = this.state.viewport.orientation === "vertical";
    const isYou = role.toLowerCase() === "you";
    const verseLabel = formatVerseLabel(verseIndex);
    const metrics = this.measureResultChip(verseLabel, role);

    const stem = 14;
    const crossGap = this.railThick() / 2 + 12;

    let bx: number;
    let by: number;
    let bw = metrics.bw;
    const bh = metrics.bh;

    if (chipLayout) {
      bx = chipLayout.bx;
      by = chipLayout.by;
      bw = chipLayout.bw;
    } else if (isV) {
      // Solo portrait label (perfect hit / single marker): prefer role side.
      by = p.y - bh / 2;
      by = Math.min(
        free.origin + free.length - bh - 2,
        Math.max(free.origin + 2, by)
      );
      const minChipW = 56;
      const edge = 4;
      if (isYou) {
        const rightEdge = p.x - crossGap;
        const maxBw = Math.max(minChipW, rightEdge - edge);
        bw = Math.min(bw, maxBw);
        bx = Math.max(edge, rightEdge - bw);
      } else {
        const leftEdge = p.x + crossGap;
        const maxBw = Math.max(minChipW, w - edge - leftEdge);
        bw = Math.min(bw, maxBw);
        bx = leftEdge;
        if (bx + bw > w - edge) bx = Math.max(leftEdge, w - edge - bw);
      }
    } else {
      bx = p.x - bw / 2;
      by = side === "above" ? p.y - bh - stem : p.y + stem;
      if (by < 4) by = p.y + stem;
      if (by + bh > h - 4) by = p.y - bh - stem;
      const minX = free.origin + 2;
      const maxX = free.origin + free.length - bw - 2;
      bx = Math.min(maxX, Math.max(minX, bx));
      bx = Math.min(Math.max(4, bx), w - bw - 4);
    }

    // Hairline stem toward the pin (role color → diamond)
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (isV) {
      const chipOnLeft = bx + bw / 2 <= p.x;
      const chipEdgeX = chipOnLeft ? bx + bw : bx;
      const pinEdgeX = chipOnLeft ? p.x - 10 : p.x + 10;
      const midY = Math.min(Math.max(p.y, by + 6), by + bh - 6);
      ctx.moveTo(chipEdgeX, midY);
      ctx.lineTo(pinEdgeX, p.y);
    } else {
      const stemX = Math.min(Math.max(p.x, bx + 8), bx + bw - 8);
      if (side === "above" || by + bh < p.y) {
        ctx.moveTo(stemX, by + bh);
        ctx.lineTo(p.x, p.y - 10);
      } else {
        ctx.moveTo(stemX, by);
        ctx.lineTo(p.x, p.y + 10);
      }
    }
    ctx.stroke();
    ctx.restore();

    this.resultLinkHits.push({
      verseIndex,
      bx,
      by,
      bw,
      bh,
      role,
    });
  }

  private clearResultLinks(): void {
    this.resultLinkHits = [];
    if (this.linkLayer) this.linkLayer.replaceChildren();
  }

  /**
   * DOM chips over YOU/TRUE markers → route.bible.
   * Real links so long-press / open-in-new-tab / a11y all work; chrome
   * matches secondary panel / button material via CSS.
   */
  private syncResultLinks(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    if (!this.linkLayer) {
      this.linkLayer = document.createElement("div");
      this.linkLayer.className = "result-link-layer";
      parent.appendChild(this.linkLayer);
    }

    this.linkLayer.replaceChildren();
    if (!this.state.revealed || this.resultLinkHits.length === 0) return;

    for (const hit of this.resultLinkHits) {
      const href = routeBibleUrl(hit.verseIndex);
      if (!href) continue;
      const label = formatVerseLabel(hit.verseIndex);
      const roleKey = hit.role.toLowerCase() === "you" ? "you" : "true";
      const a = document.createElement("a");
      a.className = `result-ref-link result-ref-link--${roleKey}`;
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `Open ${label} on route.bible`;
      a.setAttribute(
        "aria-label",
        `${hit.role}: ${label}. Open on route.bible`
      );
      const roleEl = document.createElement("span");
      roleEl.className = "result-ref-role";
      roleEl.textContent = hit.role;
      const verseEl = document.createElement("span");
      verseEl.className = "result-ref-verse";
      verseEl.textContent = label;
      a.append(roleEl, verseEl);
      a.style.left = `${hit.bx}px`;
      a.style.top = `${hit.by}px`;
      a.style.width = `${hit.bw}px`;
      a.style.height = `${hit.bh}px`;
      // TRUE fades in with the reveal animation; YOU is immediate.
      if (roleKey === "true") {
        a.style.opacity = String(Math.max(this.revealProgress, 0.05));
      }
      // Keep canvas from starting a pan when the chip is pressed.
      a.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      this.linkLayer.appendChild(a);
    }
  }

  private syncAccessibility(): void {
    const value = this.state.provisionalGuess ?? this.state.viewport.center;
    this.canvas.setAttribute("aria-valuemin", "1");
    this.canvas.setAttribute("aria-valuemax", String(TOTAL_VERSES));
    this.canvas.setAttribute("aria-valuenow", String(value));
    this.canvas.setAttribute(
      "aria-valuetext",
      this.state.revealed && this.state.trueVerse != null
        ? `Your guess: ${formatVerseLabel(value)}. Correct location: ${formatVerseLabel(this.state.trueVerse)}.`
        : this.state.provisionalGuess == null
          ? "No marker placed"
          : formatVerseLabel(this.state.provisionalGuess)
    );
    this.canvas.setAttribute("aria-disabled", this.state.revealed ? "true" : "false");
    this.canvas.setAttribute("aria-orientation", this.state.viewport.orientation);
    this.canvas.setAttribute(
      "aria-keyshortcuts",
      "ArrowUp ArrowDown ArrowLeft ArrowRight PageUp PageDown Home End Enter"
    );
  }

  /* ———— 9. Distance connector (guess → truth) ———— */

  private drawConnector(guess: number, truth: number, w: number, h: number): void {
    const { ctx } = this;
    const k = this.revealProgress;
    if (k <= 0.02 || guess === truth) return;
    const toCh = guess + (truth - guess) * Math.min(1, k * 1.25);
    const from = this.railPoint(guess, w, h);
    const to = this.railPoint(toCh, w, h);
    ctx.save();
    ctx.strokeStyle = this.colors.ink;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/* ———— Helper functions ———— */

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, v: string): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = v;
}

/** Apply alpha to a CSS color for canvas gradient stops. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  if (color.startsWith("oklch(")) {
    // "oklch(" is 6 chars — slice(5) left a stray "(" and broke canvas gradients.
    const inner = color.slice(6, -1).trim();
    if (inner.includes("/")) {
      return `oklch(${inner.replace(/\/[^/]*$/, `/ ${a}`)})`;
    }
    return `oklch(${inner} / ${a})`;
  }
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex =
      color.length === 4
        ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
        : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
