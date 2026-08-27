import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { balanceSnapshots, transactions, type BalanceSnapshot } from "@/db/schema";
import { today } from "@/domain/dates";
import type { Cents, ISODate } from "@/domain/types";
import { getAccount } from "./accounts";
import { newId, nowIso } from "./context";

interface Anchor {
  date: ISODate;
  balanceCents: Cents;
  source: "opening" | "ofx" | "statement" | "manual";
}

function anchors(db: Db, accountId: string): Anchor[] {
  const a = getAccount(db, accountId);
  const list: Anchor[] = [];
  if (a.openingBalanceDate)
    list.push({
      date: a.openingBalanceDate,
      balanceCents: a.openingBalanceCents,
      source: "opening",
    });
  for (const s of db
    .select()
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.accountId, accountId))
    .all()) {
    list.push({ date: s.asOfDate, balanceCents: s.balanceCents, source: s.source });
  }
  return list.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

function sumBetween(
  db: Db,
  accountId: string,
  afterDate: ISODate | null,
  throughDate: ISODate,
): Cents {
  const conds = [
    eq(transactions.accountId, accountId),
    isNull(transactions.deletedAt),
    lte(transactions.postedDate, throughDate),
  ];
  if (afterDate) conds.push(gt(transactions.postedDate, afterDate));
  return (
    db
      .select({ s: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
      .from(transactions)
      .where(and(...conds))
      .get()?.s ?? 0
  );
}

export interface BalanceInfo {
  asOf: ISODate;
  balanceCents: Cents;
  /** null when there is no anchor at all: the balance only reflects imported activity. */
  anchor: Anchor | null;
}

/** Balance as of a date = latest anchor on/before it + activity since. */
export function accountBalance(db: Db, accountId: string, asOf: ISODate = today()): BalanceInfo {
  const list = anchors(db, accountId).filter((a) => a.date <= asOf);
  const anchor = list[list.length - 1] ?? null;
  const activity = sumBetween(db, accountId, anchor?.date ?? null, asOf);
  return { asOf, balanceCents: (anchor?.balanceCents ?? 0) + activity, anchor };
}

export interface Reconciliation {
  snapshot: Anchor;
  previous: Anchor;
  computedCents: Cents;
  differenceCents: Cents; // snapshot − computed; 0 means the ledger between the two anchors is complete
}

/** Compare the newest anchor against what the ledger implies from the anchor before it. */
export function reconcileAccount(db: Db, accountId: string): Reconciliation | null {
  const list = anchors(db, accountId);
  if (list.length < 2) return null;
  const snapshot = list[list.length - 1]!;
  const previous = list[list.length - 2]!;
  const computed = previous.balanceCents + sumBetween(db, accountId, previous.date, snapshot.date);
  return {
    snapshot,
    previous,
    computedCents: computed,
    differenceCents: snapshot.balanceCents - computed,
  };
}

export function addSnapshot(
  db: Db,
  accountId: string,
  asOfDate: ISODate,
  balanceCents: Cents,
  source: "ofx" | "statement" | "manual",
  batchId: string | null = null,
): BalanceSnapshot {
  const existing = db
    .select()
    .from(balanceSnapshots)
    .where(
      and(
        eq(balanceSnapshots.accountId, accountId),
        eq(balanceSnapshots.asOfDate, asOfDate),
        eq(balanceSnapshots.source, source),
      ),
    )
    .get();
  const ts = nowIso();
  if (existing) {
    db.update(balanceSnapshots)
      .set({ balanceCents, batchId, updatedAt: ts })
      .where(eq(balanceSnapshots.id, existing.id))
      .run();
    return { ...existing, balanceCents, batchId, updatedAt: ts };
  }
  const row = {
    id: newId(),
    accountId,
    asOfDate,
    balanceCents,
    source,
    batchId,
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(balanceSnapshots).values(row).run();
  return row;
}

export function latestSnapshot(db: Db, accountId: string): BalanceSnapshot | null {
  return (
    db
      .select()
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.accountId, accountId))
      .orderBy(desc(balanceSnapshots.asOfDate))
      .get() ?? null
  );
}
