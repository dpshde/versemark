/**
 * Insights — "see what you know about the Bible and where your gaps are".
 *
 * Pure functions over the locally stored rounds (daily history + practice log).
 * Nothing leaves the device except what the player chooses to share.
 */
import { BOOKS, bookChapterVerseFromIndex, type BookMeta } from "./books";
import type { RoundRecord } from "./storage";

export type SectionId = "law" | "history" | "poetry" | "prophets" | "gospels" | "epistles";
export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "law", label: "Law" },
  { id: "history", label: "History" },
  { id: "poetry", label: "Wisdom" },
  { id: "prophets", label: "Prophets" },
  { id: "gospels", label: "Gospels & Acts" },
  { id: "epistles", label: "Letters" },
];
/** Hosea–Malachi. */
export const MINOR_PROPHETS = ["HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL"];
/** A "hit": guess within one chapter of the verse (same or adjacent chapter, same book). */
export const NEAR_CHAPTERS = 1;
/** Minimum rounds before a book/section gets a verdict. */
export const MIN_SAMPLE = 2;

export interface ScoredGuess {
  book: BookMeta;
  guessBook: BookMeta;
  /** Signed chapters (guess − truth) on the global chapter axis; negative = placed too early. */
  chapterDelta: number;
  sameChapter: boolean;
  near: boolean;
  distance: number;
  at: string;
  source: RoundRecord["source"];
}

export interface Bucket {
  id: string;
  label: string;
  rounds: number;
  hits: number;
  /** hits / rounds (0..1), null when no rounds. */
  accuracy: number | null;
  /** Median signed chapter delta; negative = too early. */
  bias: number;
  medianChapters: number;
}

export interface Insights {
  rounds: number;
  overall: Bucket;
  books: Bucket[]; // index-aligned with BOOKS
  sections: Bucket[];
  testaments: { ot: Bucket; nt: Bucket };
  strongest: Bucket[];
  weakest: Bucket[];
  biases: Array<{ section: Bucket; direction: "early" | "late"; chapters: number }>;
  trend: { earlier: number | null; recent: number | null; window: number };
  studyNext: Array<{ book: BookMeta; chapter: number; ref: string; url: string; why: string }>;
  headline: string;
}

function globalChapter(verseIndex: number): { book: BookMeta; chapter: number; global: number } | null {
  const loc = bookChapterVerseFromIndex(verseIndex);
  if (!loc) return null;
  return { book: loc.book, chapter: loc.chapter, global: loc.book.startChapterIndex + loc.chapter - 1 };
}

