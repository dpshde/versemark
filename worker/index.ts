import { ImageResponse } from "workers-og";
import { cardTree, mapCardTree, parseMapShare, parseScores } from "./share";
import { routeApp } from "./router";
import type { RouterEnv } from "./router";

const CARD_VERSION = 5;
type Env = RouterEnv;
let fonts: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }>> | null = null;
function loadFonts(env: Env) {
  // Source Serif 4 (OFL) ships as a static asset — no third-party fetch.
  fonts ??= Promise.all(([400, 700] as const).map(async (weight) => ({
    name: "Serif", weight, style: "normal" as const,
    data: await (await env.ASSETS.fetch(`https://assets.local/fonts/source-serif-4-${weight}.woff`)).arrayBuffer(),
  })));
  return fonts;
}

/** vercel.json global headers; public/_headers only covers static assets, so Worker responses get them here. */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};
function withSecurityHeaders(res: Response): Response {
  if (Object.keys(SECURITY_HEADERS).every((k) => res.headers.has(k))) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withSecurityHeaders(await route(req, env, ctx));
  },
};

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const early = await routeApp(req, env);
  if (early) return early;

  const url = new URL(req.url);
  if (url.pathname === "/api/og") {
    const cache = caches.default;
    // Card version in the cache key so a redeploy never serves a stale design.
    const key = new Request(`${url.origin}${url.pathname}${url.search}${url.search ? "&" : "?"}_cv=${CARD_VERSION}`);
    // The Cache API is a no-op on *.workers.dev, so every card renders cold there (~0.5-1s CPU).
    // On the versemark.app custom domain this cache serves repeats from the edge.
    const hit = await cache.match(key);
    if (hit) return hit;
    const n = Number.parseInt(url.searchParams.get("n") ?? "", 10);
    const tree = url.searchParams.get("kind") === "map"
      ? mapCardTree(parseMapShare(url.searchParams))
      : cardTree(Number.isFinite(n) ? n : null, parseScores(url.searchParams.get("s")));
    const res = new ImageResponse(tree as never, {
      width: 1200, height: 630, fonts: await loadFonts(env),
      headers: { "cache-control": "public, max-age=86400, immutable" },
    } as never);
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
  // Should be unreachable — routeApp covers SPA + static.
  return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}
