/**
 * Static-asset + SPA shell helpers (mirrors route.bible):
 * missing files with an extension must 404 — never the SPA shell.
 * Extensionless app paths get index.html.
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

/** Final path segment looks like a filename (x.js, .env, next.config.mjs). */
export function hasFileExtension(pathname: string): boolean {
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  if (!last) return false;
  // Dotfiles: .env, .gitignore
  if (last.startsWith(".") && last.length > 1) return true;
  // name.ext (ignore leading-only dots already handled)
  const dot = last.lastIndexOf(".");
  return dot > 0 && dot < last.length - 1;
}

export function looksLikeStaticAsset(pathname: string): boolean {
  if (STATIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/")) return false;
  // Any file-like path (extension or dotfile) — never SPA-fallback these.
  if (hasFileExtension(pathname)) return true;
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

/**
 * Serve the SPA shell under the request URL (/, /?daily=…).
 * Fetch /index.html and follow assets html_handling redirects internally
 * so the browser keeps the original path (never a visible 307 → /).
 */
export async function serveSpaShell(env: AssetsEnv, request: Request): Promise<Response> {
  let response = await serveAsset(env, request, "/index.html");
  for (let hop = 0; hop < 3 && response.status >= 300 && response.status < 400; hop++) {
    const location = response.headers.get("Location");
    if (!location) break;
    const next = new URL(location, request.url);
    response = await env.ASSETS.fetch(new Request(next.toString(), { method: "GET" }));
  }
  if (!response.ok) {
    return new Response("Versemark shell unavailable", { status: 502 });
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  // Ensure HTML content-type even if the asset binding omits it.
  if (!headers.get("content-type")?.includes("html")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return new Response(response.body, { status: 200, headers });
}
