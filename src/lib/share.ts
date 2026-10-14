/**
 * Wordle-class share payload for texts / group chats — messaging-first.
 *
 * Spec:
 * - Self-contained pure text (works if only `text` survives the share sheet)
 * - Line 1: brand + calendar date + total with point units (no emoji)
 * - Blank line, then quiet per-verse scores
 * - Blank line, then site URL (spoiler-free; no verse refs)
 *
 * ```
 * Versemark 12 Aug 2026 · 3600 pts
 *
 * 980 · 720 · 310 · 90
 *
 * https://versemark.app
 * ```
 *
 * Delivery: navigator.share({ text }) → else clipboard + "Copied".
 */
import type { HintStep } from "./scoring";
import { localDatePartsForPuzzleNumber } from "./daily";

/** Public site — included at the end of share text. */
export const APP_URL = "https://versemark.app";

/** Origin for share links — current host on previews, prod otherwise. */
export function shareOrigin(): string {
  if (typeof location !== "undefined" && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) {
    return location.origin;
  }
  return APP_URL;
}

/**
 * Per-day results link: `/d/<n>?s=<total>-<distance>.…` — spoiler-safe
 * (scores + verse distance only, never positions). Unfurls with a score card.
 */
export function buildDailyResultUrl(
  puzzleNumber: number,
  rounds: Array<Pick<DailyShareRound, "total" | "distance">>,
  origin: string = shareOrigin()
): string {
  const s = rounds.map((r) => `${Math.round(r.total)}-${Math.round(r.distance)}`).join(".");
  return `${origin}/d/${puzzleNumber}?s=${s}`;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface DailyShareRound extends Omit<SharePayload, "puzzleNumber"> {}

/** Fixed English short date — deterministic across locales (share tests / archive). */
export function formatShareDate(year: number, month: number, day: number): string {
  const mon = MONTHS_SHORT[month - 1] ?? String(month);
  return `${day} ${mon} ${year}`;
}

/** Puzzle number → share date label (e.g. "12 Aug 2026"). */
export function formatShareDateForPuzzle(puzzleNumber: number): string {
  const { year, month, day } = localDatePartsForPuzzleNumber(puzzleNumber);
  return formatShareDate(year, month, day);
}

export function formatPoints(n: number): string {
  return `${n} pts`;
}

/**
 * Daily multi-verse share.
 *
 * ```
 * Versemark 12 Aug 2026 · 3600 pts
 *
 * 980 · 720 · 310 · 90
 *
 * https://versemark.app
 * ```
 */
export function buildDailyShareString(
  puzzleNumber: number,
  rounds: DailyShareRound[]
): string {
  const total = rounds.reduce((sum, round) => sum + round.total, 0);
  const date = formatShareDateForPuzzle(puzzleNumber);
  const scores = rounds.map((round) => String(round.total)).join(" \u00B7 ");
  return `Versemark ${date} \u00B7 ${formatPoints(total)}\n\n${scores}\n\n${buildDailyResultUrl(puzzleNumber, rounds)}`;
}

export interface SharePayload {
  /** Daily puzzle number; omit for practice rounds. */
  puzzleNumber?: number | null;
  guessVerseIndex: number;
  trueVerseIndex: number;
  distance: number;
  total: number;
  hintStep: HintStep;
}

/**
 * Single-round / practice share.
 *
 * Daily-flavored: `Versemark 12 Aug 2026 · 1500 pts`
 * Practice: `Versemark · 1500 pts`
 * Both end with the site URL.
 */
export function buildShareString(p: SharePayload): string {
  const pts = formatPoints(p.total);
  const header =
    p.puzzleNumber != null
      ? `Versemark ${formatShareDateForPuzzle(p.puzzleNumber)} \u00B7 ${pts}`
      : `Versemark \u00B7 ${pts}`;
  return `${header}\n\n${p.total}\n\n${APP_URL}`;
}

/**
 * Share via OS sheet when available (text payload includes the site URL).
 * Otherwise copy to clipboard.
 */
export async function shareText(text: string): Promise<"shared" | "copied"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      // Fall through to clipboard.
    }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}
