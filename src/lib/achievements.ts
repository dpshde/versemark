/**
 * Achievement catalog + evaluation (Steam/PS-style unlocks).
 *
 * Placement/volume: daily + practice. Ritual: daily only.
 *
 * Power-user scaling: each ladder has fixed early seeds (stable ids +
 * copy), then open-ended 1–2–5 decade steps forever. Evaluation uses
 * lifetime counters (never trimmed by LOG_CAP). Logs only backfill.
 */
import { bookChapterVerseFromIndex } from "./books";
import { DAILY_VERSE_COUNT } from "./daily";
import { CLOSE_DISTANCE } from "./scoring";
import {
  effectiveDistance,
  collectScoredRounds,
  summarizeRollups,
} from "./mastery";
import {
  completedDailyCount,
  collectConfirmedRounds,
  coverageFromRounds,
  emptyLifetime,
  isDailyComplete,
  type AppState,
  type LifetimeCounters,
  type RoundRecord,
} from "./storage";

/**
 * Drop-cap metal tier.
 * bronze = terracotta orange · gold = gold leaf ·
 * snow = pure snow-white + black (holy / highest).
 */
export type AchievementMetal = "bronze" | "gold" | "snow";

/**
 * Shared magnitude cutoffs so metal means the same across ladders.
 * bronze ≤ 25 · gold ≤ 100 · snow above (open-ended power tiers stay snow).
 */
export function metalForThreshold(n: number): AchievementMetal {
  if (!Number.isFinite(n) || n <= 25) return "bronze";
  if (n <= 100) return "gold";
  return "snow";
}

/**
 * Illuminated drop-cap path for one achievement motif + metal colorway.
 * Motif is the seed achievement id — each seed has unique art catered to
 * that unlock (letter + ornaments). Open-ended rungs inherit the highest
 * seed’s motif. File: `{seedId}-{bronze|gold|snow}.webp`.
 */
export function dropCapPath(
  motifId: string,
  metal: AchievementMetal
): string {
  return `assets/achievements/${motifId}-${metal}.webp`;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  /** Documented predicate for tests and maintainers. */
  predicate: string;
  /**
   * Illuminated drop-cap art under public/assets/achievements/.
   * Path encodes ladder motif + metal (bronze / gold / snow).
   */
  dropCap: string;
  metal: AchievementMetal;
  /** Ladder key when this is a progressive step (null for one-shots). */
  ladder?: string;
  /** Threshold for progressive steps. */
  threshold?: number;
}

export interface AchievementView {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
  dropCap: string;
  metal: AchievementMetal;
  ladder?: string;
  threshold?: number;
  /** Progress toward this step when locked (0–1). */
  progress?: number;
  current?: number;
}

interface LadderSeed {
  n: number;
  id: string;
  title?: string;
  description?: string;
  /**
   * Drop-cap motif key (defaults to id). Unique per seed so each
   * achievement keeps art catered to that unlock.
   */
  motif?: string;
}

interface Ladder {
  key: string;
  seeds: readonly LadderSeed[];
  valueOf: (state: AppState, L: LifetimeCounters) => number;
  defaultTitle: (n: number) => string;
  defaultDescription: (n: number) => string;
  /** How many locked “next” steps to show beyond current progress. */
  ahead: number;
}

/** Safe upper bound for ladder thresholds / unlock ids. */
export const LADDER_THRESHOLD_MAX = Number.MAX_SAFE_INTEGER;

/**
 * Next threshold on an open 1–2–5 ladder within each decade.
 * Examples: 1→2→5→10→20→50→100→200→500→1000→…
 * Integer-safe; never invents mid-seed steps. Caps at MAX_SAFE_INTEGER.
 */
