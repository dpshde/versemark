/**
 * PWA install offer — shown after real engagement (a finished daily, or a
 * few practice rounds), never while already installed.
 *
 * Chrome/Edge/Android: capture beforeinstallprompt and prompt() on tap.
 * iOS Safari: show Share → Add to Home Screen guidance (no install API).
 */
import {
  completedDailyCount,
  dismissInstallOffer,
  loadState,
  type AppState,
} from "./storage";

/** Practice rounds before the install offer unlocks (without a daily). */
export const PRACTICE_ROUNDS_FOR_INSTALL = 3;

/** Completed dailies before the install offer unlocks (habit signal). */
export const DAILIES_FOR_INSTALL = 3;

/** Days to wait after "Not now" before offering again. */
export const INSTALL_SNOOZE_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let listening = false;

export function initInstallCapture(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    dismissInstallOffer(new Date());
  });
}

/** Running as an installed PWA (standalone / fullscreen / iOS home screen). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)").matches;
  if (mq) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  if (document.referrer.startsWith("android-app://")) return true;
  return false;
}

export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notOther = !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  return iOS && webkit && notOther;
}

function isSnoozed(state: AppState, now: Date = new Date()): boolean {
  if (!state.installDismissedAt) return false;
  const dismissed = Date.parse(state.installDismissedAt);
  if (!Number.isFinite(dismissed)) return false;
  const ms = INSTALL_SNOOZE_DAYS * 86_400_000;
  return now.getTime() - dismissed < ms;
}

/** Enough play that an install pitch is fair. */
export function hasInstallEngagement(state: AppState = loadState()): boolean {
  return completedDailyCount(state) >= DAILIES_FOR_INSTALL;
}

/**
 * Whether the install banner should appear on a result/home surface.
 * Requires engagement + not installed + not snoozed.
 */
export function shouldOfferInstall(
  state: AppState = loadState(),
  now: Date = new Date()
): boolean {
  if (isStandalone()) return false;
  if (isSnoozed(state, now)) return false;
  return hasInstallEngagement(state);
}

export type InstallPromptResult =
  | "accepted"
  | "dismissed"
  | "ios-hint"
  | "unavailable";

/** Trigger the native install sheet when available; iOS gets a manual hint. */
export async function promptInstall(): Promise<InstallPromptResult> {
  if (isStandalone()) return "unavailable";
  if (deferredPrompt) {
    const event = deferredPrompt;
    deferredPrompt = null;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") {
        dismissInstallOffer(new Date());
        return "accepted";
      }
      dismissInstallOffer(new Date());
      return "dismissed";
    } catch {
      return "unavailable";
    }
  }
  if (isIosSafari()) return "ios-hint";
  return "unavailable";
}

export function snoozeInstallOffer(now: Date = new Date()): AppState {
  return dismissInstallOffer(now);
}

export function hasDeferredInstallPrompt(): boolean {
  return deferredPrompt != null;
}
