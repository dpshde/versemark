# Versemark

A "place the marker" Scripture familiarity game. A verse appears; you drop a pin on a canon timeline where you think it lives — all 66 books, 1,189 chapters rendered as a continuous rail. Score by distance, multiplied by how few hints you needed.

The goal is **familiarity**: building the mental map of where things live in Scripture, not trivia recall.

## Monorepo (Expo-first)

| Package | Role |
| --- | --- |
| `@versemark/core` | Shared pure domain (scoring, daily, game, achievements, mastery, books/axis, state + storage port) |
| `@versemark/mobile` | **Primary mobile client** — Expo / React Native |
| `@versemark/web` | Vite static PWA + Canvas timeline (web shell) |

See [docs/monorepo.md](docs/monorepo.md) for the share boundary (what is shared vs platform-only).

## Modes

- **Daily**: one puzzle per day, same for everyone, seeded from the date. Wordle-class pure-text share.
- **Endless practice**: unlimited rounds for reps.

## Quick start

```bash
# Prefer pnpm (workspace-native). npm workspaces still work.
pnpm install

# Mobile (Expo)
pnpm run mobile

# Native simulator / emulator and RN Web preview
pnpm run ios:simulator
pnpm run android
pnpm run mobile:web

# Web (Vite)
pnpm run web

# Shared domain tests
pnpm run test:core
pnpm test                 # core + web platform tests
pnpm run test:mobile      # mobile unit + structural smoke tests
pnpm run test:all         # complete local test suite
pnpm run typecheck        # core + web + mobile
pnpm run build            # web production static → apps/web/dist
```

Shipped data under `apps/web/public/data/` and `packages/core/src/data/` is committed so the app runs offline without external monorepo tools.

## Architecture (summary)

| Area | Choice |
| --- | --- |
| Layout | npm workspaces monorepo |
| Domain | `@versemark/core` — no DOM / Canvas / localStorage |
| Mobile | Expo + React Native; transactional SQLite snapshot, immutable events, and sync outbox |
| Web | Vite + TypeScript, Canvas 2D timeline, localStorage adapter |
| Daily | Epoch `2026-08-01` local = #1; seed `"versemark#" + N` |
| Score | distance × hint multiplier (see core `scoring.ts`) |
| State | Schema-versioned snapshot plus durable counters/rollups; platform injects persistence |

## Production deploy (web)

Vercel builds `@versemark/web` (`vercel.json` → `apps/web/dist`).

See [docs/ci-cd.md](docs/ci-cd.md) for the required CI gate, Vercel preview/production flow, rollback procedure, and the ASC-based React Native iOS release runbook.

For simulator, physical iOS/Android, tablet, accessibility, performance, and release-device QA, use [docs/mobile-device-testing.md](docs/mobile-device-testing.md).
