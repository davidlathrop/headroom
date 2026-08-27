import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: Db, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();
  if (existing) db.update(settings).set({ valueJson: json }).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, valueJson: json }).run();
}
