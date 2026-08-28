import { describe, expect, it } from "vitest";
import {
  buildMonthReport,
  countsInReport,
  foldSlices,
  isRangeCovered,
  type ReportLine,
} from "./reports";

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
    isOutlier: false,
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

describe("countsInReport — categorized transfers", () => {
  it("counts a transfer's paying side once it carries a real category, never the receiving side", () => {
    const mortgage = line({
      transactionId: "pay",
      amountCents: -189739,
      isTransfer: true,
      categoryId: "rent",
      categoryName: "Rent / Mortgage",
      parentCategoryName: "Housing",
      spendType: "fixed",
    });
    const received = line({
      transactionId: "recv",
      amountCents: 189739,
      isTransfer: true,
      accountId: "loan",
      categoryId: "rent",
      categoryName: "Rent / Mortgage",
      parentCategoryName: "Housing",
    });
    const plain = line({
      transactionId: "card",
      amountCents: -240000,
      isTransfer: true,
      categoryId: "cat-transfer",
      categoryName: "Transfer",
      parentCategoryName: null,
      flow: "transfer",
    });
    const unlabelled = line({
      transactionId: "x",
      amountCents: -100,
      isTransfer: true,
      categoryId: null,
      categoryName: null,
      flow: null,
    });
    expect(countsInReport(mortgage)).toBe(true);
    expect(countsInReport(received)).toBe(false);
    expect(countsInReport(plain)).toBe(false);
    expect(countsInReport(unlabelled)).toBe(false);
    expect(countsInReport({ ...mortgage, accountOnBudget: false })).toBe(false);

    const r = buildMonthReport("2026-03", [mortgage, received, plain, unlabelled], false);
    expect(r.spendFixedCents).toBe(189739);
    expect(r.spendCents).toBe(189739);
    expect(r.incomeCents).toBe(0);
    expect(r.transactionCount).toBe(1);
    expect(r.byCategory.map((c) => c.name)).toEqual(["Rent / Mortgage"]);
  });
});

describe("foldSlices", () => {
  const items = [
    { name: "Food", amountCents: 500 },
    { name: "Housing", amountCents: 2000 },
    { name: "Fuel", amountCents: 100 },
    { name: "Refund-only", amountCents: -50 },
    { name: "Health", amountCents: 200 },
    { name: "Fun", amountCents: 150 },
    { name: "Gifts", amountCents: 40 },
    { name: "Pets", amountCents: 10 },
  ];
  it("sorts largest first, drops non-positive, folds the tail into Other so at most max slices remain", () => {
    const s = foldSlices(items, 6);
    expect(s.map((x) => x.name)).toEqual(["Housing", "Food", "Health", "Fun", "Fuel", "Other"]);
    expect(s[5]).toMatchObject({ amountCents: 50, members: [items[6], items[7]] });
    expect(s.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1, 9);
    expect(s[0]!.share).toBeCloseTo(2000 / 3000, 9);
  });
  it("keeps every slice when they fit, and returns nothing for no spend", () => {
    expect(foldSlices(items.slice(0, 3), 6).map((x) => x.name)).toEqual([
      "Housing",
      "Food",
      "Fuel",
    ]);
    expect(foldSlices(items.slice(0, 6), 6)).toHaveLength(5); // the refund-only item is dropped
    expect(foldSlices([{ name: "x", amountCents: 0 }])).toEqual([]);
  });
});

describe("buildMonthReport — outliers", () => {
  it("counts flagged outliers in the headline but reports them separately", () => {
    const r = buildMonthReport(
      "2026-04",
      [
        line({ transactionId: "g", amountCents: -8000 }),
        line({
          transactionId: "tax",
          amountCents: -900000,
          isOutlier: true,
          categoryId: "tax",
          categoryName: "Taxes",
        }),
        line({
          transactionId: "bonus",
          amountCents: 500000,
          isOutlier: true,
          categoryId: "inc",
          categoryName: "Bonus",
          flow: "income",
        }),
        line({
          transactionId: "u",
          amountCents: -100,
          isOutlier: true,
          categoryId: null,
          categoryName: null,
          flow: null,
        }),
      ],
      false,
    );
    expect(r.spendCents).toBe(8000 + 900000 + 100);
    expect(r.incomeCents).toBe(500000);
    expect(r.outliers).toEqual({
      count: 3,
      incomeCents: 500000,
      spendCents: 900100,
      savedCents: 0,
    });
  });
});
