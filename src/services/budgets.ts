import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { budgetCategories, budgets, type Budget, type Category } from "@/db/schema";
import {
  buildBudgetReport,
  normalizeSelection,
  type BudgetItem,
  type BudgetReport,
  type BudgetRow,
} from "@/domain/budget";
import { addMonths, monthEnd, monthStart } from "@/domain/dates";
import { buildMonthReport } from "@/domain/reports";
import type { MonthKey } from "@/domain/types";
import { logAudit } from "./audit";
import { listCategories } from "./categories";
import { AppError, newId, nowIso } from "./context";
import { isMonthPartial, linesForRange } from "./reports";

export const budgetItemInput = z.object({
  categoryId: z.string().min(1),
  targetCents: z.number().int().min(0).nullable(),
});
export const budgetInput = z.object({
  name: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).default(""),
  items: z.array(budgetItemInput).min(1, "Pick at least one category"),
});
export type BudgetInput = z.infer<typeof budgetInput>;

/** Leaf id (or group id) → parent group id, for every category ever created. */
function parentIndex(db: Db): Map<string, string | null> {
  return new Map(listCategories(db, { includeArchived: true }).map((c) => [c.id, c.parentId]));
}

/** Categories a budget may watch: money-out flows only, grouped for the picker. */
export function selectableCategoryGroups(db: Db): Array<{ group: Category; children: Category[] }> {
  const all = listCategories(db).filter(
    (c) => !c.isSystem && (c.flow === "expense" || c.flow === "saving"),
  );
  return all
    .filter((c) => c.parentId == null)
    .map((group) => ({ group, children: all.filter((c) => c.parentId === group.id) }));
}

export function listBudgets(db: Db, opts: { includeArchived?: boolean } = {}): Budget[] {
  const q = db.select().from(budgets).orderBy(asc(budgets.name));
  return opts.includeArchived ? q.all() : q.where(isNull(budgets.archivedAt)).all();
}

export function getBudget(db: Db, id: string): Budget {
  const b = db.select().from(budgets).where(eq(budgets.id, id)).get();
  if (!b) throw new AppError("Budget not found", "not_found");
  return b;
}

export function listBudgetItems(db: Db, budgetId: string): BudgetItem[] {
  return db
    .select({ categoryId: budgetCategories.categoryId, targetCents: budgetCategories.targetCents })
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budgetId))
    .orderBy(asc(budgetCategories.sortOrder), asc(budgetCategories.createdAt))
    .all();
}

/** Validate ids, drop leaves whose group is also chosen, and keep the picker's order. */
function cleanItems(db: Db, items: BudgetItem[]): BudgetItem[] {
  const known = new Set(listCategories(db, { includeArchived: true }).map((c) => c.id));
  for (const i of items)
    if (!known.has(i.categoryId)) throw new AppError(`Unknown category ${i.categoryId}`, "invalid");
  const cleaned = normalizeSelection(items, parentIndex(db));
  if (cleaned.length === 0) throw new AppError("Pick at least one category", "invalid");
  return cleaned;
}

function writeItems(db: Db, budgetId: string, items: BudgetItem[]): void {
  const ts = nowIso();
  db.delete(budgetCategories).where(eq(budgetCategories.budgetId, budgetId)).run();
  items.forEach((i, k) =>
    db
      .insert(budgetCategories)
      .values({
        id: newId(),
        budgetId,
        categoryId: i.categoryId,
        targetCents: i.targetCents,
        sortOrder: k,
        createdAt: ts,
        updatedAt: ts,
      })
      .run(),
  );
}

