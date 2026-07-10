/**
 * Snapshot build: books metadata, curated pool, BSB verse/paragraph text for pool entries.
 * Sources (read at build time; artifacts committed for offline reproducibility):
 *   - topic-verse-rankings.browser.json (Exedra)
 *   - bsb.browser.jsonl (Exedra / BSB)
 *   - para-data.json (grab-bcv)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "data");
const srcDataDir = path.join(root, "src", "data");

const BOOKS = [
  ["Genesis", "GEN", "Gen", 50, "law"],
  ["Exodus", "EXO", "Exo", 40, "law"],
  ["Leviticus", "LEV", "Lev", 27, "law"],
  ["Numbers", "NUM", "Num", 36, "law"],
  ["Deuteronomy", "DEU", "Deu", 34, "law"],
  ["Joshua", "JOS", "Jos", 24, "history"],
  ["Judges", "JDG", "Jdg", 21, "history"],
  ["Ruth", "RUT", "Rut", 4, "history"],
  ["1 Samuel", "1SA", "1Sa", 31, "history"],
  ["2 Samuel", "2SA", "2Sa", 24, "history"],
  ["1 Kings", "1KI", "1Ki", 22, "history"],
  ["2 Kings", "2KI", "2Ki", 25, "history"],
  ["1 Chronicles", "1CH", "1Ch", 29, "history"],
  ["2 Chronicles", "2CH", "2Ch", 36, "history"],
  ["Ezra", "EZR", "Ezr", 10, "history"],
  ["Nehemiah", "NEH", "Neh", 13, "history"],
  ["Esther", "EST", "Est", 10, "history"],
  ["Job", "JOB", "Job", 42, "poetry"],
  ["Psalms", "PSA", "Psa", 150, "poetry"],
  ["Proverbs", "PRO", "Pro", 31, "poetry"],
  ["Ecclesiastes", "ECC", "Ecc", 12, "poetry"],
  ["Song of Solomon", "SNG", "Sng", 8, "poetry"],
  ["Isaiah", "ISA", "Isa", 66, "prophets"],
  ["Jeremiah", "JER", "Jer", 52, "prophets"],
  ["Lamentations", "LAM", "Lam", 5, "prophets"],
  ["Ezekiel", "EZK", "Ezk", 48, "prophets"],
  ["Daniel", "DAN", "Dan", 12, "prophets"],
  ["Hosea", "HOS", "Hos", 14, "prophets"],
  ["Joel", "JOL", "Jol", 3, "prophets"],
  ["Amos", "AMO", "Amo", 9, "prophets"],
  ["Obadiah", "OBA", "Oba", 1, "prophets"],
  ["Jonah", "JON", "Jon", 4, "prophets"],
  ["Micah", "MIC", "Mic", 7, "prophets"],
  ["Nahum", "NAM", "Nam", 3, "prophets"],
  ["Habakkuk", "HAB", "Hab", 3, "prophets"],
  ["Zephaniah", "ZEP", "Zep", 3, "prophets"],
  ["Haggai", "HAG", "Hag", 2, "prophets"],
  ["Zechariah", "ZEC", "Zec", 14, "prophets"],
  ["Malachi", "MAL", "Mal", 4, "prophets"],
  ["Matthew", "MAT", "Mat", 28, "gospels"],
  ["Mark", "MRK", "Mrk", 16, "gospels"],
  ["Luke", "LUK", "Luk", 24, "gospels"],
  ["John", "JHN", "Jhn", 21, "gospels"],
  ["Acts", "ACT", "Act", 28, "gospels"],
  ["Romans", "ROM", "Rom", 16, "epistles"],
  ["1 Corinthians", "1CO", "1Co", 16, "epistles"],
  ["2 Corinthians", "2CO", "2Co", 13, "epistles"],
  ["Galatians", "GAL", "Gal", 6, "epistles"],
  ["Ephesians", "EPH", "Eph", 6, "epistles"],
  ["Philippians", "PHP", "Php", 4, "epistles"],
  ["Colossians", "COL", "Col", 4, "epistles"],
  ["1 Thessalonians", "1TH", "1Th", 5, "epistles"],
  ["2 Thessalonians", "2TH", "2Th", 3, "epistles"],
  ["1 Timothy", "1TI", "1Ti", 6, "epistles"],
  ["2 Timothy", "2TI", "2Ti", 4, "epistles"],
  ["Titus", "TIT", "Tit", 3, "epistles"],
  ["Philemon", "PHM", "Phm", 1, "epistles"],
  ["Hebrews", "HEB", "Heb", 13, "epistles"],
  ["James", "JAS", "Jas", 5, "epistles"],
  ["1 Peter", "1PE", "1Pe", 5, "epistles"],
  ["2 Peter", "2PE", "2Pe", 3, "epistles"],
  ["1 John", "1JN", "1Jn", 5, "epistles"],
  ["2 John", "2JN", "2Jn", 1, "epistles"],
  ["3 John", "3JN", "3Jn", 1, "epistles"],
  ["Jude", "JUD", "Jud", 1, "epistles"],
  ["Revelation", "REV", "Rev", 22, "prophets"],
];

/** OSIS ← BSB jsonl book codes (Exedra bsb.browser.jsonl uses longer forms). */
const BSB_ALIASES = {
  Gen: "GEN",
  Exod: "EXO",
  Lev: "LEV",
  Num: "NUM",
  Deut: "DEU",
  Josh: "JOS",
  Judg: "JDG",
  Ruth: "RUT",
  "1Sam": "1SA",
  "2Sam": "2SA",
  "1Kgs": "1KI",
  "2Kgs": "2KI",
  "1Chr": "1CH",
  "2Chr": "2CH",
  Ezra: "EZR",
  Neh: "NEH",
  Esth: "EST",
  Job: "JOB",
  Ps: "PSA",
  Prov: "PRO",
  Eccl: "ECC",
  Song: "SNG",
  Isa: "ISA",
  Jer: "JER",
  Lam: "LAM",
  Ezek: "EZK",
  Dan: "DAN",
  Hos: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obad: "OBA",
  Jonah: "JON",
  Mic: "MIC",
  Nah: "NAM",
  Hab: "HAB",
  Zeph: "ZEP",
  Hag: "HAG",
  Zech: "ZEC",
  Mal: "MAL",
  Matt: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Rom: "ROM",
  "1Cor": "1CO",
  "2Cor": "2CO",
  Gal: "GAL",
  Eph: "EPH",
  Phil: "PHP",
  Col: "COL",
  "1Thess": "1TH",
  "2Thess": "2TH",
  "1Tim": "1TI",
  "2Tim": "2TI",
  Titus: "TIT",
  Phlm: "PHM",
  Heb: "HEB",
  Jas: "JAS",
  "1Pet": "1PE",
  "2Pet": "2PE",
  "1John": "1JN",
  "2John": "2JN",
  "3John": "3JN",
  Jude: "JUD",
  Rev: "REV",
};