export function nextThreshold(prev: number): number {
  if (!Number.isFinite(prev) || prev < 1) return 1;
  const n = Math.floor(prev);
  if (n >= LADDER_THRESHOLD_MAX) return LADDER_THRESHOLD_MAX;
  // Largest power-of-10 decade base with base <= n (integer path; no log10 float).
  let base = 1;
  while (base <= n / 10) {
    base *= 10;
  }
  const mant = n / base;
  let next: number;
  if (mant < 2) next = 2 * base;
  else if (mant < 5) next = 5 * base;
  else next = base * 10;
  if (!Number.isFinite(next) || next <= n || next > LADDER_THRESHOLD_MAX) {
    return LADDER_THRESHOLD_MAX;
  }
  return next;
}

/**
 * Seed thresholds plus open-ended steps past the last seed.
 * Walks 1–2–5 from the highest seed through `value`, then `ahead` more.
 * Infinite: no fixed ceiling other than MAX_SAFE_INTEGER.
 */
export function thresholdsForLadder(
  seeds: readonly LadderSeed[],
  value: number,
  ahead: number
): number[] {
  const seedNs = seeds.map((s) => s.n).sort((a, b) => a - b);
  const seen = new Set<number>(seedNs);
  const v = Math.min(
    LADDER_THRESHOLD_MAX,
    Math.max(0, Math.floor(value))
  );

  // Extend past the last seed for power users (and for “next goal” rows).
  let cur = seedNs.length ? seedNs[seedNs.length - 1]! : 1;
  // Materialize every open step with n <= value
  for (let i = 0; i < 512; i++) {
    const next = nextThreshold(cur);
    if (next <= cur) break;
    if (next > v) break;
    seen.add(next);
    cur = next;
  }
  // Then `ahead` locked goals above value
  cur = Math.max(...seen);
  let beyond = 0;
  for (let i = 0; i < 512 && beyond < ahead; i++) {
    const next = nextThreshold(cur);
    if (next <= cur) break;
    seen.add(next);
    cur = next;
    if (next > v) beyond++;
  }
  return [...seen].sort((a, b) => a - b);
}

function seedFor(ladder: Ladder, n: number): LadderSeed | undefined {
  return ladder.seeds.find((s) => s.n === n);
}

function idForStep(ladder: Ladder, n: number): string {
  const seed = seedFor(ladder, n);
  if (seed) return seed.id;
  return `${ladder.key}-${n}`;
}

/**
 * Motif id for drop-cap art: each seed has its own; open-ended steps
 * inherit the highest seed’s motif so power tiers stay on-theme.
 */
function motifForStep(ladder: Ladder, n: number): string {
  const seeds = [...ladder.seeds].sort((a, b) => a.n - b.n);
  if (!seeds.length) return ladder.key;
  const exact = seeds.find((s) => s.n === n);
  if (exact) return exact.motif ?? exact.id;
  // Open-ended past the last seed → last seed motif
  const last = seeds[seeds.length - 1]!;
  if (n > last.n) return last.motif ?? last.id;
  // Between seeds (shouldn’t list non-seed mid-rungs) → nearest seed at or below
  let best = seeds[0]!;
  for (const s of seeds) {
    if (s.n <= n) best = s;
  }
  return best.motif ?? best.id;
}

function defForStep(ladder: Ladder, n: number): AchievementDef {
  const seed = seedFor(ladder, n);
  const metal = metalForThreshold(n);
  const motif = motifForStep(ladder, n);
  return {
    id: idForStep(ladder, n),
    title: seed?.title ?? ladder.defaultTitle(n),
    description: seed?.description ?? ladder.defaultDescription(n),
    predicate: `${ladder.key} >= ${n}`,
    dropCap: dropCapPath(motif, metal),
    metal,
    ladder: ladder.key,
    threshold: n,
  };
}

