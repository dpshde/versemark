import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";
import { cardTree, mapCardTree, parseMapShare, parseScores } from "../worker/share.js";

/** Vercel fallback for the Worker's /api/og (same card trees as worker/share.ts). */
let fonts: Promise<Array<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" }>> | null = null;
function loadFonts() {
  fonts ??= Promise.all(([400, 700] as const).map(async (weight) => ({
    name: "Serif", weight, style: "normal" as const,
    data: await readFile(new URL(`./fonts/source-serif-4-${weight}.woff`, import.meta.url)),
  })));
  return fonts;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get("n") ?? "", 10);
  const tree = url.searchParams.get("kind") === "map"
    ? mapCardTree(parseMapShare(url.searchParams))
    : cardTree(Number.isFinite(n) ? n : null, parseScores(url.searchParams.get("s")));
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: await loadFonts() });
  const png = new Resvg(svg).render().asPng();
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
}
