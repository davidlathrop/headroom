import { and, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, recurringSeries, transactions, type Category } from "@/db/schema";
import { addMonths, monthKey, today } from "@/domain/dates";
import { detectRecurring, type DetectedSeries } from "@/domain/recurring";
import { logAudit } from "./audit";
import { AppError, newId, nowIso } from "./context";

export type SeriesRow = typeof recurringSeries.$inferSelect;

/**
 * Re-run detection over the last 26 months and sync the recurring_series table.
 * Your decisions (confirmed / dismissed) survive; amounts and next dates refresh.
 * Returns the detected series (with member ids) keyed by (accountId|payeeKey|sign).
 */
export function refreshRecurringSeries(db: Db, asOf = today()): Map<string, DetectedSeries> {
  const since = `${addMonths(monthKey(asOf), -26)}-01`;
  const rows = db
    .select({ id: transactions.id, accountId: transactions.accountId, payeeKey: transactions.payeeKey, categoryId: transactions.categoryId, postedDate: transactions.postedDate, amountCents: transactions.amountCents })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(isNull(transactions.deletedAt), gte(transactions.postedDate, since), isNull(accounts.archivedAt)))
    .all();
  const detected = detectRecurring(rows, { today: asOf });
  const byKey = new Map(detected.map((d) => [d.key, d]));
  const existing = db.select().from(recurringSeries).all();
  const ts = nowIso();
  const seen = new Set<string>();
  for (const e of existing) {
    const key = `${e.accountId}|${e.payeeKey}|${e.typicalAmountCents < 0 ? "-" : "+"}`;
    const d = byKey.get(key);
    if (!d) {
      if (e.status === "detected") db.delete(recurringSeries).where(eq(recurringSeries.id, e.id)).run();
      else if (e.status !== "dismissed") db.update(recurringSeries).set({ status: "inactive", updatedAt: ts }).where(eq(recurringSeries.id, e.id)).run();
      continue;
    }
    seen.add(key);
    const status = e.status === "dismissed" ? "dismissed" : e.status === "confirmed" ? (d.active ? "confirmed" : "inactive") : d.active ? "detected" : "inactive";
    db.update(recurringSeries)
      .set({ categoryId: e.categoryId ?? d.categoryId, cadence: d.cadence, typicalAmountCents: d.typicalAmountCents, amountMadCents: d.amountMadCents, anchorDay: d.anchorDay, lastSeenDate: d.lastSeenDate, nextExpectedDate: d.nextExpectedDate, status, updatedAt: ts })
      .where(eq(recurringSeries.id, e.id))
      .run();
  }
  for (const d of detected) {
    if (seen.has(d.key)) continue;
    db.insert(recurringSeries)
      .values({ id: newId(), accountId: d.accountId, payeeKey: d.payeeKey, categoryId: d.categoryId, cadence: d.cadence, typicalAmountCents: d.typicalAmountCents, amountMadCents: d.amountMadCents, anchorDay: d.anchorDay, lastSeenDate: d.lastSeenDate, nextExpectedDate: d.nextExpectedDate, status: d.active ? "detected" : "inactive", createdAt: ts, updatedAt: ts })
      .run();
  }
  return byKey;
}

export function listSeries(db: Db): SeriesRow[] {
  return db.select().from(recurringSeries).all().sort((a, b) => Math.abs(b.typicalAmountCents) - Math.abs(a.typicalAmountCents));
}

export function setSeriesStatus(db: Db, id: string, status: "confirmed" | "dismissed" | "detected"): void {
  const before = db.select().from(recurringSeries).where(eq(recurringSeries.id, id)).get();
  if (!before) throw new AppError("Series not found", "not_found");
  db.update(recurringSeries).set({ status, updatedAt: nowIso() }).where(eq(recurringSeries.id, id)).run();
  logAudit(db, "recurring_series", id, "set_status", { status: before.status }, { status });
}

export function setSeriesAmount(db: Db, id: string, typicalAmountCents: number, categoryId: string | null): void {
  db.update(recurringSeries).set({ typicalAmountCents, categoryId, updatedAt: nowIso() }).where(eq(recurringSeries.id, id)).run();
}

export function seriesKey(s: Pick<SeriesRow, "accountId" | "payeeKey" | "typicalAmountCents">): string {
  return `${s.accountId}|${s.payeeKey}|${s.typicalAmountCents < 0 ? "-" : "+"}`;
}

export function seriesLabel(s: SeriesRow, categories: Category[], accountName: string): string {
  const cat = s.categoryId ? categories.find((c) => c.id === s.categoryId) : null;
  const payee = s.payeeKey
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length <= 2 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
  return cat && cat.flow === "transfer" ? `${payee} (${accountName})` : payee;
}
