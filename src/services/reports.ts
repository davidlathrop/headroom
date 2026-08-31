import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db/client";
import { accounts, categories, transactionSplits, transactions } from "@/db/schema";
import { addDays, monthEnd, monthStart, today } from "@/domain/dates";
import {
  buildMonthReport,
  isRangeCovered,
  type MonthReport,
  type ReportLine,
} from "@/domain/reports";
import type { ISODate, MonthKey } from "@/domain/types";
import { accountCoverage, listAccounts } from "./accounts";

/** The date a transaction counts as: the user's `effective_date` override when set, else posted. */
const effectiveDate = sql<string>`coalesce(${transactions.effectiveDate}, ${transactions.postedDate})`;

/**
 * Lines whose *effective* date falls in [start, end]: a mortgage paid 7/31 but marked as counting
 * in August belongs to August's lines, not July's.
 */
export function linesForRange(db: Db, start: string, end: string): ReportLine[] {
  const parent = alias(categories, "parent");
  const rows = db
    .select({
      t: transactions,
      onBudget: accounts.onBudget,
      categoryName: categories.name,
      flow: categories.flow,
      spendType: categories.spendType,
      parentName: parent.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .where(
      and(
        isNull(transactions.deletedAt),
        sql`${effectiveDate} >= ${start}`,
        sql`${effectiveDate} <= ${end}`,
      ),
    )
    .all();
  const splitCat = alias(categories, "sc");
  const splitParent = alias(categories, "sp");
  const splits = db
    .select({
      s: transactionSplits,
      categoryName: splitCat.name,
      flow: splitCat.flow,
      spendType: splitCat.spendType,
      parentName: splitParent.name,
      postedDate: transactions.postedDate,
    })
    .from(transactionSplits)
    .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
    .leftJoin(splitCat, eq(splitCat.id, transactionSplits.categoryId))
    .leftJoin(splitParent, eq(splitParent.id, splitCat.parentId))
    .where(and(sql`${effectiveDate} >= ${start}`, sql`${effectiveDate} <= ${end}`))
    .all();
  const splitsByTxn = new Map<string, typeof splits>();
  for (const s of splits) {
    const l = splitsByTxn.get(s.s.transactionId) ?? [];
    l.push(s);
    splitsByTxn.set(s.s.transactionId, l);
  }
  const lines: ReportLine[] = [];
  for (const r of rows) {
    const t = r.t;
    const base = {
      transactionId: t.id,
      accountId: t.accountId,
      accountOnBudget: r.onBudget,
      postedDate: t.postedDate,
      effectiveDate: t.effectiveDate ?? t.postedDate,
      isTransfer: t.transferId != null,
      isOutlier: t.isOutlier,
    };
    const ss = splitsByTxn.get(t.id);
    if (ss && ss.length) {
      for (const s of ss) {
        lines.push({
          ...base,
          amountCents: s.s.amountCents,
          categoryId: s.s.categoryId,
          categoryName: s.categoryName,
          parentCategoryName: s.parentName,
          flow: s.flow,
          spendType: s.spendType,
        });
      }
    } else {
      lines.push({
        ...base,
        amountCents: t.amountCents,
        categoryId: t.categoryId,
        categoryName: r.categoryName,
        parentCategoryName: r.parentName,
        flow: r.flow,
        spendType: r.spendType,
      });
    }
  }
  return lines;
}

/**
 * A file exported today rarely contains today: banks post overnight and exports lag a day or
 * two. Coverage ending within this many days of today is not a gap.
 */
export const COVERAGE_LAG_DAYS = 3;

/**
 * Is this month fully covered by imports for every on-budget account that has any imports at all?
 * For the current month "fully" means through `asOf − COVERAGE_LAG_DAYS`.
 */
export function isMonthPartial(
  db: Db,
  month: MonthKey,
  asOf: ISODate = today(),
): { partial: boolean; gaps: Array<{ accountId: string; accountName: string }> } {
  const start = monthStart(month);
  const recent = addDays(asOf, -COVERAGE_LAG_DAYS);
  const end = monthEnd(month) < recent ? monthEnd(month) : recent;
  if (start > end) return { partial: false, gaps: [] };
  const gaps: Array<{ accountId: string; accountName: string }> = [];
  for (const a of listAccounts(db)) {
    if (!a.onBudget) continue;
    const windows = accountCoverage(db, a.id);
    if (windows.length === 0) continue;
    // Coverage before the account's first import isn't a gap: the account may not have existed.
    const firstStart = windows.reduce((m, w) => (w.start < m ? w.start : m), windows[0]!.start);
    if (end < firstStart) continue;
    const effStart = start < firstStart ? firstStart : start;
    if (!isRangeCovered(windows, effStart, end))
      gaps.push({ accountId: a.id, accountName: a.name });
  }
  return { partial: gaps.length > 0, gaps };
}

export function monthReport(
  db: Db,
  month: MonthKey,
  opts: { excludeOutliers?: boolean } = {},
): MonthReport & { gaps: Array<{ accountId: string; accountName: string }> } {
  let lines = linesForRange(db, monthStart(month), monthEnd(month));
  if (opts.excludeOutliers) lines = lines.filter((l) => !l.isOutlier);
  const { partial, gaps } = isMonthPartial(db, month);
  return { ...buildMonthReport(month, lines, partial), gaps };
}

export function listMonthKeys(db: Db): MonthKey[] {
  const rows = db
    .select({ m: sql<string>`substr(${effectiveDate}, 1, 7)` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(isNull(transactions.deletedAt), eq(accounts.onBudget, true)))
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`)
    .all();
  return rows.map((r) => r.m);
}

export function listMonthReports(
  db: Db,
  limit = 24,
  opts: { excludeOutliers?: boolean } = {},
): MonthReport[] {
  return listMonthKeys(db)
    .slice(0, limit)
    .map((m) => monthReport(db, m, opts));
}

/** Spend by category for one month, grouped by parent for display. */
export function categoryBreakdown(
  db: Db,
  month: MonthKey,
  opts: { excludeOutliers?: boolean } = {},
) {
  const r = monthReport(db, month, opts);
  const groups = new Map<
    string,
    { name: string; amountCents: number; flow: string | null; items: typeof r.byCategory }
  >();
  for (const c of r.byCategory) {
    const key = c.parentName ?? c.name;
    const g = groups.get(key) ?? { name: key, amountCents: 0, flow: c.flow, items: [] };
    g.amountCents += c.amountCents;
    g.items.push(c);
    groups.set(key, g);
  }
  return {
    report: r,
    groups: [...groups.values()].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)),
  };
}
