/**
 * Durable app state: daily results / streak / history / practice log /
 * achievement unlocks / coverage stats / monthly rollups.
 *
 * Persistence is via {@link setStorageBackend} (KvStore). Core never touches
 * localStorage or AsyncStorage directly — web and native inject adapters.
 *
 * Completed and in-progress dailies share one record shape. A daily is
 * complete when `completedAt` is set; partial progress keeps the same
 * puzzle entry with `rounds` shorter than the full set and `completedAt: null`.
 *
 * Coverage sets (verses/books/chapters), activity timestamps, and monthly
 * rollups are never trimmed by LOG_CAP — only the detailed history/practiceLog
 * windows are. Evicted rounds fold into per-month, per-book aggregates.
 */

import { bookChapterVerseFromIndex } from "./books";
import { getStorageBackend } from "./kv-store";
import {
  bucketForDistance,
  CLOSE_DISTANCE,
  DIST_BUCKET_COUNT,
  effectiveDistance,
} from "./scoring";

export {
  createMemoryKvStore,
  getStorageBackend,
  resetStorageBackend,
  setStorageBackend,
  type KvStore,
} from "./kv-store";

/** Current physical key — bump when old clients would strip unknown fields. */
export const STORAGE_KEY_V3 = "versemark:v3";
/** Pre-coverage / pre-rollup saves; imported once into KEY then left alone. */
export const STORAGE_KEY_V2 = "versemark:v2";
const KEY = STORAGE_KEY_V3;
const LEGACY_KEY = STORAGE_KEY_V2;

/** Embedded state schema. Migrations remain independent of physical KV keys. */
export const STORAGE_SCHEMA_VERSION = 4;

let idSequence = 0;

/** Dependency-free, time-sortable local id suitable for idempotent sync upserts. */
export function createRecordId(prefix: "device" | "round" | "reset", at: Date = new Date()): string {
  idSequence = (idSequence + 1) % 1_679_616;
  const time = Math.max(0, at.getTime()).toString(36).padStart(9, "0");
  const random = Math.floor(Math.random() * 2_176_782_336).toString(36).padStart(6, "0");
  const sequence = idSequence.toString(36).padStart(4, "0");
  return `${prefix}_${time}${sequence}${random}`;
}

/**
 * Sliding window for daily history + practice log.
 * Cap is in *records* (daily entries / practice rounds), not verse-rounds:
 * ~2000 dailies ≈ up to ~6000 daily verses + 2000 practice. Keeps
 * stringify size workable on mobile while mastery is less jittery
 * than a 400-round window. Lifetime unlocks/counters never depend on this
 * cap; evicted rounds fold into `rollups` for all-time mastery signal.
 */
export const DEFAULT_LOG_CAP = 2000;
let LOG_CAP = DEFAULT_LOG_CAP;

/** @internal test helper — pass null to restore the default. */
export function setLogCapForTests(n: number | null): void {
  LOG_CAP = n == null ? DEFAULT_LOG_CAP : Math.max(1, Math.floor(n));
}

export function getLogCap(): number {
  return LOG_CAP;
}

/** Unified scored-round shape (daily verse or practice). */
export interface RoundRecord {
  /** Stable immutable-event id. Present on all newly recorded rounds. */
  eventId?: string;
  trueRef: string;
  /** Range start on the global verse axis. */
  trueVerseIndex: number;
  /** Inclusive range end; equals trueVerseIndex for single verses. */
  trueRangeEndVerseIndex: number;
  guessVerseIndex: number;
  /** Scoring distance (to range start), as today. */
  distance: number;
  total: number;
  hintStep: number;
  /** ISO timestamp. */
  at: string;
  /** Explicit sync/event timestamp; mirrors `at` for compatibility. */
  occurredAt?: string;
  source: "daily" | "practice";
  /** Stable installation owner; userId remains nullable until accounts exist. */
  deviceId?: string;
  userId?: string | null;
  /** Immutable events start at revision 1. */
  revision?: number;
  appVersion?: string;
  rulesVersion?: string;
  contentVersion?: string;
  translation?: "kjv" | "bsb";
  durationMs?: number;
  hintEvents?: HintEvent[];
}

export interface HintEvent {
  step: number;
  occurredAt: string;
}

/** @deprecated Prefer RoundRecord — kept as alias for daily resume fields. */
export type DailyRoundRecord = RoundRecord;

export interface DailyResultRecord {
  puzzleNumber: number;
  dateKey: string; // YYYY-MM-DD local
  /** Last confirmed verse (or final verse when complete). */
  guessVerseIndex: number;
  trueVerseIndex: number;
  trueRef: string;
  distance: number;
  /** Sum of confirmed round totals so far. */
  total: number;
  hintStep: number;
  /** ISO timestamp when the full daily finished; null while in progress. */
  completedAt: string | null;
  rounds: RoundRecord[];
}

export interface AchievementUnlock {
  unlockedAt: string;
}

/**
 * Compact per-book aggregate for rounds evicted past LOG_CAP.
 * `hist[i]` counts rounds whose effectiveDistance fell in bucket i.
 */
export interface BookRollup {
  rounds: number;
  /** Practice subset (daily = rounds - practice). */
  practice: number;
  exact: number;
  near: number;
  /** Sum of confirmed round totals folded into this aggregate. */
  points: number;
  hist: number[];
}

/** YYYY-MM → OSIS → book rollup. Never trimmed. */
export type MonthlyRollups = Record<string, Record<string, BookRollup>>;

export function emptyBookRollup(): BookRollup {
  return {
    rounds: 0,
    practice: 0,
    exact: 0,
    near: 0,
    points: 0,
    hist: Array.from({ length: DIST_BUCKET_COUNT }, () => 0),
  };
}

/**
 * Lifetime counters for power-user achievement ladders.
 * Never trimmed — unlocks evaluate from these, not the capped logs.
 */
