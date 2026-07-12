/**
 * Parse free-text Bible references into canon verse indices via grab-bcv.
 * Autocomplete mirrors the passage pickers in type-the-word / route-bible.
 */
import {
  autocompletePassage,
  tryParsePassage,
  type AutocompletePassageSuggestion,
  type OsisBookCode,
} from "grab-bcv";
import { verseIndexFor, formatVerseLabel, BOOKS } from "./books";

export type GuessParseResult =
  | { ok: true; verseIndex: number; label: string; input: string }
  | { ok: false; reason: "empty" | "invalid" | "out_of_range"; input: string };

export type GuessSuggestion = AutocompletePassageSuggestion;

export type BookGuessResult =
  | {
      ok: true;
      osis: string;
      name: string;
      startVerseIndex: number;
      input: string;
    }
  | { ok: false };

/**
 * Parse a typed reference into a global verse index.
 * Chapter-only refs (e.g. "Romans 8") resolve to verse 1 of that chapter.
 */
export function parseGuessText(raw: string): GuessParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, reason: "empty", input: raw };

  const parsed = tryParsePassage(input);
  if (!parsed.ok) return { ok: false, reason: "invalid", input };

  const book = parsed.value.start.book as OsisBookCode;
  const chapter = parsed.value.start.chapter;
  const verse = parsed.value.start.verse ?? 1;

  const verseIndex = verseIndexFor(book, chapter, verse);
  if (verseIndex == null) {
    return { ok: false, reason: "out_of_range", input };
  }

  return {
    ok: true,
    verseIndex,
    label: formatVerseLabel(verseIndex),
    input,
  };
}

/**
 * Resolve a book-only draft (exact name or unambiguous abbreviation).
 * Used to keep the field from erroring while typing; zoom waits for autocomplete selection.
 */
export function resolveBookGuess(raw: string): BookGuessResult {
  const input = raw.trim();
  if (!input) return { ok: false };

  // Chapter/verse drafts ("John 3", "Rom 8:1") — not book-only.
  if (/\s+\d/.test(input) || /:/.test(input)) return { ok: false };

  const suggestions = autocompletePassage(input, { limit: 8 }).filter(
    (s) => s.kind === "book"
  );
  if (suggestions.length === 0) return { ok: false };

  const normalized = input.toLowerCase();
  const exact = suggestions.find(
    (s) =>
      s.insertText.toLowerCase() === normalized ||
      s.label.toLowerCase() === normalized
  );
  const match = exact ?? (suggestions.length === 1 ? suggestions[0] : null);
  if (!match) return { ok: false };

  const book = BOOKS.find((b) => b.osis === match.canonical);
  if (!book) return { ok: false };

  return {
    ok: true,
    osis: book.osis,
    name: book.name,
    startVerseIndex: book.startVerseIndex,
    input,
  };
}

/**
 * Passage autocomplete for the guess field (grab-bcv).
 * Drops the exact-current-token suggestion so the list only advances the draft.
 */
export function suggestGuessPassages(
  raw: string,
  limit = 6
): GuessSuggestion[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return autocompletePassage(trimmed, { limit }).filter(
    (suggestion) => suggestion.insertText !== trimmed
  );
}

/**
 * Progressive insert text: book → ready for chapter; chapter → ready for verse.
 * Verse/range inserts as-is so a complete ref can be confirmed.
 */
export function progressiveInsertText(suggestion: GuessSuggestion): string {
  if (suggestion.kind === "book") return `${suggestion.insertText} `;
  if (suggestion.kind === "chapter") return `${suggestion.insertText}:`;
  return suggestion.insertText;
}
