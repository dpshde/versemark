import { beforeEach, describe, expect, it, vi } from "vitest";

const { impactAsync, notificationAsync, selectionAsync } = vi.hoisted(() => ({
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  selectionAsync: vi.fn(async () => undefined),
}));

vi.mock("expo-haptics", () => ({
  impactAsync,
  notificationAsync,
  selectionAsync,
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));

import {
  hapticConfirm,
  hapticLight,
  hapticResult,
  hapticSelection,
  hapticWarning,
  resetHapticsForTests,
} from "../src/lib/haptics";

describe("native haptic vocabulary", () => {
  beforeEach(() => {
    resetHapticsForTests();
    vi.clearAllMocks();
  });

  it("maps taps, selections, confirmation, warnings, and results semantically", async () => {
    hapticLight();
    hapticSelection();
    hapticConfirm();
    hapticWarning();
    hapticResult(true);
    hapticResult(false);

    await vi.waitFor(() => {
      expect(impactAsync).toHaveBeenCalledWith("light");
      expect(impactAsync).toHaveBeenCalledWith("medium");
      expect(selectionAsync).toHaveBeenCalledOnce();
      expect(notificationAsync).toHaveBeenCalledWith("warning");
      expect(notificationAsync).toHaveBeenCalledWith("success");
    });
  });

  it("fails open after the platform haptics API rejects", async () => {
    impactAsync.mockRejectedValueOnce(new Error("unavailable"));

    hapticLight();
    await vi.waitFor(() => expect(impactAsync).toHaveBeenCalledOnce());
    hapticLight();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(impactAsync).toHaveBeenCalledOnce();
  });
});
