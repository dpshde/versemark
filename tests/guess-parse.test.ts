import { describe, it, expect } from "vitest";
import {
  parseGuessText,
  progressiveInsertText,
  resolveBookGuess,
  suggestGuessPassages,
} from "../src/lib/guess-parse";
import { verseIndexFor } from "../src/lib/books";

describe("parseGuessText (grab-bcv)", () => {
  it("parses full book names with verse", () => {
    const r = parseGuessText("Proverbs 11:21");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verseIndex).toBe(verseIndexFor("PRO", 11, 21));
    expect(r.label).toBe("Proverbs 11:21");
  });

  it("parses abbreviations", () => {
    const r = parseGuessText("Jn 3:16");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verseIndex).toBe(verseIndexFor("JHN", 3, 16));
  });

  it("parses OSIS-style refs", () => {
    const r = parseGuessText("GEN.1.1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verseIndex).toBe(1);
  });

  it("chapter-only refs resolve to verse 1", () => {
    const r = parseGuessText("Romans 8");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verseIndex).toBe(verseIndexFor("ROM", 8, 1));
  });

  it("rejects empty and nonsense", () => {
    expect(parseGuessText("").ok).toBe(false);
    expect(parseGuessText("   ").ok).toBe(false);
    expect(parseGuessText("not a verse").ok).toBe(false);
  });
});

describe("resolveBookGuess", () => {
  it("resolves full book names", () => {
    const r = resolveBookGuess("John");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.osis).toBe("JHN");
    expect(r.name).toBe("John");
    expect(r.startVerseIndex).toBe(verseIndexFor("JHN", 1, 1));
  });

  it("resolves unambiguous abbreviations", () => {
    const gen = resolveBookGuess("Gen");
    expect(gen.ok).toBe(true);
    if (gen.ok) expect(gen.osis).toBe("GEN");

    const mt = resolveBookGuess("Mt");
    expect(mt.ok).toBe(true);
    if (mt.ok) expect(mt.osis).toBe("MAT");
  });

  it("trims trailing space after progressive book insert", () => {
    const r = resolveBookGuess("Romans ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.osis).toBe("ROM");
  });

  it("resolves numbered books and compact abbreviations", () => {
    const john = resolveBookGuess("1 John");
    expect(john.ok).toBe(true);
    if (john.ok) expect(john.osis).toBe("1JN");

    const cor = resolveBookGuess("1Cor");
    expect(cor.ok).toBe(true);
    if (cor.ok) expect(cor.osis).toBe("1CO");
  });

  it("resolves unambiguous prefixes, not ambiguous ones", () => {
    expect(resolveBookGuess("Joh").ok).toBe(true);
    expect(resolveBookGuess("J").ok).toBe(false);
    expect(resolveBookGuess("Jo").ok).toBe(false);
  });

  it("rejects chapter drafts and empty input", () => {
    expect(resolveBookGuess("John 3").ok).toBe(false);
    expect(resolveBookGuess("Romans 8:1").ok).toBe(false);
    expect(resolveBookGuess("").ok).toBe(false);
    expect(resolveBookGuess("not a verse").ok).toBe(false);
  });
});

describe("suggestGuessPassages (grab-bcv autocomplete)", () => {
  it("returns empty for blank input", () => {
    expect(suggestGuessPassages("")).toEqual([]);
    expect(suggestGuessPassages("   ")).toEqual([]);
  });

  it("suggests books from a prefix", () => {
    const s = suggestGuessPassages("jn");
    expect(s.length).toBeGreaterThan(0);
    expect(s.some((x) => x.canonical === "JHN" && x.kind === "book")).toBe(
      true
    );
  });

  it("suggests chapters and verses as the draft advances", () => {
    const chapter = suggestGuessPassages("jn 3");
    expect(chapter.some((x) => x.kind === "chapter" && x.label === "John 3")).toBe(
      true
    );
    const verse = suggestGuessPassages("jn 3:");
    expect(verse.every((x) => x.kind === "verse")).toBe(true);
    expect(verse[0]?.label).toMatch(/^John 3:/);
  });

  it("omits the exact current token so the list only advances the draft", () => {
    const s = suggestGuessPassages("John");
    expect(s.every((x) => x.insertText !== "John")).toBe(true);
  });

  it("progressiveInsertText advances book/chapter drafts", () => {
    expect(
      progressiveInsertText({
        kind: "book",
        label: "John",
        insertText: "John",
        canonical: "JHN",
      })
    ).toBe("John ");
    expect(
      progressiveInsertText({
        kind: "chapter",
        label: "John 3",
        insertText: "John 3",
        canonical: "JHN.3",
      })
    ).toBe("John 3:");
    expect(
      progressiveInsertText({
        kind: "verse",
        label: "John 3:16",
        insertText: "John 3:16",
        canonical: "JHN.3.16",
      })
    ).toBe("John 3:16");
  });
});
