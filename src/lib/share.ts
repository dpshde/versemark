/**
 * Wordle-style share string for round results.
 */
import type { HintStep } from "./scoring";
import { TOTAL_VERSES } from "./books";

const APP_URL = "https://canonmark.app";

/**
 * Encode distance on a 7-cell mini-timeline:
 * true position = pushpin, guess = blue circle, empty = white square.
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
    if (i === truePos && i === guessPos) row.push("\uD83C\uDFAF");
    else if (i === truePos) row.push("\uD83D\uDCCC");
    else if (i === guessPos) row.push("\uD83D\uDD35");
    else row.push("\u2B1C");
  }
  return row.join("");
}

export function hintEmoji(hintStep: HintStep): string {
  if (hintStep === 1) return "\uD83D\uDFe1";
  if (hintStep === 2) return "\uD83D\uDFE0";
  return "\uD83D\uDD34";
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

export function buildShareString(p: SharePayload): string {
  const band = distanceEmojiBand(p.guessVerseIndex, p.trueVerseIndex);
  const hint = hintEmoji(p.hintStep);
  const title =
    p.puzzleNumber != null
      ? `Canonmark #${p.puzzleNumber}`
      : "Canonmark";
  return [
    title,
    `${band} ${hint}`,
    `${p.distance} v \u00B7 ${p.total} pts`,
    APP_URL,
  ].join("\n");
}

/** Share via system sheet when available; otherwise copy to clipboard. */
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
