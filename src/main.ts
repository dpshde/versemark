import "./styles.css";
import type { PoolItem } from "./lib/daily";
import type { PoolFile } from "./lib/daily";
import {
  startDailyRound,
  startDailyRoundForPuzzle,
  startEndlessRound,
  advanceDailyRound,
  takeHint,
  confirmGuess,
  shareForRound,
  hintQuadrantLabel,
  currentAppState,
  type RoundData,
  type TextBundle,
} from "./lib/game";
import { CanonStrip } from "./lib/strip";
import { formatVerseLabel } from "./lib/books";
import { bookSegments, testamentSeamT, type ZoomPreset } from "./lib/axis";
import { shareText } from "./lib/share";
import { parseGuessText } from "./lib/guess-parse";
import { hapticLight, hapticResult } from "./lib/haptics";

const app = document.querySelector<HTMLDivElement>("#app")!;

let pool: PoolItem[] = [];
let texts: TextBundle = { verses: {}, paragraphs: {} };
let round: RoundData | null = null;
let strip: CanonStrip | null = null;
let provisionalGuess: number | null = null;
let chromeRo: ResizeObserver | null = null;
/** Active zoom chip; cleared when the player free-zooms with wheel/gesture. */
let activeZoom: ZoomPreset | null = null;
/** True while the guess field has focus — don't clobber in-progress typing. */
let guessInputFocused = false;
/** Invalid text must never confirm a stale marker that happens to remain on the rail. */
let guessInputInvalid = false;
let scoreToBeat: number | null = null;

