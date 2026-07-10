/**
 * Canonical 66-book axis metadata — verse-level (1..TOTAL_VERSES).
 * Chapter indices retained for book layout; selection is verse-precise.
 */
import booksData from "../data/books.json";

export type Genre =
  | "law"
  | "history"
  | "poetry"
  | "prophets"
  | "gospels"
  | "epistles";

export interface BookMeta {
  index: number;
  name: string;
  osis: string;
  bsb: string;
  chapters: number;
  verses: number;
  /** Inclusive 1-based chapter index on the global chapter axis. */
  startChapterIndex: number;
  endChapterIndex: number;
  /** Inclusive 1-based verse index on the global verse axis. */
  startVerseIndex: number;
  endVerseIndex: number;
  /** Verse count per chapter (1-indexed via array offset 0). */
  versesPerChapter: number[];
  genre: Genre;
  testament: "OT" | "NT";
}

export const TOTAL_CHAPTERS = 1189 as const;
export const TOTAL_VERSES = (booksData as { totalVerses: number }).totalVerses;

export const BOOKS: readonly BookMeta[] = (
  booksData as { books: BookMeta[] }
).books;

/** Testament-half quadrants (verse indices on the full canon). */
export type TestamentQuadrant =
  | "ot-first"
  | "ot-second"
  | "nt-first"
  | "nt-second";

export interface QuadrantInfo {
  id: TestamentQuadrant;
  label: string;
  startVerseIndex: number;
  endVerseIndex: number;
}

/** Fixed quadrants aligned to book boundaries (ADR). */
export const QUADRANTS: readonly QuadrantInfo[] = [
  {
    id: "ot-first",
    label: "first half of the Old Testament (Law and History)",
    startVerseIndex: 1,
    endVerseIndex: 12870,
  },
  {
    id: "ot-second",
    label: "second half of the Old Testament (Poetry and Prophets)",
    startVerseIndex: 12871,
    endVerseIndex: 23145,
  },
  {
    id: "nt-first",
    label: "first half of the New Testament (Gospels and Acts)",
    startVerseIndex: 23146,
    endVerseIndex: 27931,
  },
  {
    id: "nt-second",
    label: "second half of the New Testament (Epistles and Revelation)",
    startVerseIndex: 27932,
    endVerseIndex: TOTAL_VERSES,
  },
] as const;

/** Last OT verse index (Malachi ends here). */
export const TESTAMENT_SEAM_AFTER = (
  booksData as { otEndVerseIndex: number }
).otEndVerseIndex;

export function verseIndexFor(
  osis: string,
  chapter: number,
  verse: number
): number | null {
  const book = BOOKS.find((b) => b.osis === osis);
  if (!book) return null;
  if (chapter < 1 || chapter > book.chapters) return null;
  const chVerses = book.versesPerChapter[chapter - 1] ?? 0;
  if (verse < 1 || verse > chVerses) return null;
  const prior = book.versesPerChapter
    .slice(0, chapter - 1)
    .reduce((a, n) => a + n, 0);
  return book.startVerseIndex + prior + verse - 1;
}

/** @deprecated Prefer verseIndexFor — chapter start as verse index. */
export function chapterIndexFor(
  osis: string,
  chapter: number
): number | null {
  return verseIndexFor(osis, chapter, 1);
}

export function bookChapterVerseFromIndex(verseIndex: number): {
  book: BookMeta;
  chapter: number;
  verse: number;
} | null {
  if (verseIndex < 1 || verseIndex > TOTAL_VERSES) return null;
  for (const book of BOOKS) {
    if (
      verseIndex >= book.startVerseIndex &&
      verseIndex <= book.endVerseIndex
    ) {
      let offset = verseIndex - book.startVerseIndex;
      for (let c = 0; c < book.chapters; c++) {
        const n = book.versesPerChapter[c];
        if (offset < n) {
          return { book, chapter: c + 1, verse: offset + 1 };
        }
        offset -= n;
      }
      return {
        book,
        chapter: book.chapters,
        verse: book.versesPerChapter[book.chapters - 1],
      };
    }
  }
  return null;
}

/** Chapter-axis lookup (for book segment layout helpers). */
export function bookAndChapterFromIndex(chapterIndex: number): {
  book: BookMeta;
  chapter: number;
} | null {
  if (chapterIndex < 1 || chapterIndex > TOTAL_CHAPTERS) return null;
  for (const book of BOOKS) {
    if (
      chapterIndex >= book.startChapterIndex &&
      chapterIndex <= book.endChapterIndex
    ) {
      return {
        book,
        chapter: chapterIndex - book.startChapterIndex + 1,
      };
    }
  }
  return null;
}

export function formatVerseLabel(verseIndex: number): string {
  const loc = bookChapterVerseFromIndex(verseIndex);
  if (!loc) return `V ${verseIndex}`;
  return `${loc.book.name} ${loc.chapter}:${loc.verse}`;
}

/** @deprecated Use formatVerseLabel. */
export function formatChapterLabel(index: number): string {
  return formatVerseLabel(index);
}

export function quadrantForVerse(verseIndex: number): QuadrantInfo {
  for (const q of QUADRANTS) {
    if (
      verseIndex >= q.startVerseIndex &&
      verseIndex <= q.endVerseIndex
    ) {
      return q;
    }
  }
  return QUADRANTS[0];
}

/** @deprecated Use quadrantForVerse. */
export function quadrantForChapter(index: number): QuadrantInfo {
  return quadrantForVerse(index);
}