/** Target curated pool size: popular + cross-referenced, canon-spread. */
const POOL_TARGET = 1000;
/**
 * Soft floor: prefer verses cited by this many topics (cross-ref depth).
 * topics≥2 ≈ 1k BSB-backed candidates — natural match for the target.
 */
const MIN_TOPIC_COUNT = 2;
const MAX_PER_BOOK = 40;
const MAX_PER_GENRE = {
  law: 140,
  history: 120,
  poetry: 180,
  prophets: 180,
  gospels: 200,
  epistles: 220,
};

/**
 * Always include these OSIS refs when BSB text exists — high cross-ref
 * verses dropped by book caps, plus classic familiarity anchors.
 * Selection force-seeds them before diversity caps apply.
 */
const POOL_ALLOWLIST = [
  // Top cross-ref misses (topics ≥ 5) under book caps
  "PSA.91.11",
  "MAT.5.32",
  "MAT.5.14",
  "MAT.28.18",
  "MAT.6.7",
  "MAT.5.37",
  "MAT.6.6",
  "MAT.25.35",
  // Classic / familiar anchors often under-ranked or cap-blocked
  "PSA.46.1",
  "PSA.27.1",
  "PSA.19.1",
  "PSA.1.1",
  "MAT.22.37",
  "MAT.22.39",
  "MAT.5.3",
  "MAT.6.9",
  "MAT.7.7",
  "PRO.3.6",
  "ROM.8.1",
  "1JN.4.8",
  "1CO.13.13",
  "JHN.15.5",
  "JHN.11.25",
  "1TH.5.16",
  "NEH.8.10",
  "HAB.2.4",
  "ISA.6.8",
  "AMO.5.24",
  "ZEC.4.6",
  "RUT.1.16",
  "GAL.2.20",
  "EPH.6.10",
  "HEB.12.1",
  "JAS.1.5",
  "REV.21.1",
  "GEN.1.27",
  "DEU.6.5",
  "MAL.3.10",
  "PHP.4.8",
];

