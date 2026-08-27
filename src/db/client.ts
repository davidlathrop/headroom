import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * One connection per process. Next.js dev reloads modules, so the instance is parked on globalThis.
 * Migrations run on first open; the app never starts against an unmigrated file.
 */
const g = globalThis as unknown as { __headroomDb?: Db; __headroomSqlite?: Database.Database };

export function getDbPath(): string {
  return process.env.HEADROOM_DB ?? path.join(process.cwd(), "data", "headroom.sqlite");
}

export function getImportDir(): string {
  return process.env.HEADROOM_IMPORT_DIR ?? path.join(process.cwd(), "data", "imports");
}

export function openDb(filePath = getDbPath()): Db {
  if (g.__headroomDb) return g.__headroomDb;
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  g.__headroomDb = db;
  g.__headroomSqlite = sqlite;
  return db;
}

/** For tests: a fresh in-memory database, not cached globally. */
export function openTestDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function db(): Db {
  return openDb();
}

export { schema };
