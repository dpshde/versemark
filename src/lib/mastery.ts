/**
 * Book / genre mastery and weaknesses from scored rounds + monthly rollups.
 * Mastery = median effective miss distance (lower is better).
 */
import { bookChapterVerseFromIndex, BOOKS, type Genre } from "./books";
import {
  CLOSE_DISTANCE,
  DIST_BUCKET_COUNT,
  DIST_BUCKET_REPS,
  effectiveDistance,
  VERSES_PER_CHAPTER,
} from "./scoring";
import {
  monthKeyFromAt,
  type AppState,
  type BookRollup,
  type MonthlyRollups,
  type RoundRecord,
} from "./storage";
import { resolvedTheme } from "./theme";

export { effectiveDistance } from "./scoring";

export const GENRE_SAMPLE_MIN = 3;
export const BOOK_SAMPLE_MIN = 2;

export interface MasterySlice {
  id: string;
  label: string;
  rounds: number;
  /** Median effective miss distance (outlier-robust). */
  medianDistance: number;
  /** Mean miss — secondary sort / diagnostics. */
  avgDistance: number;
  exactCount: number;
  nearCount: number;
}

export interface WorstRoundLine {
  trueRef: string;
  guessVerseIndex: number;
  trueVerseIndex: number;
  distance: number;
  effectiveDistance: number;
  source: "daily" | "practice";
  at: string;
}

export interface MasteryReport {
  totalRounds: number;
  dailyRoundCount: number;
  practiceRoundCount: number;
  exactCount: number;
  nearCount: number;
  streak: number;
  bestStreak: number;
  genres: MasterySlice[];
  books: MasterySlice[];
  /** Every book with ≥1 scored round, keyed by OSIS id — for the canon heat map. */
  bookHeat: Record<string, MasterySlice>;
  weakGenres: MasterySlice[];
  weakBooks: MasterySlice[];
  worstRounds: WorstRoundLine[];
}

export interface DistanceTrendPoint {
  /** Start of the local calendar period, YYYY-MM. */
  month: string;
  granularity: "month" | "quarter" | "year";
  rounds: number;
  medianDistance: number;
  avgDistance: number;
}

/** Chapters-off scale where heat saturates (~200 chapters). */
const HEAT_CHAPTER_CAP = 200;

/**
 * Map median miss → heat in 0..1 (0 = exact/strong, 1 = far/weak).
 * Sqrt eases mid-range so modest misses don't all look identical.
 */
export function masteryHeatT(medianDistance: number): number {
  if (!Number.isFinite(medianDistance) || medianDistance <= 0) return 0;
  const chapters = medianDistance / VERSES_PER_CHAPTER;
  return Math.min(1, Math.sqrt(chapters / HEAT_CHAPTER_CAP));
}

/**
 * Heat color for a book segment. `null` = untested (rail).
 * Strong → olive; weak → terracotta. Tracks light/dark surface luminance.
 */
export function masteryHeatColor(medianDistance: number | null): string {
  if (medianDistance == null) return "var(--rail)";
  const t = masteryHeatT(medianDistance);
  const dark = resolvedTheme() === "dark";
  const L = dark ? 0.38 + t * 0.28 : 0.84 - t * 0.36;
  const C = dark ? 0.06 + t * 0.1 : 0.055 + t * 0.12;
  const H = 145 - t * 105;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}

/**
 * Median of a non-empty list. Even n averages the two middle values.
 * Empty → 0.
 */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Single-round miss in natural units. Chapters use ~26 verses (canon average).
 * Same thresholds as median mastery so worst rounds stay consistent with rows.
 */
export function formatMissDistance(d: number): string {
  if (!Number.isFinite(d) || d <= 0) return "exact";
  if (d < 20) {
    const n = Math.max(1, Math.round(d));
    return `~${n} verse${n === 1 ? "" : "s"} off`;
  }
  const chapters = Math.max(1, Math.round(d / VERSES_PER_CHAPTER));
  return `~${chapters} chapter${chapters === 1 ? "" : "s"} off`;
}

/**
 * Reader-facing median miss (same units as a single-round miss).
 */
export function formatMiss(d: number): string {
  return formatMissDistance(d);
}

interface Acc {
  label: string;
  distances: number[];
  exact: number;
  near: number;
}

function emptyAcc(label: string): Acc {
  return { label, distances: [], exact: 0, near: 0 };
}

