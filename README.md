# Versemark

A "place the marker" Scripture familiarity game. A verse appears; you drop a pin on a canon timeline where you think it lives — all 66 books, 1,189 chapters rendered as a continuous rail. Score by distance, multiplied by how few hints you needed.

The goal is **familiarity**: building the mental map of where things live in Scripture, not trivia recall.

## Modes

- **Daily**: one puzzle per day, same for everyone, seeded from the date. Wordle-class pure-text share (`Versemark N score` + emoji grid; no URL/CTA).
- **Endless practice**: unlimited rounds for reps.

## Quick start

```bash
npm install
npm run build:data   # if regenerating pool/verses from monorepo sources
npm run dev          # http://127.0.0.1:5173
npm test
npm run build        # static dist/
```

Shipped data under `public/data/` (pool, BSB verse/paragraph text for pool entries, book axis metadata) is already committed so the app runs offline without `selah-tools` checked out.

## Architecture (summary)

| Area | Choice |
| --- | --- |
| Stack | Vite + TypeScript, static only |
| Board | Canvas 2D canon timeline; orientation transform (vertical portrait / horizontal wide) |
| UI | DOM cards, hints, score, share |
| Daily | Epoch `2026-08-01` local = #1; seed `"versemark#" + N` → xmur3 → mulberry32; weighted pool + 180 no-repeat window |
| Score | `round(1000 * 0.5^(d/40))` × hint multiplier (×3 / ×2 / ×1) |
| Text | Berean Standard Bible (public domain), pool snapshot from Exedra topic rankings |
| State | `localStorage` for daily results / streak |
| URL | `https://versemark.app` (site / optional deep links; default share body is link-free) |

## Production deploy

| Piece | Status |
| --- | --- |
| Domain | `versemark.app` on Porkbun (expires 2027-07-10) |
| DNS | Apex **A** → `216.198.79.1` (Vercel) |
| Host | Vercel project **`versemark`** → team **`dpshde`** (GitHub `dpshde/versemark`) |
| Config | `vercel.json` (Vite build → `dist`, cache headers) |
| App URL in code | `APP_URL` in `src/lib/share.ts` (not embedded in default share text) |

Ship latest `main` (or `vercel --prod` from a clean tree) so production HTML says **Versemark**, not the older Canonmark build.

```bash
npm test && npm run build
git push origin main   # triggers Vercel production if Git integration is on
# or: vercel --prod --scope dpshde
```

Decisions live in [`docs/decisions/`](docs/decisions/README.md). Art direction in [`docs/design/`](docs/design/README.md).

## Data rebuild

`npm run build:data` reads (when present):

- `../selah-tools/apps/exedra-search/data/topic-verse-rankings.browser.json`
- `../selah-tools/apps/exedra-search/data/bsb.browser.jsonl`
- `../grab-bcv/src/para-data.json`

and writes `public/data/{books,pool,verses,paragraphs}.json` plus `src/data/{books,pool}.json` for unit tests.

## Principles

- Mobile first: portrait touch play is the design origin (vertical timeline, thumb-scrolled); desktop adapts.
- No backend. Static site, all state in the client (localStorage).
- Bible text: Berean Standard Bible (public domain), bundled at build time.
- No image assets — everything is CSS and Canvas. Lean stack; expand only as needed.
