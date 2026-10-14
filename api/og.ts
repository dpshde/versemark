import { ImageResponse } from "@vercel/og";
import { SEGMENTS, parseScores, fmtDistance } from "./_shared";
export const config = { runtime: "edge" };
const h = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });

export default function handler(req: Request) {
  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get("n") ?? "", 10);
  const rounds = parseScores(url.searchParams.get("s"));
  const total = rounds.reduce((a, r) => a + r.total, 0);
  const totalV = SEGMENTS.reduce((a, s) => a + s[1], 0);
  const ink = "#1c1916", paper = "#faf8f4", mut = "#7a7068";
  const bar = h("div", { display: "flex", width: "100%", height: 34, marginTop: 36 },
    SEGMENTS.map(([c, v]) => h("div", { width: `${(v / totalV) * 100}%`, height: 34, background: c })));
  const rows = rounds.length
    ? h("div", { display: "flex", gap: 24, marginTop: 44 }, rounds.map((r, i) =>
        h("div", { display: "flex", flexDirection: "column", flex: 1, border: "2px solid #e3ddd3", padding: "18px 22px" }, [
          h("div", { fontSize: 22, color: mut }, `Verse ${i + 1}`),
          h("div", { fontSize: 48, fontWeight: 700, color: ink }, String(r.total)),
          h("div", { fontSize: 24, color: r.distance === 0 ? "#3b793f" : mut }, fmtDistance(r.distance)),
        ])))
    : h("div", { fontSize: 34, color: mut, marginTop: 44 }, "Mark where the verse lives in Scripture.");
  const el = h("div", { display: "flex", flexDirection: "column", width: "100%", height: "100%", background: paper, padding: "64px 72px", fontFamily: "serif" }, [
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
  return new ImageResponse(el as never, { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400, immutable" } });
}
