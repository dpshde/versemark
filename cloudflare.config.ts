import { bindings, defineConfig } from "cf/config";

// Static Vite build served as Worker assets; the Worker only handles share links + OG cards.
export default defineConfig({
  accountId: "91ff2c2b757414041aeaa00896a8a43f",
  worker: {
    name: "versemark",
    compatibilityDate: "2026-09-01",
    entrypoint: "worker/index.ts",
    workersDev: true,
    // Prod custom domains (versemark.app zone Active on Cloudflare 2026-10-15). www 301s to apex in worker/index.ts.
    domains: ["versemark.app", "www.versemark.app"],
    observability: { enabled: true, logs: { enabled: true } },
    assets: { runWorkerFirst: ["/d/*", "/api/*", "/g", "/g/*", "/i", "/i/*"], notFoundHandling: "single-page-application" },
    env: {
      ASSETS: bindings.assets(),
      // Groups prototype (free-tier D1). Flip GROUPS_ENABLED to "0" to hide /g and /api/groups.
      DB: bindings.d1({ name: "versemark-groups" }),
      GROUPS_ENABLED: { type: "text", value: "1" },
    },
  },
});
