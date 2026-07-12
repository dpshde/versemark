import { describe, it, expect } from "vitest";
import { bookSegments, FULL_CANON_SPAN } from "../src/lib/axis";
import {
  isOverviewBookLabelCandidate,
  OVERVIEW_LANDMARK_OSIS,
} from "../src/lib/strip";

/** Approximate portrait free-band length for a phone overview. */
const PORTRAIT_AXIS_PX = 600;

function lenPxFor(start: number, end: number): number {
  return ((end - start + 1) / FULL_CANON_SPAN) * PORTRAIT_AXIS_PX;
}

describe("overview book labels", () => {
  it("always includes Romans and Revelation as landmarks", () => {
    expect(OVERVIEW_LANDMARK_OSIS.has("ROM")).toBe(true);
    expect(OVERVIEW_LANDMARK_OSIS.has("REV")).toBe(true);
  });

  it("keeps post-Gospel landmarks even when short in overview pixels", () => {
    const segs = bookSegments();
    const romans = segs.find((s) => s.osis === "ROM")!;
    const revelation = segs.find((s) => s.osis === "REV")!;
    const romPx = lenPxFor(romans.startVerseIndex, romans.endVerseIndex);
    const revPx = lenPxFor(
      revelation.startVerseIndex,
      revelation.endVerseIndex
    );
    // Both sit under the normal portrait length floor (~14px).
    expect(romPx).toBeLessThan(14);
    expect(revPx).toBeLessThan(14);
    expect(isOverviewBookLabelCandidate(romPx, "ROM", "vertical")).toBe(true);
    expect(isOverviewBookLabelCandidate(revPx, "REV", "vertical")).toBe(true);
  });

  it("still filters ordinary short epistles", () => {
    expect(isOverviewBookLabelCandidate(8, "PHP", "vertical")).toBe(false);
    expect(isOverviewBookLabelCandidate(8, "JUD", "horizontal")).toBe(false);
  });

  it("keeps long books via the length floor", () => {
    expect(isOverviewBookLabelCandidate(20, "GEN", "vertical")).toBe(true);
    expect(isOverviewBookLabelCandidate(30, "PSA", "horizontal")).toBe(true);
  });
});
