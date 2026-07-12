import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateAchievements,
  listAchievements,
  nextClosestAchievement,
  effectiveLifetime,
  nextThreshold,
  thresholdsForLadder,
  achievementDefForId,
  metalForThreshold,
  dropCapPath,
  dropCapPathsToPreload,
  ACHIEVEMENT_CATALOG,
} from "../src/lib/achievements";
import {
  emptyLifetime,
  emptyAppState,
  type AppState,
  type RoundRecord,
  type DailyResultRecord,
} from "../src/lib/storage";

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
      removeItem: (k: string) => mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    },
  });
});

function practice(
  distance: number,
  hintStep = 1,
  trueVerseIndex = 1,
  guess?: number
): RoundRecord {
  return {
    trueRef: "GEN.1.1",
    trueVerseIndex,
    trueRangeEndVerseIndex: trueVerseIndex,
    guessVerseIndex: guess ?? trueVerseIndex + distance,
    distance,
    total: 1000,
    hintStep,
    at: "2026-08-01T12:00:00.000Z",
    source: "practice",
  };
}

function state(partial: Partial<AppState>): AppState {
  return {
    ...emptyAppState(),
    ...partial,
    lifetime: partial.lifetime
      ? { ...emptyLifetime(), ...partial.lifetime }
      : emptyLifetime(),
  };
}

function completeDaily(
  puzzleNumber: number,
  rounds: RoundRecord[]
): DailyResultRecord {
  return {
    puzzleNumber,
    dateKey: "2026-08-01",
    guessVerseIndex: rounds[rounds.length - 1]?.guessVerseIndex ?? 0,
    trueVerseIndex: rounds[rounds.length - 1]?.trueVerseIndex ?? 0,
    trueRef: rounds[rounds.length - 1]?.trueRef ?? "",
    distance: 0,
    total: rounds.reduce((s, r) => s + r.total, 0),
    hintStep: 1,
    completedAt: "2026-08-01T18:00:00.000Z",
    rounds,
  };
}

describe("metal tiers", () => {
  it("maps thresholds to bronze / gold / snow", () => {
    expect(metalForThreshold(1)).toBe("bronze");
    expect(metalForThreshold(25)).toBe("bronze");
    expect(metalForThreshold(50)).toBe("gold");
    expect(metalForThreshold(100)).toBe("gold");
    expect(metalForThreshold(250)).toBe("snow");
    expect(metalForThreshold(10_000)).toBe("snow");
  });

  it("drop caps are per-achievement motif + metal paths", () => {
    expect(dropCapPath("exact-once", "bronze")).toBe(
      "assets/achievements/exact-once-bronze.webp"
    );
    expect(dropCapPath("exact-10", "bronze")).toBe(
      "assets/achievements/exact-10-bronze.webp"
    );
    expect(dropCapPath("rounds-5000", "snow")).toBe(
      "assets/achievements/rounds-5000-snow.webp"
    );
  });

  it("each seed achievement gets its own drop-cap path", () => {
    const caps = ACHIEVEMENT_CATALOG.map((a) => a.dropCap);
    // Seed catalog entries should not all share one ladder image
    const unique = new Set(caps);
    expect(unique.size).toBe(ACHIEVEMENT_CATALOG.length);
    const byId = Object.fromEntries(
      ACHIEVEMENT_CATALOG.map((a) => [a.id, a.dropCap])
    );
    expect(byId["exact-once"]).toContain("exact-once-bronze");
    expect(byId["exact-10"]).toContain("exact-10-bronze");
    expect(byId["exact-500"]).toContain("exact-500-snow");
    expect(byId["rounds-10"]).toContain("rounds-10-bronze");
    expect(byId["rounds-5000"]).toContain("rounds-5000-snow");
    expect(byId["daily-365"]).toContain("daily-365-snow");
  });

  it("preload paths cover the seed catalog and listed rows", () => {
    const state = emptyAppState();
    const paths = dropCapPathsToPreload(state);
    expect(paths.length).toBeGreaterThanOrEqual(ACHIEVEMENT_CATALOG.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const def of ACHIEVEMENT_CATALOG) {
      expect(paths).toContain(def.dropCap);
    }
    for (const p of paths) {
      expect(p).toMatch(/^assets\/achievements\/.+\.webp$/);
    }
  });
});

