import { ulid } from "ulid";
import { openDb, type Db } from "@/db/client";
import { ensureSeeded } from "./seed";

export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}

const g = globalThis as unknown as { __headroomSeeded?: boolean };

/** The application database: opened, migrated, and seeded exactly once per process. */
export function getDb(): Db {
  const db = openDb();
  if (!g.__headroomSeeded) {
    ensureSeeded(db);
    g.__headroomSeeded = true;
  }
  return db;
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "app_error",
  ) {
    super(message);
    this.name = "AppError";
  }
}
