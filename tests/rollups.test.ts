import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  bucketForDistance,
  CLOSE_DISTANCE,
  DIST_BUCKET_COUNT,
  DIST_BUCKET_REPS,
  effectiveDistance,
  VERSES_PER_CHAPTER,
} from "../src/lib/scoring";
import {
  computeDistanceTrend,
  computeMastery,
  median,
} from "../src/lib/mastery";
import {
  emptyAppState,
  emptyBookRollup,
  foldRoundsIntoRollups,
  loadState,
  normalizeRollups,
  recordDailyResult,
  recordPracticeResult,
  setLogCapForTests,
  type DailyResultRecord,
  type RoundRecord,
} from "../src/lib/storage";
import { bookChapterVerseFromIndex } from "../src/lib/books";

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  setLogCapForTests(5);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    },
  });
});

afterEach(() => {
  setLogCapForTests(null);
});

function practiceRound(
  trueVerseIndex: number,
  guessOffset: number,
  at: string,
  total = 100
): RoundRecord {
  const guess = trueVerseIndex + guessOffset;
  return {
    trueRef: "PRACTICE",
    trueVerseIndex,
    trueRangeEndVerseIndex: trueVerseIndex,
    guessVerseIndex: guess,
    distance: Math.abs(guessOffset),
    total,
    hintStep: 1,
    at,
    source: "practice",
  };
}

function completeDaily(
  puzzleNumber: number,
  dateKey: string,
  rounds: RoundRecord[]
): DailyResultRecord {
  const last = rounds[rounds.length - 1]!;
  return {
    puzzleNumber,
    dateKey,
    guessVerseIndex: last.guessVerseIndex,
    trueVerseIndex: last.trueVerseIndex,
    trueRef: last.trueRef,
    distance: last.distance,
    total: rounds.reduce((s, r) => s + r.total, 0),
    hintStep: last.hintStep,
    completedAt: `${dateKey}T18:00:00.000Z`,
    rounds: rounds.map((r) => ({ ...r, source: "daily" as const })),
  };
}

describe("distance buckets", () => {
  it("maps exact / close / verse / chapter bands", () => {
    expect(bucketForDistance(0)).toBe(0);
    expect(bucketForDistance(1)).toBe(1);
    expect(bucketForDistance(CLOSE_DISTANCE)).toBe(1);
    expect(bucketForDistance(CLOSE_DISTANCE + 1)).toBe(2);
    expect(bucketForDistance(19)).toBe(2);
    expect(bucketForDistance(20)).toBe(3);
    expect(bucketForDistance(5 * VERSES_PER_CHAPTER)).toBe(4);
    expect(bucketForDistance(80 * VERSES_PER_CHAPTER)).toBe(6);
    expect(DIST_BUCKET_REPS).toHaveLength(DIST_BUCKET_COUNT);
  });

  it("effectiveDistance is 0 inside a truth range", () => {
    expect(
      effectiveDistance({
        trueVerseIndex: 100,
        trueRangeEndVerseIndex: 105,
        guessVerseIndex: 103,
      })
    ).toBe(0);
  });
});

describe("normalizeRollups", () => {
  it("returns {} for missing / garbage", () => {
    expect(normalizeRollups(undefined)).toEqual({});
    expect(normalizeRollups(null)).toEqual({});
    expect(normalizeRollups("nope")).toEqual({});
    expect(normalizeRollups([])).toEqual({});
    expect(
      normalizeRollups({
        bad: { GEN: emptyBookRollup() },
        "2026-08": { GEN: { rounds: "x" } },
      })
    ).toEqual({});
  });

  it("keeps valid month/book entries and pads hist", () => {
    const out = normalizeRollups({
      "2026-08": {
        GEN: {
          rounds: 3,
          practice: 2,
          exact: 1,
          near: 1,
          hist: [1, 1],
        },
      },
    });
    expect(out["2026-08"]?.GEN?.rounds).toBe(3);
    expect(out["2026-08"]?.GEN?.hist).toHaveLength(DIST_BUCKET_COUNT);
    expect(out["2026-08"]?.GEN?.hist[0]).toBe(1);
    expect(out["2026-08"]?.GEN?.hist[1]).toBe(1);
  });

  it("legacy state without rollups loads clean", () => {
    mem.set(
      "versemark:v2",
      JSON.stringify({
        history: [],
        practiceLog: [],
        streak: 0,
        bestStreak: 0,
      })
    );
    const state = loadState();
    expect(state.rollups).toEqual({});
    expect(mem.has("versemark:v3")).toBe(true);
  });
});

describe("foldRoundsIntoRollups", () => {
  it("aggregates by month and book with histogram", () => {
    const loc = bookChapterVerseFromIndex(1);
    expect(loc?.book.osis).toBe("GEN");
    const rounds = [
      practiceRound(1, 0, "2026-08-01T12:00:00.000Z"),
      practiceRound(1, 3, "2026-08-02T12:00:00.000Z"),
      practiceRound(1, 50, "2026-08-03T12:00:00.000Z"),
    ];
    const rollups = foldRoundsIntoRollups({}, rounds);
    const ru = rollups["2026-08"]?.GEN;
    expect(ru).toBeTruthy();
    expect(ru!.rounds).toBe(3);
    expect(ru!.practice).toBe(3);
    expect(ru!.exact).toBe(1);
    expect(ru!.near).toBe(1);
    expect(ru!.points).toBe(300);
    expect(ru!.hist[0]).toBe(1);
    expect(ru!.hist[1]).toBe(1);
    expect(ru!.hist[bucketForDistance(50)]).toBe(1);
  });
});

