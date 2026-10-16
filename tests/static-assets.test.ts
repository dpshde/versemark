import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FAVICON_ICO_FALLBACK,
  hasFileExtension,
  looksLikeStaticAsset,
  robotsTxtBody,
  serveSpaShell,
  serveStaticAsset,
} from "../worker/static";
import { resultHtml } from "../worker/share";
import { routeApp } from "../worker/router";

const INDEX_HTML = `<!DOCTYPE html><html lang="en"><head><title>Versemark</title></head><body>app</body></html>`;

function mockAssets(files: Record<string, Response | (() => Response)>) {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ).pathname;
      const hit = files[path];
      if (!hit) return new Response("missing", { status: 404 });
      return typeof hit === "function" ? hit() : hit.clone();
    }),
  };
}

function must(res: Response | null): Response {
  expect(res).not.toBeNull();
  if (!res) throw new Error("expected response");
  return res;
}

describe("robots.txt", () => {
  it("ships a text robots file that allows crawlers", () => {
    const robots = readFileSync(resolve(process.cwd(), "public/robots.txt"), "utf8");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).not.toMatch(/Sitemap:/i);
  });

  it("omits Sitemap when none exists", () => {
    expect(robotsTxtBody()).toBe("User-agent: *\nAllow: /\n");
  });
});

describe("looksLikeStaticAsset / hasFileExtension", () => {
  it("treats favicon, robots, and extension files as static", () => {
    expect(looksLikeStaticAsset("/favicon.ico")).toBe(true);
    expect(looksLikeStaticAsset("/robots.txt")).toBe(true);
    expect(looksLikeStaticAsset("/x.js")).toBe(true);
    expect(looksLikeStaticAsset("/.env")).toBe(true);
    expect(looksLikeStaticAsset("/next.config.mjs")).toBe(true);
    expect(hasFileExtension("/assets/app.css")).toBe(true);
  });

  it("does not treat extensionless SPA paths as static", () => {
    expect(looksLikeStaticAsset("/")).toBe(false);
    expect(looksLikeStaticAsset("/i")).toBe(false);
    expect(looksLikeStaticAsset("/g")).toBe(false);
    expect(hasFileExtension("/")).toBe(false);
  });
});

describe("serveSpaShell", () => {
  it("serves / as 200 HTML from index.html", async () => {
    const assets = mockAssets({
      "/index.html": new Response(INDEX_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    });
    const res = await serveSpaShell({ ASSETS: assets }, new Request("https://versemark.app/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("Versemark");
  });

  it("serves /?daily=… as the same SPA shell", async () => {
    const assets = mockAssets({
      "/index.html": new Response(INDEX_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    });
    const res = await serveSpaShell(
      { ASSETS: assets },
      new Request("https://versemark.app/?daily=12"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<!DOCTYPE html>");
  });
});

describe("serveStaticAsset", () => {
  it("serves the PNG favicon when /favicon.ico is missing", async () => {
    const assets = mockAssets({
      [FAVICON_ICO_FALLBACK]: new Response("png-bytes", {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    });
    const res = await serveStaticAsset(
      { ASSETS: assets },
      new Request("https://versemark.app/favicon.ico"),
      "/favicon.ico",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("png-bytes");
  });

  it("returns a plain 404 for missing static files like /x.js", async () => {
    const assets = mockAssets({});
    const res = await serveStaticAsset(
      { ASSETS: assets },
      new Request("https://versemark.app/x.js"),
      "/x.js",
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("Not Found");
  });
});

describe("Worker routeApp", () => {
  it("GET / returns 200 HTML", async () => {
    const env = {
      ASSETS: mockAssets({
        "/index.html": new Response(INDEX_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      }),
    };
    const res = must(await routeApp(new Request("https://versemark.app/"), env as never));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("Versemark");
  });

  it("/d/jhn.3.16 renders share HTML that hands off to today's daily", async () => {
    const env = { ASSETS: mockAssets({}) };
    const res = must(await routeApp(new Request("https://versemark.app/d/jhn.3.16"), env as never));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Opening today's Versemark");
    expect(body).toContain("location.replace");
    expect(body).toContain("/?daily=");
    // parseInt("jhn.3.16") → NaN → 0 (parity with prod)
    expect(resultHtml("https://versemark.app", 0, "")).toContain("Opening today's Versemark");
  });

  it("/x.js returns 404, not the SPA shell", async () => {
    const env = { ASSETS: mockAssets({}) };
    const res = must(await routeApp(new Request("https://versemark.app/x.js"), env as never));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("Not Found");
  });

  it("/.env and /next.config.mjs return 404", async () => {
    const env = { ASSETS: mockAssets({}) };
    for (const path of ["/.env", "/next.config.mjs"]) {
      const res = must(await routeApp(new Request(`https://versemark.app${path}`), env as never));
      expect(res.status).toBe(404);
    }
  });
});
