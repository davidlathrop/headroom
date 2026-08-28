import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * One connection per process. Next.js dev reloads modules, so the instance is parked on globalThis.
 * Migrations run on first open — and again whenever this module is re-evaluated (a dev hot
 * reload), so a migration added while `next dev` is running is applied to the cached connection
 * instead of waiting for a restart. `migrate` is idempotent: it only runs entries newer than the
 * last one recorded in `__drizzle_migrations`.
 */
const g = globalThis as unknown as { __headroomDb?: Db; __headroomSqlite?: Database.Database };
let migratedThisModule = false;

function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  migratedThisModule = true;
}

/**
 * Where Headroom keeps its data: `~/.headroom` by default (HEADROOM_DATA_DIR to move it), with
 * the database and the uploaded files beside each other. HEADROOM_DB / HEADROOM_IMPORT_DIR
 * override each individually (tests, the demo).
 */
export function getDataDir(): string {
  return process.env.HEADROOM_DATA_DIR ?? path.join(os.homedir(), ".headroom");
}

export function getDbPath(): string {
  return process.env.HEADROOM_DB ?? path.join(getDataDir(), "headroom.sqlite");
}

export function getImportDir(): string {
  return process.env.HEADROOM_IMPORT_DIR ?? path.join(getDataDir(), "imports");
}

/**
 * Data used to live in `./data` under the project. On the first open at the new location, copy
 * it there — a consistent snapshot via VACUUM INTO (safe even if another process has the old
 * file open), plus the uploaded files — and leave the original in place. Returns true if it did.
 */
export function adoptLegacyData(
  target: { dbPath: string; importDir: string },
  legacyDir = path.join(process.cwd(), "data"),
): boolean {
  if (target.dbPath === ":memory:" || fs.existsSync(target.dbPath)) return false;
  const legacyDb = path.join(legacyDir, "headroom.sqlite");
  if (!fs.existsSync(legacyDb)) return false;
  fs.mkdirSync(path.dirname(target.dbPath), { recursive: true });
  const src = new Database(legacyDb, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${target.dbPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  const legacyImports = path.join(legacyDir, "imports");
  if (fs.existsSync(legacyImports) && !fs.existsSync(target.importDir))
    fs.cpSync(legacyImports, target.importDir, { recursive: true });
  console.log(
    `[headroom] copied ${legacyDb} → ${target.dbPath} (and imports); the originals were left in place`,
  );
  return true;
}

export function openDb(filePath = getDbPath()): Db {
  if (g.__headroomDb) {
    if (!migratedThisModule) runMigrations(g.__headroomDb);
    return g.__headroomDb;
  }
  if (filePath !== ":memory:") {
    if (!process.env.HEADROOM_DB) adoptLegacyData({ dbPath: filePath, importDir: getImportDir() });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  runMigrations(db);
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
