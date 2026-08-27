import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";
import { migrate } from "./migrations";

export type Db = BetterSQLite3Database<typeof schema> & {
  readonly $sqlite: BetterSqlite3.Database;
};

/**
 * Opens (and, on first use, creates) the onramp SQLite database and brings
 * its schema up to date. Pass ":memory:" in tests for a real, isolated
 * database per test run instead of mocking the data layer.
 */
export function openDb(path: string): Db {
  const sqlite = new BetterSqlite3(path);
  // WAL is meaningless for :memory: (there's no file for a shared WAL log to
  // live in) - setting it anyway has been observed to crash the native
  // binding on some platforms, so only do it for a real on-disk database.
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  migrate(sqlite);
  return Object.assign(drizzle(sqlite, { schema }), { $sqlite: sqlite });
}

/** Releases the underlying SQLite file handle - call this in test teardown. */
export function closeDb(db: Db): void {
  db.$sqlite.close();
}
