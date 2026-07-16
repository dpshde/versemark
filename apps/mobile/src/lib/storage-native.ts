/**
 * Native persistence.
 *
 * Production uses synchronous SQLite transactions so `saveState()` only
 * succeeds after the snapshot and immutable event projections are on disk.
 * AsyncStorage is retained solely as a one-time migration source and as a
 * small injected test adapter.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collectConfirmedRounds,
  createMemoryKvStore,
  createRecordId,
  setStorageBackend,
  STORAGE_KEY_V2,
  STORAGE_KEY_V3,
  type AppState,
  type DailyResultRecord,
  type KvStore,
  type RoundRecord,
} from "@versemark/core";
import type { SQLiteDatabase } from "expo-sqlite";

const KEYS = [STORAGE_KEY_V3, STORAGE_KEY_V2, "versemark:translation"] as const;
const DATABASE_NAME = "versemark.db";
const DATABASE_SCHEMA_VERSION = 1;

export type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type FlushableKvStore = KvStore & {
  flush(): Promise<void>;
  lastWriteError(): Error | null;
};

type SQLiteLike = Pick<SQLiteDatabase, "execSync" | "runSync" | "getFirstSync" | "withTransactionSync">;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS round_events (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  translation TEXT,
  app_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  content_version TEXT NOT NULL,
  duration_ms INTEGER,
  payload TEXT NOT NULL,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  puzzle_number INTEGER NOT NULL,
  date_key TEXT NOT NULL,
  completed_at TEXT,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS achievement_unlocks (
  id TEXT PRIMARY KEY NOT NULL,
  unlocked_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS round_events_occurred_at_idx ON round_events(occurred_at);
CREATE INDEX IF NOT EXISTS sync_outbox_created_at_idx ON sync_outbox(created_at);
`;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Serialized AsyncStorage adapter for tests and emergency fallback. Call
 * `flush()` when an acknowledged write boundary is required.
 */
export async function createHydratedAsyncKvStore(
  disk: AsyncStorageLike = AsyncStorage
): Promise<FlushableKvStore & { _map: Map<string, string> }> {
  const memory = createMemoryKvStore();
  let queue = Promise.resolve();
  let writeError: Error | null = null;
  await Promise.all(
    KEYS.map(async (key) => {
      try {
        const value = await disk.getItem(key);
        if (value != null) memory.setItem(key, value);
      } catch {
        // Fail-open: memory stays empty for this key.
      }
    })
  );

  const enqueue = (write: () => Promise<void>) => {
    queue = queue.then(write).catch((error: unknown) => {
      writeError = asError(error);
    });
  };

  return {
    _map: memory._map,
    getItem(key: string): string | null {
      return memory.getItem(key);
    },
    setItem(key: string, value: string): void {
      memory.setItem(key, value);
      enqueue(() => disk.setItem(key, value));
    },
    removeItem(key: string): void {
      memory.removeItem?.(key);
      enqueue(() => disk.removeItem(key));
    },
    async flush(): Promise<void> {
      await queue;
      if (writeError) throw writeError;
    },
    lastWriteError(): Error | null {
      return writeError;
    },
  };
}

function initializeDatabase(db: SQLiteLike): void {
  db.execSync(SCHEMA_SQL);
  db.runSync(
    "INSERT OR IGNORE INTO migrations(version, applied_at) VALUES (?, ?)",
    DATABASE_SCHEMA_VERSION,
    new Date().toISOString()
  );
}

function deterministicLegacyEventId(record: RoundRecord): string {
  const seed = `${record.source}:${record.trueRef}:${record.trueVerseIndex}:${record.guessVerseIndex}:${record.occurredAt ?? record.at}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `round_legacy_${(hash >>> 0).toString(36)}`;
}

function outbox(
  db: SQLiteLike,
  entityType: string,
  entityId: string,
  operation: "upsert" | "delete",
  revision: number,
  payload: string,
  now: string
): void {
  db.runSync(
    `INSERT OR IGNORE INTO sync_outbox
      (id, entity_type, entity_id, operation, revision, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `${entityType}:${entityId}:${operation}:${revision}`,
    entityType,
    entityId,
    operation,
    revision,
    payload,
    now
  );
}

