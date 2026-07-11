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
  viewportForZoomPreset,
  viewportForPrecision,
  viewportForRange,
  viewportFullCanon,
  portraitRailCross,
  isQuickScrollHit,
  quickScrollVerse,
  verseToT,
  QUICK_SCROLL_HIT,
  selectBookAnchors,
} from "./axis";
import {
  TOTAL_VERSES,
  TESTAMENT_SEAM_AFTER,
  bookChapterVerseFromIndex,
  formatVerseLabel,
  routeBibleUrl,
} from "./books";
import { hapticLight, hapticSelection } from "./haptics";

/* ———— Constants ———— */

const ACCENT = "#b85a20";
const ACCENT_DEEP = "#8f4516";
const SUCCESS = "#5a8a3a";
const SUCCESS_DEEP = "#3f6a28";
const INK = "#2f2a25";
const INK_2 = "#6e655a";
const INK_3 = "#9a9088";
const RAIL = "#e8e4de";
const BG = "#faf8f4";
const SERIF = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif';
const REVEAL_MS = 800;
const PRECISION_ZOOM_MS = 220;
/** Span at or below this counts as precision (must cover viewportForPrecision). */
const PRECISION_THRESHOLD = 180;
const NOTCH_GAP = 8;
const ACTIVE_NOTCH_LENGTH = 28;
/** Shared gap from the portrait rail edge to the label column. */
const PORTRAIT_LABEL_GAP = 8;
/** Minimum vertical gap between portrait overview labels. */
const PORTRAIT_LABEL_MIN_GAP = 13;

