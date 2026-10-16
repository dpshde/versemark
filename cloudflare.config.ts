import { bindings, defineConfig } from "cf/config";

// Preview uploads reject `domains` — only attach custom domains on production (main) / local deploy.
const isPreviewCi =
  process.env.WORKERS_CI === "1" &&
  Boolean(process.env.WORKERS_CI_BRANCH) &&
  process.env.WORKERS_CI_BRANCH !== "main";

// Static Vite build served as Worker assets; the Worker only handles share links + OG cards.
export default defineConfig({
  accountId: "91ff2c2b757414041aeaa00896a8a43f",
  worker: {
    name: "versemark",
    compatibilityDate: "2026-09-01",
    entrypoint: "worker/index.ts",
    workersDev: true,
    // Custom domains attached at CF cutover (2026-10-15). Keep so Workers Builds redeploys preserve them.
    ...(isPreviewCi ? {} : { domains: ["versemark.app", "www.versemark.app"] }),
    observability: { enabled: true, logs: { enabled: true } },
    assets: {
      // Worker owns app + share routes so / always gets index.html (html_handling alone is not enough
      // when not_found_handling is none). Missing extensioned files still 404 via the Worker.
      runWorkerFirst: [
        "/",
        "/d/*",
        "/api/*",
        "/g",
        "/g/*",
        "/i",
        "/i/*",
        "/favicon.ico",
        "/robots.txt",
      ],
      notFoundHandling: "none",
      // So ASSETS.fetch("/index.html") and bare "/" resolve correctly when the binding is used.
      htmlHandling: "auto-trailing-slash",
    },
    env: {
      ASSETS: bindings.assets(),
      // Groups prototype (free-tier D1). Flip GROUPS_ENABLED to "0" to hide /g and /api/groups.
      DB: bindings.d1({ name: "versemark-groups" }),
      GROUPS_ENABLED: { type: "text", value: "1" },
    },
  },
});
