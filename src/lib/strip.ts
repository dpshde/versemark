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
  bookSegments,
  verseToAxisPx,
  hitTestVerse,
  clampVerse,
  defaultViewport,
  panViewport,
  zoomViewport,
  viewportForZoomPreset,
  viewportFullCanon,
} from "./axis";
import {
  TOTAL_VERSES,
  TESTAMENT_SEAM_AFTER,
  formatVerseLabel,
} from "./books";

/* ———— Constants ———— */

const ACCENT = "#b85a20";
const ACCENT_DEEP = "#8f4516";
const SUCCESS = "#5a8a3a";
const INK_2 = "#6e655a";
const INK_3 = "#9a9088";
const RAIL = "#e8e4de";
const BG = "#faf8f4";
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const REVEAL_MS = 800;

/** Genre segment tints — whisper-level warm/cool shifts. */
const GENRE_TINT: Record<string, string> = {
  law: "#e2e4e0",
  history: "#ebe5d8",
  poetry: "#e4e0e8",
  prophets: "#ebe0d8",
  gospels: "#f0e8d8",
  epistles: "#e0e8e2",
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
  private dragging = false;
  private lastAxis = 0;
  private startAxis = 0;
  /** pending = finger down, not yet pan vs tap; pan = scroll timeline; place unused mid-gesture */
  private gesture: "none" | "pending" | "pan" = "none";
  private onGuessChange: ((ch: number | null) => void) | null = null;
  /** Pixels of movement before a drag becomes a pan (vs a tap-to-place). */
  private static readonly PAN_THRESHOLD_PX = 10;
  private ro: ResizeObserver | null = null;
  private animFrame = 0;
  private revealStart = 0;
  private revealProgress = 0;
  /** Insets in CSS px (canvas layout space) for verse / dock chrome. */
  private chrome: ChromeInsets = { top: 0, bottom: 0, start: 0, end: 0 };

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
  }

  private detectOrientation(): Orientation {
    return window.innerWidth >= 720 ? "horizontal" : "vertical";
  }

  setOnGuessChange(cb: (ch: number | null) => void): void {
    this.onGuessChange = cb;
  }

  /** Place the rail in the free band between top/bottom (or side) chrome. */
  setChromeInsets(insets: Partial<ChromeInsets>): void {
    this.chrome = { ...this.chrome, ...insets };
    this.render();
  }

  /**
   * Jump to a zoom preset. Book zoom focuses the provisional guess when set,
   * otherwise the current viewport center.
   */
  setZoomPreset(preset: ZoomPreset, focusVerse?: number): void {
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
    this.state.viewport = viewportFullCanon(this.state.viewport);
    this.render();
  }

  getState(): Readonly<StripState> { return this.state; }
  getProvisionalGuess(): number | null { return this.state.provisionalGuess; }

  setProvisionalGuess(ch: number | null): void {
    this.state.provisionalGuess = ch == null ? null : clampVerse(ch);
    this.onGuessChange?.(this.state.provisionalGuess);
    this.render();
  }

  lockGuess(): number | null {
    if (this.state.provisionalGuess == null) return null;
    this.state.lockedGuess = this.state.provisionalGuess;
    return this.state.lockedGuess;
  }

  reveal(trueVerseIndex: number): void {
    this.state.trueVerse = clampVerse(trueVerseIndex);
    this.state.revealed = true;
    this.centerOn(
      this.state.lockedGuess ?? this.state.trueVerse,
      this.state.trueVerse
    );
    this.startRevealAnimation();
  }

  resetForRound(): void {
    this.state.provisionalGuess = null;
    this.state.lockedGuess = null;
    this.state.trueVerse = null;
    this.state.revealed = false;
    this.revealProgress = 0;
    this.state.viewport = {
      ...this.state.viewport,
      center: Math.round(TOTAL_VERSES / 2),
      span: TOTAL_VERSES,
    };
    this.onGuessChange?.(null);
    this.render();
  }

  /* ———— Reveal animation ———— */

  private startRevealAnimation(): void {
    cancelAnimationFrame(this.animFrame);
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

  private centerOn(a: number, b: number): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const mid = (lo + hi) / 2;
    const span = Math.max(200, (hi - lo) * 2.5);
    this.state.viewport = {
      ...this.state.viewport,
      center: clampVerse(mid),
      span: Math.min(TOTAL_VERSES, span),
    };
  }

  /* ———— Input binding ———— */

  private bind(): void {
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);

    const axisCoord = (e: PointerEvent): number => {
      const rect = this.canvas.getBoundingClientRect();
      return this.state.viewport.orientation === "vertical"
        ? e.clientY - rect.top
        : e.clientX - rect.left;
    };

    const endGesture = (): void => {
      this.dragging = false;
      this.gesture = "none";
    };

    /*
     * Touch / pointer model (mobile-first):
     * - Tap (little movement) → place / adjust marker on the verse under the finger
     * - Drag past threshold → pan the timeline (scroll Gen↔Rev)
     * After reveal, any drag pans; taps do nothing new.
     */
    this.canvas.addEventListener("pointerdown", (e) => {
      // Ignore multi-touch extras (pinch could be added later)
      if (e.isPrimary === false) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.startAxis = axisCoord(e);
      this.lastAxis = this.startAxis;
      this.gesture = "pending";
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const axis = axisCoord(e);
      const deltaPx = axis - this.lastAxis;
      this.lastAxis = axis;

      if (this.gesture === "pending") {
        if (
          Math.abs(axis - this.startAxis) >= CanonStrip.PAN_THRESHOLD_PX
        ) {
          this.gesture = "pan";
        } else {
          return;
        }
      }

      if (this.gesture === "pan") {
        // Finger down → content moves with finger (natural scroll)
        const cpp = this.state.viewport.span / this.state.viewport.axisPx;
        this.state.viewport = panViewport(
          this.state.viewport,
          -deltaPx * cpp
        );
        this.render();
      }
    });

    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.dragging) return;
      if (
        this.gesture === "pending" &&
        !this.state.revealed
      ) {
        // Tap: place marker at the press location
        const axis = axisCoord(e);
        this.setProvisionalGuess(
          hitTestVerse(axis, this.state.viewport).verseIndex
        );
      }
      endGesture();
    });

    this.canvas.addEventListener("pointercancel", () => {
      endGesture();
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const focus = this.state.provisionalGuess ?? this.state.viewport.center;
        this.state.viewport = zoomViewport(this.state.viewport, factor, focus);
        this.render();
      },
      { passive: false }
    );

    window.addEventListener("resize", () => {
      const o = this.detectOrientation();
      if (o !== this.state.viewport.orientation) {
        this.state.viewport = { ...this.state.viewport, orientation: o };
        this.resize();
      }
    });
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = parent.clientWidth || 320;
    const h = parent.clientHeight || 200;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    const o = this.detectOrientation();
    this.state.viewport = {
      ...this.state.viewport,
      orientation: o,
      axisPx: o === "vertical" ? h : w,
      crossPx: o === "vertical" ? w : h,
    };
    this.render();
  }

  destroy(): void {
    this.ro?.disconnect();
    cancelAnimationFrame(this.animFrame);
  }

  /* ———— Geometry ———— */

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
    return Math.max(8, Math.min(this.state.viewport.crossPx * 0.06, 16));
  }

  /** Verse → screen position on a straight rail. */
  private railPoint(ch: number, w: number, h: number): Point {
    const vp = this.state.viewport;
    const axis = verseToAxisPx(ch, vp);
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
    const vp = this.state.viewport;
    const w = vp.orientation === "vertical" ? vp.crossPx : vp.axisPx;
    const h = vp.orientation === "vertical" ? vp.axisPx : vp.crossPx;

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    this.drawBackground(w, h);
    this.drawBookSegments(w, h);
    this.drawSeam(w, h);
    this.drawBookLabels(w, h);
    this.drawEdgeLabels(w, h);

    if (this.state.revealed && this.state.trueVerse != null) {
      if (this.state.lockedGuess != null) {
        this.drawConnector(this.state.lockedGuess, this.state.trueVerse, w, h);
        this.drawGuessMarker(this.state.lockedGuess, w, h, false);
      }
      this.drawTrueMarker(this.state.trueVerse, w, h);
    } else if (this.state.provisionalGuess != null) {
      this.drawGuessMarker(this.state.provisionalGuess, w, h, true);
    }
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

    // Rail base
    ctx.fillStyle = RAIL;
    if (isH) {
      ctx.fillRect(0, cross - thick / 2, w, thick);
    } else {
      ctx.fillRect(cross - thick / 2, 0, thick, h);
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

    // Verse ticks at deep zoom
    const zoom = TOTAL_VERSES / vp.span;
    // Show ticks when zoomed in to a handful of chapters (~150 verses)
    if (vp.span < 150) {
      ctx.strokeStyle = INK_3;
      ctx.lineWidth = 0.5;
      const stride = zoom < 1.4 ? 5 : zoom < 2.5 ? 2 : 1;
      for (let c = range.start; c <= range.end; c += stride) {
        const p = this.railPoint(c, w, h);
        ctx.beginPath();
        if (isH) {
          ctx.moveTo(p.x, cross + thick / 2);
          ctx.lineTo(p.x, cross + thick / 2 + 3);
        } else {
          ctx.moveTo(cross + thick / 2, p.y);
          ctx.lineTo(cross + thick / 2 + 3, p.y);
        }
        ctx.stroke();
      }
    }
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
    /** Gap from rail edge to label baseline (px). */
    const gap = 6;

    ctx.save();
    ctx.font = `9px ${SERIF}`;
    setLetterSpacing(ctx, "0.5px");
    ctx.textBaseline = "middle";
    for (const seg of bookSegments()) {
      if (seg.endVerseIndex < range.start || seg.startVerseIndex > range.end) continue;
      const lenPx = this.chPx(seg.startVerseIndex, seg.endVerseIndex + 1);
      if (lenPx < 28) continue;
      const alpha = Math.min(0.7, 0.3 + (lenPx - 28) / 200);
      const mid = (seg.startVerseIndex + seg.endVerseIndex) / 2;
      const p = this.railPoint(mid, w, h);
      ctx.fillStyle = `rgba(110, 101, 90, ${alpha})`;
      ctx.save();
      if (isH) {
        // Above the rail, rotated −90° (reads bottom → top from the rail)
        ctx.translate(p.x, p.y - thick / 2 - gap);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "left";
      } else {
        // Left of the rail, rotated −90°; center on the book so ends don't drift into chrome
        ctx.translate(p.x - thick / 2 - gap, p.y);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
      }
      ctx.fillText(seg.name.toUpperCase(), 0, 0);
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
    ctx.save();
    ctx.font = `9px ${SERIF}`;
    setLetterSpacing(ctx, "1px");
    ctx.fillStyle = INK_3;

    if (state.viewport.orientation === "vertical") {
      // Beside the rail, in the free band (not under side chrome)
      const labelX = Math.min(w - 8, cross + thick / 2 + 10);
      ctx.textAlign = "left";
      ctx.fillText("GENESIS", labelX, 16 + this.chrome.top);
      ctx.fillText("REVELATION", labelX, h - 10 - this.chrome.bottom);
    } else {
      // Just below the rail — stays out of the dock band
      const labelY = Math.min(h - 12, cross + thick / 2 + 14);
      ctx.textAlign = "left";
      ctx.fillText("GENESIS", 10, labelY);
      ctx.textAlign = "right";
      ctx.fillText("REVELATION", w - 10, labelY);
    }
    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /* ———— 6. Guess marker ———— */

  private drawGuessMarker(ch: number, w: number, h: number, withLabel: boolean): void {
    const { ctx } = this;
    const p = this.railPoint(ch, w, h);

    ctx.fillStyle = ACCENT;
    diamond(ctx, p.x, p.y, 6);
    ctx.fill();

    if (withLabel) this.drawMarkerLabel(formatVerseLabel(ch), p, w, h, ACCENT_DEEP);
  }

  /* ———— 7. True marker ———— */

  private drawTrueMarker(ch: number, w: number, h: number): void {
    const { ctx } = this;
    const p = this.railPoint(ch, w, h);
    const k = this.state.revealed ? Math.max(this.revealProgress, 0.05) : 1;

    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = SUCCESS;
    diamond(ctx, p.x, p.y, 6 + 2 * (1 - k));
    ctx.fill();
    ctx.restore();

    if (k > 0.5) this.drawMarkerLabel(formatVerseLabel(ch), p, w, h, SUCCESS);
  }

  /* ———— 8. Marker label ———— */

  private drawMarkerLabel(label: string, p: Point, w: number, h: number, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = `600 10px ${SERIF}`;
    setLetterSpacing(ctx, "0.5px");
    const text = label.toUpperCase();
    const metrics = ctx.measureText(text);
    const pad = 5, bw = metrics.width + pad * 2, bh = 16;
    let bx = p.x - bw / 2, by = p.y - 24;
    if (by + bh > h - 4) by = p.y + 12;
    bx = Math.min(Math.max(4, bx), w - bw - 4);
    ctx.fillStyle = BG;
    roundedRect(ctx, bx, by, bw, bh, 3);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    roundedRect(ctx, bx, by, bw, bh, 3);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
    setLetterSpacing(ctx, "0px");
    ctx.restore();
  }

  /* ———— 9. Connector line ———— */

  private drawConnector(guess: number, truth: number, w: number, h: number): void {
    const { ctx } = this;
    const k = this.revealProgress;
    if (k <= 0.02 || guess === truth) return;
    const toCh = guess + (truth - guess) * Math.min(1, k * 1.25);
    const from = this.railPoint(guess, w, h);
    const to = this.railPoint(toCh, w, h);
    ctx.save();
    ctx.strokeStyle = INK_2;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
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
