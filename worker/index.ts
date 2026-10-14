import { ImageResponse } from "workers-og";
import { cardTree, parseScores, resultHtml } from "./share";
import { handleGroups } from "./groups";

type Env = { ASSETS: Fetcher; DB?: D1Database; GROUPS_ENABLED?: string };
let fonts: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }>> | null = null;
function loadFonts(env: Env) {
  // Source Serif 4 (OFL) ships as a static asset — no third-party fetch.
  fonts ??= Promise.all(([400, 700] as const).map(async (weight) => ({
    name: "Serif", weight, style: "normal" as const,
    data: await (await env.ASSETS.fetch(`https://assets.local/fonts/source-serif-4-${weight}.woff`)).arrayBuffer(),
  })));
  return fonts;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const g = await handleGroups(req, env, url);
    if (g) return g;
    const m = url.pathname.match(/^\/d\/(\d{1,5})\/?$/);
    if (m) {
      return new Response(resultHtml(url.origin, Number(m[1]), url.searchParams.get("s") ?? ""), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      });
    }
    if (url.pathname === "/api/og") {
      const cache = caches.default;
      const hit = await cache.match(req);
      if (hit) return hit;
      const n = Number.parseInt(url.searchParams.get("n") ?? "", 10);
      const res = new ImageResponse(cardTree(Number.isFinite(n) ? n : null, parseScores(url.searchParams.get("s"))) as never, {
        width: 1200, height: 630, fonts: await loadFonts(env),
        headers: { "cache-control": "public, max-age=86400, immutable" },
      } as never);
      ctx.waitUntil(cache.put(req, res.clone()));
      return res;
    }
    return env.ASSETS.fetch(req);
  },
};
