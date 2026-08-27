import { asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { categoryRules, transactions, type CategoryRuleRow } from "@/db/schema";
import { applyRules, type CategoryRule } from "@/domain/rules";
import { logAudit } from "./audit";
import { AppError, newId, nowIso } from "./context";

export const ruleInput = z.object({
  priority: z.number().int().default(100),
  matchField: z.enum(["payee_key", "payee_raw", "memo"]).default("payee_key"),
  matchType: z.enum(["contains", "exact", "regex"]).default("contains"),
  pattern: z.string().trim().min(1).max(200),
  amountMinCents: z.number().int().nullable().optional(),
  amountMaxCents: z.number().int().nullable().optional(),
  accountId: z.string().nullable().optional(),
  setCategoryId: z.string().min(1),
  setPayeeDisplay: z.string().trim().max(80).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type RuleInput = z.infer<typeof ruleInput>;

export function listRules(db: Db): CategoryRuleRow[] {
  return db
    .select()
    .from(categoryRules)
    .orderBy(asc(categoryRules.priority), asc(categoryRules.createdAt))
    .all();
}

export function toDomainRule(r: CategoryRuleRow): CategoryRule {
  return {
    id: r.id,
    priority: r.priority,
    matchField: r.matchField,
    matchType: r.matchType,
    pattern: r.pattern,
    amountMinCents: r.amountMinCents,
    amountMaxCents: r.amountMaxCents,
    accountId: r.accountId,
    setCategoryId: r.setCategoryId,
    setPayeeDisplay: r.setPayeeDisplay,
    enabled: r.enabled,
  };
}

export function createRule(
  db: Db,
  input: RuleInput,
  createdFromTxnId: string | null = null,
): CategoryRuleRow {
  if (input.matchType === "regex") {
    try {
      new RegExp(input.pattern, "i");
    } catch {
      throw new AppError(`"${input.pattern}" is not a valid regular expression`, "invalid");
    }
  }
  const ts = nowIso();
  const row = {
    id: newId(),
    priority: input.priority,
    matchField: input.matchField,
    matchType: input.matchType,
    pattern: input.pattern,
    amountMinCents: input.amountMinCents ?? null,
    amountMaxCents: input.amountMaxCents ?? null,
    accountId: input.accountId ?? null,
    setCategoryId: input.setCategoryId,
    setPayeeDisplay: input.setPayeeDisplay ?? null,
    enabled: input.enabled,
    hitCount: 0,
    createdFromTxnId,
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(categoryRules).values(row).run();
  logAudit(db, "rule", row.id, "create", undefined, row);
  return row;
}

export function updateRule(db: Db, id: string, patch: Partial<RuleInput>): void {
  const before = db.select().from(categoryRules).where(eq(categoryRules.id, id)).get();
  if (!before) throw new AppError("Rule not found", "not_found");
  db.update(categoryRules)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(categoryRules.id, id))
    .run();
  logAudit(db, "rule", id, "update", before, patch);
}

export function deleteRule(db: Db, id: string): void {
  const before = db.select().from(categoryRules).where(eq(categoryRules.id, id)).get();
  db.delete(categoryRules).where(eq(categoryRules.id, id)).run();
  logAudit(db, "rule", id, "delete", before, undefined);
}

/** Rules at or below this priority are overrides: they apply even to rows a file already categorized. */
export const OVERRIDE_PRIORITY = 10;

/**
 * Apply rules to the given transactions (or all uncategorized ones when ids is null).
 * Normally only touches rows with no category: a category set by a file hint or by you wins.
 * With `overridesOnly`, runs just the override rules (priority ≤ 10) and applies them regardless.
 * Returns the number of transactions categorized.
 */
export function applyRulesToTransactions(
  db: Db,
  ids: string[] | null,
  opts: { overridesOnly?: boolean } = {},
): number {
  const all = listRules(db).map(toDomainRule);
  const rules = opts.overridesOnly ? all.filter((r) => r.priority <= OVERRIDE_PRIORITY) : all;
  if (rules.length === 0) return 0;
  const base = db.select().from(transactions);
  const rows = ids
    ? ids.length
      ? base.where(inArray(transactions.id, ids)).all()
      : []
    : base.where(isNull(transactions.categoryId)).all();
  let n = 0;
  const hits = new Map<string, number>();
  const ts = nowIso();
  for (const t of rows) {
    if (t.transferId) continue;
    if (t.categoryId && !opts.overridesOnly) continue;
    const out = applyRules(rules, {
      accountId: t.accountId,
      amountCents: t.amountCents,
      payeeKey: t.payeeKey,
      payeeRaw: t.payeeRaw,
      memoRaw: t.memoRaw,
    });
    if (!out) continue;
    db.update(transactions)
      .set({
        categoryId: out.categoryId,
        payeeDisplay: out.payeeDisplay ?? t.payeeDisplay,
        updatedAt: ts,
      })
      .where(eq(transactions.id, t.id))
      .run();
    hits.set(out.ruleId, (hits.get(out.ruleId) ?? 0) + 1);
    n++;
  }
  for (const [ruleId, k] of hits) {
    const r = db
      .select({ hitCount: categoryRules.hitCount })
      .from(categoryRules)
      .where(eq(categoryRules.id, ruleId))
      .get();
    if (r)
      db.update(categoryRules)
        .set({ hitCount: r.hitCount + k })
        .where(eq(categoryRules.id, ruleId))
        .run();
  }
  return n;
}