describe("open-ended ladders", () => {
  it("nextThreshold follows 1–2–5 decades", () => {
    expect(nextThreshold(1)).toBe(2);
    expect(nextThreshold(2)).toBe(5);
    expect(nextThreshold(5)).toBe(10);
    expect(nextThreshold(10)).toBe(20);
    expect(nextThreshold(50)).toBe(100);
    expect(nextThreshold(5000)).toBe(10000);
    expect(nextThreshold(10000)).toBe(20000);
    expect(nextThreshold(365)).toBe(500);
  });

  it("scales without a fixed ceiling", () => {
    let n = 5000;
    for (let i = 0; i < 40; i++) n = nextThreshold(n);
    expect(n).toBeGreaterThan(1e12);
    expect(n).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it("extends past seeds for power-user values", () => {
    const seeds = [
      { n: 10, id: "rounds-10" },
      { n: 50, id: "rounds-50" },
      { n: 5000, id: "rounds-5000" },
    ];
    const ns = thresholdsForLadder(seeds, 12_000, 2);
    expect(ns).toContain(10);
    expect(ns).toContain(5000);
    expect(ns).toContain(10_000);
    expect(ns).toContain(20_000);
    expect(ns).toContain(50_000);
  });

  it("list collapses intermediate open unlocks at extreme scale", () => {
    const s = state({
      lifetime: {
        ...emptyLifetime(),
        scoredRounds: 1_000_000,
      },
    });
    const list = listAchievements(s);
    const openRounds = list.filter(
      (a) => a.ladder === "rounds" && (a.threshold ?? 0) > 5000 && a.unlocked
    );
    // Only the highest open rank is listed as unlocked (not every intermediate)
    expect(openRounds.length).toBe(1);
    expect(openRounds[0]!.threshold).toBe(1_000_000);
    // Still shows locked next goals
    expect(
      list.some((a) => a.ladder === "rounds" && !a.unlocked && (a.threshold ?? 0) > 1_000_000)
    ).toBe(true);
    // Finite list even at huge volume
    expect(list.length).toBeLessThan(100);
  });
});

describe("evaluateAchievements", () => {
  it("unlocks exact and sight-reading", () => {
    const s = state({
      practiceLog: [practice(0, 1)],
      practiceRounds: 1,
    });
    const u = evaluateAchievements(s);
    expect(u["exact-once"]).toBeTruthy();
    expect(u["exact-no-hint"]).toBeTruthy();
  });

  it("unlocks near-miss without exact", () => {
    const s = state({
      practiceLog: [practice(3, 1)],
      practiceRounds: 1,
    });
    const u = evaluateAchievements(s);
    expect(u["near-miss"]).toBeTruthy();
    expect(u["exact-once"]).toBeFalsy();
  });

  it("uses bestStreak for streak unlocks including long tiers", () => {
    const s = state({ bestStreak: 30, practiceRounds: 0 });
    const u = evaluateAchievements(s);
    expect(u["streak-3"]).toBeTruthy();
    expect(u["streak-7"]).toBeTruthy();
    expect(u["streak-14"]).toBeTruthy();
    expect(u["streak-30"]).toBeTruthy();
    expect(u["streak-100"]).toBeFalsy();
  });

  it("uses lifetime practiceRounds for volume even with empty log", () => {
    const s = state({ practiceRounds: 50, practiceLog: [] });
    const u = evaluateAchievements(s);
    expect(u["rounds-10"]).toBeTruthy();
    expect(u["rounds-50"]).toBeTruthy();
    expect(u["rounds-100"]).toBeFalsy();
  });

  it("scales volume past the last seed with open-ended ids", () => {
    const s = state({
      practiceLog: [],
      practiceRounds: 0,
      lifetime: {
        ...emptyLifetime(),
        scoredRounds: 12_000,
        exact: 750,
      },
    });
    const u = evaluateAchievements(s);
    expect(u["rounds-5000"]).toBeTruthy();
    expect(u["rounds-10000"]).toBeTruthy();
    expect(u["rounds-20000"]).toBeFalsy();
    expect(u["exact-500"]).toBeTruthy();
    // 750 exacts: 500 unlocked, next open step is 1000 (locked)
    expect(u["exact-1000"]).toBeFalsy();
    const list = listAchievements(s);
    expect(list.some((a) => a.id === "exact-1000" && !a.unlocked)).toBe(true);
    expect(list.some((a) => a.id === "rounds-20000" && !a.unlocked)).toBe(
      true
    );
    expect(achievementDefForId("rounds-10000")?.threshold).toBe(10_000);
  });

  it("clean sheet requires every daily round exact", () => {
    const threeExact = [1, 2, 3].map((i) => practice(0, 1, i, i));
    const s = state({
      history: [completeDaily(1, threeExact)],
      practiceRounds: 0,
    });
    const u = evaluateAchievements(s);
    expect(u["daily-once"]).toBeTruthy();
    expect(u["daily-clean"]).toBeTruthy();
    expect(u["daily-no-hints"]).toBeTruthy();
  });

  it("list sorts unlocked first and keeps a finite next-goal window", () => {
    const s = state({
      achievementUnlocks: {
        "exact-once": { unlockedAt: "2026-08-02T00:00:00.000Z" },
      },
      lifetime: { ...emptyLifetime(), exact: 1 },
    });
    const list = listAchievements(s);
    expect(list[0].id).toBe("exact-once");
    expect(list[0].unlocked).toBe(true);
    // Open-ended: not an infinite dump
    expect(list.length).toBeGreaterThan(5);
    expect(list.length).toBeLessThan(200);
  });

  it("nextClosestAchievement picks the locked goal nearest completion", () => {
    const s = state({
      achievementUnlocks: {
        "exact-once": { unlockedAt: "2026-08-02T00:00:00.000Z" },
        "rounds-10": { unlockedAt: "2026-08-03T00:00:00.000Z" },
      },
      lifetime: {
        ...emptyLifetime(),
        exact: 8,
        scoredRounds: 40,
        near: 5,
      },
    });
    const list = listAchievements(s);
    const next = nextClosestAchievement(list);
    expect(next?.unlocked).toBe(false);
    // exact 8/10 = 80% beats rounds 40/50 = 80%? equal progress — lower threshold wins
    // exact-10 threshold 10, rounds-50 threshold 50 → exact-10
    expect(next?.id).toBe("exact-10");
    expect(next?.progress).toBeCloseTo(0.8);
  });

  it("nextClosestAchievement is null when every listed row is unlocked", () => {
    const list = [
      {
        id: "exact-once",
        title: "Exact",
        description: "",
        unlocked: true,
        unlockedAt: "2026-08-01T00:00:00.000Z",
        dropCap: "",
        metal: "bronze" as const,
        progress: 1,
      },
    ];
    expect(nextClosestAchievement(list)).toBeNull();
  });

  it("effectiveLifetime prefers higher of stored vs log-derived", () => {
    const s = state({
      practiceLog: [practice(0, 1)],
      practiceRounds: 1,
      lifetime: { ...emptyLifetime(), exact: 40, scoredRounds: 1 },
    });
    const L = effectiveLifetime(s);
    expect(L.exact).toBe(40);
    expect(L.scoredRounds).toBeGreaterThanOrEqual(1);
  });
});
