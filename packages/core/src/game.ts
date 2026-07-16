/**
 * Round orchestration — pure enough to unit-test, used by the UI.
 */
import type { PoolItem } from "./daily";
import {
  DAILY_VERSE_COUNT,
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
  recordDailyScoredRound,
  recordPracticeResult,
  mergeAchievementUnlocks,
  recordHintClick,
  localDateKey,
  loadState,
  createRecordId,
  type AppState,
  type DailyRoundRecord,
  type HintEvent,
  type RoundRecord,
  type TranslationId,
} from "./storage";
import {
  evaluateAchievements,
  lifetimeFlagsForRound,
} from "./achievements";
import { effectiveDistance } from "./mastery";

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
  /** Start of the active verse attempt, used for durable duration metadata. */
  startedAt: string;
  /** Ordered hint disclosures for future achievement rules. */
  hintEvents: HintEvent[];
  daily: {
    index: number;
    items: PoolItem[];
    results: DailyVerseResult[];
  } | null;
}

export interface DailyVerseResult extends Omit<RoundRecord, "hintStep"> {
  hintStep: HintStep;
}

export interface RoundEventContext {
  deviceId?: string;
  userId?: string | null;
  appVersion?: string;
  rulesVersion?: string;
  contentVersion?: string;
  translation?: TranslationId;
}

function rangeEndVerseIndex(item: PoolItem): number {
  if (item.rangeEnd <= item.verse) return item.verseIndex;
  return item.verseIndex + (item.rangeEnd - item.verse);
}

function toRoundRecord(
  item: PoolItem,
  guessVerseIndex: number,
  distance: number,
  total: number,
  hintStep: number,
  source: "daily" | "practice",
  at: string,
  startedAt: string,
  hintEvents: HintEvent[],
  context: RoundEventContext
): RoundRecord {
  const start = trueVerseIndex(item);
  return {
    eventId: createRecordId("round", new Date(at)),
    trueRef: item.ref,
    trueVerseIndex: start,
    trueRangeEndVerseIndex: rangeEndVerseIndex(item),
    guessVerseIndex,
    distance,
    total,
    hintStep,
    at,
    occurredAt: at,
    source,
    deviceId: context.deviceId,
    userId: context.userId ?? null,
    revision: 1,
    appVersion: context.appVersion ?? "unknown",
    rulesVersion: context.rulesVersion ?? "1",
    contentVersion: context.contentVersion ?? "1",
    translation: context.translation,
    durationMs: Math.max(0, Date.parse(at) - Date.parse(startedAt)),
    hintEvents: [...hintEvents],
  };
}

function syncUnlocks(now: Date): string[] {
  const state = loadState();
  const proposed = evaluateAchievements(state);
  const { newlyUnlocked } = mergeAchievementUnlocks(proposed, now);
  return newlyUnlocked;
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

function scoreResultFromSaved(last: DailyRoundRecord): ScoreResult {
  const multiplier = last.hintStep === 1 ? 3 : last.hintStep === 2 ? 2 : 1;
  return {
    distance: last.distance,
    distancePts: Math.round(last.total / multiplier),
    proximityBonus: 0,
    hintStep: last.hintStep as HintStep,
    multiplier,
    total: last.total,
  };
}

function bindVerse(
  n: number,
  items: PoolItem[],
  index: number,
  texts: TextBundle,
  results: DailyVerseResult[],
  revealed: DailyRoundRecord | null,
  now: Date = new Date()
): RoundData {
  const item = items[index];
  const verseKey = item.ref;
  if (revealed) {
    return {
      mode: "daily",
      puzzleNumber: n,
      poolItem: item,
      verseText: texts.verses[verseKey] ?? "(text unavailable)",
      paragraph: texts.paragraphs[verseKey] ?? null,
      hintStep: revealed.hintStep as HintStep,
      phase: "revealed",
      guessVerseIndex: revealed.guessVerseIndex,
      result: scoreResultFromSaved(revealed),
      startedAt: revealed.occurredAt ?? revealed.at,
      hintEvents: revealed.hintEvents ?? [],
      daily: { index, items, results },
    };
  }
  return {
    mode: "daily",
    puzzleNumber: n,
    poolItem: item,
    verseText: texts.verses[verseKey] ?? "(text unavailable)",
    paragraph: texts.paragraphs[verseKey] ?? null,
    hintStep: 1,
    phase: "playing",
    guessVerseIndex: null,
    result: null,
    startedAt: now.toISOString(),
    hintEvents: [],
    daily: { index, items, results },
  };
}

export function startDailyRound(
  pool: PoolItem[],
  texts: TextBundle,
  now: Date = new Date()
): RoundData {
  const n = todayPuzzleNumber(now);
  return startDailyRoundForPuzzle(pool, texts, n, now);
}

/**
 * Start or resume a daily. Partial progress restores the last confirmed
 * verse in the revealed phase so the player can advance; a finished daily
 * restores the final summary/share screen.
 */
export function startDailyRoundForPuzzle(
  pool: PoolItem[],
  texts: TextBundle,
  n: number,
  now: Date = new Date()
): RoundData {
  const existing = getDailyForPuzzle(n);
  const items = selectPoolItemsForPuzzle(n, pool);
  const saved = existing?.rounds ?? [];

  if (saved.length >= items.length) {
    // Complete: land on the last verse, fully revealed (summary + share).
    const index = items.length - 1;
    const results = saved.slice(0, items.length) as DailyVerseResult[];
    return bindVerse(n, items, index, texts, results, saved[index], now);
  }
  if (saved.length > 0) {
    // Partial: show the last confirmed verse revealed (Next continues).
    const index = saved.length - 1;
    const results = saved as DailyVerseResult[];
    return bindVerse(n, items, index, texts, results, saved[index], now);
  }

  return bindVerse(n, items, 0, texts, [], null, now);
}

export function startEndlessRound(
  pool: PoolItem[],
  texts: TextBundle,
  now: Date = new Date()
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
    startedAt: now.toISOString(),
    hintEvents: [],
    daily: null,
  };
}

