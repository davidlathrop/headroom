import type { Db } from "@/db/client";
import {
  addMonths,
  daysInMonth,
  monthEnd,
  monthKey,
  monthStart,
  splitISO,
  today,
} from "@/domain/dates";
import { countsInReport, type MonthReport, type ReportLine } from "@/domain/reports";
import { listAccounts } from "./accounts";
import { listCategories } from "./categories";
import { accountBalance } from "./reconcile";
import { isMonthPartial, linesForRange, monthReport } from "./reports";
import { queryTransactions, type TransactionRow } from "./transactions";

export interface MonthPoint {
  month: string;
  incomeCents: number;
  spendCents: number;
  fixedCents: number;
  variableCents: number;
  savedCents: number;
  leftOverCents: number;
  savingsRate: number | null;
  netCashCents: number;
  partial: boolean;
}

export interface GroupTotal {
  /** Category id of the group (parent), or null for Uncategorized. */
  id: string | null;
  name: string;
  amountCents: number;
  items: Array<{ id: string | null; name: string; amountCents: number }>;
}

export interface StackedMonth {
  month: string;
  values: Record<string, number>;
  /** Group name → group id, for zoom links. */
  ids: Record<string, string | null>;
}

export interface Trends {
  months: MonthPoint[];
  spendByGroup: GroupTotal[];
  /** Top spend groups over the period (max 5) — the rest fold into "Other". */
  stackGroups: string[];
  stack: StackedMonth[];
}

const MAX_STACK_GROUPS = 5;

/** Leaf category id → its group id (a top-level category is its own group). */
function groupIndex(db: Db): Map<string, { groupId: string; groupName: string }> {
  const cats = listCategories(db, { includeArchived: true });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out = new Map<string, { groupId: string; groupName: string }>();
  for (const c of cats) {
    const parent = c.parentId ? byId.get(c.parentId) : null;
    out.set(
      c.id,
      parent
        ? { groupId: parent.id, groupName: parent.name }
        : { groupId: c.id, groupName: c.name },
    );
  }
  return out;
}

/** Spend lines only: expense flow or uncategorized outflows, on-budget, no transfers. */
function isSpendLine(l: ReportLine): boolean {
  if (!countsInReport(l)) return false;
  if (l.flow === "expense") return true;
  return l.flow == null && l.amountCents < 0;
}

function groupTotals(
  report: MonthReport,
  idx: Map<string, { groupId: string; groupName: string }>,
): Map<string | null, GroupTotal> {
  const groups = new Map<string | null, GroupTotal>();
  for (const c of report.byCategory) {
    if (c.flow !== "expense" && c.flow !== null) continue;
    const g = c.categoryId ? idx.get(c.categoryId) : null;
    const gid = g?.groupId ?? null;
    const gname = g?.groupName ?? "Uncategorized";
    const total = groups.get(gid) ?? { id: gid, name: gname, amountCents: 0, items: [] };
    total.amountCents += c.amountCents;
    const item = total.items.find((i) => i.id === c.categoryId);
    if (item) item.amountCents += c.amountCents;
    else total.items.push({ id: c.categoryId, name: c.name, amountCents: c.amountCents });
    groups.set(gid, total);
  }
  return groups;
}

/** Everything the Trends overview draws, for the last `n` months ending with the current one. */
export function trends(db: Db, n: number, asOf = today()): Trends {
  const last = monthKey(asOf);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(addMonths(last, -i));
  const accounts = listAccounts(db).filter((a) => a.onBudget);
  const idx = groupIndex(db);
  const reports = new Map<string, MonthReport>();
  const months: MonthPoint[] = keys.map((m) => {
    const r = monthReport(db, m);
    reports.set(m, r);
    const end = monthEnd(m) < asOf ? monthEnd(m) : asOf;
    const netCash = accounts.reduce((s, a) => s + accountBalance(db, a.id, end).balanceCents, 0);
    return {
      month: m,
      incomeCents: r.incomeCents,
      spendCents: r.spendCents,
      fixedCents: r.spendFixedCents,
      variableCents: r.spendVariableCents,
      savedCents: r.savedCents,
      leftOverCents: r.leftOverCents,
      savingsRate: r.savingsRate,
      netCashCents: netCash,
      partial: r.partial,
    };
  });

  const period = new Map<string | null, GroupTotal>();
  const perMonth = new Map<string, Map<string | null, GroupTotal>>();
  for (const m of keys) {
    const g = groupTotals(reports.get(m)!, idx);
    perMonth.set(m, g);
    for (const [gid, t] of g) {
      const cur = period.get(gid) ?? { id: gid, name: t.name, amountCents: 0, items: [] };
      cur.amountCents += t.amountCents;
      for (const it of t.items) {
        const ex = cur.items.find((i) => i.id === it.id);
        if (ex) ex.amountCents += it.amountCents;
        else cur.items.push({ ...it });
      }
      period.set(gid, cur);
    }
  }
  const spendByGroup = [...period.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.amountCents - a.amountCents) }))
    .filter((g) => g.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);
  const top = spendByGroup.slice(0, MAX_STACK_GROUPS);
  const hasOther = spendByGroup.length > MAX_STACK_GROUPS;
  const stack: StackedMonth[] = keys.map((m) => {
    const values: Record<string, number> = {};
    const ids: Record<string, string | null> = {};
    let other = 0;
    for (const [gid, t] of perMonth.get(m) ?? []) {
      const inTop = top.find((g) => g.id === gid);
      if (inTop) {
        values[inTop.name] = Math.max(0, t.amountCents);
        ids[inTop.name] = gid;
      } else other += Math.max(0, t.amountCents);
    }
    if (hasOther) values["Other"] = other;
    return { month: m, values, ids };
  });
  return {
    months,
    spendByGroup,
    stackGroups: hasOther ? [...top.map((g) => g.name), "Other"] : top.map((g) => g.name),
    stack,
  };
}

