import { resultHtml } from "../worker/share.js";

/** Vercel fallback for the Worker's /d/<n> route. */
export function GET(req: Request) {
  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get("n") ?? "", 10) || 0;
  return new Response(resultHtml(url.origin, n, url.searchParams.get("s") ?? ""), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