const LADDERS: readonly Ladder[] = [
  {
    key: "exact",
    ahead: 2,
    seeds: [
      {
        n: 1,
        id: "exact-once",
        title: "Exact",
        description: "Land on the true verse (or inside its range).",
      },
      {
        n: 10,
        id: "exact-10",
        title: "Ten exacts",
        description: "Ten exact placements lifetime.",
      },
      { n: 25, id: "exact-25", title: "Twenty-five exacts" },
      { n: 50, id: "exact-50", title: "Fifty exacts" },
      { n: 100, id: "exact-100", title: "Hundred exacts" },
      { n: 250, id: "exact-250", title: "Exacting" },
      { n: 500, id: "exact-500", title: "Pinpoint" },
    ],
    valueOf: (_s, L) => L.exact,
    defaultTitle: (n) => `${n.toLocaleString()} exacts`,
    defaultDescription: (n) =>
      `${n.toLocaleString()} exact placements lifetime.`,
  },
  {
    key: "sight",
    ahead: 2,
    seeds: [
      {
        n: 1,
        id: "exact-no-hint",
        title: "Sight reading",
        description: "Exact placement with no hints used.",
      },
      { n: 10, id: "sight-10", title: "Ten sight reads" },
      { n: 50, id: "sight-50", title: "Fifty sight reads" },
      { n: 100, id: "sight-100", title: "Unaided hundred" },
    ],
    valueOf: (_s, L) => L.sight,
    defaultTitle: (n) => `${n.toLocaleString()} sight reads`,
    defaultDescription: (n) =>
      `${n.toLocaleString()} exact placements with no hints.`,
  },
  {
    key: "near",
    ahead: 2,
    seeds: [
      {
        n: 1,
        id: "near-miss",
        title: "Close",
        description: "Within a few verses of the truth.",
      },
      { n: 25, id: "near-25", title: "Twenty-five closes" },
      { n: 100, id: "near-100", title: "Hundred closes" },
    ],
    valueOf: (_s, L) => L.near,
    defaultTitle: (n) => `${n.toLocaleString()} closes`,
    defaultDescription: (n) =>
      `${n.toLocaleString()} near-miss placements lifetime.`,
  },
  {
    key: "chapter",
    ahead: 2,
    seeds: [
      {
        n: 1,
        id: "same-chapter",
        title: "Same chapter",
        description: "Guess and truth share a book and chapter.",
      },
      { n: 25, id: "chapter-25", title: "Chapter sense" },
      { n: 100, id: "chapter-100", title: "Chapter fluent" },
    ],
    valueOf: (_s, L) => L.sameChapter,
    defaultTitle: (n) => `${n.toLocaleString()} same-chapter`,
    defaultDescription: (n) =>
      `${n.toLocaleString()} same-chapter landings lifetime.`,
  },
  {
    key: "rounds",
    ahead: 2,
    seeds: [
      {
        n: 10,
        id: "rounds-10",
        title: "Ten marks",
        description: "Score ten verses across daily and practice.",
      },
      {
        n: 50,
        id: "rounds-50",
        title: "Fifty marks",
        description: "Score fifty verses across daily and practice.",
      },
      { n: 100, id: "rounds-100", title: "Hundred marks" },
      { n: 250, id: "rounds-250", title: "Quarter thousand" },
      { n: 500, id: "rounds-500", title: "Five hundred marks" },
      { n: 1000, id: "rounds-1000", title: "Thousand marks" },
      { n: 2500, id: "rounds-2500", title: "Deep bench" },
      { n: 5000, id: "rounds-5000", title: "Canon walker" },
    ],
    valueOf: (_s, L) => L.scoredRounds,
    defaultTitle: (n) => `${n.toLocaleString()} marks`,
    defaultDescription: (n) =>
      `Score ${n.toLocaleString()} verses across daily and practice.`,
  },
  {
    key: "streak",
    ahead: 2,
    seeds: [
      {
        n: 3,
        id: "streak-3",
        title: "Three days",
        description: "Reach a best streak of three days.",
      },
      {
        n: 7,
        id: "streak-7",
        title: "Week of marks",
        description: "Reach a best streak of seven days.",
      },
      {
        n: 14,
        id: "streak-14",
        title: "Fortnight",
        description: "Reach a best streak of 14 days.",
      },
      {
        n: 30,
        id: "streak-30",
        title: "Month of marks",
        description: "Reach a best streak of 30 days.",
      },
      {
        n: 100,
        id: "streak-100",
        title: "Century streak",
        description: "Reach a best streak of 100 days.",
      },
    ],
    valueOf: (s) => s.bestStreak,
    defaultTitle: (n) => `${n.toLocaleString()}-day streak`,
    defaultDescription: (n) =>
      `Reach a best streak of ${n.toLocaleString()} days.`,
  },
  {
    key: "daily",
    ahead: 2,
    seeds: [
      {
        n: 1,
        id: "daily-once",
        title: "Day one",
        description: "Finish your first daily.",
      },
      { n: 10, id: "daily-10", title: "Ten dailies" },
      { n: 50, id: "daily-50", title: "Fifty dailies" },
      { n: 100, id: "daily-100", title: "Hundred dailies" },
      {
        n: 365,
        id: "daily-365",
        title: "Year of dailies",
        description: "Complete 365 dailies.",
      },
    ],
    valueOf: (_s, L) => L.completedDailies,
    defaultTitle: (n) => `${n.toLocaleString()} dailies`,
    defaultDescription: (n) => `Complete ${n.toLocaleString()} dailies.`,
  },
  {
    key: "clean",
    ahead: 2,
    seeds: [
      {
        n: 1,
        id: "daily-clean",
        title: "Clean sheet",
        description: "A daily where every verse is exact.",
      },
      { n: 5, id: "clean-5", title: "Five clean sheets" },
      { n: 25, id: "clean-25", title: "Twenty-five clean sheets" },
    ],
    valueOf: (_s, L) => L.cleanSheets,
    defaultTitle: (n) => `${n.toLocaleString()} clean sheets`,
    defaultDescription: (n) =>
      `${n.toLocaleString()} clean-sheet dailies lifetime.`,
  },
  {
    key: "unprompted",
    ahead: 2,
    seeds: [
      {
        n: 1,
        id: "daily-no-hints",
        title: "Unprompted",
        description: "Complete a daily without taking any hints.",
      },
      { n: 10, id: "unprompted-10", title: "Ten unprompted" },
      { n: 50, id: "unprompted-50", title: "Fifty unprompted" },
    ],
    valueOf: (_s, L) => L.noHintDailies,
    defaultTitle: (n) => `${n.toLocaleString()} unprompted`,
    defaultDescription: (n) =>
      `${n.toLocaleString()} dailies with no hints lifetime.`,
  },
];

