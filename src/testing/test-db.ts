import { openDb, closeDb, type Db } from "../database/db";

const openInThisFile: Db[] = [];

/** Opens a real, isolated in-memory database and schedules it to close after the test. */
export function openTestDb(): Db {
  const db = openDb(":memory:");
  openInThisFile.push(db);
  return db;
}

afterEach(() => {
  while (openInThisFile.length > 0) {
    closeDb(openInThisFile.pop()!);
  }
});
