/**
 * Daily puzzle selection (ADR: seed-daily-puzzle-from-date-hash).
 *
 * Epoch: 2026-08-01 local = puzzle #1
 * Seed: "eachstar#" + N → xmur3 → mulberry32
 * Weighted sample of pool with 180-puzzle no-repeat window replayed from #1.
 */
import { rngForPuzzle } from "./prng";

export const DAILY_EPOCH = { year: 2026, month: 8, day: 1 } as const;
export const NO_REPEAT_WINDOW = 180;

export interface PoolItem {
  ref: string;
  osis: string;
  chapter: number;
  verse: number;
  rangeEnd: number;
  rangeRaw: string;
  /** Global chapter index (1..1189) — layout / legacy. */
  chapterIndex: number;
  /** Global verse index (1..TOTAL_VERSES) — selection & scoring. */
  verseIndex: number;
  weight: number;
  topics: string[];
}

export interface PoolFile {
  version: number;
  count: number;
  items: PoolItem[];
}

/** Local-calendar days since epoch; epoch date → 1. */
export function puzzleNumberForLocalDate(
  year: number,
  month: number,
  day: number
): number {
  const epochUtc = Date.UTC(
    DAILY_EPOCH.year,
    DAILY_EPOCH.month - 1,
    DAILY_EPOCH.day
  );
  const dateUtc = Date.UTC(year, month - 1, day);
  const days = Math.floor((dateUtc - epochUtc) / 86_400_000);
  return days + 1;
}

/** Today's puzzle number in local timezone. */
export function todayPuzzleNumber(now: Date = new Date()): number {
  return puzzleNumberForLocalDate(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
}

/** Parse YYYY-MM-DD as local calendar components. */
export function puzzleNumberFromDateString(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Invalid date string: ${isoDate}`);
  return puzzleNumberForLocalDate(
    Number(m[1]),
    Number(m[2]),
    Number(m[3])
  );
}

function weightedPick(
  items: PoolItem[],
  rand: () => number,
  exclude: Set<string>
): PoolItem {
  const eligible = items.filter((it) => !exclude.has(it.ref));
  const pool = eligible.length > 0 ? eligible : items;
  let total = 0;
  for (const it of pool) total += it.weight;
  let r = rand() * total;
  for (const it of pool) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return pool[pool.length - 1];
}

/**
 * Deterministic pool selection for puzzle N.
 * Replays the 180-window from puzzle #1 so no stored history is needed.
 */
export function selectPoolItemForPuzzle(
  n: number,
  pool: PoolItem[]
): PoolItem {
  if (!pool.length) throw new Error("Empty pool");
  // Pre-epoch archive days: deterministic pick without the 180-window
  // (window is defined from puzzle #1 forward).
  if (n < 1) {
    const rand = rngForPuzzle(n);
    return weightedPick(pool, rand, new Set());
  }

  const history: string[] = [];
  for (let i = 1; i <= n; i++) {
    const exclude = new Set(
      history.slice(Math.max(0, history.length - NO_REPEAT_WINDOW))
    );
    const rand = rngForPuzzle(i);
    const pick = weightedPick(pool, rand, exclude);
    history.push(pick.ref);
  }
  return pool.find((p) => p.ref === history[history.length - 1]) ?? pool[0];
}

/** Local random pick for endless mode (non-deterministic). */
export function selectEndlessItem(
  pool: PoolItem[],
  rand: () => number = Math.random
): PoolItem {
  if (!pool.length) throw new Error("Empty pool");
  return weightedPick(pool, rand, new Set());
}