export interface LifetimeCounters {
  /** Every confirmed daily or practice verse. */
  scoredRounds: number;
  exact: number;
  near: number;
  /** Exact with no hints (hintStep <= 1). */
  sight: number;
  sameChapter: number;
  /** Fully finished dailies (not capped by history window). */
  completedDailies: number;
  /** Completed dailies with all verses exact. */
  cleanSheets: number;
  /** Completed dailies with all verses hintStep <= 1. */
  noHintDailies: number;
  /** Sum of confirmed round totals. */
  totalPoints: number;
  /** Successful hint-ladder advances (takeHint), including abandoned rounds. */
  hintsClicked: number;
  /** Distinct trueVerseIndex values ever confirmed. */
  uniqueVerses: number;
  /** Distinct books (OSIS) ever confirmed. */
  booksTouched: number;
  /** Distinct book+chapter keys ever confirmed. */
  chaptersTouched: number;
}

export interface AppState {
  schemaVersion: number;
  /** Monotonic local snapshot revision; event rows retain independent revisions. */
  revision: number;
  /** Anonymous installation id, ready to be associated with a future account. */
  deviceId: string;
  lastDaily: DailyResultRecord | null;
  history: DailyResultRecord[];
  streak: number;
  bestStreak: number;
  /** Local YYYY-MM-DD of last completed daily; drives the durable streak. */
  lastCompletedDailyDateKey: string | null;
  /** Lifetime practice finishes (install engagement + volume unlocks). */
  practiceRounds: number;
  /** Recent practice outcomes for mastery (sliding window; see LOG_CAP). */
  practiceLog: RoundRecord[];
  /** Lifetime placement tallies for scalable unlocks. */
  lifetime: LifetimeCounters;
  /** Stable unlock map; unknown ids preserved on load. */
  achievementUnlocks: Record<string, AchievementUnlock>;
  /** When the player last opened the achievements screen (crown dot). */
  achievementsSeenAt: string | null;
  /** ISO time the install banner was dismissed ("Not now"); null = never. */
  installDismissedAt: string | null;
  /** ISO of first confirmed guess; null until first play. */
  firstActivityAt: string | null;
  /** ISO of most recent confirmed guess. */
  lastActivityAt: string | null;
  /** Consecutive calendar days with ≥1 practice finish. */
  practiceStreak: number;
  bestPracticeStreak: number;
  /** Local YYYY-MM-DD of last practice finish; drives practice streak. */
  lastPracticeDateKey: string | null;
  /** Consecutive exact rounds (effectiveDistance 0), daily + practice. */
  exactStreak: number;
  /** Best-ever exact run (monotonic, never trimmed). */
  bestExactStreak: number;
  /** Unique trueVerseIndex values (never trimmed). */
  touchedVerses: number[];
  /** Book OSIS ids touched (never trimmed). */
  touchedBooks: string[];
  /** `${osis}:${chapter}` keys touched (never trimmed). */
  touchedChapters: string[];
  /**
   * Monthly per-book aggregates for rounds evicted past LOG_CAP.
   * Never trimmed — preserves all-time mastery signal.
   */
  rollups: MonthlyRollups;
}

export const emptyLifetime = (): LifetimeCounters => ({
  scoredRounds: 0,
  exact: 0,
  near: 0,
  sight: 0,
  sameChapter: 0,
  completedDailies: 0,
  cleanSheets: 0,
  noHintDailies: 0,
  totalPoints: 0,
  hintsClicked: 0,
  uniqueVerses: 0,
  booksTouched: 0,
  chaptersTouched: 0,
});

/** Empty persisted state — shared by load fallbacks and tests. */
export const emptyAppState = (): AppState => ({
  schemaVersion: STORAGE_SCHEMA_VERSION,
  revision: 0,
  deviceId: createRecordId("device"),
  lastDaily: null,
  history: [],
  streak: 0,
  bestStreak: 0,
  lastCompletedDailyDateKey: null,
  practiceRounds: 0,
  practiceLog: [],
  lifetime: emptyLifetime(),
  achievementUnlocks: {},
  achievementsSeenAt: null,
  installDismissedAt: null,
  firstActivityAt: null,
  lastActivityAt: null,
  practiceStreak: 0,
  bestPracticeStreak: 0,
  lastPracticeDateKey: null,
  exactStreak: 0,
  bestExactStreak: 0,
  touchedVerses: [],
  touchedBooks: [],
  touchedChapters: [],
  rollups: {},
});

const defaultState = (): AppState => emptyAppState();

/** Chapter coverage key for a book OSIS + chapter number. */
export function chapterKey(osis: string, chapter: number): string {
  return `${osis}:${chapter}`;
}

/** True when the daily was fully finished (legacy rows always count as complete). */
export function isDailyComplete(record: DailyResultRecord): boolean {
  if (record.completedAt != null && record.completedAt !== "") return true;
  return false;
}

