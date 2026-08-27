import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { importProfiles } from "@/db/schema";
import {
  csvProfileSchema,
  type CsvProfileInput,
  type ImportProfileRecord,
} from "@/importers/csv/profile";
import { AppError, newId, nowIso } from "./context";

export function listProfiles(db: Db): ImportProfileRecord[] {
  return db
    .select()
    .from(importProfiles)
    .orderBy(asc(importProfiles.isBuiltin), asc(importProfiles.name))
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      format: p.format,
      institution: p.institution,
      isBuiltin: p.isBuiltin,
      config: p.configJson ? csvProfileSchema.parse(JSON.parse(p.configJson)) : null,
    }));
}

export function getProfile(db: Db, id: string): ImportProfileRecord {
  const p = listProfiles(db).find((x) => x.id === id);
  if (!p) throw new AppError(`Import profile ${id} not found`, "not_found");
  return p;
}

export function createCsvProfile(
  db: Db,
  name: string,
  institution: string | null,
  config: CsvProfileInput,
): ImportProfileRecord {
  const parsed = csvProfileSchema.parse(config);
  const ts = nowIso();
  const id = newId();
  db.insert(importProfiles)
    .values({
      id,
      name,
      format: "csv",
      institution,
      configJson: JSON.stringify(parsed),
      isBuiltin: false,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return getProfile(db, id);
}

export function deleteProfile(db: Db, id: string): void {
  const p = getProfile(db, id);
  if (p.isBuiltin) throw new AppError("Built-in profiles cannot be deleted", "forbidden");
  db.delete(importProfiles).where(eq(importProfiles.id, id)).run();
}
