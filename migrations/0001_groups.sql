CREATE TABLE IF NOT EXISTS groups (code TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scores (
  code TEXT NOT NULL, puzzle INTEGER NOT NULL, player TEXT NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (code, puzzle, player)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (code, puzzle, total DESC);
