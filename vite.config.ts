import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import { cloudflare } from "@cloudflare/vite-plugin";

const CF_BUILD = !!process.env.CF_BUILD;
/** Where cf's Build Output collects the client assets; the service worker must land beside them. */
const CF_ASSETS_DIR = ".cloudflare/output/v0/workers/default/assets";

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [
    // Cloudflare build (mise run deploy sets CF_BUILD): Worker for share links + OG cards.
    // Plain `vite build` (tests, Vercel fallback) stays a static site.
    ...(CF_BUILD ? [cloudflare() as never] : []),
    // Cast: vite-plugin-pwa targets root vite; vitest nests its own vite types.
    VitePWA({
      registerType: "autoUpdate",
      ...(CF_BUILD ? { outDir: CF_ASSETS_DIR } : {}),
      injectRegister: "auto",
      includeAssets: [
        "favicon.svg",
        "favicon-32.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
      ],
      // Hand-authored manifest in public/ — keep it as the source of truth.
      manifest: false,
      workbox: {
        // App shell + bundled assets + static data for offline daily play.
        globPatterns: [
          // webp: achievement drop caps under public/assets/achievements/
          "**/*.{js,css,html,ico,png,svg,webp,webmanifest,json,woff2}",
        ],
        navigateFallback: "index.html",
        // Share links + OG cards are Worker routes, never the app shell.
        navigateFallbackDenylist: [/^\/d\//, /^\/api\//, /^\/g(\/|$)/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: {
        enabled: false,
      },
    }) as never,
  ],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
