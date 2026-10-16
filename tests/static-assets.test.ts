import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FAVICON_ICO_FALLBACK,
  looksLikeStaticAsset,
  robotsTxtBody,
  serveStaticAsset,
} from "../worker/static";

describe("robots.txt", () => {
  it("ships a text robots file that allows crawlers", () => {
    const robots = readFileSync(resolve(process.cwd(), "public/robots.txt"), "utf8");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).not.toMatch(/Sitemap:/i);
  });

  it("omits Sitemap when none exists", () => {
    expect(robotsTxtBody()).toBe("User-agent: *\nAllow: /\n");
    expect(robotsTxtBody(null)).toBe("User-agent: *\nAllow: /\n");
  });

  it("adds a Sitemap line when a sitemap URL is provided", () => {
    expect(robotsTxtBody("https://versemark.app/sitemap.xml")).toBe(
      "User-agent: *\nAllow: /\nSitemap: https://versemark.app/sitemap.xml\n",
    );
  });
});

describe("looksLikeStaticAsset", () => {
  it("treats favicon, robots, and extension files as static", () => {
    expect(looksLikeStaticAsset("/favicon.ico")).toBe(true);
    expect(looksLikeStaticAsset("/robots.txt")).toBe(true);
    expect(looksLikeStaticAsset("/x.js")).toBe(true);
    expect(looksLikeStaticAsset("/assets/app.css")).toBe(true);
    expect(looksLikeStaticAsset("/manifest.webmanifest")).toBe(true);
  });

  it("does not treat SPA share routes as static assets", () => {
    expect(looksLikeStaticAsset("/d/42")).toBe(false);
    expect(looksLikeStaticAsset("/d/jhn.3.16")).toBe(false);
    expect(looksLikeStaticAsset("/i")).toBe(false);
    expect(looksLikeStaticAsset("/g")).toBe(false);
    expect(looksLikeStaticAsset("/api/og")).toBe(false);
  });
});

describe("serveStaticAsset", () => {
  it("serves the PNG favicon when /favicon.ico is missing", async () => {
    const fetch = vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname;
      if (path === "/favicon.ico") return new Response("missing", { status: 404 });
      if (path === FAVICON_ICO_FALLBACK) {
        return new Response("png-bytes", {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response("nope", { status: 404 });
    });
    const env = { ASSETS: { fetch } };
    const res = await serveStaticAsset(
      env,
      new Request("https://versemark.app/favicon.ico"),
      "/favicon.ico",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("png-bytes");
    expect(fetch).toHaveBeenCalled();
  });

  it("returns a plain 404 for missing static files like /x.js", async () => {
    const fetch = vi.fn(async () => new Response("spa-shell", {
      status: 404,
      headers: { "content-type": "text/html" },
    }));
    const env = { ASSETS: { fetch } };
    const res = await serveStaticAsset(
      env,
      new Request("https://versemark.app/x.js"),
      "/x.js",
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("Not Found");
  });

  it("passes through existing static files unchanged", async () => {
    const fetch = vi.fn(async () => new Response("ok-js", {
      status: 200,
      headers: { "content-type": "application/javascript" },
    }));
    const env = { ASSETS: { fetch } };
    const res = await serveStaticAsset(
      env,
      new Request("https://versemark.app/assets/index.js"),
      "/assets/index.js",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok-js");
  });
});