async function loadData(): Promise<void> {
  const base = import.meta.env.BASE_URL || "./";
  const [poolRes, versesRes, paraRes] = await Promise.all([
    fetch(`${base}data/pool.json`),
    fetch(`${base}data/verses.json`),
    fetch(`${base}data/paragraphs.json`),
  ]);
  if (!poolRes.ok || !versesRes.ok || !paraRes.ok) {
    throw new Error("Failed to load game data");
  }
  const poolFile = (await poolRes.json()) as PoolFile;
  pool = poolFile.items;
  texts = {
    verses: (await versesRes.json()) as Record<string, string>,
    paragraphs: (await paraRes.json()) as TextBundle["paragraphs"],
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function makeHomeTimeline(): HTMLElement {
  const timeline = el("div", {
    class: "home-timeline",
    role: "img",
    "aria-label": "The Bible from Genesis to Revelation",
  });
  const rail = el("div", { class: "home-timeline-rail" });

  for (const segment of bookSegments()) {
    const book = el("span", {
      class: "home-timeline-book",
      "data-genre": segment.genre,
    });
    book.style.width = `${Math.max(0, segment.t1 - segment.t0) * 100}%`;
    rail.append(book);
  }

  const seam = el("span", { class: "home-timeline-seam" });
  seam.style.left = `${testamentSeamT() * 100}%`;
  rail.append(seam);
  timeline.append(
    rail,
    el("div", { class: "home-timeline-ends" }, [
      el("span", { text: "Genesis" }),
      el("span", { text: "Revelation" }),
    ])
  );
  return timeline;
}

function makeWordmark(): HTMLHeadingElement {
  const heading = el("h1", { "aria-label": "Versemark" });
  heading.append(
    document.createTextNode("Versem"),
    el("span", { class: "wordmark-pin", "aria-hidden": "true" }),
    document.createTextNode("rk")
  );
  return heading;
}

function renderHome(): void {
  app.innerHTML = "";
  const state = currentAppState();
  const screen = el("div", { class: "screen home active", id: "screen-home" });
  const panel = el("div", { class: "home-panel" });

  panel.append(
    makeWordmark(),
    el("p", {
      class: "tagline",
      text: "Mark where the verse lives in Scripture.",
    }),
    makeHomeTimeline()
  );

  if (state.streak > 0) {
    panel.append(
      el("p", {
        class: "streak",
        text: `Streak ${state.streak} · Best ${state.bestStreak}`,
      })
    );
  }

  panel.append(
    el("div", { class: "btn-row" }, [
      (() => {
        const b = el("button", {
          class: "btn-primary",
          id: "btn-daily",
          type: "button",
          text: "Daily",
        });
        b.addEventListener("click", () => {
          hapticLight();
          startMode("daily");
        });
        return b;
      })(),
      (() => {
        const b = el("button", {
          class: "btn-secondary",
          id: "btn-endless",
          type: "button",
          text: "Practice",
        });
        b.addEventListener("click", () => {
          hapticLight();
          startMode("endless");
        });
        return b;
      })(),
    ])
  );

  screen.append(panel);
  app.append(screen);
}

function startMode(mode: "daily" | "endless", puzzleNumber?: number): void {
  if (mode === "daily" && puzzleNumber == null) scoreToBeat = null;
  chromeRo?.disconnect();
  chromeRo = null;
  strip?.destroy();
  strip = null;
  activeZoom = null;
  guessInputInvalid = false;
  round =
    mode === "daily"
      ? puzzleNumber == null
        ? startDailyRound(pool, texts)
        : startDailyRoundForPuzzle(pool, texts, puzzleNumber)
      : startEndlessRound(pool, texts);
  provisionalGuess = round.guessVerseIndex;
  renderPlay();
  requestAnimationFrame(() => {
    if (!strip || !round) return;
    if (round.phase === "revealed" && round.guessVerseIndex != null) {
      strip.setProvisionalGuess(round.guessVerseIndex);
      strip.lockGuess();
      strip.reveal(round.poolItem.verseIndex);
    }
  });
}

function renderPlay(): void {
  if (!round) return;
  app.innerHTML = "";
  const screen = el("div", {
    class: "screen play active",
    id: "screen-play",
  });

  const board = el("div", {
    class: "board-wrap",
    id: "strip-wrap",
  });
  const canvas = el("canvas", {
    id: "canon-strip",
    role: "slider",
    tabindex: "0",
    "aria-label": "Place your marker on the canon timeline",
    "aria-describedby": "timeline-instructions",
  });
  board.append(canvas);
  screen.append(board);

  const hud = el("div", { class: "hud" });

  const top = el("div", { class: "top-bar" });
  const back = el("button", {
    class: "btn-ghost",
    type: "button",
    id: "btn-home",
    "aria-label": "Home",
    title: "Home",
  });
  back.innerHTML = `<svg class="home-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.75 10.5 12 3.75l8.25 6.75" />
    <path d="M5.75 9.25v10h12.5v-10M9.5 19.25v-5.5h5v5.5" />
  </svg>`;
  back.addEventListener("click", () => {
    hapticLight();
    chromeRo?.disconnect();
    chromeRo = null;
    strip?.destroy();
    strip = null;
    round = null;
    renderHome();
  });
  const dailyPosition = round.daily
    ? `${round.daily.index + 1}/${round.daily.items.length}`
    : null;
  const modeLabel =
    round.mode === "daily"
      ? `${scoreToBeat != null ? `Beat ${scoreToBeat} · ` : ""}${dailyPosition ?? "Daily"}`
      : "Practice";
  const modeAria =
    round.mode === "daily" && round.puzzleNumber != null
      ? `Daily ${round.puzzleNumber}${round.daily ? `, verse ${round.daily.index + 1} of ${round.daily.items.length}` : ""}${scoreToBeat != null ? `, score to beat ${scoreToBeat}` : ""}`
      : "Practice";
  const mode = el("span", {
    class: "mode-label",
    text: modeLabel,
    "aria-label": modeAria,
    title: modeAria,
  });
  /* Map zooms sit with nav chrome while placing — hide on result to reduce noise */
  if (round.phase === "playing") {
    top.append(
      back,
      makeZoomBar(),
      mode
    );
  } else {
    top.append(back, mode);
  }
  hud.append(top);

  /* Verse band — same horizontal measure as the dock */
  const verseBand = el("div", { class: "verse-band" });
  const card = el("div", { class: "card", id: "verse-card" });
  card.append(el("p", { class: "verse", id: "verse-text", text: round.verseText }));
  verseBand.append(card);
  hud.append(verseBand);

  /* Transparent mid — hits pass through to the board */
  const hudMid = el("div", { class: "hud-mid" });
  hudMid.append(
    el("p", {
      class: "sr-only",
      id: "timeline-instructions",
      text: "Tap or drag to place a marker. The timeline zooms in automatically; drag across the verse notches to choose the exact verse. Arrow keys move one verse, Shift plus an arrow moves ten, and Enter confirms.",
    }),
    el("p", {
      class: `timeline-cue${provisionalGuess == null ? "" : " is-hidden"}`,
      id: "timeline-cue",
      "aria-hidden": "true",
      text: "Tap or drag to place your marker",
    })
  );
  hud.append(hudMid);

  const dock = el("div", { class: "dock" });

  /* Hints sit under the timeline, above readout / actions */
  const hintPanel = makeHintPanel(round);
  if (hintPanel) dock.append(hintPanel);

  if (round.phase === "playing") {
    const guessTools = el("div", { class: "guess-tools" });
    guessTools.append(makePrecisionZoomOut(), makeGuessInput());
    dock.append(guessTools);

    const actions = el("div", { class: "actions" });
    const hintBtn = el("button", {
      class: "btn-secondary",
      type: "button",
      id: "btn-hint",
      text: "Hint",
    });
    if (round.hintStep >= 3) hintBtn.disabled = true;
    hintBtn.setAttribute(
      "aria-label",
      round.hintStep >= 3
        ? "All hints used"
        : "Take a hint"
    );
    hintBtn.addEventListener("click", () => {
      if (!round || round.hintStep >= 3) return;
      hapticLight();
      round = takeHint(round);
      renderPlay();
    });

    const confirm = el("button", {
      class: "btn-primary",
      type: "button",
      id: "btn-confirm",
      text: "Confirm",
    });
    confirm.disabled = provisionalGuess == null || guessInputInvalid;
    confirm.addEventListener("click", () => {
      if (!round || provisionalGuess == null) return;
      // Prefer whatever is currently typed if it parses
      const input = document.querySelector<HTMLInputElement>("#guess-input");
      if (input?.value.trim()) {
        const parsed = parseGuessText(input.value);
        if (parsed.ok) {
          provisionalGuess = parsed.verseIndex;
          strip?.setProvisionalGuess(parsed.verseIndex);
        }
      }
      if (provisionalGuess == null) return;
      const locked = strip?.lockGuess() ?? provisionalGuess;
      const { round: next } = confirmGuess(round, locked);
      round = next;
      hapticResult(locked === round.poolItem.verseIndex);
      strip?.reveal(round.poolItem.verseIndex);
      renderPlay();
    });

    actions.append(hintBtn, confirm);
    dock.append(actions);
  }

  if (round.phase === "revealed" && round.result) {
    dock.append(makeResultPanel(round));
  }

  hud.append(dock);
  screen.append(hud);
  app.append(screen);

  strip = new CanonStrip(canvas);
  strip.setOnGuessChange((ch) => {
    provisionalGuess = ch;
    guessInputInvalid = false;
    syncConfirmEnabled();
    syncGuessInputFromMarker();
    syncTimelineCue();
    const zoomBar = document.querySelector<HTMLElement>(".zoom-bar");
    if (zoomBar) syncZoomBarUI(zoomBar);
  });
  strip.setOnGuessCommit(() => {
    document.querySelector<HTMLButtonElement>("#btn-confirm")?.click();
  });
  strip.setOnFreeViewChange(() => {
    activeZoom = null;
    const zoomBar = document.querySelector<HTMLElement>(".zoom-bar");
    if (zoomBar) syncZoomBarUI(zoomBar);
  });
  if (provisionalGuess != null) {
    strip.setProvisionalGuess(provisionalGuess);
  }
  if (round.phase === "revealed" && round.guessVerseIndex != null) {
    strip.setProvisionalGuess(round.guessVerseIndex);
    strip.lockGuess();
    strip.reveal(round.poolItem.verseIndex);
  }

  /* Keep the rail centered in the free band as chrome resizes */
  chromeRo?.disconnect();
  chromeRo = new ResizeObserver(() => syncChromeInsets());
  chromeRo.observe(hud);
  chromeRo.observe(board);
  requestAnimationFrame(() => syncChromeInsets());
}

/** Measure HUD chrome and offset the canvas rail into the free board band. */
function syncChromeInsets(): void {
  if (!strip) return;
  const board = document.querySelector(".board-wrap");
  const topBar = document.querySelector(".top-bar");
  const verseBand = document.querySelector(".verse-band");
  const dock = document.querySelector(".dock");
  if (!board) return;

  const br = board.getBoundingClientRect();
  const topEdge = verseBand
    ? verseBand.getBoundingClientRect().bottom
    : topBar
      ? topBar.getBoundingClientRect().bottom
      : br.top;
  const bottomEdge = dock ? dock.getBoundingClientRect().top : br.bottom;

  /* Extra room so marker labels (~24px) clear the chrome gradients */
  const topGap = 16;
  const bottomGap = 16;
  const topInset = Math.max(0, topEdge - br.top + topGap);
  const bottomInset = Math.max(0, br.bottom - bottomEdge + bottomGap);
  strip.setChromeInsets({
    top: topInset,
    bottom: bottomInset,
    start: 0,
    end: 0,
  });
  const railCross = topInset + Math.max(48, br.height - topInset - bottomInset) * 0.5;
  document
    .querySelector<HTMLElement>(".hud")
    ?.style.setProperty("--rail-cross", `${railCross}px`);
}

function makeGuessInput(): HTMLElement {
  const wrap = el("div", { class: "guess-field", id: "guess-readout" });
  const error = el("p", {
    class: "guess-error",
    id: "guess-error",
    "aria-live": "polite",
    text: "Try a reference like John 3:16.",
  });
  const input = el("input", {
    class: "guess-input",
    id: "guess-input",
    type: "text",
    inputmode: "text",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "words",
    spellcheck: "false",
    enterkeyhint: "done",
    "aria-label": "Your guess — type a Bible reference or tap the timeline",
    "aria-errormessage": "guess-error",
    placeholder: "Type a reference or tap the timeline",
  }) as HTMLInputElement;
  if (provisionalGuess != null) {
    guessInputInvalid = false;
    input.value = formatVerseLabel(provisionalGuess);
    wrap.classList.add("is-valid");
  }

  const setValidity = (state: "empty" | "valid" | "invalid"): void => {
    wrap.classList.toggle("is-valid", state === "valid");
    wrap.classList.toggle("is-invalid", state === "invalid");
    guessInputInvalid = state === "invalid";
    input.setAttribute("aria-invalid", state === "invalid" ? "true" : "false");
    error.hidden = state !== "invalid";
  };

  const applyFromInput = (commitLabel: boolean): void => {
    const raw = input.value;
    const parsed = parseGuessText(raw);
    if (parsed.ok) {
      provisionalGuess = parsed.verseIndex;
      strip?.setProvisionalGuess(parsed.verseIndex);
      if (commitLabel && !guessInputFocused) {
        input.value = parsed.label;
      } else if (commitLabel && document.activeElement !== input) {
        input.value = parsed.label;
      }
      setValidity("valid");
      syncConfirmEnabled();
      return;
    }
    if (parsed.reason === "empty") {
      setValidity("empty");
      // Keep timeline marker; empty field is fine while still deciding
      syncConfirmEnabled();
      return;
    }
    setValidity("invalid");
    syncConfirmEnabled();
  };

  input.addEventListener("focus", () => {
    guessInputFocused = true;
    // Select all so a re-tap replaces cleanly
    requestAnimationFrame(() => input.select());
  });
  input.addEventListener("blur", () => {
    guessInputFocused = false;
    applyFromInput(true);
    // Normalize display to canonical label when valid
    if (provisionalGuess != null && parseGuessText(input.value).ok) {
      input.value = formatVerseLabel(provisionalGuess);
      setValidity("valid");
    }
  });
  input.addEventListener("input", () => applyFromInput(false));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFromInput(true);
      if (provisionalGuess != null && !guessInputInvalid) {
        input.blur();
        document.querySelector<HTMLButtonElement>("#btn-confirm")?.focus();
      }
    }
  });

  error.hidden = true;
  wrap.append(input, error);
  return wrap;
}