/* ------------------------------------------------------------ month zoom */

export interface MonthZoom {
  month: string;
  prevMonth: string;
  report: MonthReport & { gaps: Array<{ accountId: string; accountName: string }> };
  groups: GroupTotal[];
  /** Cumulative spend by day of month; null once past today (current month) or beyond the month's length. */
  cumulative: Array<{ day: number; thisMonth: number | null; prevMonth: number | null }>;
}

function cumulativeSpend(db: Db, month: string, asOf: string): Array<number | null> {
  const start = monthStart(month);
  const end = monthEnd(month);
  const days = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const perDay = new Array<number>(days + 1).fill(0);
  for (const l of linesForRange(db, start, end)) {
    if (!isSpendLine(l)) continue;
    const d = splitISO(l.postedDate).d;
    perDay[d] = (perDay[d] ?? 0) - l.amountCents;
  }
  const lastDay = end <= asOf ? days : monthKey(asOf) === month ? splitISO(asOf).d : 0;
  const out: Array<number | null> = [];
  let acc = 0;
  for (let d = 1; d <= days; d++) {
    acc += perDay[d]!;
    out.push(d <= lastDay ? acc : null);
  }
  return out;
}

export function monthZoom(db: Db, month: string, asOf = today()): MonthZoom {
  const report = monthReport(db, month);
  const idx = groupIndex(db);
  const groups = [...groupTotals(report, idx).values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.amountCents - a.amountCents) }))
    .filter((g) => g.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);
  const prevMonth = addMonths(month, -1);
  const cur = cumulativeSpend(db, month, asOf);
  const prev = cumulativeSpend(db, prevMonth, asOf);
  const days = Math.max(cur.length, prev.length);
  const cumulative = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    thisMonth: cur[i] ?? null,
    prevMonth: prev[i] ?? null,
  }));
  return { month, prevMonth, report, groups, cumulative };
}

/* --------------------------------------------------------- category zoom */

export interface CategoryZoom {
  id: string | null;
  name: string;
  groupName: string | null;
  isGroup: boolean;
  /** Total over the scope (a month, or the whole period). */
  totalCents: number;
  /** Subcategory totals over the scope (only for a group). */
  children: Array<{ id: string | null; name: string; amountCents: number }>;
  history: Array<{ month: string; amountCents: number; partial: boolean }>;
  transactions: TransactionRow[];
  transactionCount: number;
}

/** `categoryId` may be a group, a leaf, or null for Uncategorized. `month` null = the whole `n`-month period. */
export function categoryZoom(
  db: Db,
  categoryId: string | null,
  month: string | null,
  n: number,
  asOf = today(),
): CategoryZoom | null {
  const cats = listCategories(db, { includeArchived: true });
  const cat = categoryId ? cats.find((c) => c.id === categoryId) : null;
  if (categoryId && !cat) return null;
  const idx = groupIndex(db);
  const isGroup = cat ? !cat.parentId : true; // Uncategorized behaves like a group with one child
  const groupName = cat?.parentId ? (cats.find((c) => c.id === cat.parentId)?.name ?? null) : null;
  const belongs = (l: ReportLine) => {
    if (!isSpendLine(l)) return false;
    if (categoryId == null) return l.categoryId == null;
    if (l.categoryId === categoryId) return true;
    return isGroup && idx.get(l.categoryId ?? "")?.groupId === categoryId;
  };

  const last = monthKey(asOf);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(addMonths(last, -i));
  const scopeMonths = month ? [month] : keys;
  const historyMonths =
    month && !keys.includes(month) ? [...keys.filter((k) => k < month), month] : keys;

  const children = new Map<
    string | null,
    { id: string | null; name: string; amountCents: number }
  >();
  let total = 0;
  const history = historyMonths.map((m) => {
    let sum = 0;
    for (const l of linesForRange(db, monthStart(m), monthEnd(m))) {
      if (!belongs(l)) continue;
      const v = -l.amountCents;
      sum += v;
      if (scopeMonths.includes(m)) {
        total += v;
        const key = l.categoryId;
        const c = children.get(key) ?? {
          id: key,
          name: l.categoryName ?? "Uncategorized",
          amountCents: 0,
        };
        c.amountCents += v;
        children.set(key, c);
      }
    }
    return { month: m, amountCents: sum, partial: isMonthPartial(db, m).partial };
  });
  const q = queryTransactions(db, {
    month: month ?? undefined,
    categoryId: categoryId ?? undefined,
    uncategorized: categoryId == null,
    limit: 300,
  });
  // Without a month, restrict the listing to the period.
  const periodStart = monthStart(keys[0]!);
  const rows = month ? q.rows : q.rows.filter((t) => t.postedDate >= periodStart);
  return {
    id: categoryId,
    name: cat?.name ?? "Uncategorized",
    groupName,
    isGroup,
    totalCents: total,
    children:
      isGroup && categoryId != null
        ? [...children.values()].sort((a, b) => b.amountCents - a.amountCents)
        : [],
    history,
    transactions: rows.filter((t) => t.amountCents !== 0),
    transactionCount: month ? q.total : rows.length,
  };
}