export function createBudget(db: Db, input: BudgetInput): Budget {
  const parsed = budgetInput.parse(input);
  const items = cleanItems(db, parsed.items);
  const ts = nowIso();
  const row = {
    id: newId(),
    name: parsed.name,
    note: parsed.note,
    archivedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
  db.transaction((tx) => {
    tx.insert(budgets).values(row).run();
    writeItems(tx, row.id, items);
  });
  logAudit(db, "budget", row.id, "create", undefined, { ...row, items });
  return getBudget(db, row.id);
}

export function updateBudget(db: Db, id: string, input: BudgetInput): Budget {
  const before = getBudget(db, id);
  const beforeItems = listBudgetItems(db, id);
  const parsed = budgetInput.parse(input);
  const items = cleanItems(db, parsed.items);
  const ts = nowIso();
  db.transaction((tx) => {
    tx.update(budgets)
      .set({ name: parsed.name, note: parsed.note, updatedAt: ts })
      .where(eq(budgets.id, id))
      .run();
    writeItems(tx, id, items);
  });
  logAudit(
    db,
    "budget",
    id,
    "update",
    { ...before, items: beforeItems },
    { name: parsed.name, note: parsed.note, items },
  );
  return getBudget(db, id);
}

export function deleteBudget(db: Db, id: string): void {
  const before = getBudget(db, id);
  const items = listBudgetItems(db, id);
  db.transaction((tx) => {
    tx.delete(budgetCategories).where(eq(budgetCategories.budgetId, id)).run();
    tx.delete(budgets).where(eq(budgets.id, id)).run();
  });
  logAudit(db, "budget", id, "delete", { ...before, items }, undefined);
}

export interface BudgetRowView extends BudgetRow {
  name: string;
  groupName: string | null;
  /** True when the row is a whole group, not one category. */
  isGroup: boolean;
  /** The same line in the month before, for "how did I do" without a target. */
  previousActualCents: number;
  /** This line's share of the budget's total spend this month, 0–1. */
  share: number;
}

export interface BudgetReportView extends BudgetReport {
  budget: Budget;
  rows: BudgetRowView[];
  gaps: Array<{ accountId: string; accountName: string }>;
  previousMonth: MonthKey;
  previousActualCents: number;
  transactionCount: number;
  hasTargets: boolean;
}

export function budgetReport(db: Db, budgetId: string, month: MonthKey): BudgetReportView {
  const budget = getBudget(db, budgetId);
  const items = listBudgetItems(db, budgetId);
  const cats = listCategories(db, { includeArchived: true });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  const { partial, gaps } = isMonthPartial(db, month);
  const report = buildBudgetReport(
    month,
    items,
    linesForRange(db, monthStart(month), monthEnd(month)),
    parentOf,
    partial,
  );
  const previousMonth = addMonths(month, -1);
  const previous = buildBudgetReport(
    previousMonth,
    items,
    linesForRange(db, monthStart(previousMonth), monthEnd(previousMonth)),
    parentOf,
    false,
  );
  const prevByCat = new Map(previous.rows.map((r) => [r.categoryId, r.actualCents]));
  return {
    ...report,
    budget,
    gaps,
    previousMonth,
    previousActualCents: previous.actualCents,
    transactionCount: report.rows.reduce((n, r) => n + r.count, 0),
    hasTargets: items.some((i) => i.targetCents != null),
    rows: report.rows.map((r) => {
      const c = byId.get(r.categoryId);
      const parent = c?.parentId ? byId.get(c.parentId) : null;
      return {
        ...r,
        name: c?.name ?? "?",
        groupName: parent?.name ?? null,
        isGroup: !!c && c.parentId == null,
        previousActualCents: prevByCat.get(r.categoryId) ?? 0,
        share: report.actualCents > 0 ? Math.max(0, r.actualCents) / report.actualCents : 0,
      };
    }),
  };
}

/** Total spend against a budget for each of the given months — the month strip on the budget page. */
export function budgetHistory(
  db: Db,
  budgetId: string,
  months: MonthKey[],
): Array<{ month: MonthKey; actualCents: number; partial: boolean }> {
  const items = listBudgetItems(db, budgetId);
  const parentOf = parentIndex(db);
  return months.map((m) => {
    const partial = isMonthPartial(db, m).partial;
    const r = buildBudgetReport(
      m,
      items,
      linesForRange(db, monthStart(m), monthEnd(m)),
      parentOf,
      partial,
    );
    return { month: m, actualCents: r.actualCents, partial };
  });
}

/** Every active budget with its report for one month — the list page and the home summary. */
export function budgetSummaries(db: Db, month: MonthKey): BudgetReportView[] {
  return listBudgets(db).map((b) => budgetReport(db, b.id, month));
}

export interface BudgetPeriodMonth {
  month: MonthKey;
  partial: boolean;
  /** Spend in the budget's categories. */
  actualCents: number;
  targetCents: number;
  /** Spend across every expense category (uncategorized outflows included), same as the month report. */
  allSpendCents: number;
  /** Budget line (categoryId) → spend that month. */
  byRow: Record<string, number>;
}

export interface BudgetPeriod {
  months: BudgetPeriodMonth[];
  /** The budget's lines, in order, with display names. */
  lines: Array<{ categoryId: string; name: string; isGroup: boolean }>;
  /** Every expense category with spend in the period, largest first; `inBudget` marks the budget's own. */
  breakdown: Array<{
    categoryId: string | null;
    name: string;
    groupName: string | null;
    amountCents: number;
    inBudget: boolean;
  }>;
  totals: { actualCents: number; targetCents: number; allSpendCents: number };
}

/** The budget against all spending over several months — the charts on the budget page. */
export function budgetPeriod(db: Db, budgetId: string, months: MonthKey[]): BudgetPeriod {
  const items = listBudgetItems(db, budgetId);
  const chosen = new Set(items.map((i) => i.categoryId));
  const cats = listCategories(db, { includeArchived: true });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  const inBudget = (id: string | null) =>
    id != null && (chosen.has(id) || chosen.has(parentOf.get(id) ?? ""));
  const breakdown = new Map<string | null, BudgetPeriod["breakdown"][number]>();
  const totals = { actualCents: 0, targetCents: 0, allSpendCents: 0 };

  const out = months.map((m) => {
    const partial = isMonthPartial(db, m).partial;
    const lines = linesForRange(db, monthStart(m), monthEnd(m));
    const r = buildBudgetReport(m, items, lines, parentOf, partial);
    const all = buildMonthReport(m, lines, partial);
    for (const c of all.byCategory) {
      if (c.flow !== "expense" && c.flow !== null) continue;
      const cur = breakdown.get(c.categoryId) ?? {
        categoryId: c.categoryId,
        name: c.name,
        groupName: c.parentName,
        amountCents: 0,
        inBudget: inBudget(c.categoryId),
      };
      cur.amountCents += c.amountCents;
      breakdown.set(c.categoryId, cur);
    }
    totals.actualCents += r.actualCents;
    totals.targetCents += r.targetCents;
    totals.allSpendCents += all.spendCents;
    return {
      month: m,
      partial,
      actualCents: r.actualCents,
      targetCents: r.targetCents,
      allSpendCents: all.spendCents,
      byRow: Object.fromEntries(r.rows.map((x) => [x.categoryId, x.actualCents])),
    };
  });
  return {
    months: out,
    lines: items.map((i) => {
      const c = byId.get(i.categoryId);
      return { categoryId: i.categoryId, name: c?.name ?? "?", isGroup: !!c && c.parentId == null };
    }),
    breakdown: [...breakdown.values()]
      .filter((b) => b.amountCents > 0)
      .sort((a, b) => b.amountCents - a.amountCents),
    totals,
  };
}
