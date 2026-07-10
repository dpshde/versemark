import { describe, it, expect } from "vitest";
import {
  distancePoints,
  hintMultiplier,
  scoreRound,
  verseDistance,
  SCORE_HALF_LIFE,
} from "../src/lib/scoring";

describe(`distancePoints (half-life ${SCORE_HALF_LIFE} verses)`, () => {
  it("d=0 → 1000", () => {
    expect(distancePoints(0)).toBe(1000);
  });

  it("d=half-life → 500", () => {
    expect(distancePoints(SCORE_HALF_LIFE)).toBe(500);
  });

  it("d=2×half-life → 250", () => {
    expect(distancePoints(SCORE_HALF_LIFE * 2)).toBe(250);
  });

  it("d=1 → nearly max", () => {
    expect(distancePoints(1)).toBeGreaterThan(990);
  });

  it("d=250 → solid neighborhood", () => {
    const p = distancePoints(250);
    expect(p).toBeGreaterThan(800);
    expect(p).toBeLessThan(900);
  });
});

describe("hintMultiplier", () => {
  it("step 1 → ×3", () => expect(hintMultiplier(1)).toBe(3));
  it("step 2 → ×2", () => expect(hintMultiplier(2)).toBe(2));
  it("step 3 → ×1", () => expect(hintMultiplier(3)).toBe(1));
});

describe("scoreRound", () => {
  it("perfect ×3 = 3000", () => {
    const r = scoreRound(5000, 5000, 1);
    expect(r.distance).toBe(0);
    expect(r.distancePts).toBe(1000);
    expect(r.multiplier).toBe(3);
    expect(r.total).toBe(3000);
  });

  it("d=half-life with step 2 → 500×2=1000", () => {
    const r = scoreRound(1000, 1000 + SCORE_HALF_LIFE, 2);
    expect(r.distance).toBe(SCORE_HALF_LIFE);
    expect(r.distancePts).toBe(500);
    expect(r.total).toBe(1000);
  });

  it("verseDistance is absolute", () => {
    expect(verseDistance(10, 50)).toBe(40);
    expect(verseDistance(50, 10)).toBe(40);
  });
});
