import { describe, expect, it } from "vitest";
import { buildMonthReport, isRangeCovered, type ReportLine } from "./reports";

function line(p: Partial<ReportLine> & { transactionId: string; amountCents: number }): ReportLine {
  return {
    accountId: "chk",
    accountOnBudget: true,
    postedDate: "2026-03-10",
    categoryId: "cat",
    categoryName: "Groceries",
    parentCategoryName: "Food",
    flow: "expense",
    spendType: "variable",
    isTransfer: false,
    ...p,
  };
}

describe("buildMonthReport", () => {
  it("computes the three numbers under the financial rules", () => {
    const r = buildMonthReport(
      "2026-03",
      [
        line({
          transactionId: "pay",
          amountCents: 500000,
          categoryId: "sal",
          categoryName: "Salary",
          parentCategoryName: "Income",
          flow: "income",
          spendType: null,
        }),
        line({
          transactionId: "rent",
          amountCents: -200000,
          categoryId: "rent",
          categoryName: "Rent",
          parentCategoryName: "Housing",
          spendType: "fixed",
        }),
        line({ transactionId: "groc", amountCents: -40000 }),
        line({ transactionId: "refund", amountCents: 5000 }), // refund in an expense category reduces spend
        line({
          transactionId: "ccpay",
          amountCents: -100000,
          isTransfer: true,
          categoryId: null,
          categoryName: null,
          flow: null,
        }), // transfer: ignored
        line({ transactionId: "ccpay2", amountCents: 100000, accountId: "cc", isTransfer: true }),
        line({
          transactionId: "invest",
          amountCents: -50000,
          categoryId: "brk",
          categoryName: "Brokerage",
          parentCategoryName: "Saving",
          flow: "saving",
          spendType: null,
        }),
        line({ transactionId: "ignored", amountCents: -999, flow: "ignore" }),
        line({ transactionId: "offbudget", amountCents: -77777, accountOnBudget: false }),
      ],
      false,
    );
    expect(r.incomeCents).toBe(500000);
    expect(r.spendFixedCents).toBe(200000);
    expect(r.spendVariableCents).toBe(35000);
    expect(r.spendCents).toBe(235000);
    expect(r.savedCents).toBe(50000);
    expect(r.leftOverCents).toBe(215000);
    expect(r.savingsRate).toBeCloseTo(0.53, 2);
    expect(r.transactionCount).toBe(5);
    expect(r.byCategory[0]!.name).toBe("Salary");
  });

  it("counts uncategorized money in the headline but flags it", () => {
    const r = buildMonthReport(
      "2026-03",
      [
        line({
          transactionId: "u",
          amountCents: -1000,
          categoryId: null,
          categoryName: null,
          flow: null,
        }),
      ],
      true,
    );
    expect(r.spendVariableCents).toBe(1000);
    expect(r.uncategorizedCount).toBe(1);
    expect(r.partial).toBe(true);
    expect(r.savingsRate).toBeNull();
  });
});

describe("isRangeCovered", () => {
  it("detects gaps", () => {
    const w = [
      { start: "2026-01-01", end: "2026-02-15" },
      { start: "2026-02-10", end: "2026-03-20" },
    ];
    expect(isRangeCovered(w, "2026-02-01", "2026-02-28")).toBe(true);
    expect(isRangeCovered(w, "2026-03-01", "2026-03-31")).toBe(false);
    expect(
      isRangeCovered(
        [
          { start: "2026-01-01", end: "2026-01-10" },
          { start: "2026-01-12", end: "2026-01-31" },
        ],
        "2026-01-01",
        "2026-01-31",
      ),
    ).toBe(false);
    expect(
      isRangeCovered(
        [
          { start: "2026-01-01", end: "2026-01-10" },
          { start: "2026-01-11", end: "2026-01-31" },
        ],
        "2026-01-01",
        "2026-01-31",
      ),
    ).toBe(true);
    expect(isRangeCovered([], "2026-01-01", "2026-01-31")).toBe(false);
  });
});
