import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  accounts,
  categories,
  transactionSplits,
  transactions,
  transfers,
  type Transaction,
} from "@/db/schema";
import { monthEnd, monthStart } from "@/domain/dates";
import type { ISODate, MonthKey } from "@/domain/types";
import { logAudit } from "./audit";
import { AppError, newId, nowIso } from "./context";
import { createRule } from "./rules";
import { setPaymentCategory } from "./transfers";

const TRANSFER_CATEGORY = "cat-transfer";

export interface TransactionFilters {
  accountId?: string | null;
  month?: MonthKey | null;
  /** Inclusive posted-date bounds; a reconciliation window, for instance. */
  from?: ISODate | null;
  to?: ISODate | null;
  categoryId?: string | null;
  uncategorized?: boolean;
  transfersOnly?: boolean;
  outliersOnly?: boolean;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface TransactionRow extends Transaction {
  accountName: string;
  accountKind: string;
  categoryName: string | null;
  categoryParentName: string | null;
  counterpartAccountName: string | null;
  splitCount: number;
}

export interface TransactionTotals {
  count: number;
  netCents: number;
  inflowCents: number;
  outflowCents: number;
}

export function queryTransactions(
  db: Db,
  f: TransactionFilters = {},
): { rows: TransactionRow[]; total: number; totals: TransactionTotals } {
  const parent = alias(categories, "parent");
  const conds: SQL[] = [isNull(transactions.deletedAt)];
  if (f.accountId) conds.push(eq(transactions.accountId, f.accountId));
  if (f.month)
    conds.push(
      gte(transactions.postedDate, monthStart(f.month)),
      lte(transactions.postedDate, monthEnd(f.month)),
    );
  if (f.from) conds.push(gte(transactions.postedDate, f.from));
  if (f.to) conds.push(lte(transactions.postedDate, f.to));
  if (f.categoryId)
    conds.push(
      or(eq(transactions.categoryId, f.categoryId), eq(categories.parentId, f.categoryId))!,
    );
  if (f.uncategorized) conds.push(isNull(transactions.categoryId), isNull(transactions.transferId));
  if (f.transfersOnly) conds.push(sql`${transactions.transferId} is not null`);
  if (f.outliersOnly) conds.push(eq(transactions.isOutlier, true));
  if (f.search && f.search.trim()) {
    const term = `%${f.search.trim()}%`;
    conds.push(
      or(
        like(transactions.payeeDisplay, term),
        like(transactions.payeeRaw, term),
        like(transactions.memoRaw, term),
        like(transactions.notes, term),
      )!,
    );
  }
  const where = and(...conds);
  // Totals cover every matching row, not just this page.
  const agg = db
    .select({
      n: sql<number>`count(*)`,
      net: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
      inflow: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      outflow: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then ${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(where)
    .get();
  const total = agg?.n ?? 0;
  const totals: TransactionTotals = {
    count: total,
    netCents: agg?.net ?? 0,
    inflowCents: agg?.inflow ?? 0,
    outflowCents: agg?.outflow ?? 0,
  };
  const rows = db
    .select({
      t: transactions,
      accountName: accounts.name,
      accountKind: accounts.kind,
      categoryName: categories.name,
      categoryParentName: parent.name,
      splitCount: sql<number>`(select count(*) from ${transactionSplits} where ${transactionSplits.transactionId} = ${transactions.id})`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .where(where)
    .orderBy(desc(transactions.postedDate), desc(transactions.createdAt))
    .limit(f.limit ?? 200)
    .offset(f.offset ?? 0)
    .all();

  // Counterpart account names for transfers (a second cheap query keeps the main one simple).
  const transferIds = rows.map((r) => r.t.transferId).filter((x): x is string => !!x);
  const counterpart = new Map<string, string>();
  if (transferIds.length) {
    const links = db.select().from(transfers).where(inArray(transfers.id, transferIds)).all();
    const otherIds = links.flatMap((l) => [l.fromTxnId, l.toTxnId]);
    const others = db
      .select({ id: transactions.id, accountName: accounts.name })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(inArray(transactions.id, otherIds))
      .all();
    const nameById = new Map(others.map((o) => [o.id, o.accountName]));
    for (const l of links) {
      counterpart.set(`${l.id}|${l.fromTxnId}`, nameById.get(l.toTxnId) ?? "?");
      counterpart.set(`${l.id}|${l.toTxnId}`, nameById.get(l.fromTxnId) ?? "?");
    }
  }
  return {
    total,
    totals,
    rows: rows.map((r) => ({
      ...r.t,
      accountName: r.accountName,
      accountKind: r.accountKind,
      categoryName: r.categoryName,
      categoryParentName: r.categoryParentName,
      counterpartAccountName: r.t.transferId
        ? (counterpart.get(`${r.t.transferId}|${r.t.id}`) ?? null)
        : null,
      splitCount: r.splitCount,
    })),
  };
}

export function getTransaction(db: Db, id: string): Transaction {
  const t = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!t) throw new AppError("Transaction not found", "not_found");
  return t;
}

export function setCategory(
  db: Db,
  id: string,
  categoryId: string | null,
  opts: { alwaysForPayee?: boolean } = {},
): void {
  const before = getTransaction(db, id);
  let next = categoryId;
  if (before.transferId) {
    // Only the paying side of a transfer may carry a real category (a mortgage payment is
    // Housing); the receiving side stays a transfer so the money is never counted twice.
    if (before.amountCents > 0 && categoryId && categoryId !== TRANSFER_CATEGORY)
      throw new AppError(
        "This is the receiving side of a transfer — categorize the paying side instead",
        "invalid",
      );
    next = categoryId ?? TRANSFER_CATEGORY;
  }
  db.update(transactions)
    .set({ categoryId: next, isReviewed: true, updatedAt: nowIso() })
    .where(eq(transactions.id, id))
    .run();
  logAudit(
    db,
    "transaction",
    id,
    "set_category",
    { categoryId: before.categoryId },
    { categoryId: next },
  );
  if (opts.alwaysForPayee && before.transferId && next && next !== TRANSFER_CATEGORY) {
    // "Always" on a transfer means: every payment into that account counts this way.
    const link = db.select().from(transfers).where(eq(transfers.id, before.transferId)).get();
    const other = link ? getTransaction(db, link.toTxnId) : null;
    if (other) setPaymentCategory(db, other.accountId, next);
  } else if (opts.alwaysForPayee && categoryId && !before.transferId) {
    createRule(
      db,
      {
        priority: 50,
        matchField: "payee_key",
        matchType: "exact",
        pattern: before.payeeKey,
        setCategoryId: categoryId,
        enabled: true,
      },
      id,
    );
    // Apply to other uncategorized rows with the same payee right away.
    db.update(transactions)
      .set({ categoryId, updatedAt: nowIso() })
      .where(
        and(
          eq(transactions.payeeKey, before.payeeKey),
          isNull(transactions.categoryId),
          isNull(transactions.transferId),
        ),
      )
      .run();
  }
}

export function setPayeeDisplay(db: Db, id: string, payeeDisplay: string): void {
  const before = getTransaction(db, id);
  db.update(transactions)
    .set({ payeeDisplay, updatedAt: nowIso() })
    .where(eq(transactions.id, id))
    .run();
  logAudit(
    db,
    "transaction",
    id,
    "set_payee_display",
    { payeeDisplay: before.payeeDisplay },
    { payeeDisplay },
  );
}

/** Flag or unflag an outlier: it keeps its category and its month, but leaves the trends and forecast statistics. */
export function setOutlier(db: Db, id: string, isOutlier: boolean): void {
  const before = getTransaction(db, id);
  if (before.isOutlier === isOutlier) return;
  db.update(transactions)
    .set({ isOutlier, isReviewed: true, updatedAt: nowIso() })
    .where(eq(transactions.id, id))
    .run();
  logAudit(db, "transaction", id, "set_outlier", { isOutlier: before.isOutlier }, { isOutlier });
}

export function setNotes(db: Db, id: string, notes: string): void {
  db.update(transactions).set({ notes, updatedAt: nowIso() }).where(eq(transactions.id, id)).run();
}

export const splitInput = z
  .array(
    z.object({
      categoryId: z.string().nullable(),
      amountCents: z.number().int(),
      memo: z.string().default(""),
    }),
  )
  .max(20);

/** Replace splits. An empty array removes them. Splits must sum to the transaction amount. */
export function setSplits(db: Db, id: string, splits: z.infer<typeof splitInput>): void {
  const t = getTransaction(db, id);
  if (splits.length > 0) {
    const sum = splits.reduce((s, x) => s + x.amountCents, 0);
    if (sum !== t.amountCents)
      throw new AppError("Splits must add up to the transaction amount", "invalid");
  }
  const ts = nowIso();
  db.transaction((tx) => {
    tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id)).run();
    for (const s of splits)
      tx.insert(transactionSplits)
        .values({
          id: newId(),
          transactionId: id,
          categoryId: s.categoryId,
          amountCents: s.amountCents,
          memo: s.memo,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
    tx.update(transactions)
      .set({ isReviewed: true, updatedAt: ts })
      .where(eq(transactions.id, id))
      .run();
  });
  logAudit(db, "transaction", id, "set_splits", undefined, splits);
}

export function listSplits(db: Db, transactionId: string) {
  return db
    .select()
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId))
    .orderBy(asc(transactionSplits.createdAt))
    .all();
}

/** Most common category for a payee key, for suggestions when no rule matches. */
export function suggestCategoryForPayee(db: Db, payeeKey: string): string | null {
  const r = db
    .select({ categoryId: transactions.categoryId, n: sql<number>`count(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.payeeKey, payeeKey),
        sql`${transactions.categoryId} is not null`,
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(transactions.categoryId)
    .orderBy(desc(sql`count(*)`))
    .get();
  return r?.categoryId ?? null;
}
