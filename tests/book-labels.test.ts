import { describe, it, expect } from "vitest";
import { bookSegments, FULL_CANON_SPAN } from "../src/lib/axis";
import {
  isOverviewBookLabelCandidate,
  OVERVIEW_LANDMARK_OSIS,
  OVERVIEW_SKIP_OSIS,
  pickOverviewBookLabels,
} from "../src/lib/strip";

/** Approximate portrait free-band length for a phone overview. */
const PORTRAIT_AXIS_PX = 600;

function lenPxFor(start: number, end: number): number {
  return ((end - start + 1) / FULL_CANON_SPAN) * PORTRAIT_AXIS_PX;
}

function axisPxFor(verseIndex: number): number {
  return ((verseIndex - 1) / FULL_CANON_SPAN) * PORTRAIT_AXIS_PX;
}

describe("overview book labels", () => {
  it("landmarks span Joshua through Hebrews plus Revelation", () => {
    expect([...OVERVIEW_LANDMARK_OSIS].sort()).toEqual([
      "EPH",
      "EZR",
      "HEB",
      "JOS",
      "REV",
      "ROM",
    ]);
  });

  it("skips History volume-2 books on the overview", () => {
    expect([...OVERVIEW_SKIP_OSIS].sort()).toEqual([
      "2CH",
      "2KI",
      "2SA",
      "JDG",
    ]);
    for (const osis of OVERVIEW_SKIP_OSIS) {
      expect(isOverviewBookLabelCandidate(40, osis, "horizontal")).toBe(false);
      expect(isOverviewBookLabelCandidate(40, osis, "vertical")).toBe(false);
    }
  });

  it("keeps short landmarks even when under the length floor", () => {
    for (const osis of OVERVIEW_LANDMARK_OSIS) {
      const seg = bookSegments().find((s) => s.osis === osis)!;
      const px = lenPxFor(seg.startVerseIndex, seg.endVerseIndex);
      expect(px).toBeLessThan(14);
      expect(isOverviewBookLabelCandidate(px, osis, "vertical")).toBe(true);
    }
  });

  it("still filters ordinary short epistles", () => {
    expect(isOverviewBookLabelCandidate(8, "PHP", "vertical")).toBe(false);
    expect(isOverviewBookLabelCandidate(8, "JUD", "horizontal")).toBe(false);
  });

  it("keeps long books via the length floor", () => {
    expect(isOverviewBookLabelCandidate(20, "GEN", "vertical")).toBe(true);
    expect(isOverviewBookLabelCandidate(30, "PSA", "horizontal")).toBe(true);
  });

  it("wide overview admits mid-length History volume-1 books", () => {
    expect(isOverviewBookLabelCandidate(12, "1SA", "horizontal")).toBe(true);
    expect(isOverviewBookLabelCandidate(15, "1KI", "horizontal")).toBe(true);
    expect(isOverviewBookLabelCandidate(11, "1SA", "horizontal")).toBe(false);
    // Portrait keeps the stricter floor for ordinary books.
    expect(isOverviewBookLabelCandidate(12, "1SA", "vertical")).toBe(false);
  });

  it("wide packing keeps one History label per arc", () => {
    const AXIS = 680;
    const segs = bookSegments();
    const candidates = segs
      .map((seg) => ({
        osis: seg.osis,
        name: seg.name,
        axis: ((seg.startVerseIndex - 1) / FULL_CANON_SPAN) * AXIS,
        lenPx:
          ((seg.endVerseIndex - seg.startVerseIndex + 1) / FULL_CANON_SPAN) *
          AXIS,
        landmark: OVERVIEW_LANDMARK_OSIS.has(seg.osis),
      }))
      .filter((c) =>
        isOverviewBookLabelCandidate(c.lenPx, c.osis, "horizontal")
      );
    const picked = pickOverviewBookLabels(candidates, 10);
    const history = new Set(
      segs.filter((s) => s.genre === "history").map((s) => s.osis)
    );
    const historyLabels = picked
      .filter((c) => history.has(c.osis))
      .map((c) => c.osis);
    expect(historyLabels).toEqual(
      expect.arrayContaining(["JOS", "1SA", "1KI", "1CH", "EZR"])
    );
    for (const skip of OVERVIEW_SKIP_OSIS) {
      expect(historyLabels).not.toContain(skip);
    }
  });

  it("portrait packing keeps Joshua plus volume-1 History", () => {
    const AXIS = 600;
    const segs = bookSegments();
    const candidates = segs
      .map((seg) => ({
        osis: seg.osis,
        name: seg.name,
        axis: ((seg.startVerseIndex - 1) / FULL_CANON_SPAN) * AXIS,
        lenPx:
          ((seg.endVerseIndex - seg.startVerseIndex + 1) / FULL_CANON_SPAN) *
          AXIS,
        landmark: OVERVIEW_LANDMARK_OSIS.has(seg.osis),
      }))
      .filter((c) =>
        isOverviewBookLabelCandidate(c.lenPx, c.osis, "vertical")
      );
    const picked = pickOverviewBookLabels(candidates, 12);
    const history = new Set(
      segs.filter((s) => s.genre === "history").map((s) => s.osis)
    );
    const historyLabels = picked
      .filter((c) => history.has(c.osis))
      .map((c) => c.osis);
    expect(historyLabels).toEqual(
      expect.arrayContaining(["JOS", "1SA", "1KI", "1CH", "EZR"])
    );
    for (const skip of OVERVIEW_SKIP_OSIS) {
      expect(historyLabels).not.toContain(skip);
    }
  });

  it("places epistle landmarks before ordinary books fill the gaps", () => {
    const segs = bookSegments();
    const candidates = segs.map((seg) => ({
      osis: seg.osis,
      name: seg.name,
      axis: axisPxFor(seg.startVerseIndex),
      lenPx: lenPxFor(seg.startVerseIndex, seg.endVerseIndex),
      landmark: OVERVIEW_LANDMARK_OSIS.has(seg.osis),
    }));
    // Include a long Acts so greedy-without-priority would crowd Ephesians.
    const picked = pickOverviewBookLabels(candidates, 14);
    const osis = picked.map((c) => c.osis);
    expect(osis).toContain("ROM");
    expect(osis).toContain("EPH");
    expect(osis).toContain("HEB");
    expect(osis).toContain("REV");
  });
});