/** Seed-only catalog for static discovery / tests. Dynamic steps extend this. */
export const ACHIEVEMENT_CATALOG: readonly AchievementDef[] = LADDERS.flatMap(
  (ladder) => ladder.seeds.map((s) => defForStep(ladder, s.n))
);

/** Resolve any id (seed or open-ended `ladder-N`) to a def for toasts / UI. */
export function achievementDefForId(id: string): AchievementDef | null {
  if (!id) return null;
  for (const ladder of LADDERS) {
    const seed = ladder.seeds.find((s) => s.id === id);
    if (seed) return defForStep(ladder, seed.n);
    const prefix = `${ladder.key}-`;
    if (id.startsWith(prefix)) {
      const n = Number(id.slice(prefix.length));
      if (Number.isFinite(n) && n > 0) return defForStep(ladder, n);
    }
  }
  // Seed ids that don't match ladder.key-N (e.g. exact-once)
  const staticHit = ACHIEVEMENT_CATALOG.find((d) => d.id === id);
  return staticHit ?? null;
}

function sameChapter(r: RoundRecord): boolean {
  const g = bookChapterVerseFromIndex(r.guessVerseIndex);
  const t = bookChapterVerseFromIndex(r.trueVerseIndex);
  if (!g || !t) return false;
  return g.book.osis === t.book.osis && g.chapter === t.chapter;
}