function upsertRoundEvents(db: SQLiteLike, state: AppState, now: string): void {
  for (const record of collectConfirmedRounds(state)) {
    const id = record.eventId || deterministicLegacyEventId(record);
    const occurredAt = record.occurredAt || record.at;
    const revision = Math.max(1, Number(record.revision) || 1);
    const payload = JSON.stringify({ ...record, eventId: id, occurredAt, revision });
    const result = db.runSync(
      `INSERT OR IGNORE INTO round_events
        (id, occurred_at, device_id, user_id, revision, source, translation,
         app_version, rules_version, content_version, duration_ms, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      occurredAt,
      record.deviceId || state.deviceId,
      record.userId ?? null,
      revision,
      record.source,
      record.translation ?? null,
      record.appVersion || "legacy",
      record.rulesVersion || "legacy",
      record.contentVersion || "legacy",
      record.durationMs ?? null,
      payload
    );
    if (result.changes > 0) outbox(db, "round_event", id, "upsert", revision, payload, now);
  }
}

function dailyRecords(state: AppState): DailyResultRecord[] {
  const byPuzzle = new Map<number, DailyResultRecord>();
  for (const daily of state.history) byPuzzle.set(daily.puzzleNumber, daily);
  if (state.lastDaily) byPuzzle.set(state.lastDaily.puzzleNumber, state.lastDaily);
  return [...byPuzzle.values()];
}

function upsertDailySessions(db: SQLiteLike, state: AppState, now: string): void {
  for (const daily of dailyRecords(state)) {
    const id = `daily_${daily.puzzleNumber}`;
    const payload = JSON.stringify(daily);
    db.runSync(
      `INSERT INTO daily_sessions(id, puzzle_number, date_key, completed_at, revision, payload)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         date_key = excluded.date_key,
         completed_at = excluded.completed_at,
         revision = excluded.revision,
         payload = excluded.payload`,
      id,
      daily.puzzleNumber,
      daily.dateKey,
      daily.completedAt,
      state.revision,
      payload
    );
    outbox(db, "daily_session", id, "upsert", state.revision, payload, now);
  }
}

function upsertUnlocks(db: SQLiteLike, state: AppState, now: string): void {
  for (const [id, unlock] of Object.entries(state.achievementUnlocks)) {
    const result = db.runSync(
      "INSERT OR IGNORE INTO achievement_unlocks(id, unlocked_at, revision) VALUES (?, ?, 1)",
      id,
      unlock.unlockedAt
    );
    if (result.changes > 0) outbox(db, "achievement_unlock", id, "upsert", 1, JSON.stringify(unlock), now);
  }
}

function projectState(db: SQLiteLike, value: string): void {
  const state = JSON.parse(value) as AppState;
  // Pre-schema AsyncStorage snapshots are copied first, then normalized and
  // projected by core's explicit migration on load.
  if (
    !state.deviceId ||
    !Number.isFinite(Number(state.schemaVersion)) ||
    !Array.isArray(state.history) ||
    !Array.isArray(state.practiceLog) ||
    !state.achievementUnlocks
  ) {
    return;
  }
  const now = new Date().toISOString();
  upsertRoundEvents(db, state, now);
  upsertDailySessions(db, state, now);
  upsertUnlocks(db, state, now);
  db.runSync(
    `INSERT INTO settings(key, value, revision, updated_at) VALUES ('device_id', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
    state.deviceId,
    state.revision,
    now
  );
  db.runSync(
    `INSERT INTO settings(key, value, revision, updated_at) VALUES ('schema_version', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
    String(state.schemaVersion),
    state.revision,
    now
  );
}

function resetDomainTables(db: SQLiteLike): void {
  const now = new Date().toISOString();
  const resetId = createRecordId("reset", new Date(now));
  db.execSync(`
    DELETE FROM round_events;
    DELETE FROM daily_sessions;
    DELETE FROM achievement_unlocks;
    DELETE FROM sync_outbox;
  `);
  outbox(db, "progress", resetId, "delete", 1, JSON.stringify({ resetAt: now }), now);
}

export function createSQLiteKvStore(db: SQLiteLike): FlushableKvStore {
  initializeDatabase(db);
  return {
    getItem(key: string): string | null {
      if (key === "versemark:translation") {
        return db.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value ?? null;
      }
      return db.getFirstSync<{ value: string }>("SELECT value FROM app_state WHERE key = ?", key)?.value ?? null;
    },
    setItem(key: string, value: string): void {
      const now = new Date().toISOString();
      db.withTransactionSync(() => {
        if (key === "versemark:translation") {
          db.runSync(
            `INSERT INTO settings(key, value, revision, updated_at) VALUES (?, ?, 1, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = settings.revision + 1, updated_at = excluded.updated_at`,
            key,
            value,
            now
          );
          return;
        }
        const revision = key === STORAGE_KEY_V3
          ? Math.max(0, Number((JSON.parse(value) as Partial<AppState>).revision) || 0)
          : 0;
        db.runSync(
          `INSERT INTO app_state(key, value, revision, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
          key,
          value,
          revision,
          now
        );
        if (key === STORAGE_KEY_V3) projectState(db, value);
      });
    },
    removeItem(key: string): void {
      db.withTransactionSync(() => {
        if (key === "versemark:translation") {
          db.runSync("DELETE FROM settings WHERE key = ?", key);
          return;
        }
        db.runSync("DELETE FROM app_state WHERE key = ?", key);
        if (key === STORAGE_KEY_V3) resetDomainTables(db);
      });
    },
    async flush(): Promise<void> {
      // Every SQLite mutation above is committed before returning.
    },
    lastWriteError(): Error | null {
      return null;
    },
  };
}

async function migrateLegacyAsyncStorage(store: KvStore, disk: AsyncStorageLike): Promise<void> {
  for (const key of KEYS) {
    if (store.getItem(key) != null) continue;
    const value = await disk.getItem(key);
    if (value != null) store.setItem(key, value);
  }
  // SQLite is now authoritative; erase the stale blob so reset cannot revive it.
  await Promise.all(KEYS.map((key) => disk.removeItem(key)));
}

/** Install durable storage as core's backend (call once before loadState). */
export async function installNativeStorage(
  disk?: AsyncStorageLike
): Promise<FlushableKvStore> {
  if (disk) {
    const testStore = await createHydratedAsyncKvStore(disk);
    setStorageBackend(testStore);
    return testStore;
  }

  const { openDatabaseSync } = await import("expo-sqlite");
  const db = openDatabaseSync(DATABASE_NAME);
  const store = createSQLiteKvStore(db);
  await migrateLegacyAsyncStorage(store, AsyncStorage);
  setStorageBackend(store);
  return store;
}

export { DATABASE_SCHEMA_VERSION, SCHEMA_SQL };
