# Achievement system guide

This guide explains how Versemark evaluates and persists achievements, and how to add one without resetting, shrinking, or miscounting an existing player's progress.

## The durability rule

**An achievement may only depend on data that remains correct for the lifetime of the install.**

`history` and `practiceLog` are bounded by `LOG_CAP`. They are useful for recent detail and migration floors, but old rounds are eventually evicted. Never make a lifetime achievement depend only on scanning those arrays.

Use one of these durable sources instead:

- `AppState.lifetime`: monotonic counters such as exact guesses, completed dailies, points, and hints.
- `bestStreak`, `bestPracticeStreak`, or `bestExactStreak`: persisted best-ever values.
- `touchedVerses`, `touchedBooks`, and `touchedChapters`: never-trimmed coverage sets.
- `rollups`: never-trimmed monthly, per-book aggregates for details evicted from the logs.
- `achievementUnlocks`: an append-only map of stable achievement IDs to their original unlock timestamps.

If the behavior you want is not represented by one of these sources, add durable data collection **before** adding the achievement. Once detailed logs have been evicted, a new dimension cannot be reconstructed retroactively. For example, existing rollups cannot answer “no-hint exact guesses in Romans” because hint use is not one of their dimensions.

## How an unlock flows

```diagram
confirmed round
      │
      ▼
recordDailyScoredRound / recordPracticeResult
      │  updates lifetime counters, bests, coverage, and rollups
      ▼
persisted AppState
      │
      ▼
evaluateAchievements(state)
      │  compares durable values with ladder thresholds
      ▼
mergeAchievementUnlocks(...)
      │  adds missing IDs; never replaces or removes existing entries
      ▼
achievementUnlocks[id] = { unlockedAt }
```

The main implementation files are:

- `src/lib/achievements.ts`: ladder definitions, predicates, materialization, listing, and unlock evaluation.
- `src/lib/storage.ts`: persisted state, normalization, migrations, durable write paths, and append-only unlock merging.
- `src/lib/game.ts`: computes round facts and invokes the atomic storage paths before evaluating unlocks.
- `src/lib/mastery.ts`: combines retained detail with evicted rollups.
- `src/ui/achievements-flat.ts`: flat scroll ledger (lifetime, canon map, focus lists, next, unlocks) — only display dimensions already durable above. UI chrome labels the `sight` ladder **Unaided**; formal titles stay catalog copy. Deck modules (`achievements-deck*`) remain in tree but are not the live surface.

## Existing ladders

Achievements are progressive ladders in `LADDERS`. Each ladder has:

- a permanent `key`;
- curated seed thresholds with permanent IDs and copy;
- a `valueOf` function reading durable state;
- generated 1–2–5 thresholds beyond the highest seed;
- a number of locked future goals to show with `ahead`.

The seed catalog is static, but each ladder is open-ended. At high values, IDs are generated as `${ladder.key}-${threshold}`. Evaluation stores every earned ID; the achievements screen collapses intermediate generated ranks so the list remains finite.

### Safe: add a seed to an existing ladder

Add a seed when the achievement uses an existing durable value:

```ts
{
  key: "exact",
  ahead: 2,
  seeds: [
    // Existing IDs must remain unchanged.
    { n: 1, id: "exact-once", title: "Exact" },
    { n: 10, id: "exact-10", title: "Ten exacts" },
    { n: 25, id: "exact-25", title: "Twenty-five exacts" },
  ],
  valueOf: (_state, lifetime) => lifetime.exact,
  // ...
}
```

On the next evaluation, players whose stored value already meets the new threshold receive the new ID. Existing unlock IDs and timestamps remain untouched.

Rules:

1. Never rename or reuse an existing seed `id`.
2. Never change a ladder `key`; it is part of every generated open-ended ID.
3. Never assign an old ID to a different predicate.
4. Changing title, description, or artwork is safe; changing identity or meaning is not.
5. Keep thresholds positive integers and unique within the ladder.
6. Generated IDs are already public IDs. If a shipped ladder has generated `exact-1000`, a later curated seed at 1,000 must keep the ID `exact-1000`; giving that threshold a new ID would create a duplicate unlock with a new timestamp.

Prefer adding curated seeds before a ladder ships. After release, inspect `idForStep` and the ladder's previous highest seed before inserting a seed above it.

### Safe: add a ladder over an existing durable value

For example, `bestExactStreak` is already persisted and monotonic, so a ladder can read it directly:

```ts
{
  key: "exact-streak",
  ahead: 2,
  seeds: [
    {
      n: 3,
      id: "exact-streak-3",
      title: "Three in a row",
      description: "Place three consecutive rounds exactly.",
    },
  ],
  valueOf: (state) => state.bestExactStreak,
  defaultTitle: (n) => `${n.toLocaleString()} exacts in a row`,
  defaultDescription: (n) =>
    `Reach ${n.toLocaleString()} consecutive exact placements.`,
}
```

Choose a globally unique ladder key and seed IDs. Add the corresponding drop-cap assets under `public/assets/achievements/` using the paths produced by `dropCapPath`.

## Adding a new tracked metric safely

Adding the achievement definition is the **last** step. First make the metric durable.

### 1. Decide whether historical backfill is possible

Classify the metric:

- **Exactly derivable from durable state:** backfill from lifetime counters, bests, coverage sets, or rollups.
- **Partially derivable from retained logs:** use the logs only as a lower bound with `Math.max(stored, derived)`. Document that players may have done more before the metric shipped.
- **Not derivable:** initialize existing players to zero and state clearly that counting begins with the release. Do not pretend recent logs represent lifetime history.

