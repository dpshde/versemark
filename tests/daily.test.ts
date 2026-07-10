import { describe, it, expect } from "vitest";
import {
  puzzleNumberFromDateString,
  puzzleNumberForLocalDate,
  selectPoolItemForPuzzle,
  selectPoolItemsForPuzzle,
  DAILY_EPOCH,
  NO_REPEAT_WINDOW,
  type PoolItem,
} from "../src/lib/daily";
import poolData from "../src/data/pool.json";

const pool = (poolData as { items: PoolItem[] }).items;

describe("puzzle numbering", () => {
  it("epoch 2026-08-01 is puzzle #1", () => {
    expect(
      puzzleNumberForLocalDate(
        DAILY_EPOCH.year,
        DAILY_EPOCH.month,
        DAILY_EPOCH.day
      )
    ).toBe(1);
    expect(puzzleNumberFromDateString("2026-08-01")).toBe(1);
  });

  it("day after epoch is #2", () => {
    expect(puzzleNumberFromDateString("2026-08-02")).toBe(2);
  });

  it("2026-08-31 is #31", () => {
    expect(puzzleNumberFromDateString("2026-08-31")).toBe(31);
  });
});

describe("selectPoolItemForPuzzle", () => {
  it("builds the same four unique verses for every player", () => {
    const a = selectPoolItemsForPuzzle(42, pool);
    const b = selectPoolItemsForPuzzle(42, pool);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    expect(new Set(a.map((item) => item.ref)).size).toBe(4);
  });
  it("same N always yields same ref", () => {
    const a = selectPoolItemForPuzzle(1, pool);
    const b = selectPoolItemForPuzzle(1, pool);
    expect(a.ref).toBe(b.ref);
    expect(a.chapterIndex).toBeGreaterThanOrEqual(1);
    expect(a.chapterIndex).toBeLessThanOrEqual(1189);
  });

  it("different N can differ when pool allows", () => {
    const refs = new Set(
      [1, 2, 3, 4, 5, 10, 20, 50].map((n) => selectPoolItemForPuzzle(n, pool).ref)
    );
    expect(refs.size).toBeGreaterThan(1);
  });

  it("respects no-repeat window within first 180+ puzzles", () => {
    const seen: string[] = [];
    for (let n = 1; n <= Math.min(200, pool.length); n++) {
      const item = selectPoolItemForPuzzle(n, pool);
      const window = seen.slice(Math.max(0, seen.length - NO_REPEAT_WINDOW));
      if (pool.length > NO_REPEAT_WINDOW) {
        expect(window).not.toContain(item.ref);
      }
      seen.push(item.ref);
    }
  });

  it("is deterministic across full replay for N=42", () => {
    const first = selectPoolItemForPuzzle(42, pool);
    const second = selectPoolItemForPuzzle(42, pool);
    expect(first).toEqual(second);
  });
});
