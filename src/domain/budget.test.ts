import { describe, expect, it } from "vitest";
import { buildBudgetReport, normalizeSelection } from "./budget";
import type { ReportLine } from "./reports";

const parentOf = new Map<string, string | null>([
  ["food", null],
  ["groceries", "food"],
  ["dining", "food"],
  ["housing", null],
  ["rent", "housing"],
  ["utilities", "housing"],
]);

function line(
  categoryId: string | null,
  amountCents: number,
  extra: Partial<ReportLine> = {},
): ReportLine {
  return {
    transactionId: `${categoryId}-${amountCents}-${Math.random()}`,
    accountId: "a",
    accountOnBudget: true,
    postedDate: "2026-03-10",
    effectiveDate: extra.postedDate ?? "2026-03-10",
    amountCents,
    categoryId,
    categoryName: categoryId,
    parentCategoryName: categoryId ? (parentOf.get(categoryId) ?? null) : null,
    flow: categoryId ? "expense" : null,
    spendType: "variable",
    isTransfer: false,
    isOutlier: false,
    ...extra,
  };
}

describe("normalizeSelection", () => {
  it("drops leaves whose group is also chosen, keeps order, dedupes", () => {
    const out = normalizeSelection(
      [
        { categoryId: "groceries", targetCents: 1 },
        { categoryId: "food", targetCents: 50000 },
        { categoryId: "rent", targetCents: null },
        { categoryId: "rent", targetCents: 200000 },
        { categoryId: "dining", targetCents: 2 },
      ],
      parentOf,
    );
    expect(out).toEqual([
      { categoryId: "food", targetCents: 50000 },
      { categoryId: "rent", targetCents: null },
    ]);
  });
});

describe("buildBudgetReport", () => {
  it("attributes lines to their category or its group, and refunds reduce spend", () => {
    const r = buildBudgetReport(
      "2026-03",
      [
        { categoryId: "food", targetCents: 50000 },
        { categoryId: "rent", targetCents: 200000 },
        { categoryId: "utilities", targetCents: null },
      ],
      [
        line("groceries", -12000),
        line("dining", -4000),
        line("dining", 1500), // refund
        line("rent", -200000),
        line("utilities", -9000),
        line("housing", -1000), // group itself, not a row → not counted
        line(null, -5000), // uncategorized never counts
      ],
      parentOf,
      false,
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.categoryId, x]));
    expect(by.food).toMatchObject({ actualCents: 14500, remainingCents: 35500, count: 3 });
    expect(by.rent).toMatchObject({ actualCents: 200000, remainingCents: 0, count: 1 });
    expect(by.utilities).toMatchObject({ actualCents: 9000, remainingCents: null, count: 1 });
    expect(r.targetCents).toBe(250000);
    expect(r.actualCents).toBe(223500);
    expect(r.targetedActualCents).toBe(214500);
    expect(r.remainingCents).toBe(35500);
  });

  it("ignores plain transfers, off-budget accounts and ignore flows — but counts a transfer's categorized paying side; goes negative when over", () => {
    const r = buildBudgetReport(
      "2026-03",
      [{ categoryId: "dining", targetCents: 3000 }],
      [
        line("dining", -5000),
        line("dining", -5000, { isTransfer: true, categoryId: "xfer", flow: "transfer" }),
        line("dining", -5000, { accountOnBudget: false }),
        line("dining", -5000, { flow: "ignore" }),
        line("dining", -2000, { isTransfer: true }), // paying side of a transfer, categorized
        line("dining", 2000, { isTransfer: true }), // receiving side never counts
      ],
      parentOf,
      true,
    );
    expect(r.rows[0]).toMatchObject({ actualCents: 7000, remainingCents: -4000, count: 2 });
    expect(r.remainingCents).toBe(-4000);
    expect(r.partial).toBe(true);
  });

  it("keeps rows for categories with no activity", () => {
    const r = buildBudgetReport(
      "2026-03",
      [{ categoryId: "rent", targetCents: 1 }],
      [],
      parentOf,
      false,
    );
    expect(r.rows).toEqual([
      { categoryId: "rent", targetCents: 1, actualCents: 0, remainingCents: 1, count: 0 },
    ]);
  });
});
