# Name the project Versemark

- Status: accepted
- Date: 2026-07-10
- Supersedes: [name-the-project-eachstar.md](name-the-project-eachstar.md)

## Context and Problem Statement

The product shipped under working name **Canonmark**, which fails orally (misheard as *cannon*) and is flatly descriptive. An interim ADR chose **Each Star** / `eachstar` (Psalm 147:4), but product UI and package still said Canonmark, and domain/brand work preferred a clearer, more ownable product name. What is the public product called?

## Decision Drivers

- No cannon / Mark-gospel / verse-drop collisions when *spoken and written carefully*
- Clarity for a place-the-marker Scripture game
- Domain ownability (`.app` / `.game` / get-prefix viable; `.com` not required at launch)
- One-word title casing in UI; lowercase slug for package and seed
- Quiet literary brand still fits (not gamification kitsch)

## Considered Options

- Versemark (chosen)
- Imprint (strong thesis; poor domain availability)
- Mindmark (mental-map compound; middling domains)
- Daymark (daily + nav; habit-app noise)
- Each Star / eachstar (prior ADR; common phrase, weaker store clarity)
- Canonmark (rejected: cannon homophone)
- Waymark (rejected: live Bible app at getwaymark.app)

## Decision Outcome

Chosen option: **Versemark**.

- Title: **Versemark** (one word, never “Verse Mark” in UI — reduces Gospel-of-Mark misparse)
- Package / seed / storage: `versemark`, seed `` `versemark#${N}` ``, localStorage key `versemark:v2`
- Share: `Versemark #N`
- Canonical URL: **`https://versemark.app`** (share strings, PWA host; claim at registrar)
- Tagline: *Mark where the verse lives.*

### Consequences

- Good: clear mechanic signal; strong domain surface vs Imprint/Daymark crowding
- Good: daily seed and share strings aligned under one brand
- Bad: descriptive compound sits near other “verse + …” Bible products; positioning must lead with *map / timeline / familiarity*, not trivia
- Bad: spoken “verse Mark” can still surface the Gospel of Mark; mitigated by one-word wordmark
- Bad: changing seed prefix from `canonmark#` / `eachstar#` **reshuffles** daily pool order vs any earlier playtests (acceptable pre-launch)
- Storage key change clears prior local streaks/results under old keys
- Repo folder may remain `eachstar` until a separate rename; product-facing brand is Versemark
