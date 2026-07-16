/**
 * Fail-open Expo Haptics wrapper — never blocks UX.
 */
import * as Haptics from "expo-haptics";

let unavailable = false;

async function run(fn: () => Promise<void>): Promise<void> {
  if (unavailable) return;
  try {
    await fn();
  } catch {
    unavailable = true;
  }
}

/** Light tick for taps / marker moves. */
export function hapticLight(): void {
  void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Selection change while scrubbing the timeline. */
export function hapticSelection(): void {
  void run(() => Haptics.selectionAsync());
}

/** Confirm press. */
export function hapticConfirm(): void {
  void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Invalid committed input or another recoverable warning. */
export function hapticWarning(): void {
  void run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Result reveal — exact is success; a miss gets one decisive impact. */
export function hapticResult(exact: boolean): void {
  void run(() =>
    exact
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  );
}

/** Test helper — reset dead-letter flag. */
export function resetHapticsForTests(): void {
  unavailable = false;
}