function resolvePath(candidates) {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function loadVerseAxis() {
  const p = path.join(srcDataDir, "verse-axis.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      "src/data/verse-axis.json missing — needed for verse-level axis"
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function buildBooks() {
  const axis = loadVerseAxis();
  const byOsis = new Map(axis.books.map((b) => [b.osis, b]));
  let offset = 1;
  const books = BOOKS.map(([name, osis, bsb, chapters, genre], i) => {
    const startChapterIndex = offset;
    const endChapterIndex = offset + chapters - 1;
    offset = endChapterIndex + 1;
    const v = byOsis.get(osis);
    if (!v) throw new Error(`No verse axis for ${osis}`);
    if (v.chapters !== chapters) {
      throw new Error(
        `${osis}: expected ${chapters} chapters, verse-axis has ${v.chapters}`
      );
    }
    return {
      index: i,
      name,
      osis,
      bsb,
      chapters,
      verses: v.verses,
      startChapterIndex,
      endChapterIndex,
      startVerseIndex: v.startVerseIndex,
      endVerseIndex: v.endVerseIndex,
      versesPerChapter: v.versesPerChapter,
      genre,
      testament: i < 39 ? "OT" : "NT",
    };
  });
  if (offset - 1 !== 1189) {
    throw new Error(`Expected 1189 chapters, got ${offset - 1}`);
  }
  return { books, totalVerses: axis.totalVerses, otEndVerseIndex: axis.otEndVerseIndex };
}

function parseRankingRef(ref) {
  // e.g. "EXO.20.1-26", "JHN.3.16", "PSA.23.1-6"
  const m = ref.match(/^([A-Z0-9]+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/i);
  if (!m) return null;
  const book = m[1].toUpperCase();
  const chapter = Number(m[2]);
  const verseStart = m[3] ? Number(m[3]) : 1;
  const verseEnd = m[4] ? Number(m[4]) : verseStart;
  return { book, chapter, verseStart, verseEnd, raw: ref };
}

function loadBsb(bsbPath) {
  const map = new Map(); // OSIS key "GEN.1.1" -> text
  const lines = fs.readFileSync(bsbPath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const [ref, text] = JSON.parse(line);
    // ref like "Gen.1.1"
    const parts = ref.split(".");
    if (parts.length !== 3) continue;
    const osisBook = BSB_ALIASES[parts[0]] || parts[0].toUpperCase();
    const key = `${osisBook}.${parts[1]}.${parts[2]}`;
    map.set(key, text);
  }
  return map;
}

function loadPara(paraPath) {
  return JSON.parse(fs.readFileSync(paraPath, "utf8"));
}

/** Paragraph range containing a verse: style markers start new paragraphs. */
function paragraphRange(paraData, book, chapter, verse) {
  const chapKey = `${book}.${chapter}`;
  const entries = paraData[chapKey];
  if (!entries || !entries.length) {
    return { start: verse, end: verse };
  }
  // entries are markers: {v, s} — s is paragraph style starting at verse v
  const starts = entries.map((e) => e.v).sort((a, b) => a - b);
  let paraStart = 1;
  for (const s of starts) {
    if (s <= verse) paraStart = s;
    else break;
  }
  let paraEnd = verse;
  const next = starts.find((s) => s > verse);
  if (next != null) {
    paraEnd = next - 1;
  } else {
    // end of chapter — leave open; caller may clamp by available text
    paraEnd = verse + 20;
  }
  return { start: paraStart, end: paraEnd };
}

/**
 * First BSB verse available in [start, end] for a book.chapter
 * (topic rankings often cite range starts missing from the BSB subset).
 */
function firstBsbVerseInRange(bsb, book, chapter, start, end) {
  const lo = Math.max(1, start);
  const hi = Math.max(lo, end);
  for (let v = lo; v <= hi; v++) {
    if (bsb.has(`${book}.${chapter}.${v}`)) return v;
  }
  return null;
}

function verseIndexFor(bookMeta, chapter, verse) {
  const priorVerses = bookMeta.versesPerChapter
    .slice(0, chapter - 1)
    .reduce((a, n) => a + n, 0);
  return bookMeta.startVerseIndex + priorVerses + verse - 1;
}

/**
 * Popularity = cross-topic citations (primary) + ranking weight (secondary).
 * Then greedily pick ~POOL_TARGET with per-book / per-genre caps so the
 * timeline is not dominated by a few epistles or felt-need passages.
 * Allowlisted refs are force-seeded first (bypass caps).
 */
function selectDiversePool(candidates, books) {
  const genreOf = new Map(books.map((b) => [b.osis, b.genre]));
  const allowSet = new Set(POOL_ALLOWLIST);
  const sorted = [...candidates].sort(
    (a, b) =>
      b.topicCount - a.topicCount ||
      b.rawWeight - a.rawWeight ||
      a.verseIndex - b.verseIndex
  );

  const selected = [];
  const byBook = new Map();
  const byGenre = new Map();
  const chaptersInBook = new Map(); // osis -> Set of chapters

  const recordAdd = (c) => {
    selected.push(c);
    const g = genreOf.get(c.osis) || "other";
    byBook.set(c.osis, (byBook.get(c.osis) || 0) + 1);
    byGenre.set(g, (byGenre.get(g) || 0) + 1);
    const chs = chaptersInBook.get(c.osis) || new Set();
    chs.add(c.chapter);
    chaptersInBook.set(c.osis, chs);
  };

  // Allowlisted refs are free — they don't consume diversity budget so
  // force-seeding classics doesn't crowd out other high cross-ref hits.
  const rankedBookCount = (osis) => {
    let n = 0;
    for (const s of selected) {
      if (s.osis === osis && !allowSet.has(s.ref)) n += 1;
    }
    return n;
  };
  const rankedGenreCount = (g) => {
    let n = 0;
    for (const s of selected) {
      if ((genreOf.get(s.osis) || "other") === g && !allowSet.has(s.ref)) n += 1;
    }
    return n;
  };

  const tryAdd = (c, { maxBook, maxGenre, uniqueChapter }) => {
    const g = genreOf.get(c.osis) || "other";
    if (rankedBookCount(c.osis) >= maxBook) return false;
    if (rankedGenreCount(g) >= maxGenre) return false;
    const chs = chaptersInBook.get(c.osis) || new Set();
    if (uniqueChapter && chs.has(c.chapter) && rankedBookCount(c.osis) >= 3) {
      return false;
    }
    recordAdd(c);
    return true;
  };

  // Pass 0: force-include allowlist (no caps)
  const byRef = new Map(sorted.map((c) => [c.ref, c]));
  let allowSeeded = 0;
  for (const ref of POOL_ALLOWLIST) {
    const c = byRef.get(ref);
    if (!c) continue;
    if (selected.some((s) => s.ref === ref)) continue;
    c.allowlisted = true;
    recordAdd(c);
    allowSeeded += 1;
  }

  const preferred = sorted.filter((c) => c.topicCount >= MIN_TOPIC_COUNT);
  const rest = sorted.filter((c) => c.topicCount < MIN_TOPIC_COUNT);
  const have = () => new Set(selected.map((s) => s.ref));

  // Pass 1: high cross-ref, strict diversity
  for (const c of preferred) {
    if (selected.length >= POOL_TARGET) break;
    if (have().has(c.ref)) continue;
    tryAdd(c, {
      maxBook: MAX_PER_BOOK,
      maxGenre: MAX_PER_GENRE[genreOf.get(c.osis)] ?? 40,
      uniqueChapter: true,
    });
  }
  // Pass 2: same quality band, relax chapter uniqueness
  if (selected.length < POOL_TARGET) {
    const seen = have();
    for (const c of preferred) {
      if (selected.length >= POOL_TARGET) break;
      if (seen.has(c.ref)) continue;
      if (
        tryAdd(c, {
          maxBook: MAX_PER_BOOK + 2,
          maxGenre: (MAX_PER_GENRE[genreOf.get(c.osis)] ?? 40) + 10,
          uniqueChapter: false,
        })
      ) {
        seen.add(c.ref);
      }
    }
  }
  // Pass 3: fill remainder from lower cross-ref if still short
  if (selected.length < POOL_TARGET) {
    const seen = have();
    for (const c of rest) {
      if (selected.length >= POOL_TARGET) break;
      if (seen.has(c.ref)) continue;
      if (
        tryAdd(c, {
          maxBook: MAX_PER_BOOK + 2,
          maxGenre: (MAX_PER_GENRE[genreOf.get(c.osis)] ?? 40) + 15,
          uniqueChapter: false,
        })
      ) {
        seen.add(c.ref);
      }
    }
  }

  // If allowlist + greedy exceeded target, drop lowest-score non-allowlisted
  if (selected.length > POOL_TARGET) {
    const keep = selected.filter((s) => allowSet.has(s.ref));
    const flexible = selected
      .filter((s) => !allowSet.has(s.ref))
      .sort(
        (a, b) =>
          a.topicCount - b.topicCount ||
          a.rawWeight - b.rawWeight ||
          b.verseIndex - a.verseIndex
      );
    const need = Math.max(0, POOL_TARGET - keep.length);
    selected.length = 0;
    selected.push(...keep, ...flexible.slice(flexible.length - need));
  }

  // Sampling weight: mild log boost for highly cross-referenced verses so
  // dailies rotate across the pool instead of locking onto mega-hits.
  for (const item of selected) {
    item.weight =
      Math.round((1 + Math.log1p(item.topicCount) * 4 + Math.log1p(item.rawWeight)) * 100) /
      100;
  }

  return { selected, allowSeeded };
}

function buildPool(rankingsPath, books, bsb, paraData) {
  const byOsis = new Map(books.map((b) => [b.osis, b]));
  // Accumulate by stable ranking key, then resolve to a BSB-backed verse.
  const acc = new Map(); // key "BOOK.CH.Vstart" -> aggregate

  const rankings = JSON.parse(fs.readFileSync(rankingsPath, "utf8"));
  for (const [topic, refs] of rankings) {
    if (!Array.isArray(refs)) continue;
    for (const entry of refs) {
      const refStr = entry[0];
      const score = Number(entry[1]) || 1;
      const rank = Number(entry[2]) || 99;
      const parsed = parseRankingRef(refStr);
      if (!parsed) continue;
      const bookMeta = byOsis.get(parsed.book);
      if (!bookMeta) continue;
      if (parsed.chapter < 1 || parsed.chapter > bookMeta.chapters) continue;

      const key = `${parsed.book}.${parsed.chapter}.${parsed.verseStart}`;
      const weightAdd = score / Math.max(1, rank);

      if (!acc.has(key)) {
        acc.set(key, {
          osis: parsed.book,
          chapter: parsed.chapter,
          verseStart: parsed.verseStart,
          rangeEnd: parsed.verseEnd,
          rangeRaw: parsed.raw,
          rawWeight: 0,
          topicCount: 0,
          topics: [],
        });
      }
      const item = acc.get(key);
      item.rawWeight += weightAdd;
      item.topicCount += 1;
      if (item.topics.length < 8 && !item.topics.includes(topic)) {
        item.topics.push(topic);
      }
      if (parsed.verseEnd > item.rangeEnd) item.rangeEnd = parsed.verseEnd;
    }
  }

  // Resolve each aggregate to a concrete BSB verse (range-start fallback).
  const candidates = [];
  for (const item of acc.values()) {
    const bookMeta = byOsis.get(item.osis);
    if (!bookMeta) continue;
    const chapterMax =
      bookMeta.versesPerChapter[item.chapter - 1] ?? item.rangeEnd;
    const resolvedVerse = firstBsbVerseInRange(
      bsb,
      item.osis,
      item.chapter,
      item.verseStart,
      Math.max(item.rangeEnd, item.verseStart, Math.min(chapterMax, item.verseStart + 5))
    );
    if (resolvedVerse == null) continue;

    const ref = `${item.osis}.${item.chapter}.${resolvedVerse}`;
    const chapterIndex = bookMeta.startChapterIndex + item.chapter - 1;
    const verseIndex = verseIndexFor(bookMeta, item.chapter, resolvedVerse);

    candidates.push({
      ref,
      osis: item.osis,
      chapter: item.chapter,
      verse: resolvedVerse,
      rangeEnd: Math.max(item.rangeEnd, resolvedVerse),
      rangeRaw: item.rangeRaw,
      chapterIndex,
      verseIndex,
      rawWeight: item.rawWeight,
      topicCount: item.topicCount,
      topics: item.topics,
      weight: 0,
    });
  }

  // Deduplicate if multiple ranking keys resolved to the same BSB verse.
  const byRef = new Map();
  for (const c of candidates) {
    const prev = byRef.get(c.ref);
    if (!prev) {
      byRef.set(c.ref, c);
      continue;
    }
    prev.rawWeight += c.rawWeight;
    prev.topicCount += c.topicCount;
    for (const t of c.topics) {
      if (prev.topics.length < 8 && !prev.topics.includes(t)) prev.topics.push(t);
    }
    if (c.rangeEnd > prev.rangeEnd) prev.rangeEnd = c.rangeEnd;
  }

  // Inject allowlisted refs that have BSB text but never appeared in rankings.
  const allowMissing = [];
  for (const ref of POOL_ALLOWLIST) {
    if (byRef.has(ref)) continue;
    if (!bsb.has(ref)) {
      allowMissing.push(ref);
      continue;
    }
    const m = /^([A-Z0-9]+)\.(\d+)\.(\d+)$/.exec(ref);
    if (!m) continue;
    const osis = m[1];
    const chapter = Number(m[2]);
    const verse = Number(m[3]);
    const bookMeta = byOsis.get(osis);
    if (!bookMeta) continue;
    if (chapter < 1 || chapter > bookMeta.chapters) continue;
    byRef.set(ref, {
      ref,
      osis,
      chapter,
      verse,
      rangeEnd: verse,
      rangeRaw: ref,
      chapterIndex: bookMeta.startChapterIndex + chapter - 1,
      verseIndex: verseIndexFor(bookMeta, chapter, verse),
      rawWeight: 1,
      topicCount: 0,
      topics: ["_allowlist"],
      weight: 0,
      allowlisted: true,
    });
  }
  if (allowMissing.length) {
    console.warn(
      "Allowlist refs with no BSB text (skipped):",
      allowMissing.join(", ")
    );
  }

  const { selected, allowSeeded } = selectDiversePool([...byRef.values()], books);
  console.log(
    `Allowlist: seeded ${allowSeeded}/${POOL_ALLOWLIST.length} (missing BSB: ${allowMissing.length})`
  );

  // Build verse + paragraph payloads for selected only
  const verses = {};
  const paragraphs = {};
  for (const item of selected) {
    const textKey = `${item.osis}.${item.chapter}.${item.verse}`;
    verses[textKey] = bsb.get(textKey);

    const pr = paragraphRange(
      paraData,
      item.osis,
      item.chapter,
      item.verse
    );
    const texts = [];
    for (let v = pr.start; v <= pr.end && v < pr.start + 30; v++) {
      const k = `${item.osis}.${item.chapter}.${v}`;
      if (bsb.has(k)) {
        texts.push({ v, t: bsb.get(k) });
        verses[k] = bsb.get(k);
      } else if (v > item.verse) {
        break;
      }
    }
    paragraphs[textKey] = {
      start: texts[0]?.v ?? item.verse,
      end: texts[texts.length - 1]?.v ?? item.verse,
      verses: texts,
    };
  }

  return {
    pool: selected.map(
      ({
        ref,
        osis,
        chapter,
        verse,
        rangeEnd,
        rangeRaw,
        chapterIndex,
        verseIndex,
        weight,
        topicCount,
        topics,
      }) => ({
        ref,
        osis,
        chapter,
        verse,
        rangeEnd,
        rangeRaw,
        chapterIndex,
        verseIndex,
        weight,
        topicCount,
        topics: topics.slice(0, 4),
      })
    ),
    verses,
    paragraphs,
  };
}

function main() {
  const rankingsPath = resolvePath([
    path.join(
      root,
      "..",
      "selah-tools/apps/exedra-search/data/topic-verse-rankings.browser.json"
    ),
    path.join(root, "data-src/topic-verse-rankings.browser.json"),
  ]);
  const bsbPath = resolvePath([
    path.join(root, "..", "selah-tools/apps/exedra-search/data/bsb.browser.jsonl"),
    path.join(root, "data-src/bsb.browser.jsonl"),
  ]);
  const paraPath = resolvePath([
    path.join(root, "..", "grab-bcv/src/para-data.json"),
    path.join(root, "data-src/para-data.json"),
  ]);

  if (!rankingsPath || !bsbPath || !paraPath) {
    console.error("Missing sources:", { rankingsPath, bsbPath, paraPath });
    process.exit(1);
  }

  console.log("rankings:", rankingsPath);
  console.log("bsb:", bsbPath);
  console.log("para:", paraPath);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(srcDataDir, { recursive: true });

  const { books, totalVerses, otEndVerseIndex } = buildBooks();
  const bsb = loadBsb(bsbPath);
  const paraData = loadPara(paraPath);
  const { pool, verses, paragraphs } = buildPool(
    rankingsPath,
    books,
    bsb,
    paraData
  );

  const booksJson = {
    totalChapters: 1189,
    totalVerses,
    otEndVerseIndex,
    books,
  };
  const poolJson = {
    version: 3,
    generated: new Date().toISOString().slice(0, 10),
    count: pool.length,
    target: POOL_TARGET,
    selection: "crossref-popular-diverse",
    items: pool,
  };

  fs.writeFileSync(
    path.join(outDir, "books.json"),
    JSON.stringify(booksJson)
  );
  fs.writeFileSync(path.join(outDir, "pool.json"), JSON.stringify(poolJson));
  fs.writeFileSync(path.join(outDir, "verses.json"), JSON.stringify(verses));
  fs.writeFileSync(
    path.join(outDir, "paragraphs.json"),
    JSON.stringify(paragraphs)
  );

  // Also embed small copies importable by tests / tree-shaken modules
  fs.writeFileSync(
    path.join(srcDataDir, "books.json"),
    JSON.stringify(booksJson, null, 2)
  );
  fs.writeFileSync(
    path.join(srcDataDir, "pool.json"),
    JSON.stringify(poolJson)
  );

  console.log(
    `Wrote ${books.length} books (${totalVerses} verses), pool ${pool.length}, verses ${Object.keys(verses).length}, paragraphs ${Object.keys(paragraphs).length}`
  );
  console.log("Out:", outDir);
}

main();
