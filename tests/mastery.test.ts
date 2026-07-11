import { describe, it, expect } from "vitest";
import {
  effectiveDistance,
  computeMastery,
  median,
  formatMiss,
  formatMissDistance,
  GENRE_SAMPLE_MIN,
  BOOK_SAMPLE_MIN,
} from "../src/lib/mastery";
import type { AppState, RoundRecord } from "../src/lib/storage";
import { CLOSE_DISTANCE } from "../src/lib/scoring";

function r(
  partial: Partial<RoundRecord> &
    Pick<RoundRecord, "trueVerseIndex" | "guessVerseIndex" | "distance">
): RoundRecord {
  const start = partial.trueVerseIndex;
  return {
    trueRef: partial.trueRef ?? "GEN.1.1",
    trueVerseIndex: start,
    trueRangeEndVerseIndex: partial.trueRangeEndVerseIndex ?? start,
    guessVerseIndex: partial.guessVerseIndex,
    distance: partial.distance,
    total: partial.total ?? 1000,
    hintStep: partial.hintStep ?? 1,
    at: partial.at ?? "2026-08-01T12:00:00.000Z",
    source: partial.source ?? "practice",
  };
}

const emptyState = (): AppState => ({
  lastDaily: null,
  history: [],
  streak: 0,
  bestStreak: 0,
  practiceRounds: 0,
  practiceLog: [],
  lifetime: {
    scoredRounds: 0,
    exact: 0,
    near: 0,
    sight: 0,
    sameChapter: 0,
    completedDailies: 0,
    cleanSheets: 0,
    noHintDailies: 0,
  },
  achievementUnlocks: {},
  achievementsSeenAt: null,
  installDismissedAt: null,
});

describe("effectiveDistance", () => {
  it("is 0 when guess is inside the truth range", () => {
    expect(
      effectiveDistance(
        r({
          trueVerseIndex: 100,
          trueRangeEndVerseIndex: 105,
          guessVerseIndex: 103,
          distance: 3,
        })
      )
    ).toBe(0);
  });

  it("uses min distance to either bound outside the range", () => {
    expect(
      effectiveDistance(
        r({
          trueVerseIndex: 100,
          trueRangeEndVerseIndex: 105,
          guessVerseIndex: 90,
          distance: 10,
        })
      )
    ).toBe(10);
    expect(
      effectiveDistance(
        r({
          trueVerseIndex: 100,
          trueRangeEndVerseIndex: 105,
          guessVerseIndex: 110,
          distance: 10,
        })
      )
    ).toBe(5);
  });
});

