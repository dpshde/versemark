import { defineConfig } from "void/config";

/**
 * SPIKE ONLY — throwaway Worker `versemark-void-spike`.
 * Prod Worker `versemark` / versemark.app stay on Workers Builds + `cloudflare.config.ts`.
 * Do not point this config at the prod Worker name.
 */
export default defineConfig({
  target: "cloudflare",
  inference: {
    // Existing Vite SPA: deploy built `dist/` with SPA fallback.
    // Share/OG Worker routes (`worker/`) are NOT on this path — see docs/VOID-SPIKE.md.
    appType: "spa",
    outputDir: "dist",
  },
  worker: {
    compatibility_date: "2026-09-01",
  },
  cloudflare: {
    name: "versemark-void-spike",
    account_id: "91ff2c2b757414041aeaa00896a8a43f",
    workers_dev: true,
    // Explicitly no custom domains — never attach versemark.app here.
  },
  routing: {
    notFound: "single-page-application",
  },
});
