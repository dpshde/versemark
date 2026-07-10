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

const BSB_ALIASES = {
  Gen: "GEN", Exo: "EXO", Lev: "LEV", Num: "NUM", Deu: "DEU",
  Jos: "JOS", Jdg: "JDG", Rut: "RUT", "1Sa": "1SA", "2Sa": "2SA",
  "1Ki": "1KI", "2Ki": "2KI", "1Ch": "1CH", "2Ch": "2CH", Ezr: "EZR",
  Neh: "NEH", Est: "EST", Job: "JOB", Psa: "PSA", Pro: "PRO",
  Ecc: "ECC", Sng: "SNG", Isa: "ISA", Jer: "JER", Lam: "LAM",
  Ezk: "EZK", Dan: "DAN", Hos: "HOS", Jol: "JOL", Amo: "AMO",
  Oba: "OBA", Jon: "JON", Mic: "MIC", Nam: "NAM", Hab: "HAB",
  Zep: "ZEP", Hag: "HAG", Zec: "ZEC", Mal: "MAL", Mat: "MAT",
  Mrk: "MRK", Luk: "LUK", Jhn: "JHN", Act: "ACT", Rom: "ROM",
  "1Co": "1CO", "2Co": "2CO", Gal: "GAL", Eph: "EPH", Php: "PHP",
  Col: "COL", "1Th": "1TH", "2Th": "2TH", "1Ti": "1TI", "2Ti": "2TI",
  Tit: "TIT", Phm: "PHM", Heb: "HEB", Jas: "JAS", "1Pe": "1PE",
  "2Pe": "2PE", "1Jn": "1JN", "2Jn": "2JN", "3Jn": "3JN", Jud: "JUD",
  Rev: "REV",
};

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

function buildPool(rankingsPath, books, bsb, paraData) {
  const byOsis = new Map(books.map((b) => [b.osis, b]));
  const acc = new Map(); // key "BOOK.CH.V" -> { weight, topics, range }

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
      const chapterIndex =
        bookMeta.startChapterIndex + parsed.chapter - 1;
      const priorVerses = bookMeta.versesPerChapter
        .slice(0, parsed.chapter - 1)
        .reduce((a, n) => a + n, 0);
      const verseIndex =
        bookMeta.startVerseIndex + priorVerses + parsed.verseStart - 1;
      const weightAdd = score / Math.max(1, rank);

      if (!acc.has(key)) {
        acc.set(key, {
          ref: key,
          osis: parsed.book,
          chapter: parsed.chapter,
          verse: parsed.verseStart,
          rangeEnd: parsed.verseEnd,
          rangeRaw: parsed.raw,
          chapterIndex,
          verseIndex,
          weight: 0,
          topics: [],
        });
      }
      const item = acc.get(key);
      item.weight += weightAdd;
      if (item.topics.length < 8 && !item.topics.includes(topic)) {
        item.topics.push(topic);
      }
      if (parsed.verseEnd > item.rangeEnd) item.rangeEnd = parsed.verseEnd;
    }
  }

  // Keep only pool entries with actual BSB text
  const pool = [];
  for (const item of acc.values()) {
    const textKey = `${item.osis}.${item.chapter}.${item.verse}`;
    if (!bsb.has(textKey)) continue;
    // soft-cap weight so mega-hits don't dominate
    item.weight = Math.round(Math.min(item.weight, 50) * 100) / 100;
    if (item.weight < 0.5) continue;
    pool.push(item);
  }

  // Prefer diverse, high-weight entries; cap pool size for bundle size
  pool.sort((a, b) => b.weight - a.weight);
  const MAX = 800;
  const selected = pool.slice(0, MAX);

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
    // Collect verse texts in paragraph
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
    version: 2,
    generated: new Date().toISOString().slice(0, 10),
    count: pool.length,
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