function syncConfirmEnabled(): void {
  const conf = document.querySelector<HTMLButtonElement>("#btn-confirm");
  if (conf) conf.disabled = provisionalGuess == null || guessInputInvalid;
}

function syncTimelineCue(): void {
  const cue = document.querySelector("#timeline-cue");
  cue?.classList.toggle("is-hidden", provisionalGuess != null);
}

/** Push marker placement into the text field (unless the user is typing). */
function syncGuessInputFromMarker(): void {
  const input = document.querySelector<HTMLInputElement>("#guess-input");
  const wrap = document.querySelector("#guess-readout");
  if (!input || !wrap) return;
  if (guessInputFocused) return;
  if (provisionalGuess == null) {
    input.value = "";
    wrap.classList.remove("is-valid", "is-invalid");
    input.setAttribute("aria-invalid", "false");
    const error = document.querySelector<HTMLElement>("#guess-error");
    if (error) error.hidden = true;
    return;
  }
  input.value = formatVerseLabel(provisionalGuess);
  input.setAttribute("aria-invalid", "false");
  wrap.classList.add("is-valid");
  wrap.classList.remove("is-invalid");
  const error = document.querySelector<HTMLElement>("#guess-error");
  if (error) error.hidden = true;
}

function continueDailyRound(current: RoundData): void {
  round = advanceDailyRound(current, texts);
  provisionalGuess = null;
  activeZoom = null;
  renderPlay();
}

