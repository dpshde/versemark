import { describe, it, expect } from "vitest";
import { computeInsights, computeMilestones, encodeMap, scoreGuess } from "../src/lib/insights";
import { verseIndexFor } from "../src/lib/books";
import type { RoundRecord } from "../src/lib/storage";

let t = 0;
function round(trueOsis: string, ch: number, guessOsis: string, gch: number): RoundRecord {
  const tv = verseIndexFor(trueOsis, ch, 1)!, gv = verseIndexFor(guessOsis, gch, 1)!;
  return { trueRef: `${trueOsis}.${ch}.1`, trueVerseIndex: tv, trueRangeEndVerseIndex: tv, guessVerseIndex: gv,
    distance: Math.abs(gv - tv), total: 0, hintStep: 1, at: new Date(Date.UTC(2026, 7, 1) + t++ * 60_000).toISOString(), source: "practice" };
}

describe("insights", () => {
  it("scores near/same-chapter and signed bias", () => {
    expect(scoreGuess(round("JHN", 3, "JHN", 3))!.sameChapter).toBe(true);
    expect(scoreGuess(round("JHN", 3, "JHN", 4))!.near).toBe(true);
    const early = scoreGuess(round("ISA", 40, "ISA", 20))!;
    expect(early.chapterDelta).toBe(-20);
    expect(early.near).toBe(false);
  });

  it("finds strengths, gaps, bias and study-next links", () => {
    const rs = [
      round("JHN", 3, "JHN", 3), round("MAT", 5, "MAT", 5), round("LUK", 2, "LUK", 2), round("JHN", 1, "JHN", 1),
      round("ISA", 40, "ISA", 10), round("JER", 29, "ISA", 50), round("EZK", 37, "ISA", 60), round("ISA", 53, "ISA", 30),
    ];
    const ins = computeInsights(rs);
    expect(ins.rounds).toBe(8);
    expect(ins.sections.find((s) => s.id === "gospels")!.accuracy).toBe(1);
    expect(ins.sections.find((s) => s.id === "prophets")!.accuracy).toBe(0);
    expect(ins.headline).toMatch(/Gospels & Acts best/);
    expect(ins.biases[0].section.id).toBe("prophets");
    expect(ins.biases[0].direction).toBe("early");
    expect(ins.weakest.map((b) => b.id)).toContain("ISA");
    expect(ins.studyNext[0].url).toMatch(/^https:\/\/www\.route\.bible\/[a-z0-9]{3}\.\d+$/);
    expect(encodeMap(ins)).toHaveLength(66);
  });

  it("milestones track book coverage, pool-aware, and near streaks", () => {
    const rs = ["MAT", "MRK", "LUK", "JHN"].map((b) => round(b, 2, b, 2));
    const ms = computeMilestones(rs);
    expect(ms.find((m) => m.id === "gospels")!.unlocked).toBe(true);
    expect(ms.find((m) => m.id === "near-streak-5")!.done).toBe(4);
    const pool = new Set([27]); // only Hosea available
    const mp = computeMilestones([round("HOS", 1, "HOS", 1)], pool).find((m) => m.id === "minor-prophets")!;
    expect(mp.total).toBe(1);
    expect(mp.unlocked).toBe(true);
  });
});

import { gapPool } from "../src/lib/insights";
describe("gap practice pool", () => {
  it("draws from weak/untested books, falls back when thin", () => {
    const ins = computeInsights([round("JHN", 3, "JHN", 3), round("JHN", 4, "JHN", 4)]);
    const pool = [verseIndexFor("JHN", 1, 1)!, verseIndexFor("ISA", 1, 1)!, verseIndexFor("GEN", 1, 1)!].map((v) => ({ verseIndex: v }));
    const g = gapPool(pool, ins, 1);
    expect(g.items.map((x) => x.verseIndex)).not.toContain(verseIndexFor("JHN", 1, 1));
    expect([...g.books].sort()).toEqual(["Genesis", "Isaiah"]);
    expect(gapPool(pool, ins, 99).items).toHaveLength(3);
  });
});
