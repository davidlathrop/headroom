import { ulid } from "ulid";
import { openDb, type Db } from "@/db/client";
import { ensureCoverageRanges } from "./coverage";
import { ensureSeeded } from "./seed";

export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}

const g = globalThis as unknown as { __headroomSeeded?: boolean };
/** Data upgrades re-check once per module evaluation, so a dev hot reload applies a new one. */
let upgradesChecked = false;

/** The application database: opened, migrated, seeded once per process, data upgrades applied. */
export function getDb(): Db {
  const db = openDb();
  if (!g.__headroomSeeded) {
    ensureSeeded(db);
    g.__headroomSeeded = true;
  }
  if (!upgradesChecked) {
    ensureCoverageRanges(db);
    upgradesChecked = true;
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
