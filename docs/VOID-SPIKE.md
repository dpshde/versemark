# Void spike (Versemark) — go / no-go

**Status:** spike branch only — **do not merge**.  
**Throwaway Worker:** `versemark-void-spike` (workers.dev only).  
**Prod:** Worker `versemark` + `versemark.app` stay on **Workers Builds** + `cf` / `cloudflare.config.ts`. Do not delete the spike Worker afterward (Relay cleanup later).

Spike date: 2026-10-15. Void package: `void@1.1.11`. Blog: [Deploy with Void](https://blog.cloudflare.com/deploy-with-void/).

---

## Recommendation: **NO-GO for prod cutover** (spike useful)

Keep **Workers Builds + `cf` OAuth** as the production path. Treat Void as optional future tooling only if Versemark wants Void-native routes/auth/DB provisioning — not as a drop-in replace for the current Worker+assets deploy.

| Criterion | Verdict |
| --- | --- |
| Coexist with Workers Builds on `main` | **Yes** (gated; see below) |
| Honor no-API-token / `cf` OAuth for interactive deploy | **Yes locally**; **CI still wants `CLOUDFLARE_API_TOKEN`** |
| Preserve share/OG/groups Worker without rewrite | **No** on Void SPA path |
| Bundle / perf win vs current | **Client: flat**; **Worker: Void SPA is lighter only because it drops OG/wasm** |
| Lock-in / platform cost | **High** (Vite 8 + Node ≥24.21 + Void conventions) |

---

## What we changed (diff size / files)

### Spike-commit surface (intentional)

| File | Role |
| --- | --- |
| `void.config.ts` | **New.** Targets Worker name `versemark-void-spike` only; SPA `dist/` |
| `vite.config.ts` | `voidPlugin()` behind `VOID_BUILD` (mutually exclusive with `CF_BUILD`) |
| `package.json` | `void`, Vite **6→8**, scripts `dev:void` / `deploy:void`, engines note |
| `package-lock.json` | Large (Void + Vite 8 tree; Void alone ~42 MB under `node_modules/void`) |
| `.gitignore` | Ignore `.void/`, `.void-wrangler.jsonc` |
| `docs/VOID-SPIKE.md` | This report |

**Rough LOC (hand-authored, excluding lockfile):** ~80–100 lines across config/scripts/docs wiring.

**Not touched (on purpose):** `cloudflare.config.ts` still names Worker **`versemark`** with custom domains — Workers Builds path unchanged.

### What a *full* Void parity port would add

Existing Worker surface (`worker/*.ts`): **~313 LOC** (share cards, OG via `workers-og` + resvg/yoga wasm, groups D1). Void SPA deploy does **not** include this. Full parity would mean rewriting those routes into Void `routes/` (or a custom Void worker entry) and re-binding D1 — estimate **hundreds of LOC + wasm bundle policy**, not a config flip.

---

## Coexistence: Workers Builds + no-API-token / `cf` OAuth

### Workers Builds / `cf` path

| Path | How |
| --- | --- |
| Prod / Builds | `CF_BUILD=1` → `@cloudflare/vite-plugin` + `cloudflare.config.ts` + `mise run deploy` / Workers Builds |
| Void spike | `void.config.ts` + `npm run deploy:void` → Worker **`versemark-void-spike` only** |
| Local Void DX | `VOID_BUILD=1 vite` → `voidPlugin()` (does **not** run when `CF_BUILD` is set) |

So Void can sit on a spike branch (or behind flags) **without** forcing `main` off Workers Builds.

### Auth / API token rule

| Context | Void behavior | vs Versemark preference |
| --- | --- | --- |
| Interactive `void deploy` / `void cloudflare login` | Browser **OAuth** (Void CLI built on **`cf`**) | **Compatible** with no-API-token / `cf` OAuth |
| This cloud agent | Used `cf auth login --no-browser --device` (same OAuth grant) | Preferred path; no token required if approved |
| CI / GitHub Actions (`void init --github`) | Docs require **`CLOUDFLARE_API_TOKEN`** (+ account id when multi-account) | **Breaks** a strict no-API-token CI rule — same class of requirement as `cf` in CI |

**Documented gap:** Void does **not** remove the need for an API token in unattended CI. Interactive deploys can stay OAuth-only; automating Void the way Workers Builds does today would still need a token (or stay on Workers Builds).

---

## Bundle size + perf vs current

Measured on this spike machine (Node 24.22 / Vite 8.3.4). Client assets are the same hashed bundle either way.

| Artifact | Current (`CF_BUILD=1` / `cf build`) | Void SPA (`void deploy --dir dist --spa`) | Void `VOID_BUILD=1` vite |
| --- | --- | --- | --- |
| Client JS | ~216 KB (~66 KB gzip) | same | same (`dist/client`) |
| Client CSS | ~46 KB (~8.6 KB gzip) | same | same |
| Worker JS | **~536 KB** (~151 KB gzip) | Void-generated thin SPA worker (not our `worker/`) | **~104 KB** (~29 KB gzip) Void SSR shell |
| Worker wasm | **resvg ~1.37 MB** + yoga ~89 KB (OG) | none | none |
| Build output tree | `.cloudflare/output/…` ~11 MB | `dist/` ~7.2 MB (assets + PWA + data) | `dist/client` + `dist/ssr` |

**Perf read:** Client runtime is unchanged. Void looks “lighter” on the Worker only because the spike SPA path **omits** share/OG/groups (and their wasm). Restoring OG parity brings the heavy Worker back (or equivalent) — no free lunch.

**Runtime checks on spike URL (fill after deploy):** TTFB for `/`, `/d/1`, `/api/og` — expect `/` OK; `/d/*` and `/api/og` **not** equivalent to prod until Worker ported.

---

## Local `void` / `vite` / `cf` DX

| Command | Result on spike |
| --- | --- |
| `npm run dev` | Unchanged static Vite app |
| `npm run cf:dev` / `CF_BUILD=1` | Existing Worker+assets Miniflare path (needs Node ≥22.18 for `cloudflare.config.ts` load) |
| `npm run dev:void` (`VOID_BUILD=1`) | `voidPlugin()` dual build (`void_worker` + client); works, but **does not** load `worker/index.ts` |
| `npm run build` | Vite 8 OK; tests **199/199** pass |
| `npm run deploy:void` | `build` then `void deploy --platform cloudflare --dir dist --spa --skip-build` → **spike Worker only** |
| `void` engines | Declares **Node ≥24.21.0** (EBADENGINE on Node 22) |
| Peer | **`vite@^8`** (forced Vite 6→8 on this branch) |

Friction: Node 24 + Vite 8 upgrade tax; Void’s nested `cf@1.0.0-beta.17` vs project `cf@1.0.0-beta.13`; generated `.void-wrangler.jsonc` must stay out of git / never retarget prod name.

---

## Lock-in risks

1. **Toolchain floor:** Void → Vite 8 + Node 24.21+; Versemark today is Vite 6 / Node 22-friendly for Builds.
2. **Routing model:** Value of Void is file-based `routes/` / `void/db` / provisioning — not a thin wrapper over an existing custom Worker. Share/OG stay “outside” Void unless rewritten.
3. **Config duality:** `cloudflare.config.ts` (cf) + `void.config.ts` (Void) — two sources of Worker name/bindings; mis-edit risk of pointing Void at prod name.
4. **CI token:** Void GitHub workflow path documents `CLOUDFLARE_API_TOKEN` — conflicts with a hard no-token policy unless Builds remains the only CI deploy.
5. **Young stack:** Open-sourced 2026-10-15; Platform/SDK/CLI still moving; pinning `void` + lockfile discipline required.
6. **Dependency weight:** `void` pulls a large tree (~42 MB package dir) vs current lean `cf` + vite-plugin.

---

## Preview / branch / PR

| Item | Value |
| --- | --- |
| Branch | `spike/void` |
| Preview Worker | `versemark-void-spike` |
| Preview URL | `https://versemark-void-spike.<account-subdomain>.workers.dev` — **set after successful `void deploy`** (see deploy log / `void project status`) |
| PR | Draft PR from `spike/void` → `main` (do not merge) |

### Deploy commands (after OAuth)

```bash
# Node ≥24.21 for void CLI
npm run build
npx void deploy --platform cloudflare --dir dist --spa --skip-build
# Confirm name in void.config.ts is still versemark-void-spike before running
```

Auth: `cf auth login` or `void cloudflare login` (OAuth). Avoid `CLOUDFLARE_API_TOKEN` unless documenting an intentional break of the no-API-token rule.

---

## Go / no-go summary

- **GO (spike / learning):** Keep `spike/void` + throwaway Worker for Dylan/Prime to poke SPA-via-Void and compare DX; leave Worker up for Relay cleanup later.
- **NO-GO (replace Workers Builds):** Do not cut prod to Void. Costs (Vite 8, Node 24, Worker rewrite, CI token, dual config) outweigh benefits for a static SPA + small custom Worker already shipping on Builds + `cf` OAuth.

Revisit only if Versemark deliberately adopts Void-native APIs/DB/auth or Void gains a first-class “bring your own Worker entry” story that preserves `worker/` without a rewrite.