/** Flags for one finished round — used by game + backfill. */
export function lifetimeFlagsForRound(r: RoundRecord): {
  exact: boolean;
  near: boolean;
  sight: boolean;
  sameChapter: boolean;
} {
  const d = effectiveDistance(r);
  const hints = Number(r.hintStep) || 1;
  return {
    exact: d === 0,
    near: d > 0 && d <= CLOSE_DISTANCE,
    sight: d === 0 && hints <= 1,
    sameChapter: sameChapter(r),
  };
}

/**
 * Recompute counters from available logs (capped). Used to backfill older
 * saves and as a floor so unlocks never regress when lifetime is empty.
 */
export function recomputeLifetimeFromLogs(state: AppState): LifetimeCounters {
  const L = emptyLifetime();
  const rounds = collectScoredRounds(state);
  for (const r of rounds) {
    L.scoredRounds += 1;
    const f = lifetimeFlagsForRound(r);
    if (f.exact) {
      L.exact += 1;
      if (f.sight) L.sight += 1;
    } else if (f.near) {
      L.near += 1;
    }
    if (f.sameChapter) L.sameChapter += 1;
  }
  for (const daily of state.history) {
    if (!isDailyComplete(daily)) continue;
    L.completedDailies += 1;
    const rs = daily.rounds;
    if (!rs?.length || rs.length < DAILY_VERSE_COUNT) continue;
    if (rs.every((r) => effectiveDistance(r) === 0)) L.cleanSheets += 1;
    if (rs.every((r) => (Number(r.hintStep) || 1) <= 1)) L.noHintDailies += 1;
  }
  const rolled = summarizeRollups(state.rollups ?? {});
  // Window rounds (loop) + evicted rollups; also floor from never-trimmed
  // practiceRounds plus any daily rounds still visible or rolled.
  const dailyInHistory = state.history
    .filter(isDailyComplete)
    .reduce((n, d) => n + (d.rounds?.length || 0), 0);
  const dailyInRollups = Math.max(0, rolled.rounds - rolled.practice);
  L.scoredRounds = Math.max(
    L.scoredRounds + rolled.rounds,
    state.practiceRounds + dailyInHistory + dailyInRollups
  );
  L.exact += rolled.exact;
  L.near += rolled.near;
  // Floor from history window when lifetime.completedDailies was never bumped
  L.completedDailies = Math.max(
    L.completedDailies,
    completedDailyCount(state)
  );

  const coverage = coverageFromRounds(collectConfirmedRounds(state));
  L.totalPoints = coverage.totalPoints + rolled.points;
  L.hintsClicked = coverage.hintsFromSteps;
  L.uniqueVerses = Math.max(
    coverage.verses.size,
    state.touchedVerses?.length ?? 0
  );
  L.booksTouched = Math.max(
    coverage.books.size,
    state.touchedBooks?.length ?? 0
  );
  L.chaptersTouched = Math.max(
    coverage.chapters.size,
    state.touchedChapters?.length ?? 0
  );
  return L;
}

/** Prefer stored lifetime; never fall below log-derived floor. */
export function effectiveLifetime(state: AppState): LifetimeCounters {
  const stored = state.lifetime ?? emptyLifetime();
  const fromLogs = recomputeLifetimeFromLogs(state);
  return {
    scoredRounds: Math.max(stored.scoredRounds, fromLogs.scoredRounds),
    exact: Math.max(stored.exact, fromLogs.exact),
    near: Math.max(stored.near, fromLogs.near),
    sight: Math.max(stored.sight, fromLogs.sight),
    sameChapter: Math.max(stored.sameChapter, fromLogs.sameChapter),
    completedDailies: Math.max(
      stored.completedDailies,
      fromLogs.completedDailies
    ),
    cleanSheets: Math.max(stored.cleanSheets, fromLogs.cleanSheets),
    noHintDailies: Math.max(stored.noHintDailies, fromLogs.noHintDailies),
    totalPoints: Math.max(stored.totalPoints, fromLogs.totalPoints),
    hintsClicked: Math.max(stored.hintsClicked, fromLogs.hintsClicked),
    uniqueVerses: Math.max(stored.uniqueVerses, fromLogs.uniqueVerses),
    booksTouched: Math.max(stored.booksTouched, fromLogs.booksTouched),
    chaptersTouched: Math.max(stored.chaptersTouched, fromLogs.chaptersTouched),
  };
}

