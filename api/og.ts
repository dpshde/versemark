import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { readFile } from "node:fs/promises";

/** Source Serif 4 (OFL), bundled — no runtime CDN fetch. */
let fonts: Promise<Array<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }>> | null = null;
function loadFonts() {
  fonts ??= Promise.all(([400, 700] as const).map(async (weight) => ({
    name: "Serif", weight, style: "normal" as const,
    data: await readFile(new URL(`./fonts/source-serif-4-${weight}.woff`, import.meta.url)),
  })));
  return fonts;
}
const SEGMENTS: Array<[string, number]> = [
  ["#6ec272", 5852], ["#e1755a", 7018], ["#bc88f4", 4785], ["#e36558", 5490],
  ["#ee7d8d", 4786], ["#00beaf", 2767], ["#e36558", 404],
];
interface ShareRound { total: number; distance: number }
/** s = "980-12.720-40.310-150" → per-verse total-distance (spoiler-safe: no positions). */
function parseScores(s: string | null): ShareRound[] {
  if (!s) return [];
  return s.split(".").slice(0, 5).map((p) => {
    const [t, d] = p.split("-").map((x) => Number.parseInt(x, 10));
    return { total: clamp(t, 0, 3000), distance: clamp(d, 0, 31102) };
  }).filter((r) => Number.isFinite(r.total) && Number.isFinite(r.distance));
}
function clamp(n: number, lo: number, hi: number) { return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : NaN; }
function fmtDistance(d: number): string { return d === 0 ? "exact" : `${d} verse${d === 1 ? "" : "s"} off`; }
const h = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get("n") ?? "", 10);
  const rounds = parseScores(url.searchParams.get("s"));
  const total = rounds.reduce((a, r) => a + r.total, 0);
  const totalV = SEGMENTS.reduce((a, s) => a + s[1], 0);
  const ink = "#1c1916", paper = "#faf8f4", mut = "#7a7068";
  const bar = h("div", { display: "flex", height: 34, marginTop: 36 },
    SEGMENTS.map(([c, v]) => h("div", { width: `${(v / totalV) * 100}%`, height: 34, background: c })));
  const rows = rounds.length
    ? h("div", { display: "flex", gap: 24, marginTop: 44 }, rounds.map((r, i) =>
        h("div", { display: "flex", flexDirection: "column", flex: 1, border: "2px solid #e3ddd3", padding: "18px 22px" }, [
          h("div", { fontSize: 22, color: mut }, `Verse ${i + 1}`),
          h("div", { fontSize: 48, fontWeight: 700, color: ink }, String(r.total)),
          h("div", { fontSize: 24, color: r.distance === 0 ? "#3b793f" : mut }, fmtDistance(r.distance)),
        ])))
    : h("div", { fontSize: 34, color: mut, marginTop: 44 }, "Mark where the verse lives in Scripture.");
  const el = h("div", { display: "flex", flexDirection: "column", width: 1200, height: 630, boxSizing: "border-box", background: paper, padding: "64px 72px", fontFamily: "Serif" }, [
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "baseline" }, [
      h("div", { fontSize: 64, fontWeight: 700, color: ink }, "Versemark"),
      h("div", { fontSize: 34, color: mut }, Number.isFinite(n) ? `Daily #${n}` : "Daily"),
    ]),
    bar,
    h("div", { display: "flex", justifyContent: "space-between", fontSize: 18, color: mut, marginTop: 8, letterSpacing: 3 }, [h("div", {}, "GENESIS"), h("div", {}, "REVELATION")]),
    rows,
    h("div", { display: "flex", marginTop: "auto", justifyContent: "space-between", alignItems: "center" }, [
      h("div", { fontSize: 40, fontWeight: 700, color: "#b74b21" }, rounds.length ? `${total} pts` : ""),
      h("div", { fontSize: 28, color: ink, background: "#e3ddd3", padding: "10px 20px" }, rounds.length ? "Can you beat it? versemark.app" : "versemark.app"),
    ]),
  ]);
  const svg = await satori(el as never, { width: 1200, height: 630, fonts: await loadFonts() });
  const png = new Resvg(svg).render().asPng();
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400, immutable" } });
}
