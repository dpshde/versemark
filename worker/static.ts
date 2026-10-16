/**
 * Static-asset routing helpers (mirrors route.bible):
 * missing .js/.ico/etc. must 404 — never the SPA shell.
 */

/** Browsers still request /favicon.ico; dist ships PNG/SVG icons instead. */
export const FAVICON_ICO_FALLBACK = "/favicon-32.png";

const STATIC_EXACT = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sw.js",
]);

export function looksLikeStaticAsset(pathname: string): boolean {
  if (STATIC_EXACT.has(pathname)) return true;
  if (
    /\.(js|css|map|png|webp|svg|woff2?|ttf|json|webmanifest|txt|xml|ico|wasm)$/i.test(
      pathname,
    )
  ) {
    if (pathname.startsWith("/api/")) return false;
    return true;
  }
  return false;
}

export function robotsTxtBody(sitemapUrl?: string | null): string {
  const lines = ["User-agent: *", "Allow: /"];
  if (sitemapUrl) lines.push(`Sitemap: ${sitemapUrl}`);
  return `${lines.join("\n")}\n`;
}

/** Minimal ASSETS binding shape so this module typechecks without Workers globals. */
export type AssetsEnv = { ASSETS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };

export async function serveAsset(
  env: AssetsEnv,
  request: Request,
  pathname?: string,
): Promise<Response> {
  if (pathname) {
    const url = new URL(request.url);
    url.pathname = pathname;
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }
  return env.ASSETS.fetch(request);
}

/**
 * Serve a real static file, or 404 — never the SPA shell.
 * /favicon.ico falls back to the shipped PNG icon when no .ico exists.
 */
export async function serveStaticAsset(
  env: AssetsEnv,
  request: Request,
  pathname: string,
): Promise<Response> {
  if (pathname === "/favicon.ico") {
    const icon = await serveAsset(env, request, FAVICON_ICO_FALLBACK);
    if (icon.status !== 404) return icon;
  }

  const asset = await serveAsset(env, request);
  if (asset.status !== 404) return asset;

  return new Response("Not Found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
