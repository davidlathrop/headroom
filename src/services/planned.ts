import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { plannedItems } from "@/db/schema";
import { logAudit } from "./audit";
import { newId, nowIso } from "./context";

export function listPlanned(db: Db) {
  return db.select().from(plannedItems).orderBy(asc(plannedItems.date)).all();
}

export function addPlanned(db: Db, input: { name: string; amountCents: number; date: string; categoryId: string | null; note?: string }) {
  const ts = nowIso();
  const row = { id: newId(), name: input.name, amountCents: input.amountCents, date: input.date, categoryId: input.categoryId, note: input.note ?? "", createdAt: ts, updatedAt: ts };
  db.insert(plannedItems).values(row).run();
  logAudit(db, "planned_item", row.id, "create", undefined, row);
  return row;
}

export function deletePlanned(db: Db, id: string) {
  db.delete(plannedItems).where(eq(plannedItems.id, id)).run();
  logAudit(db, "planned_item", id, "delete", undefined, undefined);
}
