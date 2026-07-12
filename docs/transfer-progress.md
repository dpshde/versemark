# Transfer progress plan

This plan describes how a player moves their progress to another device via a link, a QR code, or a paste-able transfer code — with no backend. Status: planned, not yet implemented.

## Constraints

- **No backend.** A stated principle ([decision](decisions/build-backend-free-static-app.md)). There is no paste service, account, or short-code lookup: the token must *be* the data.
- **Full state is too big for URL/QR.** `AppState` holds `history` and `practiceLog` capped at `LOG_CAP` (2,000) records each — potentially ~300 KB of JSON. A QR code tops out at ~2.9 KB.
- **The codebase already has the shrink mechanism.** `storage.ts` folds evicted log rounds into `rollups`, which are never trimmed. The transfer format does the same fold aggressively: drop detailed logs, keep rollups + counters. Per the [achievement durability rule](achievements.md), unlocks evaluate from durable sources (lifetime counters, bests, coverage sets, rollups, unlock map), never from the capped logs — so the fold loses nothing that achievements or mastery need.

## Design: one payload, three transports

### The payload — a compact versioned envelope

New module `src/lib/transfer.ts`:

1. **Prune.** Take `AppState`, fold `history`/`practiceLog` into `rollups` (reuse the eviction-fold logic from `storage.ts`; extract it if private). Keep only:
   - streaks and bests (`streak`, `bestStreak`, `practiceStreak`, `bestPracticeStreak`, `exactStreak`, `bestExactStreak`)
   - `lifetime` counters
   - `rollups`
   - `achievementUnlocks` (+ `achievementsSeenAt`)
   - `lastCompletedDailyDateKey`, `firstActivityAt`, `lastActivityAt`
   - the last ~30 daily results, so the recent calendar and streak context survive
   - coverage as **bitmaps**, not arrays: `touchedChapters` (1,189 chapters = 149 bytes), `touchedBooks` (66 books = 9 bytes), `touchedVerses` (bitmap over the pool index)
2. **Encode.** `{ v: 1, at, crc, state }` → JSON → deflate via native `CompressionStream` → base64url. Estimated final size: **~1–2.5 KB**.
3. **Decode.** Reverse the pipeline, verify version and CRC, then run the result through the same normalization path as `parseStoredState` so a malformed or old token can never corrupt local state.

### Transports (same token everywhere)

- **URL**: `https://versemark.app/#restore=<token>`. Fragment, not query — it never reaches server logs, works on a static host, and browsers handle multi-KB fragments. On boot, `main.ts` detects `#restore=`, shows the confirm dialog, imports, then scrubs the fragment with `history.replaceState`.
- **QR**: render the restore URL as a QR client-side (error correction L). Only offer the QR when the token is under ~1.5 KB; otherwise fall back to link/code. Use a tiny zero-dependency generator (`uqr`) to honor the lean-stack principle.
- **Transfer code**: the raw base64url token as copyable text, with a paste box on the receiving side. The universal fallback (message to self, cross-device clipboard, desktop→phone).
- **Full backup** (phase 2): download/upload the *unpruned* state as a `.json` file for complete round-level fidelity.

```diagram
╭──────────────╮  prune+fold   ╭──────────╮  deflate+b64url  ╭─────────╮
│  AppState    │──────────────▶│ envelope │─────────────────▶│  token  │
│ (localStorage│               │ v·crc·   │                  ╰────┬────╯
│  versemark:v3│               │ state    │            ╭──────────┼──────────╮
╰──────────────╯               ╰──────────╯            ▼          ▼          ▼
                                                  #restore=…   QR code   copy/paste
                                                       ╰──────────┴──────────╯
                                                    confirm → normalize → replace
```

### Import semantics

**Replace-with-confirmation, not merge.** Merging two divergent play histories correctly (double-counted lifetime counters, conflicting streaks) is hard to get right; the v1 behavior is an explicit, previewed replace. A later phase may add a safe partial merge for union-able pieces only: coverage bitmaps (OR), achievement unlocks (earliest date wins), best-streak maxima.

## UX

### Where it lives

A single row — **"Move to another device"** — in the stats/achievements panel. No new nav, no badge, no prompting. Tapping it opens one sheet with two halves, **Send** and **Receive** — the same screen on both devices, so the mental model is "open the same place on both phones."

### Sending (old device)

The sheet opens on Send, showing a one-line summary of what travels ("87 dailies · streak 21 · 14 achievements") so the user trusts the token before sharing it. Three buttons, in priority order:

1. **Share link** — native share sheet (`navigator.share`, same path as the daily share). AirDrop/message to yourself; done in two taps.
2. **Show code** — full-screen QR of the restore link. Two phones on a table: camera apps open URLs natively, so scanning *is* importing.
3. **Copy code** — copies the raw token for the paste fallback.

No expiry, no account, no spinner — token generation is synchronous and local.

### Receiving (new device)

Two entry paths converge on the same confirm dialog:

- **Link/QR**: opening `versemark.app/#restore=…` boots straight into the confirm dialog. The link *is* the import.
- **Paste**: the Receive half of the sheet is a paste box with an **Import** button. Malformed token → inline "This code doesn't look right — copy it again from your other device," local state untouched.

### The confirm dialog

The only decision point, so it does the honest work — a side-by-side of local versus incoming:

```diagram
╭──────────────────────────────────╮
│  Restore progress?               │
│                                  │
│  This device      Incoming      │
│  3 dailies        87 dailies    │
│  streak 1         streak 21     │
│  2 achievements   14 achieve…   │
│                                  │
│  Replacing can't be undone.      │
│                                  │
│  [ Keep this device ] [Restore]  │
╰──────────────────────────────────╯
```

Special cases:

- **Fresh device** (the common case): skip the comparison; a single "Restore 87 dailies and streak 21? → Restore." One tap.
- **Downgrade guard**: if the local side is clearly larger than the incoming token, flip the framing — "This device has more progress than the code you scanned" — and make *Keep* the primary button. Protects against scanning your own stale QR.

After restore: dialog closes, fragment scrubbed, home screen renders with the restored streak and stats. A quiet "Progress restored" line — calm over juice, no celebration.

### What the user never sees

No accounts, no sign-in, no syncing states, no expiring links, no server errors. The only failure modes are "bad paste" and "chose not to restore," both recoverable by redoing a two-tap flow on the old device.

**Tradeoff, stated plainly: this is transfer, not sync.** Playing on both devices afterward diverges the states, and a later transfer replaces one side. The comparison dialog keeps that honest; live sync would require the backend the project deliberately does not have.

## Files touched

- `src/lib/transfer.ts` (new): prune/fold, bitmap packing, encode/decode, CRC, size guard.
- `src/lib/storage.ts`: export the rollup-fold helper; add an `importState()` that routes through the normalization path.
- `src/main.ts`: `#restore=` boot handler; "Move to another device" sheet (Send: share link / show QR / copy code; Receive: paste box) reached from the stats/achievements panel.
- Tests: encode/decode round-trip, CRC tamper rejection, unknown-version rejection, prune keeps achievements evaluable, token stays under the QR budget with a maxed-out state.

## Phasing

1. **v1**: token + restore URL + paste import, replace-with-confirm. No new dependencies; ships the whole path end to end.
2. **v2**: QR (`uqr`), full-fidelity file backup, partial merge for coverage sets and unlocks.

## Open decisions

- Replace-not-merge as the v1 import behavior (merge deferred to v2, partial only).
- Detailed round logs are dropped from the transfer token; full logs travel only via the phase-2 file backup.
- `uqr` as the single new dependency (v2).
- UI placement under the stats/achievements panel rather than a new settings screen.
