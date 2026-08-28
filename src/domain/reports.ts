import type { Cents, Flow, ISODate, MonthKey, SpendType } from "./types";

/** One reportable line: a transaction or one of its splits, already joined to its category. */
export interface ReportLine {
  transactionId: string;
  accountId: string;
  accountOnBudget: boolean;
  postedDate: ISODate;
  amountCents: Cents;
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryName: string | null;
  flow: Flow | null;
  spendType: SpendType | null;
  isTransfer: boolean;
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  parentName: string | null;
  flow: Flow | null;
  spendType: SpendType | null;
  amountCents: Cents; // positive = money out for expense, money in for income
  count: number;
}

export interface MonthReport {
  month: MonthKey;
  incomeCents: Cents;
  spendFixedCents: Cents;
  spendVariableCents: Cents;
  spendCents: Cents;
  savedCents: Cents;
  leftOverCents: Cents;
  /** null when income is 0 */
  savingsRate: number | null;
  uncategorizedCents: Cents;
  uncategorizedCount: number;
  transactionCount: number;
  byCategory: CategoryTotal[];
  partial: boolean;
}

/**
 * Does a line count toward Income / Spend / Saved? Off-budget accounts, transfer and ignore flows
 * never do. A linked transfer normally doesn't either — unless its *paying* side was given a real
 * category: a mortgage payment to a tracked loan is Housing spend, a contribution to a tracked
 * brokerage is Saved. The receiving side of a transfer never counts, so nothing is double counted.
 */
export function countsInReport(
  l: Pick<ReportLine, "accountOnBudget" | "isTransfer" | "flow" | "categoryId" | "amountCents">,
): boolean {
  if (!l.accountOnBudget) return false;
  if (l.flow === "transfer" || l.flow === "ignore") return false;
  if (l.isTransfer) return l.categoryId != null && l.flow != null && l.amountCents < 0;
  return true;
}

/**
 * Roll up one month. Transfers and ignore-flow lines contribute nothing (see countsInReport).
 * Uncategorized lines are reported separately and counted in Spend (outflows) / Income (inflows)
 * so the headline never silently hides money — but they are flagged.
 */
export function buildMonthReport(
  month: MonthKey,
  lines: ReportLine[],
  partial: boolean,
): MonthReport {
  let income = 0,
    fixed = 0,
    variable = 0,
    saved = 0,
    uncat = 0,
    uncatCount = 0;
  const byCat = new Map<string, CategoryTotal>();
  const txnIds = new Set<string>();

  for (const l of lines) {
    if (!countsInReport(l)) continue;
    txnIds.add(l.transactionId);

    if (l.categoryId == null || l.flow == null) {
      uncatCount++;
      uncat += l.amountCents;
      if (l.amountCents < 0) variable += -l.amountCents;
      else income += l.amountCents;
      bump(
        byCat,
        "__uncategorized__",
        "Uncategorized",
        null,
        null,
        null,
        l.amountCents < 0 ? -l.amountCents : -l.amountCents,
      );
      continue;
    }

    switch (l.flow) {
      case "income":
        income += l.amountCents;
        bump(
          byCat,
          l.categoryId,
          l.categoryName!,
          l.parentCategoryName,
          l.flow,
          l.spendType,
          l.amountCents,
        );
        break;
      case "expense": {
        // outflow → positive spend; inflow (refund) → negative spend
        const spend = -l.amountCents;
        if (l.spendType === "fixed") fixed += spend;
        else variable += spend;
        bump(
          byCat,
          l.categoryId,
          l.categoryName!,
          l.parentCategoryName,
          l.flow,
          l.spendType,
          spend,
        );
        break;
      }
      case "saving":
        saved += -l.amountCents;
        bump(
          byCat,
          l.categoryId,
          l.categoryName!,
          l.parentCategoryName,
          l.flow,
          l.spendType,
          -l.amountCents,
        );
        break;
    }
  }
  const spend = fixed + variable;
  const leftOver = income - spend - saved;
  return {
    month,
    incomeCents: income,
    spendFixedCents: fixed,
    spendVariableCents: variable,
    spendCents: spend,
    savedCents: saved,
    leftOverCents: leftOver,
    savingsRate: income > 0 ? (saved + leftOver) / income : null,
    uncategorizedCents: uncat,
    uncategorizedCount: uncatCount,
    transactionCount: txnIds.size,
    byCategory: [...byCat.values()].sort(
      (a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents),
    ),
    partial,
  };
}

function bump(
  map: Map<string, CategoryTotal>,
  id: string,
  name: string,
  parentName: string | null,
  flow: Flow | null,
  spendType: SpendType | null,
  amount: Cents,
) {
  const cur = map.get(id);
  if (cur) {
    cur.amountCents += amount;
    cur.count++;
  } else {
    map.set(id, {
      categoryId: id === "__uncategorized__" ? null : id,
      name,
      parentName,
      flow,
      spendType,
      amountCents: amount,
      count: 1,
    });
  }
}

/** Coverage windows → is [start,end] fully covered? */
export function isRangeCovered(
  windows: Array<{ start: ISODate; end: ISODate }>,
  start: ISODate,
  end: ISODate,
): boolean {
  const sorted = [...windows].sort((a, b) => (a.start < b.start ? -1 : 1));
  let cursor = start;
  for (const w of sorted) {
    if (w.end < cursor) continue;
    if (w.start > cursor) return false; // gap before this window
    if (w.end >= end) return true;
    cursor = nextDay(w.end);
  }
  return false;
}

function nextDay(iso: ISODate): ISODate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
