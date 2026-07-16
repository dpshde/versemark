import { describe, expect, it } from "vitest";
import type { MasteryReport, MasterySlice } from "@versemark/core";
import { progressInsights } from "../src/lib/progress-insights";

function slice(id: string, medianDistance: number, rounds = 3): MasterySlice {
  return {
    id,
    label: id,
    rounds,
    medianDistance,
    avgDistance: medianDistance,
    exactCount: 0,
    nearCount: 0,
  };
}

function report(overrides: Partial<MasteryReport> = {}): MasteryReport {
  return {
    totalRounds: 10,
    dailyRoundCount: 0,
    practiceRoundCount: 10,
    exactCount: 2,
    nearCount: 3,
    streak: 0,
    bestStreak: 0,
    genres: [],
    books: [],
    bookHeat: {},
    weakGenres: [],
    weakBooks: [],
    worstRounds: [],
    ...overrides,
  };
}

describe("progressInsights", () => {
  it("counts exact and near results in close rate", () => {
    expect(progressInsights(report()).closeRate).toBe(50);
  });

  it("finds strongest and practice-next books and genres", () => {
    const gen = slice("Genesis", 20);
    const psa = slice("Psalms", 5);
    const law = slice("Law", 30);
    const poetry = slice("Poetry", 8);
    const insights = progressInsights(report({
      bookHeat: { GEN: gen, PSA: psa },
      genres: [law, poetry],
    }));

    expect(insights.bestBook?.label).toBe("Psalms");
    expect(insights.bookToPractice?.label).toBe("Genesis");
    expect(insights.bestGenre?.label).toBe("Poetry");
    expect(insights.genreToPractice?.label).toBe("Law");
  });

  it("does not present the same single sample as both best and worst", () => {
    const only = slice("Genesis", 20);
    const insights = progressInsights(report({ bookHeat: { GEN: only } }));

    expect(insights.bestBook?.label).toBe("Genesis");
    expect(insights.bookToPractice).toBeUndefined();
  });
});