describe("median", () => {
  it("returns the middle value for odd n", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("averages the two middle values for even n", () => {
    expect(median([1, 3, 5, 7])).toBe(4);
  });

  it("is robust to a single huge outlier", () => {
    // Two small misses + one 24,999-verse miss → median stays small
    expect(median([2, 4, 24999])).toBe(4);
  });
});

describe("formatMiss / formatMissDistance", () => {
  it("labels exact landings", () => {
    expect(formatMissDistance(0)).toBe("exact");
    expect(formatMiss(0)).toBe("typically exact");
  });

  it("uses verses under 20", () => {
    expect(formatMissDistance(3)).toBe("~3 verses off");
    expect(formatMissDistance(1)).toBe("~1 verse off");
    expect(formatMiss(3)).toBe("typically ~3 verses off");
  });

  it("uses chapters for larger misses (~26 verses each)", () => {
    // 120 * 26 = 3120 → rounds to 120 chapters
    expect(formatMissDistance(3120)).toBe("~120 chapters off");
    expect(formatMissDistance(26)).toBe("~1 chapter off");
    expect(formatMiss(3120)).toBe("typically ~120 chapters off");
  });
});

describe("computeMastery", () => {
  it("returns empty mastery with no rounds", () => {
    const m = computeMastery(emptyState());
    expect(m.totalRounds).toBe(0);
    expect(m.genres).toHaveLength(0);
    expect(m.worstRounds).toHaveLength(0);
  });

  it("gates genre/book by sample thresholds", () => {
    const log: RoundRecord[] = [];
    for (let i = 0; i < BOOK_SAMPLE_MIN - 1; i++) {
      log.push(
        r({
          trueRef: "GEN.1.1",
          trueVerseIndex: 1,
          guessVerseIndex: 10,
          distance: 9,
          source: "practice",
        })
      );
    }
    let state = { ...emptyState(), practiceLog: log, practiceRounds: log.length };
    let m = computeMastery(state);
    expect(m.books.length).toBe(0);

    log.push(
      r({
        trueRef: "GEN.1.1",
        trueVerseIndex: 1,
        guessVerseIndex: 2,
        distance: 1,
        source: "practice",
      })
    );
    state = { ...emptyState(), practiceLog: log, practiceRounds: log.length };
    m = computeMastery(state);
    expect(m.books.some((b) => b.id === "GEN")).toBe(true);
  });

  it("counts exact and near via effective distance", () => {
    const log = [
      r({
        trueVerseIndex: 1,
        trueRangeEndVerseIndex: 5,
        guessVerseIndex: 3,
        distance: 2,
        trueRef: "GEN.1.1",
      }),
      r({
        trueVerseIndex: 100,
        guessVerseIndex: 100 + CLOSE_DISTANCE,
        distance: CLOSE_DISTANCE,
        trueRef: "GEN.3.1",
      }),
      r({
        trueVerseIndex: 200,
        guessVerseIndex: 500,
        distance: 300,
        trueRef: "GEN.5.1",
      }),
    ];
    const m = computeMastery({
      ...emptyState(),
      practiceLog: log,
      practiceRounds: 3,
    });
    expect(m.exactCount).toBe(1);
    expect(m.nearCount).toBe(1);
    expect(m.worstRounds[0].effectiveDistance).toBeGreaterThanOrEqual(300);
  });

  it("requires genre min samples", () => {
    expect(GENRE_SAMPLE_MIN).toBeGreaterThanOrEqual(3);
  });

  it("stores medianDistance and ignores a single outlier", () => {
    // Genesis: misses 2, 4, and 24999 → median 4
    const log = [
      r({ trueVerseIndex: 1, guessVerseIndex: 3, distance: 2, trueRef: "GEN.1.1" }),
      r({ trueVerseIndex: 1, guessVerseIndex: 5, distance: 4, trueRef: "GEN.1.1" }),
      r({
        trueVerseIndex: 1,
        guessVerseIndex: 25000,
        distance: 24999,
        trueRef: "GEN.1.1",
      }),
    ];
    const m = computeMastery({
      ...emptyState(),
      practiceLog: log,
      practiceRounds: 3,
    });
    const gen = m.books.find((b) => b.id === "GEN");
    expect(gen?.medianDistance).toBe(4);
    expect(gen?.avgDistance).toBeGreaterThan(1000);
  });

  it("sorts slices strongest-first by medianDistance", () => {
    // GEN: three small misses (median low)
    // EXO: three large misses (median high) — need BOOK_SAMPLE_MIN=2 each,
    // GENRE_SAMPLE_MIN=3 so use three per book, same genre (Law).
    const log = [
      r({ trueVerseIndex: 1, guessVerseIndex: 2, distance: 1, trueRef: "GEN.1.1" }),
      r({ trueVerseIndex: 1, guessVerseIndex: 3, distance: 2, trueRef: "GEN.1.1" }),
      r({ trueVerseIndex: 1, guessVerseIndex: 4, distance: 3, trueRef: "GEN.1.1" }),
      // Exodus starts around verse 1534
      r({
        trueVerseIndex: 1534,
        guessVerseIndex: 1534 + 100,
        distance: 100,
        trueRef: "EXO.1.1",
      }),
      r({
        trueVerseIndex: 1534,
        guessVerseIndex: 1534 + 200,
        distance: 200,
        trueRef: "EXO.1.1",
      }),
      r({
        trueVerseIndex: 1534,
        guessVerseIndex: 1534 + 300,
        distance: 300,
        trueRef: "EXO.1.1",
      }),
    ];
    const m = computeMastery({
      ...emptyState(),
      practiceLog: log,
      practiceRounds: log.length,
    });
    const gen = m.books.find((b) => b.id === "GEN");
    const exo = m.books.find((b) => b.id === "EXO");
    expect(gen && exo).toBeTruthy();
    expect(gen!.medianDistance).toBeLessThan(exo!.medianDistance);
    // Strongest first
    const genIdx = m.books.findIndex((b) => b.id === "GEN");
    const exoIdx = m.books.findIndex((b) => b.id === "EXO");
    expect(genIdx).toBeLessThan(exoIdx);
    // Weak list reverses
    expect(m.weakBooks[0]?.id).toBe("EXO");
  });
});
