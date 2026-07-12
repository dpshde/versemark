import "./styles.css";
import type { PoolItem } from "./lib/daily";
import type { PoolFile } from "./lib/daily";
import {
  startDailyRound,
  startDailyRoundForPuzzle,
  startEndlessRound,
  advanceDailyRound,
  takeHint,
  canTakeHint,
  isUsefulParagraph,
  confirmGuess,
  shareForRound,
  hintQuadrantLabel,
  currentAppState,
  type RoundData,
  type TextBundle,
} from "./lib/game";
import { CanonStrip } from "./lib/strip";
import { formatVerseLabel, BOOKS } from "./lib/books";
import { bookSegments, bookSegmentAtT, testamentSeamT, type ZoomPreset } from "./lib/axis";
import { shareText } from "./lib/share";
import {
  parseGuessText,
  progressiveInsertText,
  resolveBookGuess,
  suggestGuessPassages,
  type GuessSuggestion,
} from "./lib/guess-parse";
import { hapticLight, hapticResult, bindTapHaptics } from "./lib/haptics";
import { initSounds } from "./lib/sounds";
import {
  initInstallCapture,
  promptInstall,
  shouldOfferInstall,
  snoozeInstallOffer,
} from "./lib/install";
import {
  loadTranslation,
  saveTranslation,
  loadState,
  markAchievementsSeen,
  unseenAchievementCount,
  type TranslationId,
} from "./lib/storage";
import {
  computeMastery,
  computeDistanceTrend,
  formatMiss,
  masteryHeatColor,
  booksForFocusMode,
  genresForFocusMode,
  defaultMasteryFocusMode,
  masteryFocusMetric,
  MASTERY_FOCUS_MODES,
  type MasteryFocusMode,
  type MasteryReport,
  type MasterySlice,
  type DistanceTrendPoint,
} from "./lib/mastery";
import {
  listAchievements,
  nextClosestAchievement,
  unlockedCount,
  achievementDefForId,
  dropCapPath,
  dropCapPathsToPreload,
  type AchievementMetal,
  type AchievementView,
} from "./lib/achievements";
import {
  applyTheme,
  cycleTheme,
  loadThemePreference,
  themeLabel,
  type ThemePreference,
} from "./lib/theme";

const app = document.querySelector<HTMLDivElement>("#app")!;

let pool: PoolItem[] = [];
/** BSB + KJV text bundles for the curated pool. */
let textsByTranslation: Record<TranslationId, TextBundle> = {
  kjv: { verses: {}, paragraphs: {} },
  bsb: { verses: {}, paragraphs: {} },
};
let translation: TranslationId = "bsb";
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
/** Verse band expanded past the 3-line clamp (long verses only). */
let verseExpanded = false;
/** Player toggled expand/collapse — don't auto-expand on marker again. */
let verseExpandUserSet = false;

function activeTexts(): TextBundle {
  return textsByTranslation[translation];
}

/** Join public asset path with Vite base (handles `./` and `/foo/`). */
function assetUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1);
  if (!base.endsWith("/") && !path.startsWith("/") && base !== "./") {
    return `${base}/${path}`;
  }
  // base is `./` or ends with /
  return `${base}${path}`;
}

/**
 * Load a drop-cap; if the preferred metal file 404s, try the other metals
 * for the same motif so open-ended rungs never show an empty orange tile.
 */
function bindDropCapSrc(
  img: HTMLImageElement,
  base: string,
  dropCap: string,
  preferred: AchievementMetal
): void {
  const m = dropCap.match(
    /^(?:\.\/)?assets\/achievements\/(.+)-(bronze|gold|snow)\.webp$/
  );
  const motif = m?.[1];
  const order: AchievementMetal[] = [
    preferred,
    ...(["bronze", "gold", "snow"] as const).filter((x) => x !== preferred),
  ];
  let i = 0;
  const apply = () => {
    const metal = order[i] ?? preferred;
    img.src = assetUrl(
      base,
      motif ? dropCapPath(motif, metal) : dropCap
    );
  };
  img.onerror = () => {
    i += 1;
    if (motif && i < order.length) apply();
  };
  apply();
}

/** Drop-cap URLs already kicked off so re-visits home don't re-fetch. */
const warmedDropCapUrls = new Set<string>();

/**
 * Warm achievement drop-cap images in the background while the player is
 * on home, so the achievements screen paints art from cache.
 */
function scheduleAchievementDropCapPreload(
  state: Parameters<typeof dropCapPathsToPreload>[0]
): void {
  const base = import.meta.env.BASE_URL || "./";
  const pending: string[] = [];
  for (const path of dropCapPathsToPreload(state)) {
    const url = assetUrl(base, path);
    if (warmedDropCapUrls.has(url)) continue;
    warmedDropCapUrls.add(url);
    pending.push(url);
  }
  if (!pending.length) return;

  const warm = () => {
    for (const url of pending) {
      const img = new Image();
      img.decoding = "async";
      if ("fetchPriority" in img) {
        (img as HTMLImageElement & { fetchPriority: string }).fetchPriority =
          "low";
      }
      img.src = url;
    }
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(warm, { timeout: 1500 });
  } else {
    setTimeout(warm, 200);
  }
}

async function loadData(): Promise<void> {
  const base = import.meta.env.BASE_URL || "./";
  const [poolRes, bsbVersesRes, bsbParaRes, kjvVersesRes, kjvParaRes] =
    await Promise.all([
      fetch(`${base}data/pool.json`),
      fetch(`${base}data/verses.json`),
      fetch(`${base}data/paragraphs.json`),
      fetch(`${base}data/verses-kjv.json`),
      fetch(`${base}data/paragraphs-kjv.json`),
    ]);
  if (
    !poolRes.ok ||
    !bsbVersesRes.ok ||
    !bsbParaRes.ok ||
    !kjvVersesRes.ok ||
    !kjvParaRes.ok
  ) {
    throw new Error("Failed to load game data");
  }
  const poolFile = (await poolRes.json()) as PoolFile;
  pool = poolFile.items;
  textsByTranslation = {
    bsb: {
      verses: (await bsbVersesRes.json()) as Record<string, string>,
      paragraphs: (await bsbParaRes.json()) as TextBundle["paragraphs"],
    },
    kjv: {
      verses: (await kjvVersesRes.json()) as Record<string, string>,
      paragraphs: (await kjvParaRes.json()) as TextBundle["paragraphs"],
    },
  };
  translation = loadTranslation();
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

const THEME_ICONS: Record<ThemePreference, string> = {
  system: `<svg class="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.6"/>
    <path d="M12 3.75v16.5A8.25 8.25 0 0 1 12 3.75Z" fill="currentColor"/>
  </svg>`,
  light: `<svg class="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="3.75" stroke="currentColor" stroke-width="1.6"/>
    <path d="M12 3.5v1.75M12 18.75V20.5M3.5 12h1.75M18.75 12H20.5M6.05 6.05l1.24 1.24M16.71 16.71l1.24 1.24M6.05 17.95l1.24-1.24M16.71 7.29l1.24-1.24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  dark: `<svg class="theme-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19.5 13.1A7.5 7.5 0 1 1 10.9 4.5 6 6 0 0 0 19.5 13.1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
};

function syncThemeButton(btn: HTMLButtonElement): void {
  const pref = loadThemePreference();
  const label = themeLabel(pref);
  btn.innerHTML = THEME_ICONS[pref];
  btn.title = `Appearance: ${label}`;
  btn.setAttribute("aria-label", `Appearance: ${label}. Click to change.`);
}

/** Recolor map heat after tokens flip (inline oklch, not CSS vars). */
function refreshMasteryHeat(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    ".mastery-map-book"
  )) {
    const raw = btn.dataset.heat;
    const dist =
      raw === undefined || raw === "" ? null : Number(raw);
    btn.style.background = masteryHeatColor(
      dist == null || !Number.isFinite(dist) ? null : dist
    );
  }
}

/**
 * Theme is CSS-driven via data-theme. Never remount screens — only sync
 * chrome that paints outside the cascade (toggle icon, canvas, heat).
 */
function refreshThemeSurfaces(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    ".theme-toggle"
  )) {
    syncThemeButton(btn);
  }
  strip?.render();
  refreshMasteryHeat();
}

function onThemeToggle(): void {
  cycleTheme();
  refreshThemeSurfaces();
}