/**
 * Result dock — score is the hero; timeline already carries guess/true labels.
 * One meta line, one action row. No repeated refs, no base-point jargon.
 */
function makeResultPanel(round: RoundData): HTMLElement {
  const r = round.result!;
  const panel = el("div", { class: "result-panel", id: "result-card" });
  const dailyComplete =
    round.daily != null &&
    round.daily.results.length === round.daily.items.length;
  const displayTotal = dailyComplete
    ? round.daily!.results.reduce((sum, item) => sum + item.total, 0)
    : r.total;

  const distLabel =
    r.distance === 0
      ? "Exact"
      : r.distance === 1
        ? "1 verse off"
        : `${r.distance} verses off`;

  panel.append(
    el("p", { class: "score-line", id: "score-total" }, [
      document.createTextNode(String(displayTotal)),
      el("span", { class: "pts-unit", text: "pts" }),
    ]),
    el("p", {
      class: "score-meta",
      id: "true-ref",
      text: `${distLabel} · ×${r.multiplier}`,
    })
  );

  const actions = el("div", { class: "result-actions" });
  if (dailyComplete) {
    const summary = el("ol", { class: "daily-summary", "aria-label": "Daily verse scores" });
    round.daily!.results.forEach((item, index) => {
      const distance = item.distance === 0 ? "Exact" : `${item.distance} verses off`;
      summary.append(el("li", { class: "daily-summary-row" }, [
        el("span", { text: `${index + 1}. ${item.trueRef}` }),
        el("span", { text: `${distance} · ${item.total} pts` }),
      ]));
    });
    panel.append(summary);
  }
  const shareTextBody = shareForRound(round);
  if (shareTextBody) {
    const shareBtn = el("button", {
      class:
        round.mode === "daily" ? "btn-primary" : "btn-secondary",
      type: "button",
      id: "btn-share",
      text: "Share",
    });
    shareBtn.addEventListener("click", async () => {
      try {
        const how = await shareText(shareTextBody);
        hapticResult(true);
        shareBtn.textContent = how === "shared" ? "Shared" : "Copied";
        window.setTimeout(() => {
          shareBtn.textContent = "Share";
        }, 1600);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        let box = document.querySelector("#share-box") as HTMLElement | null;
        if (!box) {
          box = el("div", { class: "share-box", id: "share-box" });
          box.textContent = shareTextBody;
          panel.insertBefore(box, actions);
        }
        shareBtn.textContent = "Select text above";
      }
    });
    actions.append(shareBtn);
  }

  if (round.mode === "endless") {
    const again = el("button", {
      class: "btn-primary",
      type: "button",
      id: "btn-again",
      text: "Next",
    });
    again.addEventListener("click", () => {
      hapticLight();
      startMode("endless");
    });
    actions.append(again);
  } else if (round.daily && !dailyComplete) {
    const nextVerse = el("button", {
      class: "btn-primary",
      type: "button",
      id: "btn-next-daily",
      text: "Next verse",
    });
    nextVerse.addEventListener("click", () => {
      hapticLight();
      continueDailyRound(round);
    });
    actions.append(nextVerse);
  }

  if (actions.childNodes.length === 1) {
    actions.classList.add("result-actions--solo");
  }
  if (actions.childNodes.length) panel.append(actions);
  return panel;
}

