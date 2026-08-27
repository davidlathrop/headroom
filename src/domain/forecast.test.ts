import { describe, expect, it } from "vitest";
import { buildForecast, type ForecastInput, type ForecastSeries } from "./forecast";

const today = "2026-08-26";
function series(p: Partial<ForecastSeries> & { id: string; typicalAmountCents: number; nextExpectedDate: string }): ForecastSeries {
  return { label: p.id, categoryId: "c", flow: "expense", spendType: "fixed", cadence: "monthly", anchorDay: null, isFixedAmount: true, accountIsCash: true, confirmed: true, ...p };
}
const base: ForecastInput = {
  today,
  months: 3,
  series: [
    series({ id: "Paycheck", typicalAmountCents: 325000, nextExpectedDate: "2026-09-04", cadence: "biweekly", flow: "income", spendType: null }),
    series({ id: "Rent", typicalAmountCents: -200000, nextExpectedDate: "2026-09-01", anchorDay: 1 }),
    series({ id: "Netflix", typicalAmountCents: -1549, nextExpectedDate: "2026-09-06", anchorDay: 6, accountIsCash: false }),
    series({ id: "Card payment", typicalAmountCents: -120000, nextExpectedDate: "2026-09-10", anchorDay: 10, flow: "transfer", spendType: null }),
    series({ id: "Brokerage", typicalAmountCents: -50000, nextExpectedDate: "2026-09-15", anchorDay: 15, flow: "saving", spendType: null }),
  ],
  variableMedians: [
    { categoryId: "groc", name: "Groceries", medianCents: 60000 },
    { categoryId: "dine", name: "Dining", medianCents: 30000 },
  ],
  nonRecurringIncomeMedianCents: 0,
  planned: [{ id: "p1", name: "Flights", date: "2026-10-03", amountCents: -80000 }],
  currentMonth: { incomeCents: 650000, fixedCents: 201549, variableByCategory: [{ categoryId: "groc", amountCents: 70000 }, { categoryId: "dine", amountCents: 10000 }], savedCents: 50000 },
  netCashCents: 500000,
  cashBalanceCents: 620000,
  variableCashPerMonthCents: 30000,
  bufferCents: 200000,
  avgMonthlySpendCents: 300000,
};

describe("buildForecast", () => {
  const f = buildForecast(base);

  it("projects future months from series, medians and planned items", () => {
    const oct = f.months[2]!;
    expect(oct.month).toBe("2026-10");
    // biweekly from Sep 4: Sep 4, 18, Oct 2, 16, 30 → three paychecks land in October
    expect(oct.incomeCents).toBe(3 * 325000);
    expect(oct.fixedCents).toBe(201549);
    expect(oct.variableCents).toBe(90000);
    expect(oct.savedCents).toBe(50000);
    expect(oct.plannedCents).toBe(-80000);
    expect(oct.leftOverCents).toBe(3 * 325000 - 201549 - 90000 - 50000 - 80000);
    expect(oct.items.find((i) => i.label === "Card payment")).toBeUndefined(); // transfers are not spend
  });

  it("blends the current month: actuals plus what is still to come, variable floored at the median", () => {
    const cur = f.months[0]!;
    expect(cur.isCurrent).toBe(true);
    expect(cur.incomeCents).toBe(650000); // no more paychecks before Aug 31
    expect(cur.fixedCents).toBe(201549);
    expect(cur.variableCents).toBe(70000 + 30000); // groceries above median stays; dining rises to median
  });

  it("chains net cash month over month", () => {
    const [aug, sep] = f.months;
    expect(aug!.netCashEndCents).toBe(500000 - 20000); // only the remaining dining median moves cash
    expect(sep!.netCashEndCents).toBe(aug!.netCashEndCents + sep!.leftOverCents);
  });

  it("builds a 60-day cash curve on cash accounts and finds the lowest point before the next paycheck", () => {
    expect(f.cashCurve).toHaveLength(61);
    expect(f.nextIncomeDate).toBe("2026-09-04");
    // Sep 1: rent −2000 and 6 days of variable drip (1000/day) → 620000 − 200000 − 6000
    const sep1 = f.cashCurve.find((p) => p.date === "2026-09-01")!;
    expect(sep1.balanceCents).toBe(620000 - 200000 - 6 * 1000);
    expect(sep1.events.map((e) => e.label)).toEqual(["Rent"]);
    expect(f.cashCurve.some((p) => p.events.some((e) => e.label === "Netflix"))).toBe(false); // card, not cash
    expect(f.cashCurve.some((p) => p.events.some((e) => e.label === "Card payment"))).toBe(true); // paying the card moves cash
    expect(f.lowestPoint?.date).toBe("2026-09-03");
    expect(f.safeToSpendCents).toBe(f.lowestPoint!.balanceCents - 200000);
    expect(f.emergencyFundMonths).toBeCloseTo(1.67, 2);
  });
});
