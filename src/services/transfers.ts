import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, transactions, transfers } from "@/db/schema";
import { addDays } from "@/domain/dates";
import {
  detectTransfers,
  looksLikeTransfer,
  type TransferCandidateTxn,
  type TransferProposal,
} from "@/domain/transfers";
import type { AccountKind } from "@/domain/types";
import { logAudit } from "./audit";
import { AppError, newId, nowIso } from "./context";

const TRANSFER_CATEGORY = "cat-transfer";

function toCandidate(t: {
  id: string;
  accountId: string;
  postedDate: string;
  amountCents: number;
  payeeKey: string;
  transferId: string | null;
}): TransferCandidateTxn {
  return {
    id: t.id,
    accountId: t.accountId,
    postedDate: t.postedDate,
    amountCents: t.amountCents,
    payeeKey: t.payeeKey,
    transferId: t.transferId,
  };
}

function accountKinds(db: Db): Map<string, AccountKind> {
  return new Map(
    db
      .select({ id: accounts.id, kind: accounts.kind })
      .from(accounts)
      .all()
      .map((a) => [a.id, a.kind]),
  );
}

function pairHistory(db: Db): Map<string, number> {
  const rows = db
    .select({
      a: sql<string>`min(f.account_id, t.account_id)`,
      b: sql<string>`max(f.account_id, t.account_id)`,
      n: sql<number>`count(*)`,
    })
    .from(transfers)
    .innerJoin(sql`${transactions} as f`, sql`f.id = ${transfers.fromTxnId}`)
    .innerJoin(sql`${transactions} as t`, sql`t.id = ${transfers.toTxnId}`)
    .groupBy(sql`1, 2`)
    .all();
  return new Map(rows.map((r) => [`${r.a}|${r.b}`, r.n]));
}

/**
 * Detect transfers among `freshIds` (e.g. rows just committed) against everything unlinked
 * within the window. Auto-links confident pairs; returns the rest as suggestions.
 */
export function runTransferDetection(
  db: Db,
  freshIds: string[] | null,
  opts: { maxDays?: number; autoThreshold?: number } = {},
): { linked: number; suggested: TransferProposal[] } {
  const maxDays = opts.maxDays ?? 4;
  const base = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), isNull(transactions.transferId)));
  const fresh = freshIds
    ? freshIds.length
      ? db
          .select()
          .from(transactions)
          .where(and(inArray(transactions.id, freshIds), isNull(transactions.transferId)))
          .all()
      : []
    : base.all();
  if (fresh.length === 0) return { linked: 0, suggested: [] };
  const minDate = addDays(
    fresh.reduce((m, t) => (t.postedDate < m ? t.postedDate : m), fresh[0]!.postedDate),
    -maxDays,
  );
  const maxDate = addDays(
    fresh.reduce((m, t) => (t.postedDate > m ? t.postedDate : m), fresh[0]!.postedDate),
    maxDays,
  );
  const freshSet = new Set(fresh.map((t) => t.id));
  const pool = db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        isNull(transactions.transferId),
        gte(transactions.postedDate, minDate),
        lte(transactions.postedDate, maxDate),
      ),
    )
    .all()
    .filter((t) => !freshSet.has(t.id));
  const { auto, suggested } = detectTransfers(
    fresh.map(toCandidate),
    pool.map(toCandidate),
    accountKinds(db),
    pairHistory(db),
    { maxDays, autoThreshold: opts.autoThreshold },
  );
  for (const p of auto) linkTransfer(db, p.fromTxnId, p.toTxnId, "auto", p.score);
  return { linked: auto.length, suggested };
}

export function linkTransfer(
  db: Db,
  fromTxnId: string,
  toTxnId: string,
  linkedBy: "auto" | "user",
  confidence = 1,
): string {
  const from = db.select().from(transactions).where(eq(transactions.id, fromTxnId)).get();
  const to = db.select().from(transactions).where(eq(transactions.id, toTxnId)).get();
  if (!from || !to) throw new AppError("Transaction not found", "not_found");
  if (from.transferId || to.transferId)
    throw new AppError("One of these transactions is already part of a transfer", "invalid");
  if (from.accountId === to.accountId)
    throw new AppError("A transfer needs two different accounts", "invalid");
  if (from.amountCents + to.amountCents !== 0)
    throw new AppError("Transfer sides must be equal and opposite", "invalid");
  const id = newId();
  const ts = nowIso();
  db.transaction((tx) => {
    tx.insert(transfers)
      .values({
        id,
        fromTxnId: from.amountCents < 0 ? from.id : to.id,
        toTxnId: from.amountCents < 0 ? to.id : from.id,
        confidence,
        linkedBy,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    tx.update(transactions)
      .set({
        transferId: id,
        categoryId: TRANSFER_CATEGORY,
        isReviewed: linkedBy === "user",
        updatedAt: ts,
      })
      .where(inArray(transactions.id, [from.id, to.id]))
      .run();
  });
  logAudit(db, "transfer", id, "link", undefined, { fromTxnId, toTxnId, linkedBy, confidence });
  return id;
}

export function unlinkTransfer(db: Db, transferId: string): void {
  const link = db.select().from(transfers).where(eq(transfers.id, transferId)).get();
  if (!link) throw new AppError("Transfer not found", "not_found");
  const ts = nowIso();
  db.transaction((tx) => {
    tx.update(transactions)
      .set({ transferId: null, categoryId: null, updatedAt: ts })
      .where(eq(transactions.transferId, transferId))
      .run();
    tx.delete(transfers).where(eq(transfers.id, transferId)).run();
  });
  logAudit(db, "transfer", transferId, "unlink", link, undefined);
}

/** Transactions that look like the other half is missing: transfer-ish payee, not linked. */
export function unlinkedTransferLike(db: Db, limit = 50) {
  return db
    .select({ t: transactions, accountName: accounts.name })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(isNull(transactions.deletedAt), isNull(transactions.transferId)))
    .all()
    .filter((r) => r.t.categoryId !== TRANSFER_CATEGORY && looksLikeTransfer(r.t.payeeKey))
    .slice(0, limit);
}
