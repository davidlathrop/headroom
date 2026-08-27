import { addDays, addMonths, monthEnd, monthKey, monthStart } from "./dates";
import { expectedDates, type Cadence } from "./recurring";
import type { Cents, Flow, ISODate, MonthKey, SpendType } from "./types";

export interface ForecastSeries {
  id: string;
  label: string;
  categoryId: string | null;
  flow: Flow | null;
  spendType: SpendType | null;
  cadence: Cadence;
  anchorDay: number | null;
  /** Signed as seen from its own account. */
  typicalAmountCents: Cents;
  nextExpectedDate: ISODate;
  isFixedAmount: boolean;
  /** The series lives in a checking/savings account (so it moves cash). */
  accountIsCash: boolean;
  confirmed: boolean;
}

/** A series is forecast as a fixed commitment when its category is fixed or its amount barely varies. */
export function isFixedSeries(s: Pick<ForecastSeries, "flow" | "spendType" | "isFixedAmount">): boolean {
  return s.flow === "expense" && (s.spendType === "fixed" || s.isFixedAmount);
}

export interface PlannedItem {
  id: string;
  name: string;
  date: ISODate;
  /** Signed: negative = a cost, positive = money in. */
  amountCents: Cents;
}

export interface ForecastInput {
  today: ISODate;
  months: number;
  series: ForecastSeries[];
  /** Monthly median spend per variable category over complete months, excluding fixed-series members. Positive. */
  variableMedians: Array<{ categoryId: string | null; name: string; medianCents: Cents }>;
  /** Monthly median of income not explained by an income series. */
  nonRecurringIncomeMedianCents: Cents;
  planned: PlannedItem[];
  currentMonth: {
    incomeCents: Cents;
    fixedCents: Cents;
    variableByCategory: Array<{ categoryId: string | null; amountCents: Cents }>;
    savedCents: Cents;
  };
  /** Cash accounts − card balances, today. */
  netCashCents: Cents;
  /** Checking + savings, today. */
  cashBalanceCents: Cents;
  /** Median monthly variable spend that hits cash accounts directly (debit card, ACH). */
  variableCashPerMonthCents: Cents;
  bufferCents: Cents;
  avgMonthlySpendCents: Cents;
}

export interface MonthProjection {
  month: MonthKey;
  isCurrent: boolean;
  incomeCents: Cents;
  fixedCents: Cents;
  variableCents: Cents;
  savedCents: Cents;
  plannedCents: Cents; // signed
  leftOverCents: Cents;
  netCashEndCents: Cents;
  items: Array<{ label: string; date: ISODate; amountCents: Cents; kind: "income" | "fixed" | "saving" | "planned" }>;
}

export interface CashPoint {
  date: ISODate;
  balanceCents: Cents;
  events: Array<{ label: string; amountCents: Cents }>;
}

export interface Forecast {
  months: MonthProjection[];
  cashCurve: CashPoint[];
  nextIncomeDate: ISODate | null;
  lowestPoint: { date: ISODate; balanceCents: Cents } | null;
  safeToSpendCents: Cents | null;
  bufferCents: Cents;
  emergencyFundMonths: number | null;
  unconfirmedSeriesCount: number;
}

