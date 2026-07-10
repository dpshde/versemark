/**
 * Round orchestration — pure enough to unit-test, used by the UI.
 */
import type { PoolItem } from "./daily";
import {
  selectPoolItemsForPuzzle,
  selectEndlessItem,
  todayPuzzleNumber,
} from "./daily";
import { scoreRound, type HintStep, type ScoreResult } from "./scoring";
import {
  formatVerseLabel,
  quadrantForVerse,
  bookChapterVerseFromIndex,
} from "./books";
import { buildDailyShareString, buildShareString } from "./share";
import {
  getDailyForPuzzle,
  recordDailyResult,
  localDateKey,
  loadState,
  type AppState,
} from "./storage";

export type GameMode = "daily" | "endless";

export interface RoundData {
  mode: GameMode;
  puzzleNumber: number | null;
  poolItem: PoolItem;
  verseText: string;
  paragraph: { start: number; end: number; verses: { v: number; t: string }[] } | null;
  hintStep: HintStep;
  phase: "playing" | "revealed";
  guessVerseIndex: number | null;
  result: ScoreResult | null;
  daily: {
    index: number;
    items: PoolItem[];
    results: DailyVerseResult[];
  } | null;
}

export interface DailyVerseResult {
  trueRef: string;
  trueVerseIndex: number;
  guessVerseIndex: number;
  distance: number;
  total: number;
  hintStep: HintStep;
}

export interface TextBundle {
  verses: Record<string, string>;
  paragraphs: Record<
    string,
    { start: number; end: number; verses: { v: number; t: string }[] }
  >;
}

function trueVerseIndex(item: PoolItem): number {
  return item.verseIndex;
}

export function startDailyRound(
  pool: PoolItem[],
  texts: TextBundle,
  now: Date = new Date()
): RoundData {
  const n = todayPuzzleNumber(now);
  return startDailyRoundForPuzzle(pool, texts, n);
}

export function startDailyRoundForPuzzle(
  pool: PoolItem[],
  texts: TextBundle,
  n: number
): RoundData {
  const existing = getDailyForPuzzle(n);
  const items = selectPoolItemsForPuzzle(n, pool);
  const saved = existing?.rounds?.length === items.length ? existing.rounds : null;
  const index = saved ? items.length - 1 : 0;
  const item = items[index];
  const verseKey = item.ref;
  const verseText = texts.verses[verseKey] ?? "(text unavailable)";
  const paragraph = texts.paragraphs[verseKey] ?? null;

  if (existing && saved) {
    const last = saved[saved.length - 1];
    return {
      mode: "daily",
      puzzleNumber: n,
      poolItem: item,
      verseText,
      paragraph,
      hintStep: last.hintStep as HintStep,
      phase: "revealed",
      guessVerseIndex: last.guessVerseIndex,
      result: {
        distance: last.distance,
        distancePts: Math.round(last.total / (last.hintStep === 1 ? 3 : last.hintStep === 2 ? 2 : 1)),
        hintStep: last.hintStep as HintStep,
        multiplier: last.hintStep === 1 ? 3 : last.hintStep === 2 ? 2 : 1,
        total: last.total,
      },
      daily: { index, items, results: saved as DailyVerseResult[] },
    };
  }

  return {
    mode: "daily",
    puzzleNumber: n,
    poolItem: item,
    verseText,
    paragraph,
    hintStep: 1,
    phase: "playing",
    guessVerseIndex: null,
    result: null,
    daily: { index, items, results: [] },
  };
}

export function startEndlessRound(
  pool: PoolItem[],
  texts: TextBundle
): RoundData {
  const item = selectEndlessItem(pool);
  const verseKey = item.ref;
  return {
    mode: "endless",
    puzzleNumber: null,
    poolItem: item,
    verseText: texts.verses[verseKey] ?? "(text unavailable)",
    paragraph: texts.paragraphs[verseKey] ?? null,
    hintStep: 1,
    phase: "playing",
    guessVerseIndex: null,
    result: null,
    daily: null,
  };
}

