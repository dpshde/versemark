/**
 * Non-OG Worker routing — kept free of workers-og so vitest can import it.
 */
import { mapHtml, parseMapShare, resultHtml } from "./share";
import { handleGroups } from "./groups";
import { looksLikeStaticAsset, serveSpaShell, serveStaticAsset, type AssetsEnv } from "./static";

export type RouterEnv = AssetsEnv & { DB?: D1Database; GROUPS_ENABLED?: string };

/**
 * Handle share / SPA / static routes. Returns null when the caller should
 * continue (e.g. /api/og needs ExecutionContext + ImageResponse).
 */
export async function routeApp(req: Request, env: RouterEnv): Promise<Response | null> {
  const url = new URL(req.url);
  // Canonical host: once www.versemark.app is attached, 301 it to the apex.
  if (url.hostname === "www.versemark.app") {
    url.hostname = "versemark.app";
    return Response.redirect(url.toString(), 301);
  }
  const g = await handleGroups(req, env, url);
  if (g) return g;
  // Parity with prod: any single /d/:segment, parseInt || 0 (e.g. /d/jhn.3.16 → #0).
  const m = url.pathname.match(/^\/d\/([^/]+)$/);
  if (m) {
    const n = Number.parseInt(decodeURIComponent(m[1]), 10) || 0;
    return new Response(resultHtml(url.origin, n, url.searchParams.get("s") ?? ""), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }
  if (url.pathname.startsWith("/d/")) {
    return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (url.pathname === "/i" || url.pathname === "/i/") {
    return new Response(mapHtml(url.origin, url.search, parseMapShare(url.searchParams)), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }
  if (url.pathname === "/api/og") {
    return null; // index.ts handles OG cards
  }
  if (looksLikeStaticAsset(url.pathname)) {
    return serveStaticAsset(env, req, url.pathname);
  }
  return serveSpaShell(env, req);
}
