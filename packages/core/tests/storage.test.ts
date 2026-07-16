import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeStreak,
  computePracticeStreak,
  currentPracticeStreakFromLast,
  currentDailyStreakFromLast,
  longestConsecutiveDateKeys,
  getDailyForPuzzle,
  isDailyComplete,
  loadState,
  resetProgress,
  saveState,
  recordDailyResult,
  recordDailyScoredRound,
  recordPracticeResult,
  recordHintClick,
  applyScoredRoundMeta,
  exactRunsFromRounds,
  reconcileCoverageFromLogs,
  emptyAppState,
  emptyLifetime,
  normalizeRoundRecord,
  STORAGE_SCHEMA_VERSION,
  monthKeyFromAt,
  setLogCapForTests,
  setStorageBackend,
  type DailyResultRecord,
  type RoundRecord,
  type KvStore,
} from "../src/storage";
import { bookChapterVerseFromIndex } from "../src/books";

const KEY_V3 = "versemark:v3";
const KEY_V2 = "versemark:v2";

const mem = new Map<string, string>();
let quotaFail = false;

function testKvStore(): KvStore {
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (quotaFail) {
        const err = new Error("quota");
        err.name = "QuotaExceededError";
        throw err;
      }
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };
}

beforeEach(() => {
  mem.clear();
  quotaFail = false;
  setStorageBackend(testKvStore());
});

afterEach(() => {
  setLogCapForTests(null);
});

function partial(n: number, dateKey: string, rounds: number): DailyResultRecord {
  const list = Array.from({ length: rounds }, (_, i) => ({
    trueRef: `REF.${i}`,
    trueVerseIndex: 100 + i,
    trueRangeEndVerseIndex: 100 + i,
    guessVerseIndex: 100 + i,
    distance: 0,
    total: 900,
    hintStep: 1,
    at: `${dateKey}T12:00:00.000Z`,
    source: "daily" as const,
  }));
  const last = list[list.length - 1];
  return {
    puzzleNumber: n,
    dateKey,
    guessVerseIndex: last.guessVerseIndex,
    trueVerseIndex: last.trueVerseIndex,
    trueRef: last.trueRef,
    distance: last.distance,
    total: list.reduce((s, r) => s + r.total, 0),
    hintStep: last.hintStep,
    completedAt: null,
    rounds: list,
  };
}

function complete(n: number, dateKey: string, at: string): DailyResultRecord {
  const rec = partial(n, dateKey, 3);
  return { ...rec, completedAt: at };
}

function practiceRound(
  trueVerseIndex: number,
  at: string,
  total = 500
): RoundRecord {
  return {
    trueRef: "PRACTICE",
    trueVerseIndex,
    trueRangeEndVerseIndex: trueVerseIndex,
    guessVerseIndex: trueVerseIndex,
    distance: 0,
    total,
    hintStep: 1,
    at,
    source: "practice",
  };
}

