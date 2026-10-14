/** Spoiler-safe daily result links: /d/<n>?s=<total>-<distance>.… (scores + verse distance only). */
export const SEGMENTS: Array<[string, number]> = [
  ["#6ec272", 5852], ["#e1755a", 7018], ["#bc88f4", 4785], ["#e36558", 5490],
  ["#ee7d8d", 4786], ["#00beaf", 2767], ["#e36558", 404],
];
export interface ShareRound { total: number; distance: number }

export function parseScores(s: string | null): ShareRound[] {
  if (!s) return [];
  return s.split(".").slice(0, 5).map((p) => {
    const [t, d] = p.split("-").map((x) => Number.parseInt(x, 10));
    return { total: clamp(t, 0, 3000), distance: clamp(d, 0, 31102) };
  }).filter((r) => Number.isFinite(r.total) && Number.isFinite(r.distance));
}
const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : NaN);
export const fmtDistance = (d: number) => (d === 0 ? "exact" : `${d} verse${d === 1 ? "" : "s"} off`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Node = { type: string; props: { style: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({ type, props: { style, children } });

/** Satori element tree for the 1200×630 card (no rounds = default site card). */
export function cardTree(n: number | null, rounds: ShareRound[], label?: string): Node {
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
    : h("div", { fontSize: 34, color: mut, marginTop: 44 }, label ?? "Mark where the verse lives in Scripture.");
  return h("div", { display: "flex", flexDirection: "column", width: 1200, height: 630, boxSizing: "border-box", background: paper, padding: "64px 72px", fontFamily: "Serif" }, [
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "baseline" }, [
      h("div", { fontSize: 64, fontWeight: 700, color: ink }, "Versemark"),
      h("div", { fontSize: 34, color: mut }, n != null && Number.isFinite(n) ? `Daily #${n}` : "Daily"),
    ]),
    bar,
    h("div", { display: "flex", justifyContent: "space-between", fontSize: 18, color: mut, marginTop: 8, letterSpacing: 3 }, [h("div", {}, "GENESIS"), h("div", {}, "REVELATION")]),
    rows,
    h("div", { display: "flex", marginTop: "auto", justifyContent: "space-between", alignItems: "center" }, [
      h("div", { fontSize: 40, fontWeight: 700, color: "#b74b21" }, rounds.length ? `${total} pts` : ""),
      h("div", { fontSize: 28, color: ink, background: "#e3ddd3", padding: "10px 20px" }, rounds.length ? "Can you beat it? versemark.app" : "versemark.app"),
    ]),
  ]);
}

/** Unfurl HTML for /d/<n>; JS sends the visitor into today's daily (score-to-beat if same day). */
export function resultHtml(origin: string, n: number, s: string): string {
  const rounds = parseScores(s);
  const total = rounds.reduce((a, r) => a + r.total, 0);
  const img = `${origin}/api/og?n=${n}&s=${encodeURIComponent(s)}`;
  const title = rounds.length ? `Versemark #${n} · ${total} pts — can you beat it?` : `Versemark #${n}`;
  const desc = "Mark where the verse lives in Scripture. A new daily every day.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${desc}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Versemark">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(`${origin}/d/${n}?s=${encodeURIComponent(s)}`)}"><meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${esc(img)}">
<style>body{background:#faf8f4;color:#1c1916;font-family:Georgia,serif;text-align:center;padding-top:30vh}</style></head>
<body><p>Opening today's Versemark…</p><noscript><a href="/">Play Versemark</a></noscript>
<script>(function(){var n=${n},t=${total};var e=new Date(2026,7,1),d=new Date();d=new Date(d.getFullYear(),d.getMonth(),d.getDate());
var today=Math.round((d-e)/864e5)+1;location.replace(n===today&&t>0?"/?daily="+n+"&beat="+t:"/?daily="+today);})();</script></body></html>`;
}