If future achievements may need a new dimension, persist that dimension at write time now.

### 2. Add a normalized default

Add the field to `AppState` or `LifetimeCounters`, then update all of these together:

1. the TypeScript interface;
2. `emptyAppState()` or `emptyLifetime()`;
3. `parseStoredState()` or `normalizeLifetime()`;
4. the appropriate migration/reconciliation function;
5. the atomic daily and practice write paths;
6. `effectiveLifetime()` if it is a lifetime counter.

Normalization must accept old saves where the field is absent. Numeric counters should normally use a non-negative default:

```ts
newCounter: Math.max(0, Number(old.newCounter) || 0)
```

Do not replace the whole `lifetime` object with a newly constructed partial object. Spread or normalize the current persisted object so unrelated counters survive.

### 3. Update from the latest persisted state

The storage function that owns a write must call `loadState()` and increment the value it just loaded. Callers should pass facts or deltas, not an absolute `LifetimeCounters` snapshot.

```ts
// Good: storage loads the latest state and applies a fact.
recordDailyScoredRound(daily, round, {
  exact,
  near,
  sight,
  sameChapter,
  completedDaily,
  cleanSheet,
  noHintDaily,
});

// Unsafe: a caller computes an entire replacement object from an older load.
recordDailyScoredRound(daily, round, staleLifetimeSnapshot);
```

Persist related changes in one `saveState()` call. A confirmed daily round, its history entry, lifetime counters, coverage, streaks, and rollups must advance together rather than through separate read-modify-write cycles.

### 4. Keep lifetime values monotonic

Best-ever and cumulative values must not shrink during migration or reconciliation:

```ts
bestValue: Math.max(storedBest, derivedBest)
```

Coverage migration unions sets instead of replacing them. `effectiveLifetime()` takes the maximum of stored counters and log/rollup-derived floors. Follow those patterns.

Current streaks are different: they may reset when a run breaks. Persist a last-event date watermark and update the streak incrementally; do not recompute an unbounded streak from capped history.

### 5. Protect against old clients

The current physical storage key is `versemark:v3`. It was introduced so clients that only understand the older v2 shape cannot overwrite newer durable fields.

The state also carries an embedded `schemaVersion`. Mobile stores the snapshot
transactionally in SQLite and projects confirmed rounds into immutable
`round_events` rows. Daily sessions, unlocks, settings, applied migrations, and
an idempotent sync outbox have dedicated tables. The counters and rollups remain
fast rebuildable views; new achievement rules should prefer immutable event
fields when they need details such as translation, duration, or hint order.

If a shipped client using the **current** key would parse and rewrite your new field away, bump the physical key (for example, v3 → v4):

1. make the new key authoritative;
2. import the previous key once when the new key is absent;
3. normalize and reconcile during import;
4. save the migrated state under the new key;
5. leave the old key in place but never prefer it once the new key exists;
6. add a test proving writes to the old key cannot overwrite the new state.

Do not bump the key for a copy-only or catalog-only change. Do not delete an old key during migration; failed writes must not destroy the only recoverable copy.

## Unlock data is append-only

`achievementUnlocks` preserves unknown IDs while parsing, and `mergeAchievementUnlocks` only inserts IDs that are missing. Preserve both properties.

Never:

- rebuild the unlock map from the current catalog;
- filter unknown or retired IDs out of storage;
- replace old `unlockedAt` timestamps;
- revoke an unlock because a predicate or threshold changed;
- use achievement titles as IDs.

If an achievement is retired, stop advertising or evaluating it, but continue preserving its stored ID. If it must remain visible, keep `achievementDefForId` able to resolve it.

## Required tests

At minimum, add tests for the layer you changed:

### Catalog-only change

- the threshold unlocks from a pre-existing durable value;
- lower existing IDs still resolve;
- generated IDs remain stable;
- the drop-cap path exists or follows the expected naming rule.

### New persisted metric

- an old save without the field loads successfully;
- migration never lowers a larger stored value;
- daily and practice paths update the metric as intended;
- an unrelated lifetime counter survives the update;
- the metric still works after lowering `LOG_CAP` and forcing eviction;
- the state survives `saveState()` followed by `loadState()`;
- repeated completion does not double-count one-time daily aggregates;
- a legacy-key write cannot overwrite the new authoritative-key state when a key bump is required.

Run:

```bash
npm test
npm run typecheck
```

Useful test files:

- `tests/achievements.test.ts`: ladder generation, evaluation, listing, and durable floors.
- `tests/storage.test.ts`: normalization, migrations, atomic writes, streak watermarks, and key isolation.
- `tests/rollups.test.ts`: eviction folding and retained all-time aggregates.
- `tests/mastery.test.ts`: combining recent rounds with rollups.

## Review checklist

Before shipping an achievement change, answer **yes** to each applicable item:

- [ ] Does the predicate read a never-trimmed source?
- [ ] Can an existing player receive credit from their already persisted data?
- [ ] If exact backfill is impossible, is the limitation explicit?
- [ ] Are all existing IDs and ladder keys unchanged?
- [ ] Are unknown stored unlock IDs still preserved?
- [ ] Are cumulative values incremented from the latest loaded state?
- [ ] Are best-ever values merged with `Math.max` and coverage sets unioned?
- [ ] Are related round updates persisted atomically?
- [ ] Can an old client erase the new field? If so, was the storage key bumped?
- [ ] Do eviction, migration, and unrelated-counter regression tests pass?

When in doubt, ship durable collection first and the achievement later. Missing presentation can be added retroactively; missing historical data cannot.