function accumulate(rounds: RoundRecord[]): {
  byBook: Map<string, Acc>;
  byGenre: Map<Genre, Acc>;
} {
  const byBook = new Map<string, Acc>();
  const byGenre = new Map<Genre, Acc>();
  for (const r of rounds) {
    const d = effectiveDistance(r);
    const loc = bookChapterVerseFromIndex(r.trueVerseIndex);
    if (!loc) continue;
    const bookKey = loc.book.osis;
    const bookAcc = byBook.get(bookKey) ?? emptyAcc(loc.book.name);
    bookAcc.distances.push(d);
    if (d === 0) bookAcc.exact++;
    else if (d <= CLOSE_DISTANCE) bookAcc.near++;
    byBook.set(bookKey, bookAcc);

    const g = loc.book.genre;
    const genreAcc = byGenre.get(g) ?? emptyAcc(genreLabel(g));
    genreAcc.distances.push(d);
    if (d === 0) genreAcc.exact++;
    else if (d <= CLOSE_DISTANCE) genreAcc.near++;
    byGenre.set(g, genreAcc);
  }
  return { byBook, byGenre };
}

/** Expand histogram buckets into representative distances for median/avg. */
function expandHist(hist: number[]): number[] {
  const out: number[] = [];
  const n = Math.min(hist.length, DIST_BUCKET_COUNT);
  for (let i = 0; i < n; i++) {
    const count = Math.max(0, Math.floor(hist[i] ?? 0));
    if (count <= 0) continue;
    const rep =
      DIST_BUCKET_REPS[i] ?? DIST_BUCKET_REPS[DIST_BUCKET_REPS.length - 1]!;
    for (let k = 0; k < count; k++) out.push(rep);
  }
  return out;
}

/**
 * Monthly all-time distance trend. Recent rounds are exact; evicted rounds use
 * the same histogram representatives as all-time mastery.
 */
export function computeDistanceTrend(state: AppState): DistanceTrendPoint[] {
  const byMonth = new Map<string, number[]>();
  const add = (month: string, distances: number[]) => {
    if (!distances.length) return;
    const bucket = byMonth.get(month) ?? [];
    bucket.push(...distances);
    byMonth.set(month, bucket);
  };

  for (const [month, books] of Object.entries(state.rollups ?? {})) {
    for (const rollup of Object.values(books)) {
      add(month, expandHist(rollup.hist ?? []));
    }
  }
  for (const round of collectScoredRounds(state)) {
    add(monthKeyFromAt(round.at), [effectiveDistance(round)]);
  }

  const months = [...byMonth.keys()].sort();
  if (!months.length) return [];
  const ordinal = (month: string) => {
    const [year, monthNumber] = month.split("-").map(Number);
    return year! * 12 + monthNumber! - 1;
  };
  const span = ordinal(months[months.length - 1]!) - ordinal(months[0]!) + 1;
  const granularity: DistanceTrendPoint["granularity"] =
    span <= 24 ? "month" : span <= 72 ? "quarter" : "year";
  const periodKey = (month: string) => {
    if (granularity === "month") return month;
    const [year, monthNumber] = month.split("-").map(Number);
    if (granularity === "year") return `${year}-01`;
    const quarterStart = Math.floor((monthNumber! - 1) / 3) * 3 + 1;
    return `${year}-${String(quarterStart).padStart(2, "0")}`;
  };
  const byPeriod = new Map<string, number[]>();
  for (const [month, distances] of byMonth) {
    const key = periodKey(month);
    const bucket = byPeriod.get(key) ?? [];
    bucket.push(...distances);
    byPeriod.set(key, bucket);
  }

  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, distances]) => ({
      month,
      granularity,
      rounds: distances.length,
      medianDistance: median(distances),
      avgDistance:
        distances.reduce((sum, distance) => sum + distance, 0) /
        distances.length,
    }));
}

function bookMeta(osis: string): { name: string; genre: Genre } | null {
  const book = BOOKS.find((b) => b.osis === osis);
  if (!book) return null;
  return { name: book.name, genre: book.genre };
}

/**
 * Merge monthly rollups into book/genre accumulators.
 * Counts and histogram reps count toward sample minimums.
 */
function mergeRollups(
  byBook: Map<string, Acc>,
  byGenre: Map<Genre, Acc>,
  rollups: MonthlyRollups
): { rounds: number; practice: number; exact: number; near: number } {
  let rounds = 0;
  let practice = 0;
  let exact = 0;
  let near = 0;

  for (const monthBooks of Object.values(rollups)) {
    for (const [osis, ru] of Object.entries(monthBooks)) {
      const meta = bookMeta(osis);
      if (!meta) continue;
      const distances = expandHist(ru.hist ?? []);
      const bookAcc = byBook.get(osis) ?? emptyAcc(meta.name);
      bookAcc.distances.push(...distances);
      bookAcc.exact += ru.exact;
      bookAcc.near += ru.near;
      byBook.set(osis, bookAcc);

      const genreAcc = byGenre.get(meta.genre) ?? emptyAcc(genreLabel(meta.genre));
      genreAcc.distances.push(...distances);
      genreAcc.exact += ru.exact;
      genreAcc.near += ru.near;
      byGenre.set(meta.genre, genreAcc);

      rounds += ru.rounds;
      practice += ru.practice;
      exact += ru.exact;
      near += ru.near;
    }
  }

  return { rounds, practice, exact, near };
}