export function normalizeRoundRecord(
  raw: Partial<RoundRecord> | null | undefined,
  fallbackSource: "daily" | "practice" = "daily"
): RoundRecord | null {
  if (raw == null || typeof raw !== "object") return null;
  // Legacy daily rounds always had trueVerseIndex + distance
  if (raw.trueVerseIndex == null && raw.guessVerseIndex == null) return null;
  const trueVerseIndex = Number(raw.trueVerseIndex) || 0;
  const rangeEnd = Number(raw.trueRangeEndVerseIndex);
  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt !== ""
      ? raw.occurredAt
      : typeof raw.at === "string" && raw.at !== ""
        ? raw.at
        : new Date(0).toISOString();
  const legacySeed = [
    raw.source ?? fallbackSource,
    raw.trueRef ?? "",
    trueVerseIndex,
    Number(raw.guessVerseIndex) || 0,
    occurredAt,
  ].join(":");
  return {
    eventId:
      typeof raw.eventId === "string" && raw.eventId !== ""
        ? raw.eventId
        : `round_legacy_${stableStringHash(legacySeed)}`,
    trueRef: typeof raw.trueRef === "string" ? raw.trueRef : "",
    trueVerseIndex,
    trueRangeEndVerseIndex:
      Number.isFinite(rangeEnd) && rangeEnd > 0
        ? rangeEnd
        : trueVerseIndex,
    guessVerseIndex: Number(raw.guessVerseIndex) || 0,
    distance: Number(raw.distance) || 0,
    total: Number(raw.total) || 0,
    hintStep: Number(raw.hintStep) || 1,
    at: occurredAt,
    occurredAt,
    source:
      raw.source === "practice" || raw.source === "daily"
        ? raw.source
        : fallbackSource,
    deviceId: typeof raw.deviceId === "string" && raw.deviceId !== "" ? raw.deviceId : undefined,
    userId: typeof raw.userId === "string" && raw.userId !== "" ? raw.userId : null,
    revision: Math.max(1, Number(raw.revision) || 1),
    appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "legacy",
    rulesVersion: typeof raw.rulesVersion === "string" ? raw.rulesVersion : "legacy",
    contentVersion: typeof raw.contentVersion === "string" ? raw.contentVersion : "legacy",
    translation: raw.translation === "kjv" || raw.translation === "bsb" ? raw.translation : undefined,
    durationMs: Number.isFinite(Number(raw.durationMs)) ? Math.max(0, Number(raw.durationMs)) : undefined,
    hintEvents: Array.isArray(raw.hintEvents)
      ? raw.hintEvents.flatMap((event) => {
          if (!event || typeof event !== "object") return [];
          const item = event as Partial<HintEvent>;
          if (!Number.isFinite(Number(item.step)) || typeof item.occurredAt !== "string") return [];
          return [{ step: Math.max(1, Number(item.step)), occurredAt: item.occurredAt }];
        })
      : [],
  };
}

function stableStringHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeRecord(
  raw: Partial<DailyResultRecord> | null | undefined
): DailyResultRecord | null {
  if (!raw || typeof raw.puzzleNumber !== "number") return null;
  const roundsRaw = Array.isArray(raw.rounds) ? raw.rounds : [];
  const rounds = roundsRaw
    .map((r) => normalizeRoundRecord(r as Partial<RoundRecord>, "daily"))
    .filter((r): r is RoundRecord => r != null);
  // Legacy rounds missing full fields: synthesize from top-level if empty but complete
  return {
    puzzleNumber: raw.puzzleNumber,
    dateKey: typeof raw.dateKey === "string" ? raw.dateKey : "",
    guessVerseIndex: Number(raw.guessVerseIndex) || 0,
    trueVerseIndex: Number(raw.trueVerseIndex) || 0,
    trueRef: typeof raw.trueRef === "string" ? raw.trueRef : "",
    distance: Number(raw.distance) || 0,
    total: Number(raw.total) || 0,
    hintStep: Number(raw.hintStep) || 1,
    completedAt:
      raw.completedAt == null || raw.completedAt === ""
        ? null
        : String(raw.completedAt),
    rounds,
  };
}

function normalizeUnlocks(
  raw: unknown
): Record<string, AchievementUnlock> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, AchievementUnlock> = {};
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) continue;
    if (val && typeof val === "object" && "unlockedAt" in val) {
      const at = String((val as AchievementUnlock).unlockedAt ?? "");
      if (at) out[id] = { unlockedAt: at };
    } else if (typeof val === "string" && val) {
      out[id] = { unlockedAt: val };
    }
  }
  return out;
}

function normalizeLifetime(raw: unknown): LifetimeCounters {
  const base = emptyLifetime();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<LifetimeCounters>;
  return {
    scoredRounds: Math.max(0, Number(o.scoredRounds) || 0),
    exact: Math.max(0, Number(o.exact) || 0),
    near: Math.max(0, Number(o.near) || 0),
    sight: Math.max(0, Number(o.sight) || 0),
    sameChapter: Math.max(0, Number(o.sameChapter) || 0),
    completedDailies: Math.max(0, Number(o.completedDailies) || 0),
    cleanSheets: Math.max(0, Number(o.cleanSheets) || 0),
    noHintDailies: Math.max(0, Number(o.noHintDailies) || 0),
    totalPoints: Math.max(0, Number(o.totalPoints) || 0),
    hintsClicked: Math.max(0, Number(o.hintsClicked) || 0),
    uniqueVerses: Math.max(0, Number(o.uniqueVerses) || 0),
    booksTouched: Math.max(0, Number(o.booksTouched) || 0),
    chaptersTouched: Math.max(0, Number(o.chaptersTouched) || 0),
  };
}

function normalizeNumberList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const n = Number(item);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeIso(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function normalizeBookRollup(raw: unknown): BookRollup | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<BookRollup>;
  let rounds = Math.max(0, Number(o.rounds) || 0);
  if (rounds <= 0 && !Array.isArray(o.hist)) return null;
  const histRaw = Array.isArray(o.hist) ? o.hist : [];
  const hist = Array.from({ length: DIST_BUCKET_COUNT }, (_, i) =>
    Math.max(0, Math.floor(Number(histRaw[i]) || 0))
  );
  const histSum = hist.reduce((s, n) => s + n, 0);
  // Keep rounds and hist totals aligned so mastery medians stay honest.
  if (rounds > 0 && histSum === 0) {
    hist[DIST_BUCKET_COUNT - 1] = rounds;
  } else if (histSum > rounds) {
    rounds = histSum;
  } else if (rounds > histSum) {
    hist[DIST_BUCKET_COUNT - 1] += rounds - histSum;
  }
  const practice = Math.min(rounds, Math.max(0, Number(o.practice) || 0));
  const exact = Math.min(rounds, Math.max(0, Number(o.exact) || 0));
  const near = Math.min(rounds, Math.max(0, Number(o.near) || 0));
  const points = Math.max(0, Number(o.points) || 0);
  return { rounds, practice, exact, near, points, hist };
}

