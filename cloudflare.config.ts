import { bindings, defineConfig } from "cf/config";

// Static Vite build served as Worker assets; the Worker only handles share links + OG cards.
export default defineConfig({
  accountId: "91ff2c2b757414041aeaa00896a8a43f",
  worker: {
    name: "versemark",
    compatibilityDate: "2026-09-01",
    entrypoint: "worker/index.ts",
    workersDev: true,
    observability: { enabled: true, logs: { enabled: true } },
    assets: { runWorkerFirst: ["/d/*", "/api/*"], notFoundHandling: "single-page-application" },
    env: { ASSETS: bindings.assets() },
  },
});
