/**
 * localStorage persistence for daily results / streak / history.
 */

const KEY = "canonmark:v2";

export interface DailyResultRecord {
  puzzleNumber: number;
  dateKey: string; // YYYY-MM-DD local
  guessVerseIndex: number;
  trueVerseIndex: number;
  trueRef: string;
  distance: number;
  total: number;
  hintStep: number;
  completedAt: string;
}

export interface AppState {
  lastDaily: DailyResultRecord | null;
  history: DailyResultRecord[];
  streak: number;
  bestStreak: number;
}

const defaultState = (): AppState => ({
  lastDaily: null,
  history: [],
  streak: 0,
  bestStreak: 0,
});

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    return {
      lastDaily: parsed.lastDaily ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      streak: Number(parsed.streak) || 0,
      bestStreak: Number(parsed.bestStreak) || 0,
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota / private mode — ignore
  }
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

/** Consecutive calendar days ending at lastDaily (if yesterday or today). */
export function computeStreak(
  history: DailyResultRecord[],
  todayKey: string
): number {
  if (!history.length) return 0;
  const keys = new Set(history.map((h) => h.dateKey));
  // Walk backward from today
  let streak = 0;
  let cursor = parseDateKey(todayKey);
  // If today not completed, start from yesterday
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

export function recordDailyResult(
  record: DailyResultRecord,
  now: Date = new Date()
): AppState {
  const state = loadState();
  const filtered = state.history.filter(
    (h) => h.puzzleNumber !== record.puzzleNumber
  );
  filtered.push(record);
  filtered.sort((a, b) => a.puzzleNumber - b.puzzleNumber);
  // Keep last 400
  const history = filtered.slice(-400);
  const streak = computeStreak(history, localDateKey(now));
  const next: AppState = {
    lastDaily: record,
    history,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
  };
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