/** Tolerant rollup parse — unknown/invalid entries dropped; missing → {}. */
export function normalizeRollups(raw: unknown): MonthlyRollups {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: MonthlyRollups = {};
  for (const [month, books] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (!books || typeof books !== "object" || Array.isArray(books)) continue;
    const monthOut: Record<string, BookRollup> = {};
    for (const [osis, ru] of Object.entries(books as Record<string, unknown>)) {
      if (!osis || typeof osis !== "string") continue;
      const normalized = normalizeBookRollup(ru);
      if (normalized && normalized.rounds > 0) monthOut[osis] = normalized;
    }
    if (Object.keys(monthOut).length) out[month] = monthOut;
  }
  return out;
}

/** YYYY-MM from ISO `at` (local calendar); invalid → epoch month. */
export function monthKeyFromAt(at: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "1970-01";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Fold scored rounds into monthly per-book rollups (immutable-ish: returns
 * a new tree; mutates nested clones only).
 */
export function foldRoundsIntoRollups(
  rollups: MonthlyRollups,
  rounds: RoundRecord[]
): MonthlyRollups {
  if (!rounds.length) return rollups;
  const next: MonthlyRollups = { ...rollups };
  for (const r of rounds) {
    const loc = bookChapterVerseFromIndex(r.trueVerseIndex);
    if (!loc) continue;
    const month = monthKeyFromAt(
      typeof r.at === "string" && r.at ? r.at : new Date(0).toISOString()
    );
    const osis = loc.book.osis;
    const monthBooks = { ...(next[month] ?? {}) };
    const ru = { ...(monthBooks[osis] ?? emptyBookRollup()) };
    ru.hist = [...(ru.hist ?? emptyBookRollup().hist)];
    while (ru.hist.length < DIST_BUCKET_COUNT) ru.hist.push(0);
    if (ru.hist.length > DIST_BUCKET_COUNT) ru.hist.length = DIST_BUCKET_COUNT;

    const d = effectiveDistance(r);
    const bucket = bucketForDistance(d);
    ru.rounds += 1;
    if (r.source === "practice") ru.practice += 1;
    if (d === 0) ru.exact += 1;
    else if (d <= CLOSE_DISTANCE) ru.near += 1;
    ru.points += Math.max(0, Number(r.total) || 0);
    ru.hist[bucket] = (ru.hist[bucket] ?? 0) + 1;

    monthBooks[osis] = ru;
    next[month] = monthBooks;
  }
  return next;
}

function parseStoredState(parsed: Partial<AppState>): AppState {
  const history = Array.isArray(parsed.history)
    ? parsed.history
        .map((h) => normalizeRecord(h))
        .filter((h): h is DailyResultRecord => h != null)
    : [];
  const practiceLog = Array.isArray(parsed.practiceLog)
    ? parsed.practiceLog
        .map((r) => normalizeRoundRecord(r, "practice"))
        .filter((r): r is RoundRecord => r != null)
    : [];
  const lastCompletedDailyDateKey =
    normalizeIso(parsed.lastCompletedDailyDateKey) ??
    history
      .filter(isDailyComplete)
      .map((daily) => daily.dateKey)
      .sort()
      .at(-1) ??
    null;
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    revision: Math.max(0, Number(parsed.revision) || 0),
    deviceId:
      typeof parsed.deviceId === "string" && parsed.deviceId !== ""
        ? parsed.deviceId
        : createRecordId("device"),
    lastDaily: normalizeRecord(parsed.lastDaily),
    history,
    streak: Number(parsed.streak) || 0,
    bestStreak: Number(parsed.bestStreak) || 0,
    lastCompletedDailyDateKey,
    practiceRounds: Math.max(0, Number(parsed.practiceRounds) || 0),
    practiceLog,
    lifetime: normalizeLifetime(parsed.lifetime),
    achievementUnlocks: normalizeUnlocks(parsed.achievementUnlocks),
    achievementsSeenAt: normalizeIso(parsed.achievementsSeenAt),
    installDismissedAt: normalizeIso(parsed.installDismissedAt),
    firstActivityAt: normalizeIso(parsed.firstActivityAt),
    lastActivityAt: normalizeIso(parsed.lastActivityAt),
    practiceStreak: Math.max(0, Number(parsed.practiceStreak) || 0),
    bestPracticeStreak: Math.max(0, Number(parsed.bestPracticeStreak) || 0),
    lastPracticeDateKey: normalizeIso(parsed.lastPracticeDateKey),
    exactStreak: Math.max(0, Number(parsed.exactStreak) || 0),
    bestExactStreak: Math.max(0, Number(parsed.bestExactStreak) || 0),
    touchedVerses: normalizeNumberList(parsed.touchedVerses),
    touchedBooks: normalizeStringList(parsed.touchedBooks),
    touchedChapters: normalizeStringList(parsed.touchedChapters),
    rollups: normalizeRollups(parsed.rollups),
  };
}

function readRaw(key: string): string | null {
  try {
    return getStorageBackend().getItem(key);
  } catch {
    return null;
  }
}

/**
 * Load app state. Prefers v3; on first run imports legacy v2 once into v3.
 * Coverage backfill for legacy logs is applied during that import (and on
 * in-memory reconcile when a v3 blob still needs it). saveState failures are
 * reported via return value elsewhere — load still returns the best state.
 */
export function loadState(): AppState {
  try {
    const rawV3 = readRaw(KEY);
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as Partial<AppState>;
      const state = parseStoredState(parsed);
      if (Number(parsed.schemaVersion) !== STORAGE_SCHEMA_VERSION || needsCoverageMigration(state)) {
        const migrated = needsCoverageMigration(state) ? reconcileCoverageFromLogs(state) : state;
        // Best-effort persist of coverage import; never throw from load.
        saveState(migrated);
        return migrated;
      }
      return state;
    }

    const rawV2 = readRaw(LEGACY_KEY);
    if (rawV2) {
      const legacy = parseStoredState(JSON.parse(rawV2) as Partial<AppState>);
      const migrated = reconcileCoverageFromLogs(legacy);
      saveState(migrated);
      return migrated;
    }

    // Persist the installation id on first launch. Without this write, every
    // later load before the first scored round would mint a different device.
    const initial = defaultState();
    saveState(initial);
    return initial;
  } catch {
    return defaultState();
  }
}

