# Monorepo layout (Expo-first)

Versemark is an **npm workspaces** monorepo. Mobile (Expo / React Native) is the primary native client; web remains a Vite static PWA shell.

## Packages

| Path | Name | Role |
| --- | --- | --- |
| `packages/core` | `@versemark/core` | Platform-neutral domain: scoring, daily seed, game flow, achievements, mastery, books/axis, durable state + `KvStore` port |
| `apps/mobile` | `@versemark/mobile` | Expo app (React Native) |
| `apps/web` | `@versemark/web` | Vite + Canvas timeline + DOM chrome (legacy web surface) |

## What is shared

**Shared:** pure TypeScript domain and types. Both apps import `@versemark/core`.

**Not shared (by design):**

- Canvas `CanonStrip` timeline (web-only; native strip later)
- Haptics / sounds / PWA install (`apps/web`)
- Theme preference UI + CSS tokens (web) vs RN `StyleSheet` (mobile)
- Achievements deck DOM UI (`apps/web/src/ui`)
- Share **delivery** (navigator / Share API); share **text** builders are in core

## Storage boundary

Core never calls `localStorage` or AsyncStorage. Apps inject a `KvStore`:

```ts
import { setStorageBackend, createMemoryKvStore } from "@versemark/core";
// web: createLocalStorageKvStore() from apps/web/src/lib/storage-web.ts
// mobile: memory now; AsyncStorage hydrate later
setStorageBackend(adapter);
```

## Scripts (repo root)

Prefer **pnpm** (`pnpm-workspace.yaml` + `packageManager` field). Root scripts use `pnpm --filter`.

```bash
pnpm install
pnpm run mobile          # expo start
pnpm run web             # vite dev
pnpm test                # core + web platform tests
pnpm run typecheck       # core + web + mobile
pnpm run build           # web production static
pnpm run export:mobile   # expo export (when toolchain available)
```

`.npmrc` sets `node-linker=hoisted` so Expo/Metro resolve React Native deps reliably.

## Product note

Earlier ADRs described a web-only static app. Mobile delivery is now first-class via Expo; web stays for PWA / itch-style static hosting. Game rules are unchanged.
