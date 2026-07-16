import type { MasteryReport, MasterySlice } from "@versemark/core";

export type ProgressInsights = {
  closeRate: number;
  bestBook: MasterySlice | undefined;
  bookToPractice: MasterySlice | undefined;
  bestGenre: MasterySlice | undefined;
  genreToPractice: MasterySlice | undefined;
};

function compareStrength(a: MasterySlice, b: MasterySlice): number {
  if (a.medianDistance !== b.medianDistance) return a.medianDistance - b.medianDistance;
  if (a.avgDistance !== b.avgDistance) return a.avgDistance - b.avgDistance;
  if (a.rounds !== b.rounds) return b.rounds - a.rounds;
  return a.label.localeCompare(b.label);
}

function bounds(items: MasterySlice[]): {
  best: MasterySlice | undefined;
  toPractice: MasterySlice | undefined;
} {
  const ranked = [...items].sort(compareStrength);
  return {
    best: ranked[0],
    toPractice: ranked.length > 1 ? ranked[ranked.length - 1] : undefined,
  };
}

export function progressInsights(mastery: MasteryReport): ProgressInsights {
  const books = bounds(Object.values(mastery.bookHeat));
  const genres = bounds(mastery.genres);
  const closeCount = mastery.exactCount + mastery.nearCount;

  return {
    closeRate: mastery.totalRounds > 0 ? Math.round((closeCount / mastery.totalRounds) * 100) : 0,
    bestBook: books.best,
    bookToPractice: books.toPractice,
    bestGenre: genres.best,
    genreToPractice: genres.toPractice,
  };
}
