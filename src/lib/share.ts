/**
 * Wordle-class share payload for texts / group chats.
 *
 * Spec (messaging-first):
 * - Self-contained body: works if only `text` survives the share sheet
 * - Line 1 carries brand + day + compact score (notification-preview legible)
 * - Blank line, then emoji narrative rows (spoiler-free, paste-native)
 * - No CTA, no "beat my score", no install beg
 * - Link-optional: default payload has no URL (avoids link-preview hijack /
 *   platforms dropping body text when `url` is present)
 *
 * Delivery: navigator.share({ text }) → else clipboard.writeText + "Copied".
 */
import type { HintStep } from "./scoring";
import { TOTAL_VERSES } from "./books";

/** Public site — not embedded in the default share body. */
export const APP_URL = "https://versemark.app";

export interface DailyShareRound extends Omit<SharePayload, "puzzleNumber"> {}

/**
 * Daily multi-verse share — one string for clipboard, share sheet, and social.
 *
 * ```
 * Versemark 12 3600
 *
 * ⬜⬜🔵⬜📍⬜⬜ 🟡
 * ⬜⬜⬜🔵📍⬜⬜ 🟠
 * 🎯⬜⬜⬜⬜⬜⬜ 🟡
 * ⬜🔵⬜📍⬜⬜⬜ 🔴
 * ```
 */
export function buildDailyShareString(
  puzzleNumber: number,
  rounds: DailyShareRound[]
): string {
  const total = rounds.reduce((sum, round) => sum + round.total, 0);
  const header = `Versemark ${puzzleNumber} ${total}`;
  const grid = rounds.map((round) => shareRow(round)).join("\n");
  return `${header}\n\n${grid}`;
}

/**
 * Encode distance on a 7-cell mini-timeline:
 * true position = pushpin, guess = blue circle, exact = bullseye, empty = white square.
 */
export function distanceEmojiBand(
  guessVerseIndex: number,
  trueVerseIndex: number,
  cells = 7
): string {
  const truePos = Math.min(
    cells - 1,
    Math.max(
      0,
      Math.round(((trueVerseIndex - 1) / (TOTAL_VERSES - 1)) * (cells - 1))
    )
  );
  let guessPos = Math.min(
    cells - 1,
    Math.max(
      0,
      Math.round(((guessVerseIndex - 1) / (TOTAL_VERSES - 1)) * (cells - 1))
    )
  );
  if (guessPos === truePos && guessVerseIndex !== trueVerseIndex) {
    guessPos = Math.min(
      cells - 1,
      truePos + (guessVerseIndex > trueVerseIndex ? 1 : -1)
    );
    if (guessPos < 0) guessPos = truePos + 1;
  }

  const row: string[] = [];
  for (let i = 0; i < cells; i++) {
    if (i === truePos && i === guessPos) row.push("\uD83C\uDFAF"); // 🎯
    else if (i === truePos) row.push("\uD83D\uDCCC"); // 📍
    else if (i === guessPos) row.push("\uD83D\uDD35"); // 🔵
    else row.push("\u2B1C"); // ⬜
  }
  return row.join("");
}

/** Hint ladder marker — yellow / orange / red (no hints → full hints). */
export function hintEmoji(hintStep: HintStep): string {
  if (hintStep === 1) return "\uD83D\uDFe1"; // 🟡
  if (hintStep === 2) return "\uD83D\uDFE0"; // 🟠
  return "\uD83D\uDD34"; // 🔴
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

function shareRow(p: Pick<SharePayload, "guessVerseIndex" | "trueVerseIndex" | "hintStep">): string {
  return `${distanceEmojiBand(p.guessVerseIndex, p.trueVerseIndex)} ${hintEmoji(p.hintStep)}`;
}

/**
 * Single-round / practice share.
 *
 * ```
 * Versemark 1500
 *
 * ⬜⬜🔵⬜📍⬜⬜ 🟡
 * ```
 *
 * Practice omits the day index; daily single-round (if used) includes it.
 */
export function buildShareString(p: SharePayload): string {
  const header =
    p.puzzleNumber != null
      ? `Versemark ${p.puzzleNumber} ${p.total}`
      : `Versemark ${p.total}`;
  return `${header}\n\n${shareRow(p)}`;
}

/**
 * Share via OS sheet when available (text-only — no `url` field, so
 * Messages/WhatsApp keep the grid as the message body).
 * Otherwise copy to clipboard.
 */
export async function shareText(text: string): Promise<"shared" | "copied"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      // User cancelled the sheet — not an error worth falling back for.
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      // Fall through to clipboard.
    }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}