export function advanceDailyRound(round: RoundData, texts: TextBundle, now: Date = new Date()): RoundData {
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
    startedAt: now.toISOString(),
    hintEvents: [],
    daily: { ...round.daily, index },
  };
}

/**
 * Paragraph hint is only worth a step when it adds surrounding text.
 * Single-verse "paragraphs" (common for short pericopes) equal the verse
 * already on screen — skip them so Hint always teaches something new.
 */
export function isUsefulParagraph(
  paragraph: RoundData["paragraph"],
  focusVerse: number
): boolean {
  if (!paragraph?.verses?.length) return false;
  if (paragraph.verses.length >= 2) return true;
  // One line that isn't the focus could still help; identical focus is noise.
  return paragraph.verses[0].v !== focusVerse;
}

/** True when another hint click would reveal new information. */
export function canTakeHint(round: RoundData): boolean {
  if (round.phase !== "playing") return false;
  if (round.hintStep >= 3) return false;
  // At step 2 with no useful paragraph, testament-half is already shown.
  if (
    round.hintStep === 2 &&
    !isUsefulParagraph(round.paragraph, round.poolItem.verse)
  ) {
    return false;
  }
  return true;
}

export function takeHint(round: RoundData, now: Date = new Date()): RoundData {
  if (!canTakeHint(round)) return round;
  // Step 2 with a singleton paragraph still only costs one tier (×2);
  // makeHintPanel surfaces the testament-half label instead of the verse again.
  const next = Math.min(3, (round.hintStep + 1) as HintStep) as HintStep;
  recordHintClick();
  return {
    ...round,
    hintStep: next,
    hintEvents: [...round.hintEvents, { step: next, occurredAt: now.toISOString() }],
  };
}

export function confirmGuess(
  round: RoundData,
  guessVerseIndex: number,
  now: Date = new Date(),
  context: RoundEventContext = {}
): { round: RoundData; appState: AppState | null; newlyUnlocked: string[] } {
  if (round.phase !== "playing") {
    return { round, appState: null, newlyUnlocked: [] };
  }
  const truth = trueVerseIndex(round.poolItem);
  const result = scoreRound(guessVerseIndex, truth, round.hintStep);
  const at = now.toISOString();
  const deviceId = context.deviceId ?? loadState().deviceId;
  const finishedRecord = toRoundRecord(
    round.poolItem,
    guessVerseIndex,
    result.distance,
    result.total,
    result.hintStep,
    round.mode === "endless" ? "practice" : "daily",
    at,
    round.startedAt,
    round.hintEvents,
    { ...context, deviceId }
  );
  const verseResult: DailyVerseResult = { ...finishedRecord, hintStep: result.hintStep };
  const next: RoundData = {
    ...round,
    phase: "revealed",
    guessVerseIndex,
    result,
  };

  if (next.daily) {
    next.daily = {
      ...next.daily,
      results: [...next.daily.results, verseResult],
    };
  }

  let appState: AppState | null = null;
  let newlyUnlocked: string[] = [];

  const flags = lifetimeFlagsForRound(finishedRecord);

  // Persist after every confirmed daily verse so refresh mid-run resumes.
  // One load/save: history + rollups + lifetime + coverage together.
  if (round.mode === "daily" && round.puzzleNumber != null && next.daily) {
    const results = next.daily.results;
    const complete = results.length >= next.daily.items.length;
    const aggregate = results.reduce((sum, item) => sum + item.total, 0);
    const rounds: RoundRecord[] = results.map((record) => ({ ...record, source: "daily" as const }));
    appState = recordDailyScoredRound(
      {
        puzzleNumber: round.puzzleNumber,
        dateKey: localDateKey(now),
        guessVerseIndex,
        trueVerseIndex: truth,
        trueRef: round.poolItem.ref,
        distance: result.distance,
        total: aggregate,
        hintStep: result.hintStep,
        completedAt: complete ? now.toISOString() : null,
        rounds,
      },
      finishedRecord,
      {
        ...flags,
        completedDaily: complete,
        cleanSheet:
          complete &&
          rounds.length >= DAILY_VERSE_COUNT &&
          rounds.every((r) => effectiveDistance(r) === 0),
        noHintDaily:
          complete &&
          rounds.length >= DAILY_VERSE_COUNT &&
          rounds.every((r) => (Number(r.hintStep) || 1) <= 1),
      },
      now
    );
    // Unlock after every verse so mid-daily exacts surface immediately.
    newlyUnlocked = syncUnlocks(now);
  } else if (round.mode === "endless") {
    appState = recordPracticeResult(finishedRecord, flags, now);
    newlyUnlocked = syncUnlocks(now);
  }

  return { round: next, appState, newlyUnlocked };
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
