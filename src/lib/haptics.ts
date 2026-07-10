import { WebHaptics } from "web-haptics";

const haptics = new WebHaptics();
const MOBILE_POINTER = "(hover: none) and (pointer: coarse)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const SELECTION_INTERVAL_MS = 28;

let lastSelectionAt = 0;

function enabled(): boolean {
  return (
    typeof window !== "undefined" &&
    WebHaptics.isSupported &&
    window.matchMedia(MOBILE_POINTER).matches &&
    !window.matchMedia(REDUCED_MOTION).matches
  );
}

function trigger(pattern: "selection" | "light" | "medium" | "success" | "error"): void {
  if (!enabled()) return;
  void haptics.trigger(pattern).catch(() => undefined);
}

/** A restrained ruler tick; rate-limited for fast verse scrubbing. */
export function hapticSelection(): void {
  const now = performance.now();
  if (now - lastSelectionAt < SELECTION_INTERVAL_MS) return;
  lastSelectionAt = now;
  trigger("selection");
}

export function hapticLight(): void {
  trigger("light");
}

export function hapticResult(correct: boolean): void {
  // An incorrect guess is a normal game outcome, not an error condition.
  trigger(correct ? "success" : "medium");
}