/** Strongest first: smaller median miss, then smaller average miss. */
function compareSlices(a: MasterySlice, b: MasterySlice): number {
  if (a.medianDistance !== b.medianDistance) {
    return a.medianDistance - b.medianDistance;
  }
  return a.avgDistance - b.avgDistance;
}

function toSlice(id: string, acc: Acc): MasterySlice {
  const rounds = acc.distances.length;
  const avgDistance =
    rounds === 0
      ? 0
      : acc.distances.reduce((a, b) => a + b, 0) / rounds;
  return {
    id,
    label: acc.label,
    rounds,
    medianDistance: median(acc.distances),
    avgDistance,
    exactCount: acc.exact,
    nearCount: acc.near,
  };
}

/**
 * All confirmed rounds from daily history + practice log (window only).
 * Includes partial dailies so mastery matches coverage/lifetime and eviction.
 */
export function collectScoredRounds(state: AppState): RoundRecord[] {
  const out: RoundRecord[] = [];
  for (const daily of state.history) {
    for (const r of daily.rounds ?? []) {
      out.push({
        ...r,
        source: r.source === "practice" ? "practice" : "daily",
      });
    }
  }
  for (const r of state.practiceLog) {
    out.push({ ...r, source: "practice" });
  }
  return out;
}

/** Sum rollup counters across months/books. */
export function summarizeRollups(rollups: MonthlyRollups): {
  rounds: number;
  practice: number;
  exact: number;
  near: number;
  points: number;
} {
  let rounds = 0;
  let practice = 0;
  let exact = 0;
  let near = 0;
  let points = 0;
  for (const monthBooks of Object.values(rollups)) {
    for (const ru of Object.values(monthBooks) as BookRollup[]) {
      rounds += ru.rounds;
      practice += ru.practice;
      exact += ru.exact;
      near += ru.near;
      points += ru.points ?? 0;
    }
  }
  return { rounds, practice, exact, near, points };
}

export function computeMastery(state: AppState): MasteryReport {
  const rounds = collectScoredRounds(state);
  let exactCount = 0;
  let nearCount = 0;
  let dailyRoundCount = 0;
  let practiceRoundCount = 0;
  for (const r of rounds) {
    const d = effectiveDistance(r);
    if (d === 0) exactCount++;
    else if (d <= CLOSE_DISTANCE) nearCount++;
    if (r.source === "practice") practiceRoundCount++;
    else dailyRoundCount++;
  }

  const { byBook, byGenre } = accumulate(rounds);
  const rolled = mergeRollups(byBook, byGenre, state.rollups ?? {});
  exactCount += rolled.exact;
  nearCount += rolled.near;
  practiceRoundCount += rolled.practice;
  dailyRoundCount += Math.max(0, rolled.rounds - rolled.practice);

  const genres = [...byGenre.entries()]
    .filter(([, a]) => a.distances.length >= GENRE_SAMPLE_MIN)
    .map(([id, a]) => toSlice(id, { ...a, label: genreLabel(id) }))
    .sort(compareSlices);

  const books = [...byBook.entries()]
    .filter(([, a]) => a.distances.length >= BOOK_SAMPLE_MIN)
    .map(([id, a]) => toSlice(id, a))
    .sort(compareSlices);

  const bookHeat: Record<string, MasterySlice> = {};
  for (const [id, a] of byBook.entries()) {
    if (a.distances.length < 1) continue;
    bookHeat[id] = toSlice(id, a);
  }

  const weakGenres = [...genres].reverse().slice(0, 3);
  const weakBooks = [...books].reverse().slice(0, 5);

  // Window-only by design — rollups lack per-round refs for worst-list UI.
  const worstN = Math.min(
    10,
    Math.max(3, Math.ceil(rounds.length * 0.05))
  );
  const worstRounds: WorstRoundLine[] = [...rounds]
    .map((r) => ({
      trueRef: r.trueRef,
      guessVerseIndex: r.guessVerseIndex,
      trueVerseIndex: r.trueVerseIndex,
      distance: r.distance,
      effectiveDistance: effectiveDistance(r),
      source: r.source,
      at: r.at,
    }))
    .sort((a, b) => b.effectiveDistance - a.effectiveDistance)
    .slice(0, worstN);

  return {
    totalRounds: rounds.length + rolled.rounds,
    dailyRoundCount,
    practiceRoundCount,
    exactCount,
    nearCount,
    streak: state.streak,
    bestStreak: state.bestStreak,
    genres,
    books: books.slice(0, 8),
    bookHeat,
    weakGenres,
    weakBooks,
    worstRounds,
  };
}

