import { describe, it, expect } from "vitest";
import {
  verseToT,
  tToVerse,
  hitTestVerse,
  verseToAxisPx,
  clampVerse,
  defaultViewport,
  zoomViewport,
  panViewport,
  bookSegments,
  testamentSeamT,
  viewportForZoomPreset,
  viewportForRange,
  viewportFullCanon,
  OT_END,
  NT_START,
} from "../src/lib/axis";
import {
  verseIndexFor,
  bookChapterVerseFromIndex,
  TOTAL_VERSES,
  TOTAL_CHAPTERS,
  TESTAMENT_SEAM_AFTER,
  QUADRANTS,
  BOOKS,
  formatVerseLabel,
} from "../src/lib/books";

describe("canon axis metadata", () => {
  it("has 66 books, 1189 chapters, ~31k verses", () => {
    expect(BOOKS).toHaveLength(66);
    expect(TOTAL_CHAPTERS).toBe(1189);
    expect(TOTAL_VERSES).toBe(31102);
    expect(BOOKS[BOOKS.length - 1].endVerseIndex).toBe(TOTAL_VERSES);
  });

  it("quadrant verse boundaries cover the full axis", () => {
    expect(QUADRANTS[0].startVerseIndex).toBe(1);
    expect(QUADRANTS[3].endVerseIndex).toBe(TOTAL_VERSES);
    expect(QUADRANTS[1].endVerseIndex).toBe(TESTAMENT_SEAM_AFTER);
    expect(QUADRANTS[2].startVerseIndex).toBe(NT_START);
  });

  it("verseIndexFor Genesis 1:1 = 1, Revelation 22:21 = last", () => {
    expect(verseIndexFor("GEN", 1, 1)).toBe(1);
    expect(verseIndexFor("REV", 22, 21)).toBe(TOTAL_VERSES);
    expect(verseIndexFor("MAT", 1, 1)).toBe(NT_START);
  });

  it("bookChapterVerseFromIndex round-trips", () => {
    const mat = verseIndexFor("MAT", 1, 1)!;
    const loc = bookChapterVerseFromIndex(mat);
    expect(loc?.book.osis).toBe("MAT");
    expect(loc?.chapter).toBe(1);
    expect(loc?.verse).toBe(1);
  });

  it("formatVerseLabel is Book Chapter:Verse", () => {
    expect(formatVerseLabel(1)).toBe("Genesis 1:1");
    const jn = verseIndexFor("JHN", 3, 16)!;
    expect(formatVerseLabel(jn)).toBe("John 3:16");
  });
});

describe("placement math", () => {
  it("verseToT / tToVerse round-trip endpoints", () => {
    expect(verseToT(1)).toBe(0);
    expect(verseToT(TOTAL_VERSES)).toBe(1);
    expect(tToVerse(0)).toBe(1);
    expect(tToVerse(1)).toBe(TOTAL_VERSES);
  });

  it("hitTest at axis midpoint of full-span viewport → mid canon", () => {
    const vp = defaultViewport("horizontal", 1000, 200);
    const hit = hitTestVerse(500, vp);
    expect(hit.verseIndex).toBeGreaterThan(TOTAL_VERSES * 0.4);
    expect(hit.verseIndex).toBeLessThan(TOTAL_VERSES * 0.6);
  });

  it("verseToAxisPx inverse of hitTest near center", () => {
    const vp = defaultViewport("vertical", 800, 300);
    const v = 15000;
    const px = verseToAxisPx(v, vp);
    const hit = hitTestVerse(px, vp);
    expect(hit.verseIndex).toBe(v);
  });

  it("zoom reduces span; pan shifts center", () => {
    let vp = defaultViewport("horizontal", 500, 100);
    vp = zoomViewport(vp, 2, 5000);
    expect(vp.span).toBeLessThan(TOTAL_VERSES);
    expect(vp.center).toBe(5000);
    const panned = panViewport(vp, 100);
    expect(panned.center).toBe(5100);
  });

  it("clampVerse bounds", () => {
    expect(clampVerse(0)).toBe(1);
    expect(clampVerse(999_999)).toBe(TOTAL_VERSES);
  });

  it("testament seam after Malachi", () => {
    expect(TESTAMENT_SEAM_AFTER).toBe(OT_END);
    const t = testamentSeamT();
    expect(t).toBeGreaterThan(0.7);
    expect(t).toBeLessThan(0.8);
  });

  it("bookSegments cover full verse axis", () => {
    const segs = bookSegments();
    expect(segs).toHaveLength(66);
    expect(segs[0].startVerseIndex).toBe(1);
    expect(segs[65].endVerseIndex).toBe(TOTAL_VERSES);
  });
});

describe("zoom presets", () => {
  const base = defaultViewport("horizontal", 1000, 200);

  it("OT spans the Old Testament", () => {
    const vp = viewportForZoomPreset(base, "ot");
    expect(vp.center - vp.span / 2).toBeLessThanOrEqual(2);
    expect(vp.center + vp.span / 2).toBeGreaterThanOrEqual(OT_END - 2);
  });

  it("NT spans the New Testament", () => {
    const vp = viewportForZoomPreset(base, "nt");
    expect(vp.center - vp.span / 2).toBeLessThanOrEqual(NT_START + 10);
    expect(vp.center + vp.span / 2).toBeGreaterThanOrEqual(TOTAL_VERSES - 10);
  });

  it("Book zooms to the book containing the focus verse", () => {
    const psalms1 = verseIndexFor("PSA", 1, 1)!;
    const vp = viewportForZoomPreset(base, "book", psalms1);
    const loc = bookChapterVerseFromIndex(psalms1)!;
    expect(vp.center).toBe(
      clampVerse(
        (loc.book.startVerseIndex + loc.book.endVerseIndex) / 2
      )
    );
    expect(vp.span).toBeLessThan(OT_END);
    expect(vp.span).toBeGreaterThan(loc.book.verses * 0.9);
  });

  it("viewportForRange pads short books", () => {
    const obad = BOOKS.find((b) => b.osis === "OBA")!;
    const vp = viewportForRange(
      base,
      obad.startVerseIndex,
      obad.endVerseIndex,
      { minSpan: 80 }
    );
    expect(obad.verses).toBe(21);
    expect(vp.span).toBeGreaterThanOrEqual(80);
  });

  it("full canon clears a zoomed viewport", () => {
    const zoomed = viewportForZoomPreset(base, "nt");
    const full = viewportFullCanon(zoomed);
    expect(full.span).toBe(TOTAL_VERSES);
    expect(full.center).toBe(Math.round(TOTAL_VERSES / 2));
  });
});