function makeThemeToggle(extraClass = ""): HTMLButtonElement {
  const btn = el("button", {
    class: `btn-ghost theme-toggle${extraClass ? ` ${extraClass}` : ""}`,
    type: "button",
    id: "btn-theme",
  });
  syncThemeButton(btn);
  btn.addEventListener("click", () => {
    hapticLight();
    onThemeToggle();
  });
  return btn;
}

function initTheme(): void {
  applyTheme(loadThemePreference());
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (loadThemePreference() !== "system") return;
    applyTheme("system");
    refreshThemeSurfaces();
  });
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

/** Quiet unlock notice (no celebration motion). */
function showUnlockToast(ids: string[]): void {
  if (!ids.length) return;
  const first = achievementDefForId(ids[0] ?? "");
  const more = ids.length > 1 ? ` · +${ids.length - 1} more` : "";
  const title = first?.title ?? "Achievement";
  const existing = document.querySelector(".unlock-toast");
  existing?.remove();
  const toast = el("div", {
    class: "unlock-toast",
    role: "status",
    "aria-live": "polite",
  });
  toast.append(
    el("p", {
      class: "unlock-toast-title",
      text: `Unlocked · ${title}${more}`,
    })
  );
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function renderAchievements(): void {
  markAchievementsSeen();
  const state = loadState();
  const mastery = computeMastery(state);
  const distanceTrend = computeDistanceTrend(state);
  const unlocks = listAchievements(state);
  const counts = unlockedCount(state);

  app.innerHTML = "";
  const screen = el("div", {
    class: "screen achievements active",
    id: "screen-achievements",
  });

  const top = el("div", { class: "achievements-top" });
  const back = el("button", {
    class: "btn-ghost",
    type: "button",
    id: "btn-achievements-home",
    "aria-label": "Home",
    title: "Home",
  });
  back.innerHTML = `<svg class="home-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.75 10.5 12 3.75l8.25 6.75" />
    <path d="M5.75 9.25v10h12.5v-10M9.5 19.25v-5.5h5v5.5" />
  </svg>`;
  back.addEventListener("click", () => {
    hapticLight();
    renderHome();
  });
  const topActions = el("div", { class: "chrome-top-actions" });
  topActions.append(makeThemeToggle(), back);
  top.append(
    el("div", {
      class: "achievements-top-spacer",
      "aria-hidden": "true",
    }),
    el("h1", { class: "achievements-heading", text: "Achievements" }),
    el("div", {
      class: "achievements-top-spacer",
      "aria-hidden": "true",
    })
  );
  screen.append(topActions, top);

  const body = el("div", { class: "achievements-body" });

  // —— Summary (boxed like canon map / focus) ——
  const summary = el("div", {
    class: "achievements-summary",
    "aria-label": "Lifetime summary",
  });
  summary.append(
    el("h2", { class: "achievements-section-label", text: "Lifetime" })
  );
  if (mastery.totalRounds === 0) {
    summary.append(
      el("p", {
        class: "achievements-empty",
        text: "Finish a daily or practice round to start your ledger.",
      })
    );
  } else {
    const grid = el("div", { class: "achievements-summary-grid" });
    const addStat = (key: string, value: string) => {
      grid.append(
        el("div", { class: "achievements-summary-stat" }, [
          el("span", { class: "achievements-summary-key", text: key }),
          el("span", { class: "achievements-summary-val", text: value }),
        ])
      );
    };
    addStat("Rounds", String(mastery.totalRounds));
    addStat("Daily", String(mastery.dailyRoundCount));
    addStat("Practice", String(mastery.practiceRoundCount));
    addStat("Exact", String(mastery.exactCount));
    addStat("Near", String(mastery.nearCount));
    if (mastery.bestStreak > 0) {
      addStat("Best streak", String(mastery.bestStreak));
    }
    summary.append(grid);
  }
  body.append(summary);

  if (mastery.totalRounds > 0) {
    const { map, focus } = makeMasterySection(mastery);
    body.append(map);

    // Radio tabs + lists sit immediately above Unlocks
    body.append(focus);
  }

  // —— Next closest locked goal, then the full unlocks log ——
  const next = nextClosestAchievement(unlocks);
  const base = import.meta.env.BASE_URL || "./";

  if (next) {
    const nextBlock = el("section", {
      class: "achievement-next",
      "aria-label": "Next closest achievement",
    });
    nextBlock.append(
      el("h2", { class: "achievements-section-label", text: "Next" })
    );
    const nextList = el("ul", {
      class: "achievements-log achievements-next-log",
    });
    nextList.append(makeAchievementRow(next, base, { featured: true }));
    nextBlock.append(nextList);
    body.append(nextBlock);
  }

  body.append(
    el("h2", {
      class: "achievements-section-label",
      text: counts.openEnded
        ? `Unlocks · ${counts.unlocked}`
        : `Unlocks · ${counts.unlocked} / ${counts.total}`,
    })
  );
  const log = el("ul", {
    class: "achievements-log",
    "aria-label": "Achievement log",
  });
  for (const a of unlocks) {
    log.append(makeAchievementRow(a, base));
  }
  body.append(log);
  if (mastery.totalRounds > 0) {
    body.append(makeDistanceTrend(distanceTrend));
  }

  screen.append(body);
  app.append(screen);
}

function trendPeriodLabel(point: DistanceTrendPoint): string {
  const { month, granularity } = point;
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  if (granularity === "year") return String(year);
  if (granularity === "quarter") {
    return `Q${Math.floor((monthNumber - 1) / 3) + 1} ${String(year).slice(-2)}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "2-digit",
  }).format(new Date(year, monthNumber - 1, 1));
}

function makeDistanceTrend(points: DistanceTrendPoint[]): HTMLElement {
  const panel = el("section", {
    class: "distance-trend",
    "aria-labelledby": "distance-trend-title",
  });
  const heading = el("div", { class: "distance-trend-heading" }, [
    el("h2", {
      class: "achievements-section-label",
      id: "distance-trend-title",
      text: "Distance over time",
    }),
    el("span", {
      class: "distance-trend-note",
      text: `${points[0]?.granularity ?? "month"}ly · closer to zero is better`,
    }),
  ]);
  panel.append(heading);

  const latest = points[points.length - 1];
  if (!latest) return panel;

  const width = 320;
  const height = 104;
  const left = 34;
  const right = 60;
  const top = 8;
  const bottom = 23;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxDistance = Math.max(
    1,
    ...points.flatMap((point) => [point.medianDistance, point.avgDistance])
  );
  const monthOrdinal = (month: string) => {
    const [year, monthNumber] = month.split("-").map(Number);
    return year! * 12 + monthNumber! - 1;
  };
  const firstMonth = monthOrdinal(points[0]!.month);
  const monthSpan = monthOrdinal(latest.month) - firstMonth;
  const x = (index: number) =>
    monthSpan === 0
      ? left + plotWidth / 2
      : left +
        ((monthOrdinal(points[index]!.month) - firstMonth) / monthSpan) *
          plotWidth;
  const y = (distance: number) =>
    top + plotHeight - (distance / maxDistance) * plotHeight;
  const pathFor = (value: (point: DistanceTrendPoint) => number) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value(point)).toFixed(1)}`
      )
      .join(" ");

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("distance-trend-chart");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${latest.granularity}ly distance trend through ${trendPeriodLabel(latest)}. Latest median ${formatMiss(latest.medianDistance)}; average ${formatMiss(latest.avgDistance)}.`
  );

  for (const fraction of [0, 0.5, 1]) {
    const gridY = top + fraction * plotHeight;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("class", "distance-trend-grid");
    line.setAttribute("x1", String(left));
    line.setAttribute("x2", String(width - right));
    line.setAttribute("y1", String(gridY));
    line.setAttribute("y2", String(gridY));
    svg.append(line);
  }

  const topLabel = document.createElementNS(ns, "text");
  topLabel.setAttribute("class", "distance-trend-axis");
  topLabel.setAttribute("x", "0");
  topLabel.setAttribute("y", String(top + 4));
  topLabel.textContent =
    maxDistance < 20
      ? `${Math.round(maxDistance)}v`
      : `${Math.max(1, Math.round(maxDistance / 26))} ch`;
  const zeroLabel = document.createElementNS(ns, "text");
  zeroLabel.setAttribute("class", "distance-trend-axis");
  zeroLabel.setAttribute("x", "0");
  zeroLabel.setAttribute("y", String(top + plotHeight + 4));
  zeroLabel.textContent = "exact";
  svg.append(topLabel, zeroLabel);

  for (const [className, value] of [
    ["is-average", (point: DistanceTrendPoint) => point.avgDistance],
    ["is-median", (point: DistanceTrendPoint) => point.medianDistance],
  ] as const) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("class", `distance-trend-line ${className}`);
    path.setAttribute("d", pathFor(value));
    svg.append(path);
    for (const [index, point] of points.entries()) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("class", `distance-trend-dot ${className}`);
      dot.setAttribute("cx", x(index).toFixed(1));
      dot.setAttribute("cy", y(value(point)).toFixed(1));
      dot.setAttribute("r", "2.4");
      svg.append(dot);
    }
  }

  const averageY = y(latest.avgDistance);
  const medianY = y(latest.medianDistance);
  const labels = [
    { text: "Average", className: "is-average", y: averageY },
    { text: "Median", className: "is-median", y: medianY },
  ];
  if (Math.abs(averageY - medianY) < 12) {
    const upper = averageY <= medianY ? labels[0]! : labels[1]!;
    const lower = upper === labels[0] ? labels[1]! : labels[0]!;
    upper.y = Math.max(top + 4, upper.y - 6);
    lower.y = Math.min(top + plotHeight, lower.y + 6);
  }
  for (const item of labels) {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("class", `distance-trend-direct-label ${item.className}`);
    label.setAttribute("x", String(width - right + 7));
    label.setAttribute("y", String(item.y + 3));
    label.textContent = item.text;
    svg.append(label);
  }

  const labelIndexes = points.length === 1 ? [0] : [0, points.length - 1];
  for (const index of labelIndexes) {
    const label = document.createElementNS(ns, "text");
    label.setAttribute("class", "distance-trend-month");
    label.setAttribute("x", x(index).toFixed(1));
    label.setAttribute("y", String(height - 4));
    label.setAttribute(
      "text-anchor",
      points.length === 1 ? "middle" : index === 0 ? "start" : "end"
    );
    label.textContent = trendPeriodLabel(points[index]!);
    svg.append(label);
  }

  panel.append(svg);
  return panel;
}

function makeAchievementRow(
  a: AchievementView,
  base: string,
  opts: { featured?: boolean } = {}
): HTMLElement {
  const classes = [
    "achievement-row",
    a.unlocked ? "is-unlocked" : "is-locked",
    `metal-${a.metal}`,
  ];
  if (opts.featured) classes.push("is-next");
  const li = el("li", { class: classes.join(" ") });
  const frame = el("div", {
    class: `achievement-dropcap-frame metal-${a.metal}`,
    "aria-hidden": "true",
  });
  const cap = document.createElement("img");
  cap.className = "achievement-dropcap";
  cap.alt = "";
  cap.width = opts.featured ? 72 : 56;
  cap.height = opts.featured ? 72 : 56;
  cap.decoding = "async";
  cap.loading = opts.featured ? "eager" : "lazy";
  bindDropCapSrc(cap, base, a.dropCap, a.metal);
  frame.append(cap);

  let meta = "Locked";
  if (a.unlocked) {
    const d = a.unlockedAt ? new Date(a.unlockedAt) : null;
    meta =
      d && Number.isFinite(d.getTime())
        ? d.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "Unlocked";
  } else if (a.threshold != null && a.current != null && a.threshold > 0) {
    meta = `${a.current.toLocaleString()} / ${a.threshold.toLocaleString()}`;
  }

  const head = el("p", { class: "achievement-head" }, [
    el("span", { class: "achievement-title", text: a.title }),
  ]);
  const desc = el("p", { class: "achievement-desc", text: a.description });
  const metaLine = el("span", { class: "achievement-meta", text: meta });
  const text = el("div", { class: "achievement-copy" });
  text.append(head, desc, metaLine);
  if (!a.unlocked && a.progress != null && (a.progress > 0 || opts.featured)) {
    const bar = el("div", { class: "achievement-progress" }, [
      el("div", {
        class: "achievement-progress-fill",
        style: `width:${Math.round(Math.max(0, a.progress) * 100)}%`,
      }),
    ]);
    text.append(bar);
  }
  li.append(frame, text);
  return li;
}

function masteryAriaLabel(
  slice: MasterySlice | undefined,
  bookName: string
): string {
  if (!slice) return `${bookName}, not tested yet`;
  const hits = [
    slice.exactCount > 0 ? `${slice.exactCount} exact` : null,
    slice.nearCount > 0 ? `${slice.nearCount} near` : null,
  ].filter((p): p is string => p != null);
  const parts = [
    bookName,
    `${slice.rounds} round${slice.rounds === 1 ? "" : "s"}`,
    formatMiss(slice.medianDistance),
    ...hits,
  ];
  return parts.join(", ");
}

function fillMasteryDetail(
  detail: HTMLElement,
  slice: MasterySlice | undefined,
  bookName: string | null
): void {
  detail.replaceChildren();
  if (!bookName) {
    detail.append(
      el("span", { class: "mastery-map-detail-meta", text: "No books measured yet." })
    );
    return;
  }
  detail.append(el("span", { class: "mastery-map-detail-name", text: bookName }));
  if (!slice) {
    detail.append(
      el("span", { class: "mastery-map-detail-meta", text: "Not tested yet" })
    );
    return;
  }
  const hits = [
    slice.exactCount > 0 ? `${slice.exactCount} exact` : null,
    slice.nearCount > 0 ? `${slice.nearCount} near` : null,
  ].filter((p): p is string => p != null);
  const meta = [
    formatMiss(slice.medianDistance),
    `${slice.rounds} round${slice.rounds === 1 ? "" : "s"}`,
    ...hits,
  ].join(" · ");
  detail.append(el("span", { class: "mastery-map-detail-meta", text: meta }));
}

function masteryMapChevron(): HTMLElement {
  const chevron = el("span", {
    class: "mastery-map-detail-chevron",
    "aria-hidden": "true",
  });
  chevron.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
  return chevron;
}

/** Default selection: weakest measured book, else first book with any data. */
function defaultMasteryFocus(mastery: MasteryReport): string | null {
  const measured = Object.values(mastery.bookHeat);
  if (!measured.length) return null;
  measured.sort((a, b) => b.medianDistance - a.medianDistance);
  return measured[0]!.id;
}

function makeMasterySection(mastery: MasteryReport): {
  map: HTMLElement;
  focus: HTMLElement;
} {
  const map = el("div", { class: "mastery-map" });
  map.append(
    el("h2", { class: "achievements-section-label", text: "Canon map" })
  );

  const measured = Object.keys(mastery.bookHeat).length;
  if (measured === 0) {
    map.append(
      el("p", {
        class: "mastery-map-hint",
        text: "Play a few more rounds — tested books will warm on the rail.",
      })
    );
  }

  const rail = el("div", {
    class: "mastery-map-rail",
    role: "group",
    "aria-label": "Canon mastery by book",
  });

  let selected = defaultMasteryFocus(mastery);
  let mode: MasteryFocusMode = defaultMasteryFocusMode(mastery);
  const mapButtons: HTMLButtonElement[] = [];
  const listButtons: HTMLButtonElement[] = [];
  const pickerButtons: HTMLButtonElement[] = [];
  const segments = bookSegments();

  const picker = el("div", { class: "mastery-map-picker" });
  const detailBtn = el("button", {
    class: "mastery-map-detail",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "mastery-map-book-picker",
    "aria-label": "Choose a book on the canon map",
  });
  const detailMain = el("span", {
    class: "mastery-map-detail-main",
    "aria-live": "polite",
  });
  detailBtn.append(detailMain, masteryMapChevron());
  const pickerList = el("ul", {
    class: "mastery-map-picker-list",
    id: "mastery-map-book-picker",
    role: "listbox",
    "aria-label": "Books",
  });
  pickerList.hidden = true;
  picker.append(detailBtn, pickerList);

  let pickerOpen = false;
  const setPickerOpen = (open: boolean) => {
    pickerOpen = open;
    detailBtn.setAttribute("aria-expanded", open ? "true" : "false");
    detailBtn.classList.toggle("is-expanded", open);
    pickerList.hidden = !open;
    if (open) {
      const active = pickerButtons.find((b) => b.dataset.osis === selected);
      // After layout, center the current book in the picker viewport.
      requestAnimationFrame(() => {
        active?.scrollIntoView({ block: "center", inline: "nearest" });
      });
    }
  };

  detailBtn.addEventListener("click", () => {
    hapticLight();
    setPickerOpen(!pickerOpen);
  });

  const syncPickerSelection = () => {
    for (const b of pickerButtons) {
      const on = b.dataset.osis === selected;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    }
  };

  const selectAtClientX = (clientX: number, haptic: boolean) => {
    const rect = rail.getBoundingClientRect();
    if (rect.width <= 0) return;
    const seg = bookSegmentAtT((clientX - rect.left) / rect.width, segments);
    if (!seg || seg.osis === selected) return;
    if (haptic) hapticLight();
    if (pickerOpen) setPickerOpen(false);
    selectBook(seg.osis, seg.name, mastery.bookHeat[seg.osis]);
  };

  let scrubbing = false;
  let suppressClick = false;

  rail.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    scrubbing = true;
    suppressClick = true;
    rail.classList.add("is-scrubbing");
    rail.setPointerCapture(e.pointerId);
    selectAtClientX(e.clientX, true);
  });

  rail.addEventListener("pointermove", (e) => {
    if (!scrubbing) return;
    selectAtClientX(e.clientX, true);
  });

  const endScrub = (e: PointerEvent) => {
    if (!scrubbing) return;
    scrubbing = false;
    rail.classList.remove("is-scrubbing");
    if (rail.hasPointerCapture(e.pointerId)) {
      rail.releasePointerCapture(e.pointerId);
    }
    // Click follows pointerup in the same turn; clear afterward.
    window.setTimeout(() => {
      suppressClick = false;
    }, 0);
  };

  rail.addEventListener("pointerup", endScrub);
  rail.addEventListener("pointercancel", endScrub);

  for (const segment of segments) {
    const slice = mastery.bookHeat[segment.osis];
    const btn = el("button", {
      class: "mastery-map-book",
      type: "button",
      "data-osis": segment.osis,
      "aria-label": masteryAriaLabel(slice, segment.name),
      "aria-pressed": selected === segment.osis ? "true" : "false",
      title: segment.name,
    });
    const span = Math.max(0, segment.t1 - segment.t0);
    btn.style.left = `${segment.t0 * 100}%`;
    btn.style.width = `${span * 100}%`;
    if (slice) btn.dataset.heat = String(slice.medianDistance);
    btn.style.background = masteryHeatColor(
      slice ? slice.medianDistance : null
    );
    if (selected === segment.osis) btn.classList.add("is-selected");
    btn.addEventListener("click", (e) => {
      // Pointer scrub already selected; keep click for keyboard activation.
      if (suppressClick) {
        e.preventDefault();
        suppressClick = false;
        return;
      }
      hapticLight();
      selectBook(segment.osis, segment.name, slice);
    });
    mapButtons.push(btn);
    rail.append(btn);

    const opt = el("li", { class: "mastery-map-picker-row", role: "none" });
    const optBtn = el("button", {
      class: "mastery-map-picker-btn",
      type: "button",
      role: "option",
      "data-osis": segment.osis,
      "aria-selected": selected === segment.osis ? "true" : "false",
    });
    if (selected === segment.osis) optBtn.classList.add("is-selected");
    const miss = slice
      ? formatMiss(slice.medianDistance)
      : "Not tested yet";
    optBtn.append(
      el("span", { class: "mastery-map-picker-name", text: segment.name }),
      el("span", { class: "mastery-map-picker-meta", text: miss })
    );
    optBtn.addEventListener("click", () => {
      hapticLight();
      selectBook(segment.osis, segment.name, slice);
      setPickerOpen(false);
    });
    pickerButtons.push(optBtn);
    opt.append(optBtn);
    pickerList.append(opt);
  }

  const seam = el("span", { class: "mastery-map-seam", "aria-hidden": "true" });
  seam.style.left = `${testamentSeamT() * 100}%`;
  rail.append(seam);

  map.append(rail);
  map.append(
    el("div", { class: "mastery-map-ends" }, [
      el("span", { text: "Genesis" }),
      el("span", { text: "Revelation" }),
    ])
  );

  const focusSeg = segments.find((s) => s.osis === selected);
  const focusSlice = selected ? mastery.bookHeat[selected] : undefined;
  fillMasteryDetail(detailMain, focusSlice, focusSeg?.name ?? null);
  map.append(picker);
  map.append(
    el("div", {
      class: "mastery-map-legend",
      "aria-hidden": "true",
    }, [
      el("span", { text: "Closer" }),
      el("span", { class: "mastery-map-legend-ramp" }),
      el("span", { text: "Farther" }),
    ])
  );

  // Radio tabs + lists — placed just above Unlocks by the caller
  const focus = el("div", { class: "mastery-focus-block" });
  const modeBar = el("div", {
    class: "mastery-focus",
    role: "radiogroup",
    "aria-label": "Mastery focus",
  });
  const modeButtons: HTMLButtonElement[] = [];
  const listsHost = el("div", { class: "mastery-lists" });

  const catalog = bookSegments().map((s) => ({
    osis: s.osis,
    name: s.name,
  }));

  const MASTERY_PREVIEW = 4;
  let booksExpanded = false;
  let genresExpanded = false;

  const syncListSelection = () => {
    for (const b of listButtons) {
      const on = b.dataset.osis === selected;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) {
        const reduce = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        b.scrollIntoView({
          block: "nearest",
          behavior: reduce ? "auto" : "smooth",
        });
      }
    }
  };

  const selectBook = (
    osis: string,
    name: string,
    slice: MasterySlice | undefined
  ) => {
    selected = osis;
    for (const b of mapButtons) {
      const on = b.dataset.osis === osis;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    fillMasteryDetail(detailMain, slice, name);
    syncPickerSelection();

    const visible = listButtons.some((b) => b.dataset.osis === osis);
    if (!visible && !booksExpanded) {
      booksExpanded = true;
      renderLists(mode);
      syncListSelection();
      return;
    }
    syncListSelection();
  };

  const renderLists = (next: MasteryFocusMode) => {
    mode = next;
    for (const b of modeButtons) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    }

    listsHost.replaceChildren();
    listButtons.length = 0;

    const books = booksForFocusMode(mastery, mode, catalog);
    appendCollapsibleList({
      title: "Books",
      items: books,
      expanded: booksExpanded,
      empty:
        mode === "touch"
          ? "Land a few exact or near guesses to rank closer hits."
          : "Finish a few rounds to see where misses run farther.",
      onToggle: () => {
        booksExpanded = !booksExpanded;
        hapticLight();
        renderLists(mode);
      },
      build: (slice) => buildBookList(slice, mode),
    });

    const genres = genresForFocusMode(mastery, mode);
    appendCollapsibleList({
      title: "Genres",
      items: genres,
      expanded: genresExpanded,
      empty: "Play across more of the canon to measure genres.",
      onToggle: () => {
        genresExpanded = !genresExpanded;
        hapticLight();
        renderLists(mode);
      },
      build: (slice) => buildGenreList(slice, mode),
    });
  };

  function appendCollapsibleList(opts: {
    title: string;
    items: MasterySlice[];
    expanded: boolean;
    empty: string;
    onToggle: () => void;
    build: (items: MasterySlice[]) => HTMLElement;
  }): void {
    const needsToggle = opts.items.length > MASTERY_PREVIEW;

    if (needsToggle) {
      const header = el("button", {
        class: "mastery-list-header",
        type: "button",
        "aria-expanded": opts.expanded ? "true" : "false",
      });
      if (opts.expanded) header.classList.add("is-expanded");
      const chevron = el("span", {
        class: "mastery-list-chevron",
        "aria-hidden": "true",
      });
      chevron.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
      header.append(
        el("span", { class: "mastery-list-header-label", text: opts.title }),
        chevron
      );
      header.addEventListener("click", opts.onToggle);
      listsHost.append(header);
    } else {
      listsHost.append(
        el("h2", { class: "achievements-section-label", text: opts.title })
      );
    }

    if (!opts.items.length) {
      listsHost.append(
        el("p", { class: "achievements-sparse", text: opts.empty })
      );
      return;
    }

    const visible =
      needsToggle && !opts.expanded
        ? opts.items.slice(0, MASTERY_PREVIEW)
        : opts.items;
    listsHost.append(opts.build(visible));
  }

  function buildBookList(
    books: MasterySlice[],
    focusMode: MasteryFocusMode
  ): HTMLElement {
    const ul = el("ul", {
      class: "mastery-list",
      "aria-label": "Book mastery",
    });
    for (const s of books) {
      const row = el("li", { class: "mastery-row" });
      const slice = s.rounds > 0 ? s : undefined;
      const btn = el("button", {
        class: "mastery-row-btn",
        type: "button",
        "data-osis": s.id,
        "aria-pressed": selected === s.id ? "true" : "false",
      });
      if (selected === s.id) btn.classList.add("is-selected");
      const count =
        s.rounds > 0
          ? ` · ${s.rounds} round${s.rounds === 1 ? "" : "s"}`
          : "";
      const name = el("span", { class: "mastery-name", text: s.label }, [
        el("span", { class: "mastery-count", text: count }),
      ]);
      btn.append(
        el("div", { class: "mastery-row-main" }, [
          name,
          el("span", {
            class: "mastery-miss",
            text: masteryFocusMetric(s, focusMode),
          }),
        ])
      );
      btn.addEventListener("click", () => {
        hapticLight();
        selectBook(s.id, s.label, slice);
      });
      listButtons.push(btn);
      row.append(btn);
      ul.append(row);
    }
    return ul;
  }

  function buildGenreList(
    genres: MasterySlice[],
    focusMode: MasteryFocusMode
  ): HTMLElement {
    const ul = el("ul", {
      class: "mastery-list",
      "aria-label": "Genre mastery",
    });
    for (const s of genres) {
      const count =
        s.rounds > 0
          ? ` · ${s.rounds} round${s.rounds === 1 ? "" : "s"}`
          : "";
      const name = el("span", { class: "mastery-name", text: s.label }, [
        el("span", { class: "mastery-count", text: count }),
      ]);
      const row = el("li", { class: "mastery-row" }, [
        el("div", { class: "mastery-row-main" }, [
          name,
          el("span", {
            class: "mastery-miss",
            text: masteryFocusMetric(s, focusMode),
          }),
        ]),
      ]);
      ul.append(row);
    }
    return ul;
  }

  for (const m of MASTERY_FOCUS_MODES) {
    const btn = el("button", {
      class: "mastery-focus-btn",
      type: "button",
      role: "radio",
      "data-mode": m.id,
      text: m.label,
      "aria-checked": mode === m.id ? "true" : "false",
    });
    if (mode === m.id) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      hapticLight();
      if (m.id !== mode) {
        booksExpanded = false;
        genresExpanded = false;
      }
      renderLists(m.id);
    });
    modeButtons.push(btn);
    modeBar.append(btn);
  }

  focus.append(modeBar, listsHost);
  renderLists(mode);

  return { map, focus };
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

  const unseen = unseenAchievementCount(state);
  const crown = el("button", {
    class: "home-achievements-btn btn-ghost",
    type: "button",
    id: "btn-achievements",
    "aria-label":
      unseen > 0
        ? `Achievements, ${unseen} new`
        : "Achievements",
    title: "Achievements",
  });
  crown.innerHTML = `<svg class="crown-icon" viewBox="0 0 256 256" fill="none" aria-hidden="true">
  <path d="M54.71,200H201.29a8,8,0,0,0,7.88-6.61l22.7-104A8,8,0,0,0,218,82.76L176,128,135.26,36.65a8,8,0,0,0-14.52,0L80,128,38,82.76a8,8,0,0,0-13.9,6.66l22.7,104A8,8,0,0,0,54.71,200Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
</svg>`;
  if (unseen > 0) {
    crown.append(
      el("span", {
        class: "achievements-dot",
        "aria-hidden": "true",
      })
    );
  }
  crown.addEventListener("click", () => {
    hapticLight();
    renderAchievements();
  });
  const topActions = el("div", { class: "chrome-top-actions" });
  topActions.append(makeThemeToggle(), crown);
  screen.append(topActions);

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
          class: "btn-primary btn-with-icon",
          id: "btn-daily",
          type: "button",
        });
        b.innerHTML = `<svg class="btn-icon" viewBox="0 0 256 256" fill="none" aria-hidden="true">
  <rect x="40" y="40" width="176" height="176" rx="8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
  <line x1="176" y1="24" x2="176" y2="56" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
  <line x1="80" y1="24" x2="80" y2="56" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
  <line x1="40" y1="88" x2="216" y2="88" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
  <polyline points="88 128 104 120 104 184" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
  <path d="M138.14,128a16,16,0,1,1,26.64,17.63L136,184h32" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
</svg><span>Daily</span>`;
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

  // Translation credit: wide-screen footer only (hidden on mobile via CSS).
  const footer = el("footer", {
    class: "home-footer",
    "aria-label": "Text credit",
  });
  footer.append(
    el("p", {
      class: "attribution",
      text: "Text · KJV · BSB",
    })
  );

  screen.append(panel, footer);
  app.append(screen);

  // Cache drop-cap art while home is idle so the crown opens without
  // a cascade of image fetches.
  scheduleAchievementDropCapPreload(state);
}

function startMode(mode: "daily" | "endless", puzzleNumber?: number): void {
  if (mode === "daily" && puzzleNumber == null) scoreToBeat = null;
  chromeRo?.disconnect();
  chromeRo = null;
  strip?.destroy();
  strip = null;
  activeZoom = null;
  guessInputInvalid = false;
  const texts = activeTexts();
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

/** Refresh round verse + paragraph strings from the selected translation. */
function applyTranslationToRound(): void {
  if (!round) return;
  const t = activeTexts();
  const key = round.poolItem.ref;
  round.verseText = t.verses[key] ?? "(text unavailable)";
  round.paragraph = t.paragraphs[key] ?? null;
}

function setTranslation(next: TranslationId): void {
  if (next === translation) return;
  translation = next;
  saveTranslation(next);
  applyTranslationToRound();
  // Patch live verse chrome without rebuilding the whole play surface.
  const verseEl = document.querySelector("#verse-text");
  if (verseEl && round) verseEl.textContent = round.verseText;
  const hintHost = document.querySelector("#hint-panel");
  if (hintHost && round) {
    const rebuilt = makeHintPanel(round);
    if (rebuilt) hintHost.replaceWith(rebuilt);
    else hintHost.remove();
  } else if (!hintHost && round) {
    const dock = document.querySelector(".dock");
    const panel = makeHintPanel(round);
    if (dock && panel) dock.prepend(panel);
  }
  document
    .querySelectorAll<HTMLButtonElement>(".translation-chip button")
    .forEach((btn) => {
      const id = btn.dataset.translation as TranslationId | undefined;
      btn.classList.toggle("is-active", id === translation);
      btn.setAttribute("aria-pressed", id === translation ? "true" : "false");
    });
  // Translation swap can change wrap length — refresh expand toggle + rail inset.
  requestAnimationFrame(() => {
    syncVerseExpandToggle();
    syncChromeInsets();
  });
}

/** BSB / KJV segmented switch — same material as mastery focus. */
function makeTranslationChip(): HTMLElement {
  const chip = el("div", {
    class: "translation-chip",
    role: "group",
    "aria-label": "Bible translation",
  });
  // BSB first (default), KJV second — quiet secondary control.
  for (const id of ["bsb", "kjv"] as const) {
    const btn = el("button", {
      type: "button",
      class: id === translation ? "is-active" : "",
      "data-translation": id,
      "aria-pressed": id === translation ? "true" : "false",
      text: id.toUpperCase(),
      title:
        id === "kjv"
          ? "King James Version"
          : "Berean Standard Bible",
    });
    btn.addEventListener("click", () => {
      hapticLight();
      setTranslation(id);
    });
    chip.append(btn);
  }
  return chip;
}

function renderPlay(): void {
  if (!round) return;
  chromeRo?.disconnect();
  chromeRo = null;
  strip?.destroy();
  strip = null;
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
  const topActions = el("div", { class: "chrome-top-actions" });
  topActions.append(makeThemeToggle(), back);
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
  const hasMarker = provisionalGuess != null;

  /*
   * Header center: OT · NT · Book (playing) with BSB | KJV to the right.
   * On result, only the translation chip sits in that slot.
   */
  const center = el("div", {
    class: "top-center",
    role: "group",
    "aria-label": "Map and translation",
  });
  if (round.phase === "playing") {
    center.append(makeZoomBar());
  }
  center.append(makeTranslationChip());
  top.append(center, mode);

  /* Top chrome is one grid row (center + mode); theme/home share home's corner. */
  const chrome = el("div", { class: "hud-chrome" });
  chrome.append(top);
  hud.append(topActions, chrome);

  /* Verse band — same horizontal measure as the dock */
  const verseBand = el("div", { class: "verse-band" });
  const card = el("div", { class: "card", id: "verse-card" });
  verseExpandUserSet = false;
  // Long verses start fully open; player collapses to reclaim timeline.
  verseExpanded = true;
  hud.dataset.verseExpanded = "true";
  const verseText = el("p", {
    class: "verse",
    id: "verse-text",
    text: round.verseText,
  });
  const verseExpand = el("button", {
    type: "button",
    class: "verse-expand",
    id: "verse-expand",
    "aria-expanded": "true",
    "aria-controls": "verse-text",
    "aria-label": "Collapse verse",
    hidden: "true",
  });
  const verseChevron = el("span", {
    class: "verse-expand-chevron",
    "aria-hidden": "true",
  });
  verseChevron.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
  verseExpand.append(verseChevron);
  const toggleVerseExpand = () => {
    const toggle = document.querySelector<HTMLButtonElement>("#verse-expand");
    if (!toggle || toggle.hidden) return;
    hapticLight();
    verseExpandUserSet = true;
    setVerseExpanded(!verseExpanded);
  };
  verseText.addEventListener("click", toggleVerseExpand);
  verseExpand.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVerseExpand();
  });
  card.append(verseText, verseExpand);
  verseBand.append(card);
  hud.append(verseBand);

  /* Mid row: board fills the free band between verse and dock */
  const hudMid = el("div", { class: "hud-mid" });
  hudMid.append(board);
  // Visual cue only during rough place; refine uses notches + dock Confirm.
  const cueHidden = provisionalGuess != null;
  hudMid.append(
    el("p", {
      class: "sr-only",
      id: "timeline-instructions",
      text: "Place a marker roughly on the canon timeline. The view zooms in so you can refine with verse notches. Or type a Bible reference. Arrow keys move one verse, Shift plus arrow moves ten, Enter confirms.",
    }),
    el("p", {
      class: `timeline-cue${cueHidden ? " is-refine is-hidden" : ""}`,
      id: "timeline-cue",
      "aria-hidden": "true",
      text: cueHidden ? "" : "Rough placement",
    })
  );
  hud.append(hudMid);

  const dock = el("div", { class: "dock" });
  hud.dataset.hasMarker = hasMarker ? "true" : "false";

  /* Hints sit under the timeline, above readout / actions */
  const hintPanel = makeHintPanel(round);
  if (hintPanel) dock.append(hintPanel);

  if (round.phase === "playing") {
    // Type field appears after a marker (rough → refine); zoom/hint same.
    const guessTools = el("div", { class: "guess-tools" });
    if (!hasMarker) guessTools.hidden = true;
    guessTools.append(makePrecisionZoomOut(), makeGuessInput());
    dock.append(guessTools);

    const actions = el("div", { class: "actions", id: "play-actions" });
    const hintBtn = el("button", {
      class: "btn-secondary",
      type: "button",
      id: "btn-hint",
      text: "Hint",
    });
    const hintsExhausted = !canTakeHint(round);
    if (hintsExhausted) hintBtn.disabled = true;
    // Hidden until a marker exists — no score path without a guess.
    if (!hasMarker) {
      hintBtn.hidden = true;
      hintBtn.tabIndex = -1;
    }
    hintBtn.setAttribute(
      "aria-label",
      hintsExhausted ? "All hints used" : "Take a hint"
    );
    hintBtn.title = hintsExhausted
      ? "All hints used"
      : round.hintStep === 1
        ? "Shows surrounding text or testament half · score ×2"
        : "Shows testament half · score ×1";
    hintBtn.addEventListener("click", () => {
      if (!round || !canTakeHint(round)) return;
      hapticLight();
      round = takeHint(round);
      renderPlay();
    });

    const confirm = el("button", {
      class: "btn-primary",
      type: "button",
      id: "btn-confirm",
      text: "Confirm",
      "aria-label": "Confirm your guess",
    });
    confirm.disabled = provisionalGuess == null || guessInputInvalid;
    confirm.title =
      provisionalGuess == null
        ? "Place a marker or type a reference first"
        : guessInputInvalid
          ? "Fix the reference before confirming"
          : "Lock in your guess";
    // No selection yet — drop the whole action row so the rail owns the height.
    if (!hasMarker) actions.hidden = true;
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
      const { round: next, newlyUnlocked } = confirmGuess(round, locked);
      round = next;
      provisionalGuess = locked;
      activeZoom = null;
      hapticResult(locked === round.poolItem.verseIndex);
      // Rebuild the play surface in result mode (new strip snaps full-canon).
      renderPlay();
      if (newlyUnlocked.length) showUnlockToast(newlyUnlocked);
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
    syncPlayStage();
    const zoomBar = document.querySelector<HTMLElement>(".zoom-bar");
    if (zoomBar) syncZoomBarUI(zoomBar);
    // Verse may grow when expand lifts the clamp — remeasure free band.
    requestAnimationFrame(() => {
      syncVerseExpandToggle();
      syncChromeInsets();
    });
  });
  strip.setOnGuessCommit(() => {
    document.querySelector<HTMLButtonElement>("#btn-confirm")?.click();
  });
  strip.setOnFreeViewChange(() => {
    activeZoom = null;
    syncPlayStage();
    const zoomBar = document.querySelector<HTMLElement>(".zoom-bar");
    if (zoomBar) syncZoomBarUI(zoomBar);
  });
  if (round.phase === "revealed" && round.guessVerseIndex != null) {
    // Result: OT/NT frame (or full map if cross-testament) — reveal sets span.
    strip.setProvisionalGuess(round.guessVerseIndex);
    strip.lockGuess();
    strip.reveal(round.poolItem.verseIndex);
  } else if (provisionalGuess != null) {
    strip.setProvisionalGuess(provisionalGuess);
  }

  /* Board is laid out by the HUD mid row — resize + publish verse-band bottom. */
  chromeRo = new ResizeObserver(() => {
    syncChromeInsets();
  });
  chromeRo.observe(board);
  chromeRo.observe(hudMid);
  chromeRo.observe(verseBand);
  requestAnimationFrame(() => {
    syncVerseExpandToggle();
    syncChromeInsets();
  });
}

/**
 * Keep wide guess-tools anchored under the verse. Board layout still comes
 * from the HUD mid row — this only publishes --verse-band-bottom for CSS.
 */
function syncChromeInsets(): void {
  strip?.resize();
  const verseBand = document.querySelector(".verse-band");
  const hud = document.querySelector<HTMLElement>(".hud");
  if (!verseBand || !hud) return;
  hud.style.setProperty(
    "--verse-band-bottom",
    `${verseBand.getBoundingClientRect().bottom}px`
  );
}

/** Apply expand/collapse to the verse band and keep the toggle labeled. */
function setVerseExpanded(next: boolean): void {
  verseExpanded = next;
  const hud = document.querySelector<HTMLElement>(".hud");
  const toggle = document.querySelector<HTMLButtonElement>("#verse-expand");
  if (hud) hud.dataset.verseExpanded = next ? "true" : "false";
  if (toggle) {
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      next ? "Collapse verse" : "Expand verse"
    );
  }
  requestAnimationFrame(() => {
    syncVerseExpandToggle();
    syncChromeInsets();
  });
}

/**
 * Show the expand chevron only when the verse overflows the 3-line clamp.
 * Probes full wrap height via a hidden clone — line-clamp makes scrollHeight
 * unreliable on the live node (often equals clientHeight when clamped).
 */
function syncVerseExpandToggle(): void {
  const hud = document.querySelector<HTMLElement>(".hud");
  const verse = document.querySelector<HTMLElement>("#verse-text");
  const toggle = document.querySelector<HTMLButtonElement>("#verse-expand");
  if (!hud || !verse || !toggle) return;
  // Not laid out yet — don't treat as "short" or we clamp long verses away.
  if (verse.clientWidth <= 0) return;

  const overflows = verseOverflowsClamp(verse);
  toggle.hidden = !overflows;
  verse.classList.toggle("is-toggleable", overflows);

  const expanded = hud.dataset.verseExpanded === "true";
  if (!overflows && expanded) {
    // Short enough at this size — drop expanded chrome so the rail keeps height.
    verseExpanded = false;
    hud.dataset.verseExpanded = "false";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Expand verse");
  } else if (overflows && !verseExpandUserSet && !expanded) {
    // Default open for long verses once measurement is reliable.
    verseExpanded = true;
    hud.dataset.verseExpanded = "true";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Collapse verse");
  }
}

/** True when verse text needs more than the collapsed 3-line budget. */
function verseOverflowsClamp(verse: HTMLElement): boolean {
  const rootPx =
    parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const collapsedMax = rootPx * 1.02 * 1.4 * 3 + 2;
  const width = verse.clientWidth;
  if (width <= 0) return false;

  const probe = verse.cloneNode(true) as HTMLElement;
  probe.removeAttribute("id");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "pointer-events:none",
    "inset:auto auto auto 0",
    `width:${width}px`,
    "display:block",
    "-webkit-line-clamp:unset",
    "line-clamp:unset",
    "overflow:visible",
    "height:auto",
    "max-height:none",
    "margin:0",
  ].join(";");
  verse.parentElement!.appendChild(probe);
  const fullHeight = probe.scrollHeight;
  probe.remove();
  return fullHeight > collapsedMax;
}

function makeGuessInput(): HTMLElement {
  const listId = "guess-suggestions";
  const wrap = el("div", { class: "guess-field", id: "guess-readout" });
  const error = el("p", {
    class: "guess-error",
    id: "guess-error",
    "aria-live": "polite",
    text: "Try a reference like John 3:16.",
  });
  const list = el("div", {
    class: "guess-suggestions",
    id: listId,
    role: "listbox",
    "aria-label": "Passage suggestions",
  });
  list.hidden = true;

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
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "aria-controls": listId,
    "aria-haspopup": "listbox",
    "aria-label": "Your guess — type a Bible reference or tap the timeline",
    "aria-errormessage": "guess-error",
    placeholder: "John 3:16",
  }) as HTMLInputElement;
  if (provisionalGuess != null) {
    guessInputInvalid = false;
    input.value = formatVerseLabel(provisionalGuess);
    wrap.classList.add("is-valid");
  }

  let suggestions: GuessSuggestion[] = [];
  let activeSuggestion = -1;
  /** Last book zoomed via autocomplete selection (skip redundant jumps). */
  let lastBookZoomOsis: string | null = null;

  const zoomTimelineToBook = (osis: string): void => {
    if (osis === lastBookZoomOsis && activeZoom === "book") return;
    const book = BOOKS.find((b) => b.osis === osis);
    if (!book) return;
    lastBookZoomOsis = osis;
    strip?.setZoomPreset("book", book.startVerseIndex);
    activeZoom = "book";
    const zoomBar = document.querySelector<HTMLElement>(".zoom-bar");
    if (zoomBar) syncZoomBarUI(zoomBar);
  };

  const setValidity = (state: "empty" | "valid" | "invalid"): void => {
    wrap.classList.toggle("is-valid", state === "valid");
    wrap.classList.toggle("is-invalid", state === "invalid");
    guessInputInvalid = state === "invalid";
    input.setAttribute("aria-invalid", state === "invalid" ? "true" : "false");
    error.hidden = state !== "invalid";
  };

  const setActiveSuggestion = (index: number): void => {
    activeSuggestion = index;
    const options = list.querySelectorAll<HTMLElement>("[role='option']");
    options.forEach((opt, i) => {
      const selected = i === activeSuggestion;
      opt.setAttribute("aria-selected", selected ? "true" : "false");
      opt.classList.toggle("is-active", selected);
      if (selected) {
        input.setAttribute("aria-activedescendant", opt.id);
        opt.scrollIntoView({ block: "nearest" });
      }
    });
    if (activeSuggestion < 0) input.removeAttribute("aria-activedescendant");
  };

  const hideSuggestions = (): void => {
    suggestions = [];
    activeSuggestion = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const renderSuggestions = (): void => {
    list.replaceChildren();
    if (suggestions.length === 0) {
      hideSuggestions();
      return;
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    for (let i = 0; i < suggestions.length; i += 1) {
      const suggestion = suggestions[i]!;
      const option = el("button", {
        class: "guess-suggestion",
        id: `${listId}-${i}`,
        type: "button",
        role: "option",
        "aria-selected": "false",
      });
      option.append(
        el("span", {
          class: "guess-suggestion-label",
          text: suggestion.label,
        })
      );
      // mousedown (not click) so selection runs before input blur
      option.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applySuggestion(i);
      });
      option.addEventListener("mouseenter", () => setActiveSuggestion(i));
      list.append(option);
    }
    setActiveSuggestion(0);
  };

  const refreshSuggestions = (): void => {
    if (!guessInputFocused) {
      hideSuggestions();
      return;
    }
    suggestions = suggestGuessPassages(input.value);
    renderSuggestions();
  };

  const applyFromInput = (commitLabel: boolean): void => {
    const raw = input.value;
    const parsed = parseGuessText(raw);
    if (parsed.ok) {
      provisionalGuess = parsed.verseIndex;
      // Move the marker and zoom/pan verse precision to match the typed ref
      strip?.focusGuessFromText(parsed.verseIndex);
      activeZoom = null;
      const zoomBar = document.querySelector<HTMLElement>(".zoom-bar");
      if (zoomBar) syncZoomBarUI(zoomBar);
      if (commitLabel && !guessInputFocused) {
        input.value = parsed.label;
      } else if (commitLabel && document.activeElement !== input) {
        input.value = parsed.label;
      }
      setValidity("valid");
      syncConfirmEnabled();
      syncTimelineCue();
      syncPlayStage();
      return;
    }
    if (parsed.reason === "empty") {
      setValidity("empty");
      // Keep timeline marker; empty field is fine while still deciding
      syncConfirmEnabled();
      return;
    }
    // Book-only draft is fine — no error — but zoom waits for autocomplete pick.
    if (resolveBookGuess(raw).ok) {
      setValidity("empty");
      syncConfirmEnabled();
      return;
    }
    // Partial drafts with autocomplete matches stay neutral — only hard-fail
    // when the text can't complete into a known passage.
    const canComplete = suggestGuessPassages(raw).length > 0;
    setValidity(canComplete && guessInputFocused ? "empty" : "invalid");
    syncConfirmEnabled();
  };

  const applySuggestion = (index: number): void => {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    input.value = progressiveInsertText(suggestion);
    // Selecting a book from the list zooms the rail to that book.
    if (suggestion.kind === "book") {
      zoomTimelineToBook(suggestion.canonical);
    }
    applyFromInput(false);
    refreshSuggestions();
    // Keep caret at end for continued typing (chapter/verse after book)
    const end = input.value.length;
    input.setSelectionRange(end, end);
    input.focus({ preventScroll: true });
  };

  input.addEventListener("focus", () => {
    guessInputFocused = true;
    // Select all so a re-tap replaces cleanly — then offer matches for current text
    requestAnimationFrame(() => {
      input.select();
      refreshSuggestions();
    });
  });
  input.addEventListener("blur", () => {
    guessInputFocused = false;
    hideSuggestions();
    applyFromInput(true);
    // Normalize display to canonical label when valid
    if (provisionalGuess != null && parseGuessText(input.value).ok) {
      input.value = formatVerseLabel(provisionalGuess);
      setValidity("valid");
    }
  });
  input.addEventListener("input", () => {
    applyFromInput(false);
    refreshSuggestions();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!list.hidden) {
        e.preventDefault();
        hideSuggestions();
      }
      return;
    }

    if (!list.hidden && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestion((activeSuggestion + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestion(
          (activeSuggestion - 1 + suggestions.length) % suggestions.length
        );
        return;
      }
      if (e.key === "Enter" && activeSuggestion >= 0) {
        e.preventDefault();
        applySuggestion(activeSuggestion);
        return;
      }
      if (e.key === "Tab" && activeSuggestion >= 0 && !e.shiftKey) {
        // Progressive complete without leaving the field
        e.preventDefault();
        applySuggestion(activeSuggestion);
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      applyFromInput(true);
      if (provisionalGuess != null && !guessInputInvalid) {
        hideSuggestions();
        input.blur();
        document.querySelector<HTMLButtonElement>("#btn-confirm")?.focus();
      }
    }
  });

  error.hidden = true;
  wrap.append(input, list, error);
  return wrap;
}

function syncConfirmEnabled(): void {
  const conf = document.querySelector<HTMLButtonElement>("#btn-confirm");
  if (!conf) return;
  const disabled = provisionalGuess == null || guessInputInvalid;
  conf.disabled = disabled;
  conf.title = disabled
    ? provisionalGuess == null
      ? "Place a marker or type a reference first"
      : "Fix the reference before confirming"
    : "Lock in your guess";
}

function syncTimelineCue(): void {
  const cue = document.querySelector("#timeline-cue");
  if (!cue) return;
  if (provisionalGuess == null) {
    cue.textContent = "Rough placement";
    cue.classList.remove("is-hidden", "is-refine");
    return;
  }
  // Precision view owns the left of the rail (notches + chapter labels).
  // Dock already shows the guess + Confirm — drop the floating cue.
  cue.textContent = "";
  cue.classList.add("is-hidden", "is-refine");
}

/** Progressive disclosure: zoom + hint + type field after rough place lifts. */
function syncPlayStage(): void {
  const hud = document.querySelector<HTMLElement>(".hud");
  if (!hud) return;
  const hasMarker = provisionalGuess != null;
  // Keep overview chrome compact while the finger is still down; reveal once
  // they lift (precision zoom) or when already refining in verse precision.
  const roughPlacing =
    (strip?.isPlacing() ?? false) && !(strip?.isPrecisionView() ?? false);
  const revealPlayChrome = hasMarker && !roughPlacing;
  hud.dataset.hasMarker = revealPlayChrome ? "true" : "false";
  const hintBtn = document.querySelector<HTMLButtonElement>("#btn-hint");
  if (hintBtn) {
    hintBtn.hidden = !revealPlayChrome;
    hintBtn.tabIndex = revealPlayChrome ? 0 : -1;
  }
  const guessTools = document.querySelector<HTMLElement>(".guess-tools");
  if (guessTools) {
    guessTools.hidden = !revealPlayChrome;
  }
  const playActions = document.querySelector<HTMLElement>("#play-actions");
  if (playActions) {
    playActions.hidden = !revealPlayChrome;
  }
  requestAnimationFrame(() => {
    syncVerseExpandToggle();
    syncChromeInsets();
  });
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
  round = advanceDailyRound(current, activeTexts());
  provisionalGuess = null;
  activeZoom = null;
  renderPlay();
}

/** Plain-language hint spend for the result line (not "×3"). */
function hintSpendLabel(multiplier: number): string {
  if (multiplier >= 3) return "no hints";
  if (multiplier === 2) return "1 hint";
  return "2 hints";
}

/**
 * Result dock — score is the hero; timeline already carries guess/true labels.
 * One clear outcome line, one action row. No base-point jargon.
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
  const exact = r.distance === 0;

  const scoreLine = el("p", {
    class: exact ? "score-line is-exact" : "score-line",
    id: "score-total",
  });
  scoreLine.append(
    document.createTextNode(String(displayTotal)),
    el("span", { class: "pts-unit", text: "pts" })
  );

  panel.append(
    scoreLine,
    el("p", {
      class: "score-meta",
      id: "true-ref",
      text: `${distLabel} · ${hintSpendLabel(r.multiplier)}`,
    })
  );

  const actions = el("div", { class: "result-actions" });
  if (dailyComplete) {
    const summary = el("ol", { class: "daily-summary", "aria-label": "Daily verse scores" });
    round.daily!.results.forEach((item, index) => {
      const distance = item.distance === 0 ? "Exact" : `${item.distance} verses off`;
      const detail = el("span", { class: "daily-summary-detail" });
      detail.append(
        document.createTextNode(`${distance} · `),
        el("strong", { class: "daily-summary-pts", text: `${item.total} pts` })
      );
      summary.append(el("li", { class: "daily-summary-row" }, [
        el("span", { text: `${index + 1}. ${item.trueRef}` }),
        detail,
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

  // Install after primary actions so Share / Next own the emotional peak.
  const offerInstall =
    shouldOfferInstall() &&
    (dailyComplete || round.mode === "endless");
  if (offerInstall) {
    const banner = makeInstallBanner();
    if (banner) panel.append(banner);
  }

  return panel;
}

/** Surrounding paragraph + testament-half hints — rendered below the rail. */
function makeHintPanel(round: RoundData): HTMLElement | null {
  if (round.hintStep < 2) return null;

  const usefulPara = isUsefulParagraph(
    round.paragraph,
    round.poolItem.verse
  );
  // Singleton paragraphs equal the verse already shown — skip them.
  // In that case the first hint surfaces the testament-half label instead.
  const showParagraph = usefulPara;
  const showQuadrant = round.hintStep >= 3 || !usefulPara;
  if (!showParagraph && !showQuadrant) return null;

  const panel = el("div", {
    class: "hint-panel",
    id: "hint-panel",
  });

  if (showParagraph && round.paragraph) {
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

  if (showQuadrant) {
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
      const ready = provisionalGuess != null || activeZoom === "book";
      b.disabled = provisionalGuess == null && activeZoom !== "book";
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
  // Zoom presets are mutually exclusive.
  // Re-selecting the active preset toggles zoom completely off.
  if (next != null && activeZoom === next) {
    activeZoom = null;
    strip?.clearZoom();
    return;
  }
  if (next === "book" && provisionalGuess == null) return;
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
  // Note: BSB | KJV is a sibling after this bar in .top-center (not inside).
  for (const p of ZOOM_PRESETS) {
    const btn = el("button", {
      class: `zoom-link${activeZoom === p.id ? " is-active" : ""}`,
      type: "button",
      id: `zoom-${p.id}`,
      text: p.label,
      title: p.title,
      "aria-pressed": activeZoom === p.id ? "true" : "false",
      "aria-label":
        p.id === "book" && provisionalGuess == null && activeZoom !== "book"
          ? `${p.label} zoom — place a marker first`
          : p.label,
    });
    if (p.id === "book" && provisionalGuess == null && activeZoom !== "book") {
      btn.disabled = true;
      btn.title = `Place a marker to use ${p.label.toLowerCase()} zoom`;
    }
    btn.addEventListener("click", () => {
      hapticLight();
      applyZoomSelection(p.id);
      syncZoomBarUI(bar);
    });
    bar.append(btn);
  }
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

/**
 * Quiet install pitch after engagement — result dock footer, below Share/Next.
 * Chrome: native install sheet. iOS: Share → Add to Home Screen.
 */
function makeInstallBanner(): HTMLElement | null {
  if (!shouldOfferInstall()) return null;

  const banner = el("div", {
    class: "install-strip install-strip--result",
    role: "region",
    "aria-label": "Install Versemark",
    id: "install-banner-result",
  });

  const row = el("div", { class: "install-strip-row" });
  row.append(
    el("p", {
      class: "install-strip-copy",
      text: "Install for offline play",
    })
  );

  const actions = el("div", { class: "install-strip-actions" });
  const dismiss = el("button", {
    class: "install-strip-dismiss",
    type: "button",
    id: "btn-install-dismiss",
    text: "Not now",
  });
  dismiss.addEventListener("click", () => {
    hapticLight();
    snoozeInstallOffer();
    banner.remove();
  });

  const install = el("button", {
    class: "install-strip-cta",
    type: "button",
    id: "btn-install",
    text: "Install app",
  });

  const hint = el("p", {
    class: "install-strip-hint",
    id: "install-hint",
    hidden: "true",
    text: "",
  });

  let showingManualHint = false;
  install.addEventListener("click", async () => {
    hapticLight();
    if (showingManualHint) {
      snoozeInstallOffer();
      banner.remove();
      return;
    }
    const result = await promptInstall();
    if (result === "ios-hint") {
      showingManualHint = true;
      hint.textContent = "On iPhone: tap Share, then Add to Home Screen.";
      hint.hidden = false;
      install.textContent = "Got it";
      return;
    }
    if (result === "unavailable") {
      showingManualHint = true;
      hint.textContent =
        "Use your browser menu to Install app or Add to Home Screen.";
      hint.hidden = false;
      install.textContent = "Got it";
      return;
    }
    banner.remove();
  });

  actions.append(dismiss, install);
  row.append(actions);
  banner.append(row, hint);
  return banner;
}

async function main(): Promise<void> {
  initTheme();
  try {
    await loadData();
  } catch (e) {
    app.innerHTML = `<div class="home active" style="padding:2rem"><p>Failed to load data. Run <code>npm run build:data</code>.</p><pre>${String(e)}</pre></div>`;
    console.error(e);
    return;
  }
  initInstallCapture();
  void initSounds();
  bindTapHaptics();
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
