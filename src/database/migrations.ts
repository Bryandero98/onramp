import type Database from "better-sqlite3";

/**
 * Versioned migrations gated by `PRAGMA user_version`, run in order on every
 * connection open. Each entry is idempotent DDL for going from version
 * (index) to (index + 1). Never edit a migration that has shipped - append
 * a new one instead, the same discipline as a normal migration framework,
 * just without the extra dependency.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE funnel_items (
    repo_full_name TEXT NOT NULL,
    number INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('issue', 'pull_request')),
    stage TEXT NOT NULL CHECK (stage IN ('claimed', 'pr_opened', 'in_review', 'merged', 'abandoned')),
    claimed_by TEXT,
    claimed_at INTEGER,
    linked_issue_number INTEGER,
    last_activity_at INTEGER NOT NULL,
    nudge_count INTEGER NOT NULL DEFAULT 0,
    last_nudged_at INTEGER,
    PRIMARY KEY (repo_full_name, number)
  );
  `,
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version (${currentVersion}) is newer than this build of onramp supports (${CURRENT_SCHEMA_VERSION}). Update onramp before running against this database.`,
    );
  }

  for (let version = currentVersion; version < CURRENT_SCHEMA_VERSION; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