describe("daily progress storage", () => {
  it("saves and loads partial progress without counting streak", () => {
    const now = new Date(2026, 7, 15);
    const state = recordDailyResult(partial(15, "2026-08-15", 2), now);
    expect(state.history).toHaveLength(1);
    expect(state.streak).toBe(0);
    expect(isDailyComplete(state.lastDaily!)).toBe(false);

    const loaded = getDailyForPuzzle(15);
    expect(loaded?.rounds).toHaveLength(2);
    expect(loaded?.completedAt).toBeNull();
  });

  it("upgrades partial to complete and counts streak", () => {
    const now = new Date(2026, 7, 15);
    recordDailyResult(partial(15, "2026-08-15", 2), now);
    const done = recordDailyResult(
      complete(15, "2026-08-15", now.toISOString()),
      now
    );
    expect(done.history).toHaveLength(1);
    expect(done.history[0].rounds).toHaveLength(3);
    expect(done.streak).toBe(1);
    expect(isDailyComplete(done.lastDaily!)).toBe(true);
  });

  it("computeStreak ignores in-progress days", () => {
    const history = [
      complete(13, "2026-08-13", "2026-08-13T12:00:00.000Z"),
      complete(14, "2026-08-14", "2026-08-14T12:00:00.000Z"),
      partial(15, "2026-08-15", 1),
    ];
    // Today incomplete → streak from yesterday backward
    expect(computeStreak(history, "2026-08-15")).toBe(2);
    // Mark today complete
    history[2] = complete(15, "2026-08-15", "2026-08-15T18:00:00.000Z");
    expect(computeStreak(history, "2026-08-15")).toBe(3);
  });

  it("keeps growing daily streak after completed history is evicted", () => {
    setLogCapForTests(3);
    for (let day = 10; day <= 14; day++) {
      const key = `2026-08-${day}`;
      const now = new Date(2026, 7, day);
      recordDailyResult(complete(day, key, now.toISOString()), now);
    }

    let state = loadState();
    expect(state.history).toHaveLength(3);
    expect(state.streak).toBe(5);
    expect(state.bestStreak).toBe(5);
    expect(state.lastCompletedDailyDateKey).toBe("2026-08-14");

    state = recordDailyResult(
      partial(15, "2026-08-15", 1),
      new Date(2026, 7, 15)
    );
    expect(state.streak).toBe(5);
    expect(state.bestStreak).toBe(5);
  });

  it("derives current daily streak from the completion watermark", () => {
    expect(currentDailyStreakFromLast("2026-08-14", 12, "2026-08-15")).toBe(12);
    expect(currentDailyStreakFromLast("2026-08-13", 12, "2026-08-15")).toBe(0);
  });

  it("loadState normalizes legacy completedAt strings", () => {
    mem.set(
      KEY_V2,
      JSON.stringify({
        lastDaily: {
          puzzleNumber: 1,
          dateKey: "2026-08-01",
          guessVerseIndex: 10,
          trueVerseIndex: 10,
          trueRef: "GEN.1.1",
          distance: 0,
          total: 3000,
          hintStep: 1,
          completedAt: "2026-08-01T10:00:00.000Z",
          rounds: [
            {
              trueRef: "GEN.1.1",
              trueVerseIndex: 10,
              guessVerseIndex: 10,
              distance: 0,
              total: 3000,
              hintStep: 1,
            },
          ],
        },
        history: [
          {
            puzzleNumber: 1,
            dateKey: "2026-08-01",
            guessVerseIndex: 10,
            trueVerseIndex: 10,
            trueRef: "GEN.1.1",
            distance: 0,
            total: 3000,
            hintStep: 1,
            completedAt: "2026-08-01T10:00:00.000Z",
            rounds: [
              {
                trueRef: "GEN.1.1",
                trueVerseIndex: 10,
                guessVerseIndex: 10,
                distance: 0,
                total: 3000,
                hintStep: 1,
              },
            ],
          },
        ],
        streak: 1,
        bestStreak: 1,
      })
    );
    const state = loadState();
    expect(isDailyComplete(state.lastDaily!)).toBe(true);
    expect(getDailyForPuzzle(1)?.total).toBe(3000);
    // One-time migration backfills coverage from legacy logs
    expect(state.firstActivityAt).toBeTruthy();
    expect(state.touchedVerses).toContain(10);
    expect(state.lifetime.uniqueVerses).toBeGreaterThanOrEqual(1);
    // Imported into v3; materializes points floor
    expect(mem.has(KEY_V3)).toBe(true);
    expect(state.lifetime.totalPoints).toBeGreaterThanOrEqual(3000);
    expect(state.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(state.deviceId).toMatch(/^device_/);
    expect(state.revision).toBeGreaterThan(0);
    expect(JSON.parse(mem.get(KEY_V3)!).schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
  });

  it("persists a stable installation id on first load", () => {
    const first = loadState();
    const second = loadState();
    expect(first.deviceId).toBe(second.deviceId);
    expect(mem.has(KEY_V3)).toBe(true);
  });

  it("resets progress while preserving the installation identity", () => {
    const state = loadState();
    state.practiceRounds = 4;
    state.streak = 3;
    state.achievementUnlocks.example = { unlockedAt: "2026-08-15T12:00:00.000Z" };
    saveState(state);

    const reset = resetProgress();
    expect(reset.deviceId).toBe(state.deviceId);
    expect(reset.practiceRounds).toBe(0);
    expect(reset.streak).toBe(0);
    expect(reset.achievementUnlocks).toEqual({});
    expect(reset.history).toEqual([]);
    expect(mem.has(KEY_V2)).toBe(false);
  });

  it("gives legacy rounds deterministic immutable event ids", () => {
    const legacy = practiceRound(42, "2026-08-15T12:00:00.000Z");
    const first = normalizeRoundRecord(legacy, "practice");
    const second = normalizeRoundRecord(legacy, "practice");
    expect(first?.eventId).toMatch(/^round_legacy_/);
    expect(first?.eventId).toBe(second?.eventId);
    expect(first?.revision).toBe(1);
  });
});

describe("coverage and activity stats", () => {
  it("applyScoredRoundMeta tracks points, coverage, and activity", () => {
    const loc = bookChapterVerseFromIndex(1);
    expect(loc?.book.osis).toBe("GEN");
    const record = practiceRound(1, "2026-08-10T12:00:00.000Z", 750);
    const next = applyScoredRoundMeta(
      emptyAppState(),
      record,
      emptyLifetime(),
      new Date(2026, 7, 10)
    );
    expect(next.firstActivityAt).toBe("2026-08-10T12:00:00.000Z");
    expect(next.lastActivityAt).toBe("2026-08-10T12:00:00.000Z");
    expect(next.lifetime.totalPoints).toBe(750);
    expect(next.lifetime.uniqueVerses).toBe(1);
    expect(next.lifetime.booksTouched).toBe(1);
    expect(next.lifetime.chaptersTouched).toBe(1);
    expect(next.touchedVerses).toEqual([1]);
    expect(next.touchedBooks).toContain("GEN");
    expect(next.touchedChapters).toContain("GEN:1");
  });

  it("dedupes unique verses and books across rounds", () => {
    const a = practiceRound(1, "2026-08-10T12:00:00.000Z", 100);
    const b = practiceRound(1, "2026-08-10T13:00:00.000Z", 200);
    const c = practiceRound(50, "2026-08-10T14:00:00.000Z", 300);
    let state = applyScoredRoundMeta(
      emptyAppState(),
      a,
      emptyLifetime(),
      new Date(2026, 7, 10)
    );
    state = applyScoredRoundMeta(
      state,
      b,
      state.lifetime,
      new Date(2026, 7, 10)
    );
    state = applyScoredRoundMeta(
      state,
      c,
      state.lifetime,
      new Date(2026, 7, 10)
    );
    expect(state.lifetime.totalPoints).toBe(600);
    expect(state.lifetime.uniqueVerses).toBe(2);
    expect(state.lifetime.booksTouched).toBe(1);
    expect(state.firstActivityAt).toBe("2026-08-10T12:00:00.000Z");
    expect(state.lastActivityAt).toBe("2026-08-10T14:00:00.000Z");
  });

  it("keeps coverage counters and activity timestamps monotonic", () => {
    const base = {
      ...emptyAppState(),
      lifetime: {
        ...emptyLifetime(),
        uniqueVerses: 5,
        booksTouched: 3,
        chaptersTouched: 4,
      },
      firstActivityAt: "2026-08-01T00:00:00.000Z",
      lastActivityAt: "2026-08-10T00:00:00.000Z",
      touchedVerses: [1, 2, 3, 4, 5],
      touchedBooks: ["GEN", "EXO", "LEV"],
      touchedChapters: ["GEN:1", "GEN:2", "EXO:1", "LEV:1"],
    };
    const older = practiceRound(1, "2026-07-01T12:00:00.000Z", 50);
    const next = applyScoredRoundMeta(
      base,
      older,
      base.lifetime,
      new Date(2026, 6, 1)
    );
    expect(next.lifetime.uniqueVerses).toBeGreaterThanOrEqual(5);
    expect(next.firstActivityAt).toBe("2026-07-01T12:00:00.000Z");
    expect(next.lastActivityAt).toBe("2026-08-10T00:00:00.000Z");
  });

  it("recordPracticeResult bumps practice streak across days", () => {
    const day1 = new Date(2026, 7, 10);
    const day2 = new Date(2026, 7, 11);
    const day4 = new Date(2026, 7, 13);

    let state = recordPracticeResult(
      practiceRound(1, day1.toISOString()),
      { exact: true, near: false, sight: true, sameChapter: true },
      day1
    );
    expect(state.practiceStreak).toBe(1);
    expect(state.bestPracticeStreak).toBe(1);

    state = recordPracticeResult(
      practiceRound(2, day2.toISOString()),
      { exact: true, near: false, sight: true, sameChapter: true },
      day2
    );
    expect(state.practiceStreak).toBe(2);
    expect(state.bestPracticeStreak).toBe(2);

    // Same day does not increment again
    state = recordPracticeResult(
      practiceRound(3, day2.toISOString()),
      { exact: false, near: true, sight: false, sameChapter: false },
      day2
    );
    expect(state.practiceStreak).toBe(2);

    // Gap resets current streak but keeps best
    state = recordPracticeResult(
      practiceRound(4, day4.toISOString()),
      { exact: false, near: false, sight: false, sameChapter: false },
      day4
    );
    expect(state.practiceStreak).toBe(1);
    expect(state.bestPracticeStreak).toBe(2);
  });

  it("computePracticeStreak mirrors daily streak rules", () => {
    expect(
      computePracticeStreak(["2026-08-13", "2026-08-14"], "2026-08-15")
    ).toBe(2);
    expect(
      computePracticeStreak(
        ["2026-08-13", "2026-08-14", "2026-08-15"],
        "2026-08-15"
      )
    ).toBe(3);
  });

  it("decays stale practice streak while keeping best", () => {
    expect(
      currentPracticeStreakFromLast("2026-08-01", 5, "2026-08-15")
    ).toBe(0);
    expect(
      currentPracticeStreakFromLast("2026-08-15", 5, "2026-08-15")
    ).toBe(5);
    expect(
      currentPracticeStreakFromLast("2026-08-14", 5, "2026-08-15")
    ).toBe(5);
    expect(longestConsecutiveDateKeys(["2026-08-01", "2026-08-02", "2026-08-04", "2026-08-05", "2026-08-06"])).toBe(3);
  });

  it("recordHintClick increments lifetime hintsClicked", () => {
    expect(loadState().lifetime.hintsClicked).toBe(0);
    recordHintClick();
    recordHintClick();
    expect(loadState().lifetime.hintsClicked).toBe(2);
  });

  it("monthKeyFromAt uses local calendar month", () => {
    // Mid-month UTC is unambiguous in any local TZ
    expect(monthKeyFromAt("2026-08-15T12:00:00.000Z")).toBe("2026-08");
  });
});

function missRound(trueVerseIndex: number, at: string): RoundRecord {
  return {
    ...practiceRound(trueVerseIndex, at),
    guessVerseIndex: trueVerseIndex + 50,
    distance: 50,
  };
}

describe("exact streak", () => {
  const day = new Date(2026, 7, 10);

  it("applyScoredRoundMeta increments on exact, resets on miss, keeps best", () => {
    let state = applyScoredRoundMeta(
      emptyAppState(),
      practiceRound(1, "2026-08-10T12:00:00.000Z"),
      emptyLifetime(),
      day
    );
    expect(state.exactStreak).toBe(1);
    state = applyScoredRoundMeta(
      state,
      { ...practiceRound(2, "2026-08-10T12:05:00.000Z"), source: "daily" },
      state.lifetime,
      day
    );
    expect(state.exactStreak).toBe(2);
    expect(state.bestExactStreak).toBe(2);

    state = applyScoredRoundMeta(
      state,
      missRound(3, "2026-08-10T12:10:00.000Z"),
      state.lifetime,
      day
    );
    expect(state.exactStreak).toBe(0);
    expect(state.bestExactStreak).toBe(2);

    state = applyScoredRoundMeta(
      state,
      practiceRound(4, "2026-08-10T12:15:00.000Z"),
      state.lifetime,
      day
    );
    expect(state.exactStreak).toBe(1);
    expect(state.bestExactStreak).toBe(2);
  });

  it("counts a guess inside a verse range as exact", () => {
    const range: RoundRecord = {
      ...practiceRound(10, "2026-08-10T12:00:00.000Z"),
      trueRangeEndVerseIndex: 12,
      guessVerseIndex: 11,
      distance: 1,
    };
    const state = applyScoredRoundMeta(
      emptyAppState(),
      range,
      emptyLifetime(),
      day
    );
    expect(state.exactStreak).toBe(1);
  });

  it("exactRunsFromRounds finds best and trailing runs in at-order", () => {
    const rounds = [
      practiceRound(1, "2026-08-10T12:00:00.000Z"),
      practiceRound(2, "2026-08-10T12:01:00.000Z"),
      practiceRound(3, "2026-08-10T12:02:00.000Z"),
      missRound(4, "2026-08-10T12:03:00.000Z"),
      practiceRound(5, "2026-08-10T12:04:00.000Z"),
    ];
    // Shuffle to prove sorting by `at` governs run order
    const shuffled = [rounds[3], rounds[0], rounds[4], rounds[2], rounds[1]];
    expect(exactRunsFromRounds(shuffled)).toEqual({ best: 3, trailing: 1 });
  });

  it("reconcileCoverageFromLogs backfills best and trailing exact runs", () => {
    const state = {
      ...emptyAppState(),
      practiceLog: [
        practiceRound(1, "2026-08-10T12:00:00.000Z"),
        practiceRound(2, "2026-08-10T12:01:00.000Z"),
        missRound(3, "2026-08-10T12:02:00.000Z"),
        practiceRound(4, "2026-08-10T12:03:00.000Z"),
      ],
    };
    const migrated = reconcileCoverageFromLogs(state);
    expect(migrated.bestExactStreak).toBe(2);
    expect(migrated.exactStreak).toBe(1);
  });

  it("persists exact streak across recordPracticeResult + loadState", () => {
    recordPracticeResult(
      practiceRound(1, day.toISOString()),
      { exact: true, near: false, sight: true, sameChapter: true },
      day
    );
    recordPracticeResult(
      practiceRound(2, day.toISOString()),
      { exact: true, near: false, sight: true, sameChapter: true },
      day
    );
    let state = loadState();
    expect(state.exactStreak).toBe(2);
    expect(state.bestExactStreak).toBe(2);

    recordPracticeResult(
      missRound(3, day.toISOString()),
      { exact: false, near: false, sight: false, sameChapter: false },
      day
    );
    state = loadState();
    expect(state.exactStreak).toBe(0);
    expect(state.bestExactStreak).toBe(2);
  });
});

describe("storage durability", () => {
  it("imports v2 once into v3 so old clients cannot overwrite new fields", () => {
    mem.set(
      KEY_V2,
      JSON.stringify({
        history: [],
        practiceLog: [],
        streak: 2,
        bestStreak: 4,
        rollups: {
          "2026-08": {
            GEN: {
              rounds: 2,
              practice: 2,
              exact: 1,
              near: 1,
              points: 400,
              hist: [1, 1, 0, 0, 0, 0, 0],
            },
          },
        },
        touchedVerses: [1],
        firstActivityAt: "2026-08-01T00:00:00.000Z",
        lifetime: { ...emptyLifetime(), uniqueVerses: 1, totalPoints: 400 },
      })
    );
    const state = loadState();
    expect(state.rollups["2026-08"]?.GEN?.rounds).toBe(2);
    expect(mem.has(KEY_V3)).toBe(true);
    // Simulate old client writing only known v2 fields back to LEGACY key
    mem.set(KEY_V2, JSON.stringify({ streak: 99, history: [], practiceLog: [] }));
    const again = loadState();
    // v3 is authoritative — rollups survive
    expect(again.rollups["2026-08"]?.GEN?.rounds).toBe(2);
    expect(again.streak).toBe(2);
  });

  it("saveState returns false on quota errors", () => {
    const state = emptyAppState();
    expect(saveState(state)).toBe(true);
    quotaFail = true;
    expect(saveState(state)).toBe(false);
  });

  it("recordDailyScoredRound persists history and lifetime in one write", () => {
    const now = new Date(2026, 7, 15);
    const round = practiceRound(1, now.toISOString(), 900);
    round.source = "daily";
    const daily = complete(15, "2026-08-15", now.toISOString());
    daily.rounds = [round];
    const flags = {
      exact: true,
      near: false,
      sight: true,
      sameChapter: true,
      completedDaily: true,
      cleanSheet: true,
      noHintDaily: true,
    };
    const next = recordDailyScoredRound(daily, round, flags, now);
    expect(next.history).toHaveLength(1);
    expect(next.lifetime.scoredRounds).toBe(1);
    expect(next.lifetime.completedDailies).toBe(1);
    expect(next.lifetime.cleanSheets).toBe(1);
    expect(next.lifetime.noHintDailies).toBe(1);
    expect(next.lifetime.totalPoints).toBe(900);
    expect(next.touchedVerses).toContain(1);
    expect(next.firstActivityAt).toBeTruthy();
    // Single v3 blob
    expect(mem.has(KEY_V3)).toBe(true);
    const loaded = loadState();
    expect(loaded.lifetime.totalPoints).toBe(900);
    expect(loaded.history[0]?.puzzleNumber).toBe(15);
  });

  it("recordDailyScoredRound increments the latest persisted lifetime", () => {
    const now = new Date(2026, 7, 15);
    const existing = emptyAppState();
    existing.lifetime.scoredRounds = 7;
    existing.lifetime.hintsClicked = 4;
    saveState(existing);

    const round = practiceRound(1, now.toISOString(), 900);
    round.source = "daily";
    const daily = partial(15, "2026-08-15", 1);
    daily.rounds = [round];
    const next = recordDailyScoredRound(
      daily,
      round,
      {
        exact: true,
        near: false,
        sight: true,
        sameChapter: true,
        completedDaily: false,
        cleanSheet: false,
        noHintDaily: false,
      },
      now
    );

    expect(next.lifetime.scoredRounds).toBe(8);
    expect(next.lifetime.hintsClicked).toBe(4);
    expect(next.lifetime.exact).toBe(1);
  });
});