/**
 * Materialize every threshold ≤ value (for unlock eval) plus `ahead` next goals.
 * Infinite: walks 1–2–5 past the last seed with no fixed ceiling.
 */
function materializeLadder(
  ladder: Ladder,
  value: number
): AchievementDef[] {
  const ns = thresholdsForLadder(ladder.seeds, value, ladder.ahead);
  return ns.map((n) => defForStep(ladder, n));
}

/**
 * UI materialization: seeds always + highest unlocked open step + next goals.
 * Hides intermediate open-ended unlocks so the log stays finite while
 * thresholds themselves scale without bound.
 */
function materializeLadderForList(
  ladder: Ladder,
  value: number
): AchievementDef[] {
  const seedNs = new Set(ladder.seeds.map((s) => s.n));
  const lastSeedN = ladder.seeds.length
    ? Math.max(...ladder.seeds.map((s) => s.n))
    : 0;
  const all = thresholdsForLadder(ladder.seeds, value, ladder.ahead);
  const openUnlocked = all.filter((n) => n > lastSeedN && value >= n);
  const highestOpen =
    openUnlocked.length > 0 ? Math.max(...openUnlocked) : null;
  return all
    .filter((n) => {
      if (seedNs.has(n)) return true;
      if (value < n) return true; // locked next goals
      if (highestOpen != null && n === highestOpen) return true;
      return false;
    })
    .map((n) => defForStep(ladder, n));
}

/**
 * Evaluate against state. Unlocks every progressive step earned —
 * including open-ended steps past the seed list (infinite ladder).
 */
export function evaluateAchievements(
  state: AppState
): Record<string, { unlockedAt: string }> {
  const now = new Date().toISOString();
  const L = effectiveLifetime(state);
  const out: Record<string, { unlockedAt: string }> = {};

  for (const ladder of LADDERS) {
    const value = ladder.valueOf(state, L);
    for (const def of materializeLadder(ladder, value)) {
      const n = def.threshold ?? 0;
      if (value < n) continue;
      if (!state.achievementUnlocks[def.id]) {
        out[def.id] = { unlockedAt: now };
      }
    }
  }

  return out;
}

/**
 * List unlocks for the achievements screen.
 * Seeds + current open rank + next goals. Intermediate open unlocks stay
 * in storage (evaluate still awards them) but are collapsed in the UI.
 */
