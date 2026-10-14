/** Shared parsing for /d/<n>?s=<encoded> share links (edge). */
export const SEGMENTS: Array<[string, number]> = [
  ["#6ec272", 5852], ["#e1755a", 7018], ["#bc88f4", 4785], ["#e36558", 5490],
  ["#ee7d8d", 4786], ["#00beaf", 2767], ["#e36558", 404],
];
export interface ShareRound { total: number; distance: number }
/** s = "980-12.720-40.310-150" → per-verse total-distance (spoiler-safe: no positions). */
export function parseScores(s: string | null): ShareRound[] {
  if (!s) return [];
  return s.split(".").slice(0, 5).map((p) => {
    const [t, d] = p.split("-").map((x) => Number.parseInt(x, 10));
    return { total: clamp(t, 0, 3000), distance: clamp(d, 0, 31102) };
  }).filter((r) => Number.isFinite(r.total) && Number.isFinite(r.distance));
}
function clamp(n: number, lo: number, hi: number) { return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : NaN; }
export function fmtDistance(d: number): string { return d === 0 ? "exact" : `${d} verse${d === 1 ? "" : "s"} off`; }