/** Surrounding paragraph + testament-half hints — rendered below the rail. */
function makeHintPanel(round: RoundData): HTMLElement | null {
  if (round.hintStep < 2) return null;

  const panel = el("div", {
    class: "hint-panel",
    id: "hint-panel",
  });

  if (round.paragraph) {
    const p = el("p", { class: "paragraph", id: "paragraph-hint" });
    for (const v of round.paragraph.verses) {
      const span = el("span");
      if (v.v === round.poolItem.verse) {
        span.className = "focus";
      }
      span.textContent = `${v.t} `;
      p.append(span);
    }
    panel.append(p);
  }

  if (round.hintStep >= 3) {
    panel.append(
      el("p", {
        class: "quadrant",
        id: "quadrant-hint",
        text: hintQuadrantLabel(round),
      })
    );
  }

  return panel;
}

const ZOOM_PRESETS: { id: ZoomPreset; label: string; title: string }[] = [
  {
    id: "ot",
    label: "OT",
    title: "Old Testament — tap again for full canon",
  },
  {
    id: "nt",
    label: "NT",
    title: "New Testament — tap again for full canon",
  },
  {
    id: "book",
    label: "Book",
    title: "Book under marker — tap again for full canon",
  },
];

function syncZoomBarUI(bar: HTMLElement): void {
  bar.querySelectorAll(".zoom-link").forEach((node) => {
    const b = node as HTMLButtonElement;
    const id = b.id.replace(/^zoom-/, "") as ZoomPreset;
    const on = activeZoom === id;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    if (id === "book") {
      const ready = provisionalGuess != null;
      b.disabled = !ready;
      b.title = ready
        ? "Book under marker — tap again for full canon"
        : "Place a marker to use book zoom";
      b.setAttribute(
        "aria-label",
        ready
          ? "Zoom to book under marker"
          : "Book zoom — place a marker first"
      );
    }
  });
  const precision = strip?.isPrecisionView() ?? false;
  document.querySelectorAll<HTMLElement>(".precision-zoom-out").forEach((node) => {
    node.hidden = !precision;
  });
}

