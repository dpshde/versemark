# @versemark/core

Platform-neutral Versemark domain: scoring, daily seed, game flow, achievements, mastery, books/axis, durable state shapes.

## Shared vs not shared

| Shared (this package) | Platform-only (apps) |
| --- | --- |
| Scoring, PRNG, daily selection | Canvas / native timeline strip |
| Books + axis math | DOM / React Native chrome |
| Mastery + achievements evaluation | Haptics, sounds, install/PWA |
| Storage **types** + pure mutations via `KvStore` port | `localStorage` / SQLite adapters |
| Share **text** builders | OS share sheet / clipboard delivery |
| Appearance scheme hook (`setColorScheme`) | Theme preference UI + CSS tokens |

## Storage port

```ts
import { setStorageBackend, createMemoryKvStore, loadState } from "@versemark/core";

// Tests / default
setStorageBackend(createMemoryKvStore());

// Web: inject localStorage adapter from apps/web
// Native: inject the synchronous expo-sqlite adapter after one-time migration
```

## Scripts

```bash
npm test -w @versemark/core
npm run typecheck -w @versemark/core
```
