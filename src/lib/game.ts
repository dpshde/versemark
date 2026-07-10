/**
 * Round orchestration — pure enough to unit-test, used by the UI.
 */
import type { PoolItem } from "./daily";
import {
  selectPoolItemForPuzzle,
  selectEndlessItem,
  todayPuzzleNumber,
} from "./daily";
import { scoreRound, type HintStep, type ScoreResult } from "./scoring";
import {
  formatVerseLabel,
  quadrantForVerse,
  bookChapterVerseFromIndex,
} from "./books";
import { buildShareString } from "./share";
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
  const existing = getDailyForPuzzle(n);
  const item = selectPoolItemForPuzzle(n, pool);
  const verseKey = item.ref;
  const verseText = texts.verses[verseKey] ?? "(text unavailable)";
  const paragraph = texts.paragraphs[verseKey] ?? null;

  if (existing) {
    return {
      mode: "daily",
      puzzleNumber: n,
      poolItem: item,
      verseText,
      paragraph,
      hintStep: existing.hintStep as HintStep,
      phase: "revealed",
      guessVerseIndex: existing.guessVerseIndex,
      result: {
        distance: existing.distance,
        distancePts: Math.round(
          existing.total /
            (existing.hintStep === 1 ? 3 : existing.hintStep === 2 ? 2 : 1)
        ),
        hintStep: existing.hintStep as HintStep,
        multiplier:
          existing.hintStep === 1 ? 3 : existing.hintStep === 2 ? 2 : 1,
        total: existing.total,
      },
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

  let appState: AppState | null = null;
  if (round.mode === "daily" && round.puzzleNumber != null) {
    appState = recordDailyResult(
      {
        puzzleNumber: round.puzzleNumber,
        dateKey: localDateKey(now),
        guessVerseIndex,
        trueVerseIndex: truth,
        trueRef: round.poolItem.ref,
        distance: result.distance,
        total: result.total,
        hintStep: result.hintStep,
        completedAt: now.toISOString(),
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