function applyZoomSelection(next: ZoomPreset | null): void {
  if (next === "book" && provisionalGuess == null) return;
  // Zoom presets are mutually exclusive.
  // Re-selecting the active preset toggles zoom completely off.
  if (next != null && activeZoom === next) {
    activeZoom = null;
    strip?.clearZoom();
    return;
  }
  activeZoom = next;
  if (next == null) {
    strip?.clearZoom();
    return;
  }
  strip?.setZoomPreset(next, provisionalGuess ?? undefined);
}

function makeZoomBar(): HTMLElement {
  const bar = el("div", {
    class: "zoom-bar",
    role: "group",
    "aria-label": "Timeline zoom",
  });
  ZOOM_PRESETS.forEach((p, i) => {
    if (i > 0) {
      bar.append(el("span", { class: "zoom-sep", "aria-hidden": "true", text: "·" }));
    }
    const btn = el("button", {
      class: `zoom-link${activeZoom === p.id ? " is-active" : ""}`,
      type: "button",
      id: `zoom-${p.id}`,
      text: p.label,
      title: p.title,
      "aria-pressed": activeZoom === p.id ? "true" : "false",
      "aria-label":
        p.id === "book" && provisionalGuess == null
          ? `${p.label} zoom — place a marker first`
          : p.label,
    });
    if (p.id === "book" && provisionalGuess == null) {
      btn.disabled = true;
      btn.title = `Place a marker to use ${p.label.toLowerCase()} zoom`;
    }
    btn.addEventListener("click", () => {
      hapticLight();
      applyZoomSelection(p.id);
      syncZoomBarUI(bar);
    });
    bar.append(btn);
  });
  return bar;
}

