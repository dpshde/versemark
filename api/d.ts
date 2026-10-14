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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** /d/<n>?s=… → unfurl-friendly HTML, then straight into today's daily (with score-to-beat if same day). */
export function GET(req: Request) {
  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get("n") ?? "", 10) || 0;
  const s = url.searchParams.get("s") ?? "";
  const rounds = parseScores(s);
  const total = rounds.reduce((a, r) => a + r.total, 0);
  const origin = url.origin;
  const img = `${origin}/api/og?n=${n}&s=${encodeURIComponent(s)}`;
  const title = rounds.length ? `Versemark #${n} · ${total} pts — can you beat it?` : `Versemark #${n}`;
  const desc = "Mark where the verse lives in Scripture. A new daily every day.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${desc}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Versemark">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(url.href)}"><meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${esc(img)}">
<style>body{background:#faf8f4;color:#1c1916;font-family:Georgia,serif;text-align:center;padding-top:30vh}</style></head>
<body><p>Opening today's Versemark…</p><noscript><a href="/">Play Versemark</a></noscript>
<script>(function(){var n=${n},t=${total};var e=new Date(2026,7,1),d=new Date();d=new Date(d.getFullYear(),d.getMonth(),d.getDate());
var today=Math.round((d-e)/864e5)+1;location.replace(n===today&&t>0?"/?daily="+n+"&beat="+t:"/?daily="+today);})();</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