export function buildForecast(input: ForecastInput): Forecast {
  const { today } = input;
  const thisMonth = monthKey(today);
  const months: MonthProjection[] = [];
  let netCash = input.netCashCents;
  const variableMedianTotal = input.variableMedians.reduce((s, v) => s + v.medianCents, 0);

  for (let i = 0; i < input.months; i++) {
    const m = addMonths(thisMonth, i);
    const isCurrent = i === 0;
    const from = isCurrent ? addDays(today, 1) : monthStart(m);
    const to = monthEnd(m);
    const items: MonthProjection["items"] = [];
    let income = 0,
      fixed = 0,
      saved = 0,
      planned = 0;
    for (const s of input.series) {
      if (s.flow === "transfer" || s.flow === "ignore") continue;
      for (const d of expectedDates(s, from, to)) {
        const amt = s.typicalAmountCents;
        if (s.flow === "income") {
          income += amt;
          items.push({ label: s.label, date: d, amountCents: amt, kind: "income" });
        } else if (s.flow === "saving") {
          saved += -amt;
          items.push({ label: s.label, date: d, amountCents: amt, kind: "saving" });
        } else if (isFixedSeries(s)) {
          fixed += -amt;
          items.push({ label: s.label, date: d, amountCents: amt, kind: "fixed" });
        }
      }
    }
    for (const p of input.planned) {
      if (p.date >= from && p.date <= to) {
        planned += p.amountCents;
        items.push({ label: p.name, date: p.date, amountCents: p.amountCents, kind: "planned" });
      }
    }
    let variable: number;
    if (isCurrent) {
      // Blend: what already happened plus what the medians say is still to come.
      const actualByCat = new Map(input.currentMonth.variableByCategory.map((v) => [v.categoryId, v.amountCents]));
      variable = 0;
      const seen = new Set<string | null>();
      for (const v of input.variableMedians) {
        seen.add(v.categoryId);
        variable += Math.max(actualByCat.get(v.categoryId) ?? 0, v.medianCents);
      }
      for (const [cat, amt] of actualByCat) if (!seen.has(cat)) variable += amt;
      income += input.currentMonth.incomeCents;
      fixed += input.currentMonth.fixedCents;
      saved += input.currentMonth.savedCents;
    } else {
      variable = variableMedianTotal;
      income += input.nonRecurringIncomeMedianCents;
    }
    const leftOver = income - fixed - variable - saved + planned;
    if (isCurrent) {
      // Net cash today already reflects this month's actuals; only the remainder moves it.
      const remainingVariable = Math.max(0, variable - input.currentMonth.variableByCategory.reduce((s, v) => s + v.amountCents, 0));
      netCash += income - input.currentMonth.incomeCents - (fixed - input.currentMonth.fixedCents) - remainingVariable - (saved - input.currentMonth.savedCents) + planned;
    } else {
      netCash += leftOver;
    }
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
    months.push({ month: m, isCurrent, incomeCents: income, fixedCents: fixed, variableCents: variable, savedCents: saved, plannedCents: planned, leftOverCents: leftOver, netCashEndCents: netCash, items });
  }

  // 60-day cash curve on cash accounts only.
  const horizon = addDays(today, 60);
  const perDayVariable = Math.round(input.variableCashPerMonthCents / 30);
  const eventsByDay = new Map<ISODate, CashPoint["events"]>();
  const push = (d: ISODate, e: { label: string; amountCents: Cents }) => {
    const l = eventsByDay.get(d) ?? [];
    l.push(e);
    eventsByDay.set(d, l);
  };
  for (const s of input.series) {
    if (!s.accountIsCash || s.flow === "ignore") continue;
    for (const d of expectedDates(s, addDays(today, 1), horizon)) push(d, { label: s.label, amountCents: s.typicalAmountCents });
  }
  for (const p of input.planned) if (p.date > today && p.date <= horizon) push(p.date, { label: p.name, amountCents: p.amountCents });
  const curve: CashPoint[] = [{ date: today, balanceCents: input.cashBalanceCents, events: [] }];
  let bal = input.cashBalanceCents;
  for (let i = 1; i <= 60; i++) {
    const d = addDays(today, i);
    const ev = eventsByDay.get(d) ?? [];
    bal += ev.reduce((s, e) => s + e.amountCents, 0) - perDayVariable;
    curve.push({ date: d, balanceCents: bal, events: ev });
  }
  const nextIncome = curve.find((p) => p.date > today && p.events.some((e) => e.amountCents > 0 && input.series.some((s) => s.flow === "income" && s.label === e.label)));
  const nextIncomeDate = nextIncome?.date ?? null;
  const window = curve.filter((p) => p.date >= today && (nextIncomeDate ? p.date < nextIncomeDate : true));
  const lowest = window.reduce<CashPoint | null>((min, p) => (min == null || p.balanceCents < min.balanceCents ? p : min), null);
  const lowestPoint = lowest ? { date: lowest.date, balanceCents: lowest.balanceCents } : null;
  return {
    months,
    cashCurve: curve,
    nextIncomeDate,
    lowestPoint,
    safeToSpendCents: lowestPoint ? lowestPoint.balanceCents - input.bufferCents : null,
    bufferCents: input.bufferCents,
    emergencyFundMonths: input.avgMonthlySpendCents > 0 ? input.netCashCents / input.avgMonthlySpendCents : null,
    unconfirmedSeriesCount: input.series.filter((s) => !s.confirmed).length,
  };
}
