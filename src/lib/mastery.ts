/**
 * Book / genre mastery and weaknesses from scored rounds.
 * Mastery = median effective miss distance (lower is better).
 */
import {
  bookChapterVerseFromIndex,
  TOTAL_VERSES,
  type Genre,
} from "./books";
import { CLOSE_DISTANCE } from "./scoring";
import {
  isDailyComplete,
  type AppState,
  type RoundRecord,
} from "./storage";

export const GENRE_SAMPLE_MIN = 3;
export const BOOK_SAMPLE_MIN = 2;

/** ~average verses per chapter across the Protestant canon. */
const VERSES_PER_CHAPTER = 26;

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
  weakGenres: MasterySlice[];
  weakBooks: MasterySlice[];
  worstRounds: WorstRoundLine[];
}

/** Guess inside truth range → 0; else min distance to either bound. */
export function effectiveDistance(r: RoundRecord): number {
  const start = r.trueVerseIndex;
  const end =
    r.trueRangeEndVerseIndex >= start ? r.trueRangeEndVerseIndex : start;
  const g = r.guessVerseIndex;
  if (g >= start && g <= end) return 0;
  return Math.min(Math.abs(g - start), Math.abs(g - end));
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
 * Reader-facing median miss. "Typically" is the honest reading of a median.
 */
export function formatMiss(d: number): string {
  const base = formatMissDistance(d);
  if (base === "exact") return "typically exact";
  return `typically ${base}`;
}

/**
 * How far a miss stretches across the full canon rail (0..1).
 * Used for the quiet miss meter under mastery rows.
 */
export function missShare(d: number): number {
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.min(1, d / TOTAL_VERSES);
}

interface Acc {
  label: string;
  distances: number[];
  exact: number;
  near: number;
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
    const bookAcc = byBook.get(bookKey) ?? {
      label: loc.book.name,
      distances: [],
      exact: 0,
      near: 0,
    };
    bookAcc.distances.push(d);
    if (d === 0) bookAcc.exact++;
    else if (d <= CLOSE_DISTANCE) bookAcc.near++;
    byBook.set(bookKey, bookAcc);

    const g = loc.book.genre;
    const genreAcc = byGenre.get(g) ?? {
      label: g.charAt(0).toUpperCase() + g.slice(1),
      distances: [],
      exact: 0,
      near: 0,
    };
    genreAcc.distances.push(d);
    if (d === 0) genreAcc.exact++;
    else if (d <= CLOSE_DISTANCE) genreAcc.near++;
    byGenre.set(g, genreAcc);
  }
  return { byBook, byGenre };
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

/** All scored rounds from completed dailies + practice log. */
export function collectScoredRounds(state: AppState): RoundRecord[] {
  const out: RoundRecord[] = [];
  for (const daily of state.history) {
    if (!isDailyComplete(daily)) continue;
    for (const r of daily.rounds) {
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

  const genres = [...byGenre.entries()]
    .filter(([, a]) => a.distances.length >= GENRE_SAMPLE_MIN)
    .map(([id, a]) => toSlice(id, { ...a, label: genreLabel(id) }))
    .sort(compareSlices);

  const books = [...byBook.entries()]
    .filter(([, a]) => a.distances.length >= BOOK_SAMPLE_MIN)
    .map(([id, a]) => toSlice(id, a))
    .sort(compareSlices);

  const weakGenres = [...genres].reverse().slice(0, 3);
  const weakBooks = [...books].reverse().slice(0, 5);

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
    totalRounds: rounds.length,
    dailyRoundCount,
    practiceRoundCount,
    exactCount,
    nearCount,
    streak: state.streak,
    bestStreak: state.bestStreak,
    genres,
    books: books.slice(0, 8),
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