/** Genre segment tints — soft but readable warm/cool bands along the rail. */
const GENRE_TINT: Record<string, string> = {
  law: "#c5d6b8",
  history: "#e8d4a4",
  poetry: "#d4c4e6",
  prophets: "#e8c49a",
  gospels: "#edd08c",
  epistles: "#b8d4c4",
};

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
  private dragging = false;
  /** While true, drag moves the marker; edge zones may auto-scroll. */
  private placing = false;
  /** Free-pan mode after reveal (or explicit pan without a marker). */
  private panning = false;
  /** Portrait quick-scroll: full-canon jump via the right-edge track. */
  private quickScrolling = false;
  private lastAxis = 0;
  private hoverVerse: number | null = null;
  private activePointerType: string | null = null;
  private onGuessChange: ((ch: number | null) => void) | null = null;
  private onGuessCommit: (() => void) | null = null;
  private onFreeViewChange: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private animFrame = 0;
  private viewportAnimFrame = 0;
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

  /**
   * Fraction of the axis length that counts as an edge zone (top/bottom or
   * left/right). Dragging inside this band auto-scrolls the timeline.
   */
  private static readonly EDGE_ZONE_FRAC = 0.25;
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
    this.state.viewport = viewportFullCanon(this.state.viewport);
    this.onFreeViewChange?.();
    this.render();
  }

  isPrecisionView(): boolean {
    return this.state.viewport.span <= PRECISION_THRESHOLD;
  }

  /**
   * Leave verse precision for the full-canon overview so the player can
   * jump elsewhere quickly (mobile quick-scroll / zoom-out control).
   */
  zoomOutFromPrecision(): void {
    if (!this.isPrecisionView() && this.state.viewport.span >= FULL_CANON_SPAN - 1) {
      return;
    }
    this.stopViewportAnimation();
    this.state.viewport = viewportFullCanon(this.state.viewport);
    this.onFreeViewChange?.();
    this.render();
  }

  getState(): Readonly<StripState> { return this.state; }
  getProvisionalGuess(): number | null { return this.state.provisionalGuess; }

  setProvisionalGuess(ch: number | null): void {
    this.stopViewportAnimation();
    this.state.provisionalGuess = ch == null ? null : clampVerse(ch);
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
    const from = this.state.viewport;
    this.stopViewportAnimation();

    if (
      Math.abs(from.span - target.span) < 1 &&
      Math.abs(from.center - target.center) < 0.5
    ) {
      this.state.viewport = target;
      this.onFreeViewChange?.();
      this.render();
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.state.viewport = target;
      this.onFreeViewChange?.();
      this.render();
      return;
    }

    const started = performance.now();
    const tick = (now: number): void => {
      const raw = Math.min(1, (now - started) / PRECISION_ZOOM_MS);
      const eased = easeOutCubic(raw);
      this.state.viewport = {
        ...from,
        center: from.center + (target.center - from.center) * eased,
        span: from.span + (target.span - from.span) * eased,
      };
      this.render();
      if (raw < 1) {
        this.viewportAnimFrame = requestAnimationFrame(tick);
      } else {
        this.state.viewport = target;
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

    /** Axis coord in free-band space (0…axisPx), not full canvas. */
    const axisCoord = (e: PointerEvent): number => {
      const rect = this.canvas.getBoundingClientRect();
      const free = this.freeAxis();
      const raw =
        this.state.viewport.orientation === "vertical"
          ? e.clientY - rect.top
          : e.clientX - rect.left;
      return Math.min(free.length, Math.max(0, raw - free.origin));
    };

    const endGesture = (): void => {
      this.dragging = false;
      this.placing = false;
      this.panning = false;
      this.quickScrolling = false;
      this.activePointerType = null;
      this.canvas.classList.remove("is-placing");
      this.stopEdgeScroll();
      this.render();
    };

    /*
     * Pointer model:
     * - Playing: finger owns the marker (tap or drag to place/adjust).
     *   Scroll only when the finger sits in an edge zone so the pointer
     *   would otherwise leave the visible span (edge auto-pan).
     * - Portrait quick-scroll (right edge): zoom to full canon and jump.
     * - Revealed: free drag pans the timeline.
     */
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.isPrimary === false) return;
      this.stopViewportAnimation();
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.focus({ preventScroll: true });
      this.dragging = true;
      this.hoverVerse = null;
      this.activePointerType = e.pointerType;
      this.lastAxis = axisCoord(e);

      if (!this.state.revealed) {
        const rect = this.canvas.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        if (
          this.state.viewport.orientation === "vertical" &&
          isQuickScrollHit(localX, this.canvasW || rect.width)
        ) {
          this.quickScrolling = true;
          this.placing = false;
          this.panning = false;
          this.canvas.classList.add("is-placing");
          hapticLight();
          this.applyQuickScroll(e.clientY - rect.top);
          return;
        }
        this.quickScrolling = false;
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
        this.quickScrolling = false;
      }
    });

    this.canvas.addEventListener("pointermove", (e) => {
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

      if (this.quickScrolling) {
        const rect = this.canvas.getBoundingClientRect();
        this.applyQuickScroll(e.clientY - rect.top);
        return;
      }

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

    this.canvas.addEventListener("pointerup", () => {
      const wasQuick = this.quickScrolling;
      const shouldAutoZoom =
        !this.state.revealed &&
        (this.placing || wasQuick) &&
        this.state.provisionalGuess != null &&
        this.state.viewport.span > PRECISION_THRESHOLD;
      const focus = this.state.provisionalGuess;
      endGesture();
      if (shouldAutoZoom && focus != null) {
        this.autoZoomForPrecision(focus);
      }
    });

    this.canvas.addEventListener("pointercancel", () => {
      endGesture();
    });

    this.canvas.addEventListener("pointerleave", () => {
      if (this.dragging) return;
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
      }
    });
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
    this.animateToViewport(viewportForPrecision(this.state.viewport, focusVerse));
  }

  /**
   * Portrait quick-scroll: snap to the full-canon overview and place the
   * marker at the verse under the finger (Genesis at top → Revelation).
   */
  private applyQuickScroll(canvasY: number): void {
    const free = this.freeAxis();
    const verse = quickScrollVerse(canvasY, free.origin, free.length);
    this.stopViewportAnimation();
    if (this.state.viewport.span < FULL_CANON_SPAN - 1) {
      this.state.viewport = viewportFullCanon(this.state.viewport);
      this.onFreeViewChange?.();
    }
    this.setProvisionalGuess(verse);
  }

  private stopViewportAnimation(): void {
    if (this.viewportAnimFrame) {
      cancelAnimationFrame(this.viewportAnimFrame);
      this.viewportAnimFrame = 0;
    }
  }

  /**
   * If the pointer is in the top/bottom (or start/end) 25% of the axis,
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

    // 25% top + 25% bottom (middle 50% is pure pointer, no scroll)
    const zone = axisPx * CanonStrip.EDGE_ZONE_FRAC;
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
    this.stopViewportAnimation();
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
   * Keep viewport.axisPx / crossPx aligned with the free band between
   * header/footer chrome so markers never live under the HUD.
   */
  private syncViewportMetrics(): void {
    const o = this.state.viewport.orientation;
    const free = this.freeAxis();
    this.state.viewport = {
      ...this.state.viewport,
      axisPx: free.length,
      crossPx: o === "vertical" ? this.canvasW : this.canvasH,
    };
  }

  destroy(): void {
    this.ro?.disconnect();
    cancelAnimationFrame(this.animFrame);
    this.stopViewportAnimation();
    this.stopEdgeScroll();
    this.clearResultLinks();
    this.linkLayer?.remove();
    this.linkLayer = null;
  }

  /* ———— Geometry ———— */

  /**
   * Free band along the scroll axis, inset from header/footer (or side chrome).
   * All hit-testing and marker placement live inside this band.
   */
  private freeAxis(): { origin: number; length: number } {
    const o = this.state.viewport.orientation;
    if (o === "vertical") {
      const origin = this.chrome.top;
      const length = Math.max(
        48,
        this.canvasH - this.chrome.top - this.chrome.bottom
      );
      return { origin, length };
    }
    const origin = this.chrome.start;
    const length = Math.max(
      48,
      this.canvasW - this.chrome.start - this.chrome.end
    );
    return { origin, length };
  }

  /**
   * Cross-axis center of the free band (between chrome insets).
   * Horizontal rail: y (centered). Vertical rail: x (hugs left).
   */
  private railCross(w: number, h: number): number {
    const { top, bottom, start, end } = this.chrome;
    if (this.state.viewport.orientation === "horizontal") {
      const free = Math.max(48, h - top - bottom);
      return top + free * 0.5;
    }
    return portraitRailCross(w, start, end, this.railThick());
  }

  private railThick(): number {
    return Math.max(8, Math.min(this.state.viewport.crossPx * 0.06, 16));
  }

  /**
   * Shared x for portrait overview labels (books, edges, live selection).
   * Keeps every name in one column to the right of the left-hugged rail.
   */
  private portraitLabelX(w: number, h: number): number {
    const cross = this.railCross(w, h);
    return cross + this.railThick() / 2 + PORTRAIT_LABEL_GAP;
  }

  /** Precision / notch column — past the verse ruler. */
  private portraitNotchLabelX(w: number, h: number): number {
    const cross = this.railCross(w, h);
    return (
      cross +
      this.railThick() / 2 +
      NOTCH_GAP +
      ACTIVE_NOTCH_LENGTH +
      10
    );
  }

  /** Verse → screen position on a straight rail (inside the free band). */
  private railPoint(ch: number, w: number, h: number): Point {
    const vp = this.state.viewport;
    const free = this.freeAxis();
    const axis = free.origin + verseToAxisPx(ch, vp);
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
    // Always keep genre-tinted segments — they orient you on the close-up
    this.drawBookSegments(w, h);
    // Result: keep seam + edge labels when visible for orientation.
    // Book names stay off so marker labels aren't crowded.
    this.drawSeam(w, h);
    this.drawEdgeLabels(w, h);
    if (!resultView) {
      this.drawBookLabels(w, h);
    }

    if (resultView && this.state.trueVerse != null) {
      const guess = this.state.lockedGuess;
      const truth = this.state.trueVerse;
      if (guess != null && guess !== truth) {
        this.drawConnector(guess, truth, w, h);
        // Landscape: opposite sides along the rail. Portrait: YOU + TRUE
        // both sit to the right of the left-hugged rail.
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
          // Portrait: YOU + TRUE both sit to the right of the left-hugged rail.
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

    if (!resultView && this.state.viewport.orientation === "vertical") {
      this.drawQuickScrollTrack(w);
    }

    this.syncResultLinks();
  }

  /* ———— 1. Background ———— */

  private drawBackground(w: number, h: number): void {
    const { ctx } = this;
    ctx.fillStyle = BG;
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
    const free = this.freeAxis();

    // Rail base — only in free band between header/footer
    ctx.fillStyle = RAIL;
    if (isH) {
      ctx.fillRect(free.origin, cross - thick / 2, free.length, thick);
    } else {
      ctx.fillRect(cross - thick / 2, free.origin, thick, free.length);
    }

    // Genre segments
    for (const seg of bookSegments()) {
      if (seg.endVerseIndex < range.start || seg.startVerseIndex > range.end) continue;
      const from = Math.max(seg.startVerseIndex, range.start);
      const to = Math.min(seg.endVerseIndex, range.end);
      const fromPx = this.railPoint(from, w, h);
      const toPx = this.railPoint(to + 1, w, h);
      const len = isH ? toPx.x - fromPx.x : toPx.y - fromPx.y;
      if (len < 1) continue;

      const tint = GENRE_TINT[seg.genre] ?? RAIL;
      ctx.fillStyle = tint;
      if (isH) {
        ctx.fillRect(fromPx.x, cross - thick / 2, len, thick);
      } else {
        ctx.fillRect(cross - thick / 2, fromPx.y, thick, len);
      }
    }

    if (vp.span > PRECISION_THRESHOLD) {
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
    ctx.font = `500 6.5px ${SERIF}`;
    ctx.fillStyle = "rgba(47, 42, 37, 0.2)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, "0.8px");

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
    ctx.fillStyle = INK_2;
    ctx.globalAlpha = 0.9;
    ctx.font = `600 10px ${SERIF}`;
    ctx.textBaseline = "middle";
    setLetterSpacing(ctx, "0.6px");

    for (const chapter of chapters) {
      const lengthPx = this.chPx(chapter.start, chapter.end + 1);
      const selected =
        this.state.provisionalGuess != null &&
        this.state.provisionalGuess >= chapter.start &&
        this.state.provisionalGuess <= chapter.end;
      // Always retain the selected chapter as a stable orientation anchor.
      // The live verse reference is painted later and may overlap it briefly;
      // continuity while scrubbing is more useful than collision avoidance here.
      if (!selected && lengthPx < 20) {
        continue;
      }

      const mid = (chapter.start + chapter.end) / 2;
      const p = this.railPoint(mid, w, h);
      const label = `${chapter.bookName} ${chapter.chapter}`.toUpperCase();
      if (isH) {
        const free = this.freeAxis();
        const labelX = Math.min(
          free.origin + free.length - 8,
          Math.max(free.origin + 8, p.x)
        );
        const y = cross - thick / 2 - 6;
        const available = Math.max(40, y - this.chrome.top - 4);
        ctx.save();
        ctx.translate(labelX, y);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "left";
        ctx.fillText(label, 0, 0, available);
        ctx.restore();
      } else {
        const x = this.portraitNotchLabelX(w, h);
        ctx.textAlign = "left";
        ctx.fillText(
          label,
          x,
          p.y,
          Math.max(48, w - x - QUICK_SCROLL_HIT - 6)
        );
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
      ctx.strokeStyle = selected ? INK : chapterStart ? INK_2 : INK_3;
      ctx.globalAlpha = selected ? 1 : chapterStart ? 0.82 : milestone ? 0.62 : 0.42;
      ctx.lineWidth = selected ? 2.5 : chapterStart ? 1.5 : 1;
      ctx.beginPath();
      if (isH) {
        const start = cross + thick / 2 + NOTCH_GAP;
        ctx.moveTo(p.x, start);
        ctx.lineTo(p.x, start + length);
      } else {
        const start = cross + thick / 2 + NOTCH_GAP;
        ctx.moveTo(start, p.y);
        ctx.lineTo(start + length, p.y);
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

    ctx.strokeStyle = INK_3;
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
      ctx.fillStyle = INK_3;
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

    // Chapter labels own the precision view; avoid a competing book label.
    if (vp.span <= PRECISION_THRESHOLD) return;

    const anchors = selectBookAnchors(bookSegments(), {
      orientation: vp.orientation,
      span: vp.span,
      axisPx: vp.axisPx,
      center: vp.center,
      rangeStart: range.start,
      rangeEnd: range.end,
    });

    const labelX = this.portraitLabelX(w, h);
    const guessY =
      this.state.provisionalGuess != null
        ? this.railPoint(this.state.provisionalGuess, w, h).y
        : null;

    ctx.save();
    ctx.font = `9px ${SERIF}`;
    setLetterSpacing(ctx, "0.5px");
    ctx.textBaseline = "middle";
    for (const seg of anchors) {
      // Slightly stronger floor on portrait so the denser set stays legible.
      const alpha = isH
        ? Math.min(0.7, 0.3 + (seg.lenPx - 14) / 200)
        : Math.min(0.78, 0.42 + seg.lenPx / 160);
      const p = this.railPoint(seg.startVerseIndex, w, h);
      // Leave a clear lane for the live selection label.
      if (
        !isH &&
        guessY != null &&
        Math.abs(p.y - guessY) < PORTRAIT_LABEL_MIN_GAP
      ) {
        continue;
      }
      ctx.fillStyle = `rgba(110, 101, 90, ${alpha})`;
      ctx.save();
      if (isH) {
        // Landscape: above the rail at book start, rotated −90°
        ctx.translate(p.x, p.y - thick / 2 - gap);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "left";
        ctx.fillText(seg.name.toUpperCase(), 0, 0);
      } else {
        // Portrait: one shared column to the right of the rail.
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(seg.name.toUpperCase(), labelX, p.y);
      }
      ctx.restore();
    }
    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /* ———— 5. Edge labels ———— */

  private drawEdgeLabels(w: number, h: number): void {
    const { ctx, state } = this;
    const thick = this.railThick();
    const cross = this.railCross(w, h);
    const free = this.freeAxis();
    const precision = state.viewport.span <= PRECISION_THRESHOLD;
    // Precision chapters—including partial chapters at both edges—are all
    // rendered by drawChapterLabels so they share sizing and collision bounds.
    if (precision) return;
    ctx.save();
    ctx.font = `9px ${SERIF}`;
    setLetterSpacing(ctx, "1px");
    ctx.fillStyle = INK_3;

    if (state.viewport.orientation === "vertical") {
      const labelX = this.portraitLabelX(w, h);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const range = this.visibleRange();
      const startY = free.origin + 12;
      const endY = free.origin + free.length - 12;
      const guessY =
        state.provisionalGuess != null
          ? this.railPoint(state.provisionalGuess, w, h).y
          : null;

      // Skip an edge caption when a book anchor or the live selection already
      // occupies that lane — stops GENESIS / GENESIS 1 / EXODUS stacking.
      const anchors = selectBookAnchors(bookSegments(), {
        orientation: "vertical",
        span: state.viewport.span,
        axisPx: state.viewport.axisPx,
        center: state.viewport.center,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      const occupied = (y: number): boolean => {
        if (guessY != null && Math.abs(guessY - y) < PORTRAIT_LABEL_MIN_GAP) {
          return true;
        }
        return anchors.some((seg) => {
          const py = this.railPoint(seg.startVerseIndex, w, h).y;
          return Math.abs(py - y) < PORTRAIT_LABEL_MIN_GAP;
        });
      };

      if (!occupied(startY)) {
        ctx.fillText(this.edgeLabel(range.start), labelX, startY);
      }
      if (!occupied(endY)) {
        ctx.fillText(this.edgeLabel(range.end), labelX, endY);
      }
    } else {
      const labelY = Math.min(h - 12, cross + thick / 2 + 14);
      ctx.textAlign = "left";
      const range = this.visibleRange();
      ctx.fillText(this.edgeLabel(range.start), free.origin + 10, labelY);
      ctx.textAlign = "right";
      ctx.fillText(this.edgeLabel(range.end), free.origin + free.length - 10, labelY);
    }
    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

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

    ctx.fillStyle = ACCENT;
    diamond(ctx, p.x, p.y, result ? 9 : lifted ? 8 : 6);
    ctx.fill();
    if (result) {
      // White inner ring so the pin reads against the rail
      ctx.strokeStyle = BG;
      ctx.lineWidth = 1.5;
      diamond(ctx, p.x, p.y, 9);
      ctx.stroke();
      ctx.fillStyle = ACCENT;
      diamond(ctx, p.x, p.y, 6.5);
      ctx.fill();
    }

    if (withLabel) {
      if (result) {
        this.drawResultLabel(
          ch,
          "You",
          p,
          w,
          h,
          ACCENT_DEEP,
          labelSide,
          chipLayout
        );
      } else {
        this.drawSelectionLabel(formatVerseLabel(ch), p, lifted);
      }
    }
  }

  private drawHoverMarker(ch: number, w: number, h: number): void {
    const { ctx } = this;
    const p = this.railPoint(ch, w, h);
    ctx.save();
    ctx.strokeStyle = INK_2;
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
    ctx.strokeStyle = ACCENT;
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
    ctx.fillStyle = SUCCESS;
    diamond(ctx, p.x, p.y, 9 + 2 * (1 - k));
    ctx.fill();
    ctx.strokeStyle = BG;
    ctx.lineWidth = 1.5;
    diamond(ctx, p.x, p.y, 9);
    ctx.stroke();
    ctx.fillStyle = SUCCESS;
    diamond(ctx, p.x, p.y, 6.5);
    ctx.fill();
    ctx.restore();

    if (k > 0.5) {
      this.drawResultLabel(
        ch,
        "True",
        p,
        w,
        h,
        SUCCESS_DEEP,
        labelSide,
        chipLayout
      );
    }
  }

  /* ———— 8. Marker label ———— */

  /** Keep the live reference in the shared portrait label column (overview)
   * or past the notch ruler (precision). */
  private drawSelectionLabel(
    label: string,
    p: Point,
    lifted = false
  ): void {
    const { ctx } = this;
    const isHorizontal = this.state.viewport.orientation === "horizontal";
    const offset = this.railThick() / 2 + NOTCH_GAP;
    const text = label.toUpperCase();
    const precision = this.state.viewport.span <= PRECISION_THRESHOLD;

    ctx.save();
    ctx.fillStyle = ACCENT_DEEP;
    ctx.font = `600 ${lifted ? 12 : 10}px ${SERIF}`;
    setLetterSpacing(ctx, "0.5px");
    ctx.textBaseline = "middle";

    if (isHorizontal) {
      const y = p.y - offset;
      const available = Math.max(40, y - this.chrome.top - 4);
      ctx.translate(p.x, y);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "left";
      ctx.fillText(text, 0, 0, available);
    } else {
      const w = this.canvasW;
      const h = this.canvasH;
      const x = precision
        ? this.portraitNotchLabelX(w, h)
        : this.portraitLabelX(w, h);
      const available = Math.max(40, w - x - QUICK_SCROLL_HIT - 4);
      ctx.textAlign = "left";
      ctx.fillText(text, x, p.y, available);
    }

    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /** Natural size of a YOU/TRUE result chip (before side-fit shrink). */
  private measureResultChip(verseLabel: string, role: string): {
    bw: number;
    bh: number;
    ref: string;
    roleText: string;
  } {
    const { ctx } = this;
    const ref = verseLabel.toUpperCase();
    const roleText = role.toUpperCase();
    ctx.save();
    ctx.font = `700 13px ${SERIF}`;
    setLetterSpacing(ctx, "0.3px");
    const refW = ctx.measureText(ref).width;
    ctx.font = `600 9px ${SERIF}`;
    setLetterSpacing(ctx, "0.8px");
    const roleW = ctx.measureText(roleText).width;
    setLetterSpacing(ctx, "0px");
    ctx.restore();
    const padX = 12;
    const padY = 8;
    const gap = 3;
    const roleH = 11;
    const refH = 16;
    return {
      bw: Math.max(refW, roleW) + padX * 2,
      bh: padY * 2 + roleH + gap + refH,
      ref,
      roleText,
    };
  }

  /**
   * Portrait pair layout: YOU and TRUE both sit to the right of the
   * left-hugged rail. Long refs shrink into the remaining width; near
   * pins push apart vertically so chips never stack on the same side.
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
    const rightLimit = w - edge - QUICK_SCROLL_HIT;

    const placeRight = (
      pin: Point,
      naturalW: number,
      bh: number
    ): ResultChipLayout => {
      const leftEdge = pin.x + crossGap;
      const maxBw = Math.max(minChipW, rightLimit - leftEdge);
      let bw = Math.min(naturalW, maxBw);
      let bx = leftEdge;
      if (bx + bw > rightLimit) {
        bw = Math.max(minChipW, Math.min(bw, rightLimit - leftEdge));
        bx = Math.min(leftEdge, rightLimit - bw);
        if (bx < leftEdge) bx = leftEdge;
      }
      let by = pin.y - bh / 2;
      by = Math.min(
        free.origin + free.length - bh - 2,
        Math.max(free.origin + 2, by)
      );
      return { bx, by, bw, bh };
    };

    const you = placeRight(guessPt, youM.bw, youM.bh);
    const truth = placeRight(truePt, trueM.bw, trueM.bh);

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
   * Result-page callout: role caption + verse ref.
   * Portrait: YOU + TRUE to the right of the left-hugged rail.
   * Landscape: above/below along the band.
   * Registers a hit box so the chip is a real route.bible link overlay.
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
    const verseLabel = formatVerseLabel(verseIndex);
    const metrics = this.measureResultChip(verseLabel, role);
    const { ref, roleText } = metrics;

    const padX = 12;
    const padY = 8;
    const gap = 3;
    const roleH = 11;
    const refH = 16;
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
      // Solo portrait label: always to the right of the left-hugged rail.
      by = p.y - bh / 2;
      by = Math.min(
        free.origin + free.length - bh - 2,
        Math.max(free.origin + 2, by)
      );
      const minChipW = 56;
      const edge = 4;
      const leftEdge = p.x + crossGap;
      const rightLimit = w - edge - QUICK_SCROLL_HIT;
      const maxBw = Math.max(minChipW, rightLimit - leftEdge);
      bw = Math.min(bw, maxBw);
      bx = leftEdge;
      if (bx + bw > rightLimit) bx = Math.max(leftEdge, rightLimit - bw);
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

    ctx.save();

    // Transparent chip + strong border (page bg shows through)
    ctx.fillStyle = BG;
    roundedRect(ctx, bx, by, bw, bh, 5);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.75;
    roundedRect(ctx, bx, by, bw, bh, 5);
    ctx.stroke();

    // Stem toward the pin
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
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

    const cx = bx + bw / 2;
    const textMax = Math.max(24, bw - padX * 2);
    const refY = by + padY + roleH + gap + refH / 2 + 0.5;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink;
    ctx.font = `600 9px ${SERIF}`;
    setLetterSpacing(ctx, "0.9px");
    ctx.globalAlpha = 0.85;
    ctx.fillText(roleText, cx, by + padY + roleH / 2, textMax);
    ctx.globalAlpha = 1;
    ctx.font = `700 13px ${SERIF}`;
    setLetterSpacing(ctx, "0.25px");
    ctx.fillText(ref, cx, refY, textMax);
    // Subtle underline so the chip reads as a tappable link
    const underlineW = Math.min(textMax, ctx.measureText(ref).width);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - underlineW / 2, refY + refH / 2 - 1);
    ctx.lineTo(cx + underlineW / 2, refY + refH / 2 - 1);
    ctx.stroke();
    ctx.globalAlpha = 1;

    setLetterSpacing(ctx, "0px");
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
   * Thin right-edge track for portrait quick-scroll. Dragging it zooms to
   * the full canon and jumps the marker to the verse under the finger.
   */
  private drawQuickScrollTrack(w: number): void {
    const { ctx } = this;
    const free = this.freeAxis();
    const trackX = w - QUICK_SCROLL_HIT / 2;
    const trackW = 3;
    const focus =
      this.state.provisionalGuess ??
      this.state.lockedGuess ??
      this.state.viewport.center;
    const t = verseToT(focus);
    const thumbY = free.origin + t * free.length;

    ctx.save();
    ctx.strokeStyle = INK_3;
    ctx.globalAlpha = this.quickScrolling ? 0.55 : 0.28;
    ctx.lineWidth = trackW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackX, free.origin + 4);
    ctx.lineTo(trackX, free.origin + free.length - 4);
    ctx.stroke();

    ctx.globalAlpha = this.quickScrolling ? 0.95 : 0.7;
    ctx.fillStyle = this.quickScrolling ? ACCENT : INK_2;
    ctx.beginPath();
    ctx.arc(trackX, thumbY, this.quickScrolling ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Transparent DOM anchors over YOU/TRUE chips → route.bible.
   * Real links so long-press / open-in-new-tab / a11y all work.
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
      const a = document.createElement("a");
      a.className = "result-ref-link";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `Open ${label} on route.bible`;
      a.setAttribute(
        "aria-label",
        `${hit.role}: ${label}. Open on route.bible`
      );
      a.style.left = `${hit.bx}px`;
      a.style.top = `${hit.by}px`;
      a.style.width = `${hit.bw}px`;
      a.style.height = `${hit.bh}px`;
      // Keep canvas from starting a pan when the chip is pressed.
      a.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      this.linkLayer.appendChild(a);
    }
  }

  private edgeLabel(verseIndex: number): string {
    const loc = bookChapterVerseFromIndex(verseIndex);
    if (!loc) return formatVerseLabel(verseIndex).toUpperCase();
    if (verseIndex === 1 || verseIndex === TOTAL_VERSES) {
      return `${loc.book.name} ${loc.chapter}`.toUpperCase();
    }
    const atBookStart = verseIndex <= loc.book.startVerseIndex + 2;
    const atBookEnd = verseIndex >= loc.book.endVerseIndex - 2;
    if (atBookStart || atBookEnd) return loc.book.name.toUpperCase();
    return `${loc.book.name} ${loc.chapter}`.toUpperCase();
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
    ctx.strokeStyle = INK;
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

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, v: string): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = v;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
