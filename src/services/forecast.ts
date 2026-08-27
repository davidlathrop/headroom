import type { Db } from "@/db/client";
import { addMonths, monthEnd, monthKey, monthStart, today } from "@/domain/dates";
import {
  buildForecast,
  isFixedSeries,
  type Forecast,
  type ForecastSeries,
} from "@/domain/forecast";
import { median } from "@/domain/money";
import { listAccounts } from "./accounts";
import { listCategories } from "./categories";
import { listPlanned } from "./planned";
import { accountBalance } from "./reconcile";
import { isMonthPartial, linesForRange, listMonthKeys } from "./reports";
import { listSeries, refreshRecurringSeries, seriesKey, seriesLabel } from "./recurring";
import { getSetting } from "./settings";

export interface ForecastView extends Forecast {
  series: Array<
    ForecastSeries & {
      status: string;
      cadence: string;
      nextExpectedDate: string;
      accountName: string;
      occurrencesLabel: string;
    }
  >;
  completeMonths: string[];
  /** Months used that had a coverage gap in some account (only when there weren't enough complete ones). */
  partialMonthsUsed: string[];
  variableMedians: Array<{ categoryId: string | null; name: string; medianCents: number }>;
}

/** Assemble everything the forecast engine needs from the ledger and run it. */
export function forecastView(db: Db, asOf = today(), months = 12): ForecastView {
  const detected = refreshRecurringSeries(db, asOf);
  const accounts = listAccounts(db);
  const categories = listCategories(db, { includeArchived: true });
  const cat = (id: string | null) => (id ? categories.find((c) => c.id === id) : undefined);
  const acct = (id: string) => accounts.find((a) => a.id === id);

  const rows = listSeries(db).filter(
    (s): s is typeof s & { accountId: string } =>
      (s.status === "confirmed" || s.status === "detected") &&
      !!s.accountId &&
      !!acct(s.accountId) &&
      !acct(s.accountId)!.archivedAt,
  );
  const series: ForecastView["series"] = rows.map((s) => {
    const c = cat(s.categoryId);
    const a = acct(s.accountId)!;
    const d = detected.get(seriesKey(s));
    return {
      id: s.id,
      label: seriesLabel(s, categories, a.name),
      categoryId: s.categoryId,
      flow: c?.flow ?? (s.typicalAmountCents > 0 ? "income" : "expense"),
      spendType: c?.spendType ?? null,
      cadence: s.cadence,
      anchorDay: s.anchorDay,
      typicalAmountCents: s.typicalAmountCents,
      nextExpectedDate: s.nextExpectedDate,
      isFixedAmount: s.amountMadCents / Math.max(1, Math.abs(s.typicalAmountCents)) <= 0.05,
      accountIsCash: a.kind === "checking" || a.kind === "savings",
      confirmed: s.status === "confirmed",
      status: s.status,
      accountName: a.name,
      occurrencesLabel: d ? `${d.occurrences}× · last ${s.lastSeenDate}` : "",
    };
  });

  // Members of income series and fixed series are explained by the series; leave them out of the medians.
  const explained = new Set<string>();
  for (const s of rows) {
    const d = detected.get(seriesKey(s));
    if (!d) continue;
    const c = cat(s.categoryId);
    const flow = c?.flow ?? (s.typicalAmountCents > 0 ? "income" : "expense");
    if (
      flow === "income" ||
      flow === "saving" ||
      isFixedSeries({ flow, spendType: c?.spendType ?? null, isFixedAmount: d.isFixedAmount })
    )
      for (const id of d.memberIds) explained.add(id);
  }

  // Trailing months for the medians: complete-coverage months first (looking back at most 8).
  // If there aren't enough — typically an account that hasn't been imported in a while — fall
  // back to the most recent months that have data at all, and say so.
  const windowMonths = getSetting<number>(db, "forecast.trailingMonths", 3);
  const thisMonth = monthKey(asOf);
  const completeMonths: string[] = [];
  const partialCandidates: string[] = [];
  const monthsWithData = new Set(listMonthKeys(db));
  for (let i = 1; i <= 8 && completeMonths.length < windowMonths; i++) {
    const m = addMonths(thisMonth, -i);
    if (!monthsWithData.has(m)) continue;
    if (!isMonthPartial(db, m).partial) completeMonths.push(m);
    else partialCandidates.push(m);
  }
  const partialMonthsUsed = partialCandidates.slice(
    0,
    Math.max(0, windowMonths - completeMonths.length),
  );
  completeMonths.push(...partialMonthsUsed);
  completeMonths.sort((a, b) => (a < b ? 1 : -1));
  const perMonth = completeMonths.map((m) =>
    linesForRange(db, monthStart(m), monthEnd(m)).filter(
      (l) => l.accountOnBudget && !l.isTransfer && l.flow !== "transfer" && l.flow !== "ignore",
    ),
  );
  const cashAccountIds = new Set(
    accounts.filter((a) => a.kind === "checking" || a.kind === "savings").map((a) => a.id),
  );

  const variableCats = new Map<string | null, number[]>();
  const nonRecurringIncome: number[] = [];
  const cashVariable: number[] = [];
  const totalSpend: number[] = [];
  for (const lines of perMonth) {
    const byCat = new Map<string | null, number>();
    let income = 0,
      cashVar = 0,
      spend = 0;
    for (const l of lines) {
      const isVariableExpense = (l.flow === "expense" && l.spendType !== "fixed") || l.flow == null;
      if (l.flow === "expense" || l.flow == null) spend += -l.amountCents;
      if (isVariableExpense && !explained.has(l.transactionId)) {
        byCat.set(l.categoryId, (byCat.get(l.categoryId) ?? 0) + -l.amountCents);
        if (cashAccountIds.has(l.accountId)) cashVar += -l.amountCents;
      }
      if (l.flow === "income" && !explained.has(l.transactionId)) income += l.amountCents;
    }
    for (const [c, v] of byCat) variableCats.set(c, [...(variableCats.get(c) ?? []), v]);
    nonRecurringIncome.push(income);
    cashVariable.push(cashVar);
    totalSpend.push(spend);
  }
  const variableMedians = [...variableCats.entries()]
    .map(([categoryId, values]) => ({
      categoryId,
      name: categoryId ? (cat(categoryId)?.name ?? "?") : "Uncategorized",
      medianCents: Math.max(0, median(padTo(values, completeMonths.length))),
    }))
    .filter((v) => v.medianCents > 0)
    .sort((a, b) => b.medianCents - a.medianCents);

  // Current month actuals.
  const curLines = linesForRange(db, monthStart(thisMonth), asOf).filter(
    (l) => l.accountOnBudget && !l.isTransfer && l.flow !== "transfer" && l.flow !== "ignore",
  );
  const curVar = new Map<string | null, number>();
  let curIncome = 0,
    curFixed = 0,
    curSaved = 0;
  for (const l of curLines) {
    if (l.flow === "income") curIncome += l.amountCents;
    else if (l.flow === "saving") curSaved += -l.amountCents;
    else if (l.flow === "expense" && (l.spendType === "fixed" || explained.has(l.transactionId)))
      curFixed += -l.amountCents;
    else curVar.set(l.categoryId, (curVar.get(l.categoryId) ?? 0) + -l.amountCents);
  }

  let cash = 0,
    netCash = 0;
  for (const a of accounts) {
    if (!a.onBudget) continue;
    const b = accountBalance(db, a.id, asOf).balanceCents;
    netCash += b;
    if (cashAccountIds.has(a.id)) cash += b;
  }
  const lastFixed =
    perMonth[0]
      ?.filter(
        (l) => l.flow === "expense" && (l.spendType === "fixed" || explained.has(l.transactionId)),
      )
      .reduce((s, l) => s + -l.amountCents, 0) ?? 0;
  const bufferCents = getSetting<number | null>(db, "forecast.bufferCents", null) ?? lastFixed;

  const forecast = buildForecast({
    today: asOf,
    months,
    series,
    variableMedians,
    nonRecurringIncomeMedianCents: median(nonRecurringIncome),
    planned: listPlanned(db).map((p) => ({
      id: p.id,
      name: p.name,
      date: p.date,
      amountCents: p.amountCents,
    })),
    currentMonth: {
      incomeCents: curIncome,
      fixedCents: curFixed,
      variableByCategory: [...curVar.entries()].map(([categoryId, amountCents]) => ({
        categoryId,
        amountCents,
      })),
      savedCents: curSaved,
    },
    netCashCents: netCash,
    cashBalanceCents: cash,
    variableCashPerMonthCents: median(cashVariable),
    bufferCents,
    avgMonthlySpendCents: totalSpend.length
      ? Math.round(totalSpend.reduce((s, v) => s + v, 0) / totalSpend.length)
      : 0,
  });
  return { ...forecast, series, completeMonths, partialMonthsUsed, variableMedians };
}

/** A category absent in some months spent 0 there; the median must see those zeros. */
function padTo(values: number[], n: number): number[] {
  return values.length >= n
    ? values
    : [...values, ...Array.from({ length: n - values.length }, () => 0)];
}
