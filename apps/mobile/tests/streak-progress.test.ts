import { describe, expect, it } from "vitest";
import { streakFlameLevel, streakMarkerProgress } from "../src/lib/streak-progress";

describe("home streak marker", () => {
  it("starts at the leading edge and advances through streak milestones", () => {
    expect(streakMarkerProgress(0)).toBe(0);
    expect(streakMarkerProgress(1)).toBe(0);
    expect(streakMarkerProgress(2)).toBeGreaterThan(0);
    expect(streakMarkerProgress(3)).toBe(0.16);
    expect(streakMarkerProgress(7)).toBe(0.34);
    expect(streakMarkerProgress(14)).toBe(0.54);
    expect(streakMarkerProgress(30)).toBe(0.76);
    expect(streakMarkerProgress(100)).toBe(1);
    expect(streakMarkerProgress(365)).toBe(1);
  });

  it("intensifies at the existing achievement checkpoints", () => {
    expect([0, 1, 3, 7, 14, 30, 100].map(streakFlameLevel)).toEqual([0, 0, 1, 2, 3, 4, 5]);
  });
});