export function scoreGuess(r: RoundRecord): ScoredGuess | null {
  const t = globalChapter(r.trueVerseIndex);
  const g = globalChapter(r.guessVerseIndex);
  if (!t || !g) return null;
  const end = globalChapter(r.trueRangeEndVerseIndex ?? r.trueVerseIndex) ?? t;
  const inRange = r.guessVerseIndex >= r.trueVerseIndex && r.guessVerseIndex <= (r.trueRangeEndVerseIndex ?? r.trueVerseIndex);
  const delta = inRange ? 0 : g.global < t.global ? g.global - t.global : Math.max(0, g.global - end.global);
  const sameBook = g.book.index === t.book.index;
  return {
    book: t.book, guessBook: g.book, chapterDelta: delta,
    sameChapter: inRange || (sameBook && delta === 0),
    near: sameBook && Math.abs(delta) <= NEAR_CHAPTERS,
    distance: r.distance, at: r.at, source: r.source,
  };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function bucket(id: string, label: string, gs: ScoredGuess[]): Bucket {
  const hits = gs.filter((g) => g.near).length;
  return {
    id, label, rounds: gs.length, hits,
    accuracy: gs.length ? hits / gs.length : null,
    bias: median(gs.map((g) => g.chapterDelta)),
    medianChapters: median(gs.map((g) => Math.abs(g.chapterDelta))),
  };
}
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export function computeInsights(rounds: RoundRecord[], poolBooks?: Set<number>): Insights {
  const gs = rounds.map(scoreGuess).filter((g): g is ScoredGuess => g != null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const books = BOOKS.map((b) => bucket(b.osis, b.name, gs.filter((g) => g.book.index === b.index)));
  const sections = SECTIONS.map((s) => bucket(s.id, s.label, gs.filter((g) => g.book.genre === s.id)));
  const ot = bucket("OT", "Old Testament", gs.filter((g) => g.book.testament === "OT"));
  const nt = bucket("NT", "New Testament", gs.filter((g) => g.book.testament === "NT"));
  const rated = books.filter((b) => b.rounds >= MIN_SAMPLE && (!poolBooks || poolBooks.has(BOOKS.find((x) => x.osis === b.id)!.index)));
  const byAcc = [...rated].sort((a, b) => (b.accuracy! - a.accuracy!) || (a.medianChapters - b.medianChapters));
  const strongest = byAcc.filter((b) => b.accuracy! >= 0.5).slice(0, 3);
  const weakest = [...byAcc].reverse().filter((b) => b.accuracy! < 0.5).slice(0, 3);

  const biases = sections
    .filter((s) => s.rounds >= 3 && Math.abs(s.bias) >= 3)
    .map((s) => ({ section: s, direction: (s.bias < 0 ? "early" : "late") as "early" | "late", chapters: Math.round(Math.abs(s.bias)) }))
    .sort((a, b) => b.chapters - a.chapters);

  const window = Math.min(20, Math.floor(gs.length / 2));
  const trend = window >= 5
    ? {
        earlier: gs.slice(0, window).filter((g) => g.near).length / window,
        recent: gs.slice(-window).filter((g) => g.near).length / window,
        window,
      }
    : { earlier: null, recent: null, window };

  // Study next: the biggest recent misses in your weakest books → read that chapter.
  const seen = new Set<string>();
  const studyNext: Insights["studyNext"] = [];
  const weakIds = new Set(weakest.map((w) => w.id));
  const candidates = [...gs].reverse().filter((g) => !g.near)
    .sort((a, b) => Number(weakIds.has(b.book.osis)) - Number(weakIds.has(a.book.osis)));
  for (const g of candidates) {
    if (studyNext.length >= 3) break;
    if (seen.has(g.book.osis)) continue;
    seen.add(g.book.osis);
    const r = rounds.find((x) => x.at === g.at);
    const loc = r ? bookChapterVerseFromIndex(r.trueVerseIndex) : null;
    if (!loc) continue;
    studyNext.push({
      book: g.book, chapter: loc.chapter, ref: `${g.book.name} ${loc.chapter}`,
      url: `https://www.route.bible/${g.book.osis.toLowerCase()}.${loc.chapter}`,
      why: g.guessBook.index === g.book.index
        ? `You placed it ${Math.abs(g.chapterDelta)} chapters ${g.chapterDelta < 0 ? "early" : "late"}`
        : `You placed it in ${g.guessBook.name}`,
    });
  }

  const overall = bucket("all", "Overall", gs);
  return { rounds: gs.length, overall, books, sections, testaments: { ot, nt }, strongest, weakest, biases, trend, studyNext,
    headline: headlineFor(gs.length, sections, strongest, weakest) };
}

function headlineFor(n: number, sections: Bucket[], strongest: Bucket[], weakest: Bucket[]): string {
  if (n < 3) return "Play a few rounds to see what you know — and where your gaps are.";
  const rated = sections.filter((s) => s.rounds >= MIN_SAMPLE && s.accuracy != null);
  const best = [...rated].sort((a, b) => b.accuracy! - a.accuracy!)[0];
  const worst = [...rated].sort((a, b) => a.accuracy! - b.accuracy!)[0];
  if (best && worst && best !== worst) return `You know ${best.label} best (${pct(best.accuracy)}). ${worst.label} is your biggest gap (${pct(worst.accuracy)}).`;
  if (strongest[0]) return `Strongest so far: ${strongest[0].label}.${weakest[0] ? ` Gap: ${weakest[0].label}.` : ""}`;
  return "Keep playing — your map fills in with every round.";
}

/** 0..4 strength level per book for the heat rail and share card ("-" = untested). */
export function bookLevel(b: Bucket): number | null {
  if (!b.rounds || b.accuracy == null) return null;
  return Math.max(0, Math.min(4, Math.round(b.accuracy * 4)));
}
/** Compact share encoding: 66 chars of 0–4 or "-". */
export function encodeMap(ins: Insights): string {
  return ins.books.map((b) => { const l = bookLevel(b); return l == null ? "-" : String(l); }).join("");
}
export { pct as formatAccuracy };

// —— Knowledge milestones ——
export interface Milestone {
  id: string;
  title: string;
  detail: string;
  done: number;
  total: number;
  unlocked: boolean;
}

const nailedBooks = (gs: ScoredGuess[]) => new Set(gs.filter((g) => g.sameChapter).map((g) => g.book.osis));
function setGoal(id: string, title: string, detail: string, osis: string[], nailed: Set<string>, pool?: Set<number>): Milestone {
  const need = osis.filter((o) => !pool || pool.has(BOOKS.find((b) => b.osis === o)!.index));
  const done = need.filter((o) => nailed.has(o)).length;
  return { id, title, detail, done, total: need.length, unlocked: need.length > 0 && done === need.length };
}
const osisWhere = (f: (b: BookMeta) => boolean) => BOOKS.filter(f).map((b) => b.osis);

export function computeMilestones(rounds: RoundRecord[], poolBooks?: Set<number>): Milestone[] {
  const gs = rounds.map(scoreGuess).filter((g): g is ScoredGuess => g != null).sort((a, b) => a.at.localeCompare(b.at));
  const nailed = nailedBooks(gs);
  let run = 0, best = 0;
  for (const g of gs) { run = g.near ? run + 1 : 0; best = Math.max(best, run); }
  const secNailed = new Set(gs.filter((g) => g.sameChapter).map((g) => g.book.genre));
  const streak = (n: number): Milestone => ({
    id: `near-streak-${n}`, title: n >= 10 ? `Sure-footed ×${n}` : `Steady hand ×${n}`,
    detail: `${n} rounds in a row within one chapter`, done: Math.min(best, n), total: n, unlocked: best >= n,
  });
  return [
    setGoal("torah", "Torah tracker", "Nail a verse's chapter in all five books of the Law", osisWhere((b) => b.genre === "law"), nailed, poolBooks),
    setGoal("gospels", "Gospel guide", "Nail a chapter in Matthew, Mark, Luke, and John", ["MAT", "MRK", "LUK", "JHN"], nailed, poolBooks),
    setGoal("wisdom", "Wisdom keeper", "Nail a chapter in every Wisdom book", osisWhere((b) => b.genre === "poetry"), nailed, poolBooks),
    setGoal("minor-prophets", "Minor Prophets master", "Nail a chapter in every Minor Prophet", MINOR_PROPHETS, nailed, poolBooks),
    setGoal("pauline", "Paul's letters", "Nail a chapter in every letter from Romans to Philemon", osisWhere((b) => b.index >= 44 && b.index <= 56), nailed, poolBooks),
    setGoal("nt-every", "New Testament cartographer", "Nail a chapter in every New Testament book", osisWhere((b) => b.testament === "NT"), nailed, poolBooks),
    { id: "sections", title: "Whole-canon reader", detail: "Nail a chapter in all six sections", done: SECTIONS.filter((s) => secNailed.has(s.id)).length, total: 6, unlocked: SECTIONS.every((s) => secNailed.has(s.id)) },
    streak(5), streak(10), streak(25),
  ];
}

/**
 * "Practice my gaps": pool items from weak (< 50% within a chapter) or untested books.
 * Falls back to the full pool when the gap set is too thin to feel random.
 */
export function gapPool<T extends { verseIndex: number }>(pool: T[], ins: Insights, minItems = 20): { items: T[]; books: string[] } {
  const gapIdx = new Set<number>();
  ins.books.forEach((b, i) => {
    if (b.rounds === 0 || (b.accuracy ?? 0) < 0.5) gapIdx.add(i);
  });
  const items = pool.filter((it) => {
    const loc = bookChapterVerseFromIndex(it.verseIndex);
    return loc != null && gapIdx.has(loc.book.index);
  });
  const books = [...new Set(items.map((it) => bookChapterVerseFromIndex(it.verseIndex)!.book.name))];
  return items.length >= minItems ? { items, books } : { items: pool, books: [] };
}