/**
 * Persist state. Returns false on quota / private-mode / unavailable storage
 * so callers can avoid treating a failed write as durable.
 */
export function saveState(state: AppState): boolean {
  try {
    state.schemaVersion = STORAGE_SCHEMA_VERSION;
    state.revision = Math.max(0, Number(state.revision) || 0) + 1;
    getStorageBackend().setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete gameplay, achievements, and history while retaining this install's
 * anonymous device identity and unrelated preferences such as translation.
 */
export function resetProgress(): AppState {
  const backend = getStorageBackend();
  const current = loadState();
  backend.removeItem?.(KEY);
  backend.removeItem?.(LEGACY_KEY);
  const next = emptyAppState();
  next.deviceId = current.deviceId || next.deviceId;
  next.revision = current.revision;
  saveState(next);
  return next;
}

function dateKeyFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function localDateKey(now: Date = new Date()): string {
  return dateKeyFromParts(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
}

/** Consecutive completed calendar days ending at today (or yesterday if today open). */
export function computeStreak(
  history: DailyResultRecord[],
  todayKey: string
): number {
  const completed = history.filter(isDailyComplete);
  if (!completed.length) return 0;
  const keys = new Set(completed.map((h) => h.dateKey));
  return streakFromDateKeys(keys, todayKey);
}

/** Consecutive practice days ending at today (or yesterday if today open). */
export function computePracticeStreak(
  dateKeys: Iterable<string>,
  todayKey: string
): number {
  return streakFromDateKeys(new Set(dateKeys), todayKey);
}

function streakFromDateKeys(keys: Set<string>, todayKey: string): number {
  if (!keys.size) return 0;
  let streak = 0;
  let cursor = parseDateKey(todayKey);
  if (!keys.has(todayKey)) {
    cursor = addDays(cursor, -1);
  }
  while (keys.has(dateKeyFromParts(cursor.y, cursor.m, cursor.d))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function parseDateKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function addDays(
  p: { y: number; m: number; d: number },
  delta: number
): { y: number; m: number; d: number } {
  const dt = new Date(p.y, p.m - 1, p.d + delta);
  return {
    y: dt.getFullYear(),
    m: dt.getMonth() + 1,
    d: dt.getDate(),
  };
}

/** Local date key for an ISO timestamp (invalid → null). */
export function dateKeyFromIso(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return localDateKey(new Date(t));
}

/**
 * All confirmed rounds in storage (partial dailies included).
 * Used to backfill coverage counters from the LOG_CAP window.
 */
export function collectConfirmedRounds(state: AppState): RoundRecord[] {
  const out: RoundRecord[] = [];
  const seenPuzzle = new Set<number>();
  for (const daily of state.history) {
    seenPuzzle.add(daily.puzzleNumber);
    for (const r of daily.rounds ?? []) {
      out.push({
        ...r,
        source: r.source === "practice" ? "practice" : "daily",
      });
    }
  }
  if (state.lastDaily && !seenPuzzle.has(state.lastDaily.puzzleNumber)) {
    for (const r of state.lastDaily.rounds ?? []) {
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

export interface CoverageSnapshot {
  verses: Set<number>;
  books: Set<string>;
  chapters: Set<string>;
  totalPoints: number;
  hintsFromSteps: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  practiceDateKeys: Set<string>;
}

/** Derive coverage / activity floors from available round logs. */
export function coverageFromRounds(rounds: RoundRecord[]): CoverageSnapshot {
  const verses = new Set<number>();
  const books = new Set<string>();
  const chapters = new Set<string>();
  let totalPoints = 0;
  let hintsFromSteps = 0;
  let firstActivityAt: string | null = null;
  let lastActivityAt: string | null = null;
  const practiceDateKeys = new Set<string>();

  for (const r of rounds) {
    totalPoints += Math.max(0, Number(r.total) || 0);
    const hints = Number(r.hintStep) || 1;
    hintsFromSteps += Math.max(0, hints - 1);

    const start = Number(r.trueVerseIndex) || 0;
    if (start > 0) {
      verses.add(start);
      const loc = bookChapterVerseFromIndex(start);
      if (loc) {
        books.add(loc.book.osis);
        chapters.add(chapterKey(loc.book.osis, loc.chapter));
      }
    }

    const at = typeof r.at === "string" && r.at ? r.at : null;
    if (at) {
      if (!firstActivityAt || at < firstActivityAt) firstActivityAt = at;
      if (!lastActivityAt || at > lastActivityAt) lastActivityAt = at;
      if (r.source === "practice") {
        const dk = dateKeyFromIso(at);
        if (dk) practiceDateKeys.add(dk);
      }
    }
  }

  return {
    verses,
    books,
    chapters,
    totalPoints,
    hintsFromSteps,
    firstActivityAt,
    lastActivityAt,
    practiceDateKeys,
  };
}

/**
 * Longest and trailing runs of exact rounds (effectiveDistance 0),
 * ordered by `at`. Legacy rounds with epoch fallback timestamps keep
 * insertion order (stable sort), which is good enough for a floor.
 */
export function exactRunsFromRounds(rounds: RoundRecord[]): {
  best: number;
  trailing: number;
} {
  const sorted = [...rounds].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0
  );
  let best = 0;
  let run = 0;
  for (const r of sorted) {
    if (effectiveDistance(r) === 0) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return { best, trailing: run };
}

/**
 * Union log-derived coverage into stored sets (never shrinks).
 * Floors unique/book/chapter counts, totalPoints, hintsClicked, and exact
 * runs from logs. Current practice streak is derived (never max'd with a
 * stale stored value); bestPracticeStreak is monotonic including the longest
 * run in available logs.
 */
export function reconcileCoverageFromLogs(state: AppState): AppState {
  const confirmedRounds = collectConfirmedRounds(state);
  const fromLogs = coverageFromRounds(confirmedRounds);
  const verses = new Set(state.touchedVerses);
  const books = new Set(state.touchedBooks);
  const chapters = new Set(state.touchedChapters);
  for (const v of fromLogs.verses) verses.add(v);
  for (const b of fromLogs.books) books.add(b);
  for (const c of fromLogs.chapters) chapters.add(c);

  const lifetime: LifetimeCounters = {
    ...state.lifetime,
    uniqueVerses: Math.max(state.lifetime.uniqueVerses, verses.size),
    booksTouched: Math.max(state.lifetime.booksTouched, books.size),
    chaptersTouched: Math.max(state.lifetime.chaptersTouched, chapters.size),
    totalPoints: Math.max(state.lifetime.totalPoints, fromLogs.totalPoints),
    hintsClicked: Math.max(state.lifetime.hintsClicked, fromLogs.hintsFromSteps),
  };

  let firstActivityAt = state.firstActivityAt;
  let lastActivityAt = state.lastActivityAt;
  if (fromLogs.firstActivityAt) {
    if (!firstActivityAt || fromLogs.firstActivityAt < firstActivityAt) {
      firstActivityAt = fromLogs.firstActivityAt;
    }
  }
  if (fromLogs.lastActivityAt) {
    if (!lastActivityAt || fromLogs.lastActivityAt > lastActivityAt) {
      lastActivityAt = fromLogs.lastActivityAt;
    }
  }

  const practiceKeys = new Set(fromLogs.practiceDateKeys);
  let lastPracticeDateKey = state.lastPracticeDateKey;
  if (lastPracticeDateKey) practiceKeys.add(lastPracticeDateKey);
  if (!lastPracticeDateKey && practiceKeys.size) {
    lastPracticeDateKey = [...practiceKeys].sort().at(-1) ?? null;
  }

  const todayKey = localDateKey();
  const practiceStreak = currentPracticeStreakFromLast(
    lastPracticeDateKey,
    state.practiceStreak,
    todayKey
  );
  const bestPracticeStreak = Math.max(
    state.bestPracticeStreak,
    practiceStreak,
    longestConsecutiveDateKeys(practiceKeys)
  );

  const exactRuns = exactRunsFromRounds(confirmedRounds);
  const exactStreak = Math.max(state.exactStreak, exactRuns.trailing);
  const bestExactStreak = Math.max(
    state.bestExactStreak,
    exactStreak,
    exactRuns.best
  );

  return {
    ...state,
    lifetime,
    firstActivityAt,
    lastActivityAt,
    practiceStreak,
    bestPracticeStreak,
    lastPracticeDateKey,
    exactStreak,
    bestExactStreak,
    touchedVerses: [...verses],
    touchedBooks: [...books],
    touchedChapters: [...chapters],
  };
}

function needsCoverageMigration(state: AppState): boolean {
  const rounds = collectConfirmedRounds(state);
  if (!rounds.length) return false;
  return (
    state.firstActivityAt == null ||
    (state.touchedVerses.length === 0 && state.lifetime.uniqueVerses === 0)
  );
}

/** Min ISO string (lexicographic works for ISO-8601). */
function minIso(a: string | null, b: string): string {
  return a == null || b < a ? b : a;
}

/** Max ISO string. */
function maxIso(a: string | null, b: string): string {
  return a == null || b > a ? b : a;
}

/**
 * Current practice streak from last practice date.
 * Only today or yesterday keeps a non-zero streak; otherwise 0.
 * If last practice is today, streak is at least 1 even when stored is stale 0.
 */
export function currentPracticeStreakFromLast(
  lastPracticeDateKey: string | null,
  storedStreak: number,
  todayKey: string
): number {
  if (!lastPracticeDateKey) return 0;
  if (lastPracticeDateKey === todayKey) return Math.max(1, storedStreak);
  const yesterday = addDays(parseDateKey(todayKey), -1);
  const yKey = dateKeyFromParts(yesterday.y, yesterday.m, yesterday.d);
  if (lastPracticeDateKey === yKey) return Math.max(1, storedStreak);
  return 0;
}

/** Current daily streak from its durable last-completion watermark. */
export function currentDailyStreakFromLast(
  lastCompletedDailyDateKey: string | null,
  storedStreak: number,
  todayKey: string
): number {
  if (!lastCompletedDailyDateKey) return 0;
  if (lastCompletedDailyDateKey === todayKey) return Math.max(1, storedStreak);
  const yesterday = addDays(parseDateKey(todayKey), -1);
  const yKey = dateKeyFromParts(yesterday.y, yesterday.m, yesterday.d);
  if (lastCompletedDailyDateKey === yKey) return Math.max(1, storedStreak);
  return 0;
}

/** Longest consecutive run among YYYY-MM-DD keys (any ending day). */
export function longestConsecutiveDateKeys(keys: Iterable<string>): number {
  const sorted = [...new Set(keys)].filter(Boolean).sort();
  if (!sorted.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDateKey(sorted[i - 1]!);
    const expected = addDays(prev, 1);
    const expKey = dateKeyFromParts(expected.y, expected.m, expected.d);
    if (sorted[i] === expKey) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

/**
 * Apply points, coverage sets, activity timestamps, and practice streak
 * for one confirmed round. `lifetime` should already include score flags.
 */
export function applyScoredRoundMeta(
  state: AppState,
  record: RoundRecord,
  lifetime: LifetimeCounters,
  now: Date = new Date()
): AppState {
  const at =
    typeof record.at === "string" && record.at !== ""
      ? record.at
      : now.toISOString();

  const verses = new Set(state.touchedVerses);
  const books = new Set(state.touchedBooks);
  const chapters = new Set(state.touchedChapters);

  const start = Number(record.trueVerseIndex) || 0;
  if (start > 0) {
    verses.add(start);
    const loc = bookChapterVerseFromIndex(start);
    if (loc) {
      books.add(loc.book.osis);
      chapters.add(chapterKey(loc.book.osis, loc.chapter));
    }
  }

  const nextLife: LifetimeCounters = {
    ...lifetime,
    totalPoints:
      lifetime.totalPoints + Math.max(0, Number(record.total) || 0),
    uniqueVerses: Math.max(lifetime.uniqueVerses, verses.size),
    booksTouched: Math.max(lifetime.booksTouched, books.size),
    chaptersTouched: Math.max(lifetime.chaptersTouched, chapters.size),
  };

  let practiceStreak = currentPracticeStreakFromLast(
    state.lastPracticeDateKey,
    state.practiceStreak,
    localDateKey(now)
  );
  let bestPracticeStreak = state.bestPracticeStreak;
  let lastPracticeDateKey = state.lastPracticeDateKey;
  if (record.source === "practice") {
    const todayKey = localDateKey(now);
    if (lastPracticeDateKey !== todayKey) {
      const yesterday = addDays(parseDateKey(todayKey), -1);
      const yKey = dateKeyFromParts(yesterday.y, yesterday.m, yesterday.d);
      practiceStreak =
        lastPracticeDateKey === yKey ? Math.max(1, practiceStreak) + 1 : 1;
      lastPracticeDateKey = todayKey;
    } else if (practiceStreak <= 0) {
      practiceStreak = 1;
    }
    bestPracticeStreak = Math.max(bestPracticeStreak, practiceStreak);
  }

  const exactStreak =
    effectiveDistance(record) === 0 ? state.exactStreak + 1 : 0;
  const bestExactStreak = Math.max(state.bestExactStreak, exactStreak);

  return {
    ...state,
    lifetime: nextLife,
    firstActivityAt: minIso(state.firstActivityAt, at),
    lastActivityAt: maxIso(state.lastActivityAt, at),
    practiceStreak,
    bestPracticeStreak,
    lastPracticeDateKey,
    exactStreak,
    bestExactStreak,
    touchedVerses: [...verses],
    touchedBooks: [...books],
    touchedChapters: [...chapters],
  };
}

/**
 * Apply daily upsert + eviction fold in memory (no save).
 */
function applyDailyResultInMemory(
  state: AppState,
  record: DailyResultRecord,
  now: Date
): AppState {
  const prior = state.history.find(
    (h) => h.puzzleNumber === record.puzzleNumber
  );
  const newlyCompleted =
    isDailyComplete(record) && (prior == null || !isDailyComplete(prior));
  const filtered = state.history.filter(
    (h) => h.puzzleNumber !== record.puzzleNumber
  );
  filtered.push(record);
  filtered.sort((a, b) => a.puzzleNumber - b.puzzleNumber);

  let rollups = state.rollups;
  if (filtered.length > LOG_CAP) {
    const evicted = filtered.slice(0, filtered.length - LOG_CAP);
    const evictedRounds: RoundRecord[] = [];
    for (const daily of evicted) {
      for (const r of daily.rounds ?? []) {
        evictedRounds.push({
          ...r,
          source: r.source === "practice" ? "practice" : "daily",
        });
      }
    }
    rollups = foldRoundsIntoRollups(rollups, evictedRounds);
  }

  const history = filtered.slice(-LOG_CAP);
  const todayKey = localDateKey(now);
  let streak = currentDailyStreakFromLast(
    state.lastCompletedDailyDateKey,
    state.streak,
    todayKey
  );
  let lastCompletedDailyDateKey = state.lastCompletedDailyDateKey;
  if (newlyCompleted && lastCompletedDailyDateKey !== record.dateKey) {
    const yesterday = addDays(parseDateKey(record.dateKey), -1);
    const yKey = dateKeyFromParts(yesterday.y, yesterday.m, yesterday.d);
    streak = lastCompletedDailyDateKey === yKey ? Math.max(1, streak) + 1 : 1;
    lastCompletedDailyDateKey = record.dateKey;
  }
  return {
    ...state,
    lastDaily: record,
    history,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    lastCompletedDailyDateKey,
    rollups,
  };
}

/**
 * Upsert daily progress (partial or complete). Streak only counts completed dailies.
 * Evicted history entries fold their confirmed rounds into monthly rollups.
 */
export function recordDailyResult(
  record: DailyResultRecord,
  now: Date = new Date()
): AppState {
  const state = loadState();
  const next = applyDailyResultInMemory(state, record, now);
  saveState(next);
  return next;
}

/**
 * Single-save daily confirm: history/rollups + lifetime/coverage together.
 * Prefer this over recordDailyResult + commitScoredRound.
 */
export function recordDailyScoredRound(
  daily: DailyResultRecord,
  finishedRound: RoundRecord,
  lifetimeFlags: {
    exact: boolean;
    near: boolean;
    sight: boolean;
    sameChapter: boolean;
    completedDaily: boolean;
    cleanSheet: boolean;
    noHintDaily: boolean;
  },
  now: Date = new Date()
): AppState {
  const state = loadState();
  const priorDaily = state.history.find(
    (h) => h.puzzleNumber === daily.puzzleNumber
  );
  const newlyCompleted =
    lifetimeFlags.completedDaily &&
    isDailyComplete(daily) &&
    (priorDaily == null || !isDailyComplete(priorDaily));
  const withDaily = applyDailyResultInMemory(state, daily, now);
  const lifetime = bumpLifetimeForRound(withDaily, lifetimeFlags);
  if (newlyCompleted) {
    lifetime.completedDailies += 1;
    if (lifetimeFlags.cleanSheet) lifetime.cleanSheets += 1;
    if (lifetimeFlags.noHintDaily) lifetime.noHintDailies += 1;
  }
  const next = applyScoredRoundMeta(withDaily, finishedRound, lifetime, now);
  saveState(next);
  return next;
}

export function getDailyForPuzzle(
  puzzleNumber: number
): DailyResultRecord | null {
  const state = loadState();
  return (
    state.history.find((h) => h.puzzleNumber === puzzleNumber) ??
    (state.lastDaily?.puzzleNumber === puzzleNumber ? state.lastDaily : null)
  );
}

/** How many fully finished dailies are in history. */
export function completedDailyCount(state: AppState = loadState()): number {
  return state.history.filter(isDailyComplete).length;
}

/**
 * Apply one scored round to lifetime counters (power-user ladders).
 * Call after effectiveDistance is known for the finished round.
 */
export function bumpLifetimeForRound(
  state: AppState,
  flags: {
    exact: boolean;
    near: boolean;
    sight: boolean;
    sameChapter: boolean;
  }
): LifetimeCounters {
  const L = { ...state.lifetime };
  L.scoredRounds += 1;
  if (flags.exact) {
    L.exact += 1;
    if (flags.sight) L.sight += 1;
  } else if (flags.near) {
    L.near += 1;
  }
  if (flags.sameChapter) L.sameChapter += 1;
  return L;
}

/**
 * Persist lifetime + coverage after a confirmed round.
 * `lifetime` should already include score-flag bumps (and daily tallies).
 */
export function commitScoredRound(
  record: RoundRecord,
  lifetime: LifetimeCounters,
  now: Date = new Date()
): AppState {
  const state = loadState();
  const next = applyScoredRoundMeta(state, record, lifetime, now);
  saveState(next);
  return next;
}

/** Append a practice outcome and bump lifetime practice counter. */
export function recordPracticeResult(
  record: RoundRecord,
  lifetimeFlags?: {
    exact: boolean;
    near: boolean;
    sight: boolean;
    sameChapter: boolean;
  },
  now: Date = new Date()
): AppState {
  const state = loadState();
  const nextLog = [...state.practiceLog, record];
  let rollups = state.rollups;
  if (nextLog.length > LOG_CAP) {
    const evicted = nextLog.slice(0, nextLog.length - LOG_CAP);
    rollups = foldRoundsIntoRollups(rollups, evicted);
  }
  const practiceLog = nextLog.slice(-LOG_CAP);
  const lifetime = lifetimeFlags
    ? bumpLifetimeForRound(state, lifetimeFlags)
    : {
        ...state.lifetime,
        scoredRounds: state.lifetime.scoredRounds + 1,
      };
  const withLog: AppState = {
    ...state,
    practiceRounds: state.practiceRounds + 1,
    practiceLog,
    lifetime,
    rollups,
  };
  const next = applyScoredRoundMeta(withLog, record, lifetime, now);
  saveState(next);
  return next;
}

/** Record a successful hint-ladder advance. */
export function recordHintClick(): AppState {
  const state = loadState();
  const lifetime = {
    ...state.lifetime,
    hintsClicked: state.lifetime.hintsClicked + 1,
  };
  const next: AppState = { ...state, lifetime };
  saveState(next);
  return next;
}

/** Replace or patch lifetime counters (e.g. after bump + clean-sheet). */
export function updateLifetime(
  patch: Partial<LifetimeCounters>
): AppState {
  const state = loadState();
  const lifetime = emptyLifetime();
  const merged = { ...state.lifetime, ...patch };
  for (const key of Object.keys(lifetime) as (keyof LifetimeCounters)[]) {
    lifetime[key] = Math.max(0, Number(merged[key]) || 0);
  }
  const next: AppState = { ...state, lifetime };
  saveState(next);
  return next;
}

/** @deprecated Prefer recordPracticeResult — counter-only for tests. */
export function recordPracticeRound(): AppState {
  const state = loadState();
  const next: AppState = {
    ...state,
    practiceRounds: state.practiceRounds + 1,
  };
  saveState(next);
  return next;
}

/** Merge unlocks; never revokes existing. Returns newly unlocked ids. */
export function mergeAchievementUnlocks(
  unlocks: Record<string, AchievementUnlock>,
  now: Date = new Date()
): { state: AppState; newlyUnlocked: string[] } {
  const state = loadState();
  const newlyUnlocked: string[] = [];
  const at = now.toISOString();
  const nextMap = { ...state.achievementUnlocks };
  for (const [id, info] of Object.entries(unlocks)) {
    if (!id) continue;
    if (!nextMap[id]) {
      nextMap[id] = { unlockedAt: info.unlockedAt || at };
      newlyUnlocked.push(id);
    }
  }
  if (!newlyUnlocked.length) return { state, newlyUnlocked };
  const next: AppState = { ...state, achievementUnlocks: nextMap };
  saveState(next);
  return { state: next, newlyUnlocked };
}

export function markAchievementsSeen(now: Date = new Date()): AppState {
  const state = loadState();
  const next: AppState = {
    ...state,
    achievementsSeenAt: now.toISOString(),
  };
  saveState(next);
  return next;
}

/** Unseen unlocks since last visit to the achievements screen. */
export function unseenAchievementCount(state: AppState = loadState()): number {
  const seen = state.achievementsSeenAt
    ? Date.parse(state.achievementsSeenAt)
    : 0;
  let n = 0;
  for (const u of Object.values(state.achievementUnlocks)) {
    const t = Date.parse(u.unlockedAt);
    if (Number.isFinite(t) && t > (Number.isFinite(seen) ? seen : 0)) n++;
  }
  // If never opened, all unlocks count as unseen
  if (!state.achievementsSeenAt) {
    return Object.keys(state.achievementUnlocks).length;
  }
  return n;
}

/** Snooze the install offer (also used after a successful install). */
export function dismissInstallOffer(now: Date = new Date()): AppState {
  const state = loadState();
  const next: AppState = {
    ...state,
    installDismissedAt: now.toISOString(),
  };
  saveState(next);
  return next;
}

/* ———— Translation preference (verse text only) ———— */

export type TranslationId = "kjv" | "bsb";

const TRANSLATION_KEY = "versemark:translation";

/** Default BSB; KJV is the alternate public-domain text. */
export function loadTranslation(): TranslationId {
  try {
    const raw = getStorageBackend().getItem(TRANSLATION_KEY);
    if (raw === "bsb" || raw === "kjv") return raw;
  } catch {
    // private mode / missing backend
  }
  return "bsb";
}

export function saveTranslation(id: TranslationId): void {
  try {
    getStorageBackend().setItem(TRANSLATION_KEY, id);
  } catch {
    // ignore
  }
}