/** Genre labels for display (title case). */
export function genreLabel(genre: string): string {
  const map: Record<string, string> = {
    law: "Law",
    history: "History",
    poetry: "Poetry",
    prophets: "Prophets",
    gospels: "Gospels",
    epistles: "Epistles",
  };
  return map[genre] ?? genre;
}

export type MasteryFocusMode = "farther" | "coverage" | "touch";

export const MASTERY_FOCUS_MODES: ReadonlyArray<{
  id: MasteryFocusMode;
  label: string;
}> = [
  { id: "farther", label: "Farther" },
  { id: "coverage", label: "Coverage" },
  { id: "touch", label: "Closer" },
] as const;

export const FOCUS_GENRE_IDS = [
  "law",
  "history",
  "poetry",
  "prophets",
  "gospels",
  "epistles",
] as const;

/** Exact + near share of rounds (0 when untested). */
export function touchRate(s: MasterySlice): number {
  if (s.rounds <= 0) return 0;
  return (s.exactCount + s.nearCount) / s.rounds;
}

/** Coverage while the rail is mostly gray; farther once there is signal. */
export function defaultMasteryFocusMode(mastery: MasteryReport): MasteryFocusMode {
  return Object.keys(mastery.bookHeat).length < 8 ? "coverage" : "farther";
}

export function emptyMasterySlice(id: string, label: string): MasterySlice {
  return {
    id,
    label,
    rounds: 0,
    medianDistance: 0,
    avgDistance: 0,
    exactCount: 0,
    nearCount: 0,
  };
}

/** Right-column metric for a focus-mode row. */
export function masteryFocusMetric(
  s: MasterySlice,
  mode: MasteryFocusMode
): string {
  if (s.rounds <= 0) return "not tested";
  if (mode === "touch") {
    const n = s.exactCount + s.nearCount;
    return `${n}/${s.rounds} close`;
  }
  return formatMiss(s.medianDistance);
}

/**
 * Books for a focus mode.
 * <catalog> supplies OSIS + name for Coverage (full canon).
 */
export function booksForFocusMode(
  mastery: MasteryReport,
  mode: MasteryFocusMode,
  catalog: ReadonlyArray<{ osis: string; name: string }>
): MasterySlice[] {
  const measured = Object.values(mastery.bookHeat);
  if (mode === "farther") {
    return [...measured].sort((a, b) => {
      if (b.medianDistance !== a.medianDistance) {
        return b.medianDistance - a.medianDistance;
      }
      return b.avgDistance - a.avgDistance;
    });
  }
  if (mode === "touch") {
    return [...measured].sort((a, b) => {
      const tr = touchRate(b) - touchRate(a);
      if (tr !== 0) return tr;
      if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
      return a.medianDistance - b.medianDistance;
    });
  }
  return catalog
    .map(
      (b) => mastery.bookHeat[b.osis] ?? emptyMasterySlice(b.osis, b.name)
    )
    .sort((a, b) => {
      if (a.rounds !== b.rounds) return a.rounds - b.rounds;
      if (a.rounds === 0) return a.label.localeCompare(b.label);
      if (b.medianDistance !== a.medianDistance) {
        return b.medianDistance - a.medianDistance;
      }
      return a.label.localeCompare(b.label);
    });
}

/** Genres for a focus mode (Coverage fills every genre slot). */
export function genresForFocusMode(
  mastery: MasteryReport,
  mode: MasteryFocusMode
): MasterySlice[] {
  const measured = mastery.genres;
  if (mode === "farther") {
    return [...measured].sort((a, b) => {
      if (b.medianDistance !== a.medianDistance) {
        return b.medianDistance - a.medianDistance;
      }
      return b.avgDistance - a.avgDistance;
    });
  }
  if (mode === "touch") {
    return [...measured].sort((a, b) => {
      const tr = touchRate(b) - touchRate(a);
      if (tr !== 0) return tr;
      if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
      return a.medianDistance - b.medianDistance;
    });
  }
  const byId = new Map(measured.map((g) => [g.id, g]));
  return FOCUS_GENRE_IDS.map(
    (id) => byId.get(id) ?? emptyMasterySlice(id, genreLabel(id))
  ).sort((a, b) => {
    if (a.rounds !== b.rounds) return a.rounds - b.rounds;
    if (a.rounds === 0) return a.label.localeCompare(b.label);
    if (b.medianDistance !== a.medianDistance) {
      return b.medianDistance - a.medianDistance;
    }
    return a.label.localeCompare(b.label);
  });
}
