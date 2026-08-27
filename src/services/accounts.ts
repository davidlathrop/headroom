import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { accounts, batchCoverage, importBatches, type Account } from "@/db/schema";
import { ACCOUNT_KINDS, type ISODate } from "@/domain/types";
import { logAudit } from "./audit";
import { AppError, newId, nowIso } from "./context";

export const accountInput = z.object({
  name: z.string().trim().min(1).max(80),
  institution: z.string().trim().max(80).optional().nullable(),
  kind: z.enum(ACCOUNT_KINDS),
  onBudget: z.boolean().default(true),
  currency: z.string().length(3).default("USD"),
  openingBalanceCents: z.number().int().default(0),
  openingBalanceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  externalLabel: z.string().trim().max(120).nullable().optional(),
});
export type AccountInput = z.infer<typeof accountInput>;

export function listAccounts(db: Db, opts: { includeArchived?: boolean } = {}): Account[] {
  const q = db.select().from(accounts).orderBy(asc(accounts.name));
  return opts.includeArchived ? q.all() : q.where(isNull(accounts.archivedAt)).all();
}

export function getAccount(db: Db, id: string): Account {
  const a = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!a) throw new AppError(`Account ${id} not found`, "not_found");
  return a;
}

export function createAccount(db: Db, input: AccountInput): Account {
  const ts = nowIso();
  const row = {
    id: newId(),
    ...input,
    institution: input.institution ?? null,
    openingBalanceDate: input.openingBalanceDate ?? null,
    externalLabel: input.externalLabel ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(accounts).values(row).run();
  logAudit(db, "account", row.id, "create", undefined, row);
  return getAccount(db, row.id);
}

export function updateAccount(db: Db, id: string, patch: Partial<AccountInput>): Account {
  const before = getAccount(db, id);
  db.update(accounts)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(accounts.id, id))
    .run();
  const after = getAccount(db, id);
  logAudit(db, "account", id, "update", before, after);
  return after;
}

export function archiveAccount(db: Db, id: string): void {
  updateAccountRaw(db, id, { archivedAt: nowIso() });
}

function updateAccountRaw(db: Db, id: string, patch: Partial<Account>): void {
  db.update(accounts)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(accounts.id, id))
    .run();
}

/** Find an account for a label found in a file (OFX ACCTID, YNAB account name). */
export function findAccountByLabel(db: Db, label: string): Account | null {
  const all = listAccounts(db);
  const norm = (s: string) => s.trim().toLowerCase();
  const l = norm(label);
  return (
    all.find((a) => a.externalLabel && norm(a.externalLabel) === l) ??
    all.find((a) => norm(a.name) === l) ??
    // OFX account ids often carry the full number; match on the last 4 of a stored label.
    all.find(
      (a) =>
        a.externalLabel &&
        l.length >= 4 &&
        norm(a.externalLabel).endsWith(l.slice(-4)) &&
        l.endsWith(norm(a.externalLabel).slice(-4)),
    ) ??
    null
  );
}

export interface CoverageWindow {
  start: ISODate;
  end: ISODate;
  batchId: string;
}

/** Coverage windows from committed batches only. */
export function accountCoverage(db: Db, accountId: string): CoverageWindow[] {
  const rows = db
    .select({
      start: batchCoverage.coverageStart,
      end: batchCoverage.coverageEnd,
      batchId: batchCoverage.batchId,
      status: importBatches.status,
    })
    .from(batchCoverage)
    .innerJoin(importBatches, eq(importBatches.id, batchCoverage.batchId))
    .where(and(eq(batchCoverage.accountId, accountId), eq(importBatches.status, "committed")))
    .all();
  return rows
    .map((r) => ({ start: r.start, end: r.end, batchId: r.batchId }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** Merge overlapping windows for display. */
export function mergeWindows(
  windows: Array<{ start: ISODate; end: ISODate }>,
): Array<{ start: ISODate; end: ISODate }> {
  const sorted = [...windows].sort((a, b) => (a.start < b.start ? -1 : 1));
  const out: Array<{ start: ISODate; end: ISODate }> = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= nextDay(last.end)) {
      if (w.end > last.end) last.end = w.end;
    } else out.push({ ...w });
  }
  return out;
}

function nextDay(iso: ISODate): ISODate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