describe("eviction into rollups", () => {
  it("folds practice rounds past LOG_CAP and mastery totals all-time", () => {
    const cap = 5;
    setLogCapForTests(cap);
    const n = cap + 3;
    for (let i = 0; i < n; i++) {
      recordPracticeResult(
        practiceRound(1, i === 0 ? 0 : 2, `2026-08-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`),
        {
          exact: i === 0,
          near: i !== 0,
          sight: i === 0,
          sameChapter: true,
        },
        new Date(2026, 7, i + 1)
      );
    }
    const state = loadState();
    expect(state.practiceLog).toHaveLength(cap);
    const rolled = Object.values(state.rollups).flatMap((m) =>
      Object.values(m)
    );
    const rolledRounds = rolled.reduce((s, r) => s + r.rounds, 0);
    expect(rolledRounds).toBe(n - cap);

    const mastery = computeMastery(state);
    expect(mastery.totalRounds).toBe(n);
    expect(mastery.practiceRoundCount).toBe(n);
    expect(mastery.exactCount).toBe(1);
    expect(mastery.nearCount).toBe(n - 1);
  });

  it("folds rounds from evicted completed dailies", () => {
    setLogCapForTests(3);
    for (let i = 1; i <= 5; i++) {
      const dateKey = `2026-08-${String(i).padStart(2, "0")}`;
      const rounds: RoundRecord[] = [
        {
          trueRef: `D.${i}`,
          trueVerseIndex: 1,
          trueRangeEndVerseIndex: 1,
          guessVerseIndex: 1,
          distance: 0,
          total: 900,
          hintStep: 1,
          at: `${dateKey}T12:00:00.000Z`,
          source: "daily",
        },
      ];
      recordDailyResult(completeDaily(i, dateKey, rounds), new Date(2026, 7, i));
    }
    const state = loadState();
    expect(state.history).toHaveLength(3);
    const rolledRounds = Object.values(state.rollups)
      .flatMap((m) => Object.values(m))
      .reduce((s, r) => s + r.rounds, 0);
    expect(rolledRounds).toBe(2);

    const mastery = computeMastery(state);
    // 3 completed dailies in window × 1 round + 2 rolled
    expect(mastery.totalRounds).toBe(5);
    expect(mastery.dailyRoundCount).toBe(5);
    expect(mastery.exactCount).toBe(5);
  });
});

describe("mastery rollup median merge", () => {
  it("rolled bucket reps + window rounds stay monotonic within bucket tolerance", () => {
    const windowRounds: RoundRecord[] = [
      practiceRound(1, 0, "2026-09-01T12:00:00.000Z"),
      practiceRound(1, 0, "2026-09-02T12:00:00.000Z"),
      practiceRound(1, 2, "2026-09-03T12:00:00.000Z"),
    ];
    // Fold far misses into August rollup
    const rollups = foldRoundsIntoRollups(
      {},
      [
        practiceRound(1, 100, "2026-08-01T12:00:00.000Z"),
        practiceRound(1, 100, "2026-08-02T12:00:00.000Z"),
        practiceRound(1, 100, "2026-08-03T12:00:00.000Z"),
      ]
    );
    const state = {
      ...emptyAppState(),
      practiceLog: windowRounds,
      practiceRounds: windowRounds.length,
      rollups,
    };
    const m = computeMastery(state);
    expect(m.totalRounds).toBe(6);
    const heat = m.bookHeat.GEN;
    expect(heat).toBeTruthy();
    expect(heat!.rounds).toBe(6);

    const windowOnly = median(windowRounds.map((r) => effectiveDistance(r)));
    // Mixing far rolled reps should raise the median vs window-only
    expect(heat!.medianDistance).toBeGreaterThan(windowOnly);

    const farBucket = bucketForDistance(100);
    const farRep = DIST_BUCKET_REPS[farBucket]!;
    // Median of [0,0,2,rep,rep,rep] — within far bucket band
    expect(heat!.medianDistance).toBeLessThanOrEqual(farRep);
    expect(heat!.medianDistance).toBeGreaterThanOrEqual(0);
  });

  it("keeps evicted and recent rounds in their original trend months", () => {
    const august = practiceRound(1, 100, "2026-08-01T12:00:00.000Z");
    const september = practiceRound(1, 2, "2026-09-01T12:00:00.000Z");
    const state = {
      ...emptyAppState(),
      practiceLog: [september],
      practiceRounds: 2,
      rollups: foldRoundsIntoRollups({}, [august]),
    };

    const trend = computeDistanceTrend(state);
    expect(trend.map((point) => point.month)).toEqual(["2026-08", "2026-09"]);
    expect(trend.map((point) => point.rounds)).toEqual([1, 1]);
    expect(trend[0]!.medianDistance).toBe(
      DIST_BUCKET_REPS[bucketForDistance(100)]
    );
    expect(trend[1]!.medianDistance).toBe(2);
  });
});
