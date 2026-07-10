# Curate the verse pool from Exedra topic-verse rankings

- Status: accepted
- Date: 2026-07-10

## Context and Problem Statement

Daily puzzles (and default endless rounds) need a curated pool of verses. Uncurated random verses land on genealogies, census lists, and obscure legal minutiae, which frustrates rather than trains. Hand-curating hundreds of verses is slow. What is the pool source?

## Decision Drivers

- Pool should favor passages people actually encounter and search for; those are the ones worth having a mental map for.
- Curation must be a build-time artifact (backend-free).
- The maintainer already has `selah-tools/apps/exedra-search/data/topic-verse-rankings.browser.json`: 6,687 topics, each mapped to ranked canonical passages (`[["EXO.20.1-26", 7, 1], ...]` as OSIS ref, score, rank).

## Considered Options

- Derive pool from Exedra `topic-verse-rankings.browser.json`
- Hand-curated list
- Uncurated: any verse in the canon
- Popularity data from an external source (e.g. published "most searched verses" lists)

## Decision Outcome

Chosen option: **derive a ~1,000-verse pool from Exedra topic-verse rankings**, ranked by cross-reference depth and popularity, then diversified across the canon.

A build script (`scripts/build-data.mjs`):

1. Takes the union of all ranked passages across topics.
2. Parses each ref; normalizes ranges and whole-chapter refs to a representative verse (start verse, or the first verse in-range that has BSB text) while keeping the full range for the reveal screen.
3. Scores each passage by **topic count** (how many topics cite it — cross-reference / familiarity) then by ranking **weight** (score/rank sum).
4. Force-seeds a small **allowlist** of high-value refs (top cross-ref misses under book caps + classic familiarity anchors) when BSB text exists, bypassing diversity caps.
5. Greedily selects remaining slots up to **~1,000**, preferring multi-topic citations (topics ≥ 2), with per-book (≤40) and per-genre caps (law/history/poetry/prophets/gospels/epistles) and chapter diversity within books.
6. Assigns mild log-scaled sampling weights so mega-hits appear more often without locking the PRNG onto them.
7. Emits `pool.json` with canonical ref, weight, `topicCount`, and topic tags (tags can power a future themed mode).

This keeps zero manual curation for the bulk of the pool, and the pipeline reruns whenever Exedra's ETL improves. The allowlist in `scripts/build-data.mjs` (`POOL_ALLOWLIST`) is the hand override for cap collisions and classics that rankings under-serve.

### Consequences

- Good: pool quality inherits Exedra's ranking work; improvements flow in for free.
- Good: ~1,000 multi-topic verses is large enough for years of dailies under the 180-day no-repeat window without feeling repetitive, while staying far smaller than the full canon for the text bundle.
- Good: topic tags enable "familiarity by theme" later without new data work.
- Good: genre/book caps fix the earlier skew (e.g. missing Gospels/Psalms from bad BSB book-code aliases; epistle overweight from raw top-N by weight).
- Bad: build-time coupling to a selah-tools artifact; snapshot the input file (or its generated output) in this repo so builds are reproducible without the monorepo checked out.
- Bad: rankings still tilt toward felt-need topics; diversity caps mitigate but do not invent underrepresented genres if Exedra never ranks them.
- Bad: changing the pool shifts future daily selections; only do this pre-launch or with a versioned epoch (see [seed-daily-puzzle-from-date-hash.md](seed-daily-puzzle-from-date-hash.md)).
- Endless mode may additionally offer an "anywhere in the canon" toggle that bypasses the pool for hard-mode reps.
