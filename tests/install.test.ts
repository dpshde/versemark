import { describe, it, expect, beforeEach } from "vitest";
import {
  hasInstallEngagement,
  shouldOfferInstall,
  PRACTICE_ROUNDS_FOR_INSTALL,
  DAILIES_FOR_INSTALL,
  INSTALL_SNOOZE_DAYS,
  isStandalone,
} from "../src/lib/install";
import {
  dismissInstallOffer,
  loadState,
  recordDailyResult,
  recordPracticeRound,
  type DailyResultRecord,
} from "../src/lib/storage";

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

function completeDaily(n: number, dateKey: string): DailyResultRecord {
  const rounds = Array.from({ length: 3 }, (_, i) => ({
    trueRef: `REF.${i}`,
    trueVerseIndex: 100 + i,
    trueRangeEndVerseIndex: 100 + i,
    guessVerseIndex: 100 + i,
    distance: 0,
    total: 900,
    hintStep: 1,
    at: `${dateKey}T12:00:00.000Z`,
    source: "daily" as const,
  }));
  const last = rounds[rounds.length - 1];
  return {
    puzzleNumber: n,
    dateKey,
    guessVerseIndex: last.guessVerseIndex,
    trueVerseIndex: last.trueVerseIndex,
    trueRef: last.trueRef,
    distance: 0,
    total: 2700,
    hintStep: 1,
    completedAt: `${dateKey}T12:00:00.000Z`,
    rounds,
  };
}

describe("install engagement", () => {
  it("starts ineligible", () => {
    expect(hasInstallEngagement()).toBe(false);
    expect(shouldOfferInstall()).toBe(false);
  });

  it("unlocks only after DAILIES_FOR_INSTALL completed dailies", () => {
    for (let i = 1; i < DAILIES_FOR_INSTALL; i++) {
      recordDailyResult(completeDaily(i, `2026-08-0${i}`), new Date(2026, 7, i));
      expect(hasInstallEngagement()).toBe(false);
    }
    recordDailyResult(completeDaily(3, "2026-08-03"), new Date(2026, 7, 3));
    expect(hasInstallEngagement()).toBe(true);
    expect(shouldOfferInstall(loadState(), new Date(2026, 7, 3))).toBe(true);
  });

  it("practice rounds alone do not unlock", () => {
    for (let i = 0; i < PRACTICE_ROUNDS_FOR_INSTALL + 5; i++) recordPracticeRound();
    expect(hasInstallEngagement()).toBe(false);
  });

  it("snoozes after dismiss for INSTALL_SNOOZE_DAYS", () => {
    for (let i = 1; i <= 3; i++) recordDailyResult(completeDaily(i, `2026-08-0${i}`), new Date(2026, 7, i));
    const dismissedAt = new Date(2026, 7, 1, 12);
    dismissInstallOffer(dismissedAt);
    expect(
      shouldOfferInstall(loadState(), new Date(2026, 7, 5, 12))
    ).toBe(false);
    const afterSnooze = new Date(dismissedAt);
    afterSnooze.setDate(afterSnooze.getDate() + INSTALL_SNOOZE_DAYS + 1);
    expect(shouldOfferInstall(loadState(), afterSnooze)).toBe(true);
  });

  it("hides when running as installed PWA", () => {
    recordPracticeRound();
    recordPracticeRound();
    recordPracticeRound();
    // Simulate standalone display mode via a temporary window shim
    const prev = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      matchMedia: (query: string) => ({
        matches: query.includes("display-mode: standalone"),
      }),
      navigator: {},
      document: { referrer: "" },
    };
    try {
      expect(isStandalone()).toBe(true);
      expect(shouldOfferInstall()).toBe(false);
    } finally {
      if (prev === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = prev;
      }
    }
  });

  it("preserves install fields when recording daily", () => {
    recordPracticeRound();
    const state = loadState();
    expect(state.practiceRounds).toBe(1);
    recordDailyResult(completeDaily(2, "2026-08-02"), new Date(2026, 7, 2));
    const next = loadState();
    expect(next.practiceRounds).toBe(1);
    expect(next.installDismissedAt).toBeNull();
  });

  it("loadState defaults missing install fields", () => {
    mem.set(
      "versemark:v2",
      JSON.stringify({
        lastDaily: null,
        history: [],
        streak: 0,
        bestStreak: 0,
      })
    );
    const state = loadState();
    expect(state.practiceRounds).toBe(0);
    expect(state.installDismissedAt).toBeNull();
  });
});
