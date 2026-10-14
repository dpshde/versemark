import { mapHtml, parseMapShare } from "../worker/share.js";

/** Vercel fallback for the Worker's /i (shared Bible map / milestone). */
export function GET(req: Request) {
  const url = new URL(req.url);
  return new Response(mapHtml(url.origin, url.search, parseMapShare(url.searchParams)), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
