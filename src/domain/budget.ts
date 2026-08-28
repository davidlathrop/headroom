import { countsInReport, type ReportLine } from "./reports";
import type { Cents, MonthKey } from "./types";

/** One category in a budget with its monthly target (null = watched, no target). */
export interface BudgetItem {
  categoryId: string;
  targetCents: Cents | null;
}

export interface BudgetRow extends BudgetItem {
  /** Money out this month, positive. Refunds reduce it. */
  actualCents: Cents;
  /** target − actual; null when there is no target. Negative = over. */
  remainingCents: Cents | null;
  count: number;
}

export interface BudgetReport {
  month: MonthKey;
  rows: BudgetRow[];
  /** Sum of the targets that exist. */
  targetCents: Cents;
  /** Spend across every row, targeted or not. */
  actualCents: Cents;
  /** Spend across rows that have a target — the only spend `remainingCents` can honestly count. */
  targetedActualCents: Cents;
  remainingCents: Cents;
  partial: boolean;
}

/**
 * A budget may include a group (parent category) or its leaves, not both: a group line already
 * counts every leaf under it. Given both, the group wins and its leaves are dropped.
 * Order and duplicates: first occurrence wins, order preserved.
 */
export function normalizeSelection(
  items: BudgetItem[],
  parentOf: Map<string, string | null>,
): BudgetItem[] {
  const chosen = new Set(items.map((i) => i.categoryId));
  const out: BudgetItem[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.categoryId)) continue;
    const parent = parentOf.get(i.categoryId) ?? null;
    if (parent && chosen.has(parent)) continue;
    seen.add(i.categoryId);
    out.push({ categoryId: i.categoryId, targetCents: i.targetCents });
  }
  return out;
}

/**
 * Roll one month's lines up against a budget. A line belongs to the row for its own category,
 * or failing that to the row for its parent group. What counts is exactly what the month
 * report counts (countsInReport).
 */
export function buildBudgetReport(
  month: MonthKey,
  items: BudgetItem[],
  lines: ReportLine[],
  parentOf: Map<string, string | null>,
  partial: boolean,
): BudgetReport {
  const rows = new Map<string, BudgetRow>();
  for (const i of items)
    rows.set(i.categoryId, {
      categoryId: i.categoryId,
      targetCents: i.targetCents,
      actualCents: 0,
      remainingCents: i.targetCents,
      count: 0,
    });
  for (const l of lines) {
    if (!countsInReport(l) || l.categoryId == null) continue;
    const row = rows.get(l.categoryId) ?? rows.get(parentOf.get(l.categoryId) ?? "");
    if (!row) continue;
    row.actualCents += -l.amountCents;
    row.count++;
  }
  let target = 0,
    actual = 0,
    targetedActual = 0;
  for (const r of rows.values()) {
    actual += r.actualCents;
    if (r.targetCents != null) {
      r.remainingCents = r.targetCents - r.actualCents;
      target += r.targetCents;
      targetedActual += r.actualCents;
    }
  }
  return {
    month,
    rows: [...rows.values()],
    targetCents: target,
    actualCents: actual,
    targetedActualCents: targetedActual,
    remainingCents: target - targetedActual,
    partial,
  };
}
