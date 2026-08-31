import type { Cents, Flow, ISODate, MonthKey, SpendType } from "./types";

/** One reportable line: a transaction or one of its splits, already joined to its category. */
export interface ReportLine {
  transactionId: string;
  accountId: string;
  accountOnBudget: boolean;
  postedDate: ISODate;
  /** The date the line counts as: the user's override when set, else the posted date. */
  effectiveDate: ISODate;
  amountCents: Cents;
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryName: string | null;
  flow: Flow | null;
  spendType: SpendType | null;
  isTransfer: boolean;
  /** Flagged one-off: counts in its month, left out of cross-month statistics. */
  isOutlier: boolean;
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
  /** How much of the headline came from flagged outliers (included above; reported so it can be shown). */
  outliers: { count: number; incomeCents: Cents; spendCents: Cents; savedCents: Cents };
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
  const outliers = { count: 0, incomeCents: 0, spendCents: 0, savedCents: 0 };

  for (const l of lines) {
    if (!countsInReport(l)) continue;
    txnIds.add(l.transactionId);
    if (l.isOutlier) {
      outliers.count++;
      if (l.flow === "income" || (l.flow == null && l.amountCents > 0))
        outliers.incomeCents += l.amountCents;
      else if (l.flow === "saving") outliers.savedCents += -l.amountCents;
      else outliers.spendCents += -l.amountCents;
    }

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
    outliers,
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

export interface Slice<T> {
  name: string;
  amountCents: Cents;
  /** 0–1 of the positive total. */
  share: number;
  /** The items folded into this slice (one, or several for "Other"). */
  members: T[];
}

/**
 * Part-to-whole slices for a donut: largest first, at most `max` slices, the tail folded into
 * "Other" so a fixed categorical palette never runs out. Non-positive amounts are dropped.
 */
export function foldSlices<T extends { name: string; amountCents: Cents }>(
  items: T[],
  max = 6,
): Array<Slice<T>> {
  const sorted = items
    .filter((i) => i.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);
  const total = sorted.reduce((s, i) => s + i.amountCents, 0);
  if (total === 0) return [];
  const head = sorted.length > max ? sorted.slice(0, max - 1) : sorted;
  const tail = sorted.slice(head.length);
  const out: Array<Slice<T>> = head.map((i) => ({
    name: i.name,
    amountCents: i.amountCents,
    share: i.amountCents / total,
    members: [i],
  }));
  if (tail.length) {
    const amount = tail.reduce((s, i) => s + i.amountCents, 0);
    out.push({ name: "Other", amountCents: amount, share: amount / total, members: tail });
  }
  return out;
}
