import { describe, it, expect, beforeEach } from "vitest";
import {
  startDailyRound,
  startEndlessRound,
  takeHint,
  confirmGuess,
  shareForRound,
  type TextBundle,
} from "../src/lib/game";
import type { PoolItem } from "../src/lib/daily";
import { selectPoolItemForPuzzle, puzzleNumberFromDateString } from "../src/lib/daily";
import { scoreRound } from "../src/lib/scoring";
import poolData from "../src/data/pool.json";

// Minimal in-memory localStorage for node tests
const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    },
  });
});

const pool = (poolData as { items: PoolItem[] }).items;

function textsFor(item: PoolItem): TextBundle {
  return {
    verses: { [item.ref]: `Sample text for ${item.ref}` },
    paragraphs: {
      [item.ref]: {
        start: item.verse,
        end: item.verse,
        verses: [{ v: item.verse, t: `Sample text for ${item.ref}` }],
      },
    },
  };
}

describe("full round flow", () => {
  it("daily: verse → hint ladder → confirm → score with ADR formula", () => {
    const fixed = new Date(2026, 7, 15); // local Aug 15 2026 → puzzle #15
    const n = puzzleNumberFromDateString("2026-08-15");
    expect(n).toBe(15);
    const item = selectPoolItemForPuzzle(n, pool);
    const texts = textsFor(item);
    let round = startDailyRound(pool, texts, fixed);
    expect(round.phase).toBe("playing");
    expect(round.verseText).toContain(item.ref);
    expect(round.hintStep).toBe(1);

    round = takeHint(round);
    expect(round.hintStep).toBe(2);
    round = takeHint(round);
    expect(round.hintStep).toBe(3);

    const guess = item.verseIndex + 1000; // half-life offset in verses
    const { round: done } = confirmGuess(round, guess, fixed);
    expect(done.phase).toBe("revealed");
    expect(done.result).not.toBeNull();
    const expected = scoreRound(guess, item.verseIndex, 3);
    expect(done.result!.total).toBe(expected.total);
    expect(done.result!.distance).toBe(1000);
    expect(done.result!.distancePts).toBe(500);

    const share = shareForRound(done);
    expect(share).toContain(`Canonmark #${n}`);
    expect(share).toContain("1000 v");
  });

  it("endless produces a playable round from pool", () => {
    const allTexts: TextBundle = { verses: {}, paragraphs: {} };
    for (const p of pool.slice(0, 50)) {
      allTexts.verses[p.ref] = `T ${p.ref}`;
      allTexts.paragraphs[p.ref] = {
        start: p.verse,
        end: p.verse,
        verses: [{ v: p.verse, t: `T ${p.ref}` }],
      };
    }
    const round = startEndlessRound(pool, allTexts);
    expect(round.mode).toBe("endless");
    expect(round.phase).toBe("playing");
    expect(round.verseText.length).toBeGreaterThan(0);
  });

  it("consumer path: fixed date → stable pool ref; score triple matches ADR", () => {
    const date = "2026-08-01";
    const n = puzzleNumberFromDateString(date);
    const refA = selectPoolItemForPuzzle(n, pool).ref;
    const refB = selectPoolItemForPuzzle(n, pool).ref;
    expect(refA).toBe(refB);

    const scored = scoreRound(1000, 2000, 1); // d=1000 verses, ×3
    expect(scored.distancePts).toBe(500);
    expect(scored.total).toBe(1500);
  });
});