function makePrecisionZoomOut(): HTMLButtonElement {
  const zoomOut = el("button", {
    class: "precision-zoom-out",
    type: "button",
    id: "zoom-out-precision",
    title: "Zoom out from verse precision",
    "aria-label": "Zoom out from verse precision",
  });
  zoomOut.innerHTML = `<svg class="precision-zoom-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.25" />
    <path d="M7.75 10.5h5.5M15.25 15.25 20 20" />
  </svg>`;
  zoomOut.hidden = true;
  zoomOut.addEventListener("click", () => {
    hapticLight();
    activeZoom = null;
    strip?.zoomOutFromPrecision();
    const bar = document.querySelector<HTMLElement>(".zoom-bar");
    if (bar) syncZoomBarUI(bar);
    document.querySelector<HTMLCanvasElement>("#canon-strip")?.focus();
  });
  return zoomOut;
}

declare global {
  interface Window {
    __versemark?: {
      placeGuess: (verseIndex: number) => void;
      confirm: () => void;
      takeHint: () => void;
      getRound: () => RoundData | null;
      startDaily: () => void;
      startEndless: () => void;
      zoom: (preset: ZoomPreset | null) => void;
    };
  }
}

function installDebugApi(): void {
  window.__versemark = {
    placeGuess(verseIndex: number) {
      provisionalGuess = verseIndex;
      strip?.setProvisionalGuess(verseIndex);
      syncConfirmEnabled();
      syncGuessInputFromMarker();
    },
    confirm() {
      document.querySelector<HTMLButtonElement>("#btn-confirm")?.click();
    },
    takeHint() {
      document.querySelector<HTMLButtonElement>("#btn-hint")?.click();
    },
    getRound() {
      return round;
    },
    startDaily() {
      startMode("daily");
    },
    startEndless() {
      startMode("endless");
    },
    zoom(preset: ZoomPreset | null) {
      // null = clear; same preset twice via API always sets (use null to off)
      if (preset == null) {
        activeZoom = null;
        strip?.clearZoom();
      } else {
        activeZoom = null; // force set even if already active
        applyZoomSelection(preset);
      }
      const bar = document.querySelector(".zoom-bar");
      if (bar) syncZoomBarUI(bar as HTMLElement);
    },
  };
}

async function main(): Promise<void> {
  try {
    await loadData();
  } catch (e) {
    app.innerHTML = `<div class="home active" style="padding:2rem"><p>Failed to load data. Run <code>npm run build:data</code>.</p><pre>${String(e)}</pre></div>`;
    console.error(e);
    return;
  }
  installDebugApi();
  const params = new URLSearchParams(window.location.search);
  const sharedDaily = Number(params.get("daily"));
  const sharedBeat = Number(params.get("beat"));
  scoreToBeat = Number.isFinite(sharedBeat) && sharedBeat > 0 ? sharedBeat : null;
  if (Number.isInteger(sharedDaily) && sharedDaily !== 0) {
    startMode("daily", sharedDaily);
  } else {
    renderHome();
  }
}

main();