export function advanceDailyRound(round: RoundData, texts: TextBundle): RoundData {
  if (!round.daily || round.phase !== "revealed") return round;
  const index = round.daily.index + 1;
  if (index >= round.daily.items.length) return round;
  const item = round.daily.items[index];
  return {
    ...round,
    poolItem: item,
    verseText: texts.verses[item.ref] ?? "(text unavailable)",
    paragraph: texts.paragraphs[item.ref] ?? null,
    hintStep: 1,
    phase: "playing",
    guessVerseIndex: null,
    result: null,
    daily: { ...round.daily, index },
  };
}

export function takeHint(round: RoundData): RoundData {
  if (round.phase !== "playing") return round;
  const next = Math.min(3, (round.hintStep + 1) as HintStep) as HintStep;
  return { ...round, hintStep: next };
}

export function confirmGuess(
  round: RoundData,
  guessVerseIndex: number,
  now: Date = new Date()
): { round: RoundData; appState: AppState | null } {
  if (round.phase !== "playing") {
    return { round, appState: null };
  }
  const truth = trueVerseIndex(round.poolItem);
  const result = scoreRound(guessVerseIndex, truth, round.hintStep);
  const next: RoundData = {
    ...round,
    phase: "revealed",
    guessVerseIndex,
    result,
  };

  if (next.daily) {
    next.daily = {
      ...next.daily,
      results: [...next.daily.results, {
        trueRef: round.poolItem.ref,
        trueVerseIndex: truth,
        guessVerseIndex,
        distance: result.distance,
        total: result.total,
        hintStep: result.hintStep,
      }],
    };
  }

  let appState: AppState | null = null;
  const completedDaily =
    next.daily && next.daily.results.length === next.daily.items.length
      ? next.daily
      : null;
  if (round.mode === "daily" && round.puzzleNumber != null && completedDaily) {
    const aggregate = completedDaily.results.reduce((sum, item) => sum + item.total, 0);
    appState = recordDailyResult(
      {
        puzzleNumber: round.puzzleNumber,
        dateKey: localDateKey(now),
        guessVerseIndex,
        trueVerseIndex: truth,
        trueRef: round.poolItem.ref,
        distance: result.distance,
        total: aggregate,
        hintStep: result.hintStep,
        completedAt: now.toISOString(),
        rounds: completedDaily.results,
      },
      now
    );
  }

  return { round: next, appState };
}

export function shareForRound(round: RoundData): string | null {
  if (
    round.phase !== "revealed" ||
    !round.result ||
    round.guessVerseIndex == null
  ) {
    return null;
  }
  if (round.mode === "daily") {
    if (
      round.puzzleNumber != null &&
      round.daily &&
      round.daily.results.length === round.daily.items.length
    ) {
      return buildDailyShareString(round.puzzleNumber, round.daily.results);
    }
    return null;
  }
  return buildShareString({
    puzzleNumber: round.puzzleNumber,
    guessVerseIndex: round.guessVerseIndex,
    trueVerseIndex: trueVerseIndex(round.poolItem),
    distance: round.result.distance,
    total: round.result.total,
    hintStep: round.result.hintStep,
  });
}

export function formatTrueLocation(round: RoundData): string {
  return formatVerseLabel(trueVerseIndex(round.poolItem));
}

export function formatRef(item: PoolItem): string {
  const loc = bookChapterVerseFromIndex(item.verseIndex);
  if (!loc) return item.ref;
  if (item.rangeEnd > item.verse) {
    return `${loc.book.name} ${loc.chapter}:${item.verse}–${item.rangeEnd}`;
  }
  return formatVerseLabel(item.verseIndex);
}

export function hintQuadrantLabel(round: RoundData): string {
  return quadrantForVerse(trueVerseIndex(round.poolItem)).label;
}

export function currentAppState(): AppState {
  return loadState();
}
