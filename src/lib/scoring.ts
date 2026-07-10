/**
 * Distance score × hint multiplier (ADR: score-with-distance-and-hint-multiplier).
 *
 * points = round(1000 * 0.5^(d / halfLife))
 * d = |guessVerseIndex - trueVerseIndex| on the 31,102-verse axis
 *
 * Half-life is 1000 verses (~38 average chapters), preserving the original
 * 40-chapter falloff feel after the chapter→verse axis migration.
 */

export type HintStep = 1 | 2 | 3;

/** Half-life of ~1000 verses on the 31,102-verse axis. */
export const SCORE_HALF_LIFE = 1000;
export const MAX_DISTANCE_POINTS = 1000;

export function verseDistance(
  guessVerseIndex: number,
  trueVerseIndex: number
): number {
  return Math.abs(guessVerseIndex - trueVerseIndex);
}

/** @deprecated Use verseDistance. */
export function chapterDistance(
  guess: number,
  truth: number
): number {
  return verseDistance(guess, truth);
}

/** Distance-only points in 0..1000. */
export function distancePoints(d: number): number {
  if (d <= 0) return MAX_DISTANCE_POINTS;
  const raw = MAX_DISTANCE_POINTS * Math.pow(0.5, d / SCORE_HALF_LIFE);
  return Math.round(raw);
}

export function hintMultiplier(step: HintStep): number {
  if (step <= 1) return 3;
  if (step === 2) return 2;
  return 1;
}

export interface ScoreResult {
  distance: number;
  distancePts: number;
  hintStep: HintStep;
  multiplier: number;
  total: number;
}

export function scoreRound(
  guessVerseIndex: number,
  trueVerseIndex: number,
  hintStep: HintStep
): ScoreResult {
  const distance = verseDistance(guessVerseIndex, trueVerseIndex);
  const distancePts = distancePoints(distance);
  const multiplier = hintMultiplier(hintStep);
  return {
    distance,
    distancePts,
    hintStep,
    multiplier,
    total: distancePts * multiplier,
  };
}