export function listAchievements(state: AppState): AchievementView[] {
  const L = effectiveLifetime(state);
  const byId = new Map<string, AchievementView>();
  const listedOpenKeys = new Set<string>();

  for (const ladder of LADDERS) {
    const value = ladder.valueOf(state, L);
    for (const def of materializeLadderForList(ladder, value)) {
      const n = def.threshold ?? 0;
      const u = state.achievementUnlocks[def.id];
      const reallyUnlocked = !!u || value >= n;
      byId.set(def.id, {
        id: def.id,
        title: def.title,
        description: def.description,
        unlocked: reallyUnlocked,
        unlockedAt: u?.unlockedAt ?? null,
        dropCap: def.dropCap,
        metal: def.metal,
        ladder: def.ladder,
        threshold: def.threshold,
        current: value,
        progress: reallyUnlocked ? 1 : Math.min(1, value / Math.max(1, n)),
      });
      if (def.ladder && n > 0) {
        const isSeed = ladder.seeds.some((s) => s.n === n);
        if (!isSeed && reallyUnlocked) listedOpenKeys.add(def.ladder);
      }
    }
  }

  // Re-surface stored seed unlocks; skip collapsed open-ended intermediates
  // unless they are the highest open rank already listed.
  for (const [id, u] of Object.entries(state.achievementUnlocks)) {
    if (byId.has(id)) continue;
    const def = achievementDefForId(id);
    if (!def) continue;
    const isOpen =
      def.ladder != null &&
      def.threshold != null &&
      !LADDERS.find((l) => l.key === def.ladder)?.seeds.some(
        (s) => s.n === def.threshold
      );
    if (isOpen && def.ladder && listedOpenKeys.has(def.ladder)) {
      // Higher open rank already on the list for this ladder
      continue;
    }
    if (isOpen && def.ladder) {
      // Only keep if this is the highest stored open for the ladder
      const ladder = LADDERS.find((l) => l.key === def.ladder);
      if (ladder) {
        let best = def.threshold ?? 0;
        for (const [otherId] of Object.entries(state.achievementUnlocks)) {
          const od = achievementDefForId(otherId);
          if (
            od?.ladder === def.ladder &&
            od.threshold != null &&
            !ladder.seeds.some((s) => s.n === od.threshold) &&
            od.threshold > best
          ) {
            best = od.threshold;
          }
        }
        if ((def.threshold ?? 0) < best) continue;
      }
    }
    byId.set(id, {
      id,
      title: def.title,
      description: def.description,
      unlocked: true,
      unlockedAt: u.unlockedAt,
      dropCap: def.dropCap,
      metal: def.metal,
      ladder: def.ladder,
      threshold: def.threshold,
      progress: 1,
    });
  }

  return [...byId.values()].sort((a, b) => {
    if (a.unlocked && b.unlocked) {
      return (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? "");
    }
    if (a.unlocked) return -1;
    if (b.unlocked) return 1;
    // Locked: nearer goals first
    const pa = a.progress ?? 0;
    const pb = b.progress ?? 0;
    if (pb !== pa) return pb - pa;
    return (a.threshold ?? 0) - (b.threshold ?? 0);
  });
}

/**
 * Single locked goal nearest completion — featured above the unlocks list.
 * Prefers highest progress; ties break toward the lower threshold.
 */
export function nextClosestAchievement(
  list: readonly AchievementView[]
): AchievementView | null {
  let best: AchievementView | null = null;
  for (const a of list) {
    if (a.unlocked) continue;
    if (!best) {
      best = a;
      continue;
    }
    const pa = a.progress ?? 0;
    const pb = best.progress ?? 0;
    if (pa > pb) {
      best = a;
    } else if (pa === pb && (a.threshold ?? 0) < (best.threshold ?? 0)) {
      best = a;
    }
  }
  return best;
}

/**
 * Unique drop-cap asset paths worth warming in the background.
 * Seed catalog + currently listed rows (open-ended rungs included).
 */
export function dropCapPathsToPreload(state: AppState): string[] {
  const paths = new Set<string>();
  for (const def of ACHIEVEMENT_CATALOG) {
    paths.add(def.dropCap);
  }
  for (const a of listAchievements(state)) {
    paths.add(a.dropCap);
  }
  return [...paths];
}

export function unlockedCount(state: AppState): {
  unlocked: number;
  /** Visible rows (unlocked + next goals). Not a hard ceiling. */
  total: number;
  /** True when ladders can still grow past `total`. */
  openEnded: boolean;
} {
  const list = listAchievements(state);
  let unlocked = 0;
  for (const a of list) {
    if (a.unlocked) unlocked++;
  }
  // Also count stored unlocks not currently listed
  for (const id of Object.keys(state.achievementUnlocks)) {
    if (!list.some((a) => a.id === id)) unlocked++;
  }
  return {
    unlocked,
    total: Math.max(list.length, unlocked),
    openEnded: true,
  };
}
