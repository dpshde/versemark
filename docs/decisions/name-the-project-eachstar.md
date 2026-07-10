# Name the project eachstar

- Status: superseded by [name-the-project-versemark.md](name-the-project-versemark.md)
- Date: 2026-07-10

## Context and Problem Statement

The working name "verse-drop" collides directly: versedrop.com is an existing Bible trivia game in the same niche. Shipping under a colliding name invites confusion and takedown friction. What is the project called?

## Decision Drivers

- Must be free of collisions in the Bible-app and games space (checked via web search 2026-07-10).
- Should carry the game's thesis, not just describe the mechanic.
- Dir/domain/store friendly: short, lowercase-safe, unambiguous when spoken.

## Considered Options

- eachstar ("Each Star")
- versefall
- starcanon
- keep verse-drop despite the collision

## Decision Outcome

Chosen option: **eachstar**, from the game's governing verse: "He determines the number of the stars; He calls them each by name" (Psalm 147:4). The player's core act, placing and naming a star on the celestial band, is the name. No collisions surfaced for "eachstar" / "Each Star" as an app or game.

- versefall: available, but implies falling verses (a Tetris-like mechanic the game does not have) and drops the thesis.
- starcanon: available and literal, but reads aloud as "star cannon," suggesting a shooter.
- Keeping verse-drop was rejected outright; versedrop.com is a live Bible game.

Title casing: **Each Star** in prose and UI; `eachstar` for the directory, package, and domains. Tagline candidate: "He calls them each by name."

### Consequences

- Good: name, thesis, and reveal ceremony (a star ignites when called by name) are one idea.
- Bad: "each star" is a common phrase in devotional content; search discoverability will lean on the tagline and "Each Star game." Acceptable.
- Before public launch: register the domain and itch.io slug; re-run a collision check including app stores.
- The share string is `Each Star #N` (seeding ADR updated).
