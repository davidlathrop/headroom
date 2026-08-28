import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/db/client";
import { createAccount } from "@/services/accounts";
import {
  budgetHistory,
  budgetPeriod,
  budgetReport,
  budgetSummaries,
  createBudget,
  deleteBudget,
  listBudgetItems,
  listBudgets,
  selectableCategoryGroups,
  updateBudget,
} from "@/services/budgets";
import { commitBatch, stageImport } from "@/services/imports";
import { ensureSeeded } from "@/services/seed";

const FIX = path.join(process.cwd(), "tests", "fixtures");
let db: Db;

beforeEach(() => {
  process.env.HEADROOM_IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-budgets-"));
  db = openTestDb();
  ensureSeeded(db);
  const checking = createAccount(db, {
    name: "Chase Checking",
    kind: "checking",
    onBudget: true,
    currency: "USD",
    openingBalanceCents: 430000,
    openingBalanceDate: "2026-03-01",
  }).id;
  const b = stageImport(db, {
    fileName: "chase-checking.csv",
    bytes: fs.readFileSync(path.join(FIX, "chase-checking.csv")),
    accountId: checking,
  });
  commitBatch(db, b.id);
});

describe("budgets", () => {
  it("offers only money-out categories, grouped", () => {
    const groups = selectableCategoryGroups(db);
    const names = groups.map((g) => g.group.name);
    expect(names).toContain("Food");
    expect(names).toContain("Saving");
    expect(names).not.toContain("Income");
    expect(names).not.toContain("Transfer");
    expect(groups.find((g) => g.group.name === "Food")!.children.map((c) => c.name)).toEqual([
      "Groceries",
      "Dining Out",
      "Coffee",
    ]);
  });

  it("creates a budget from a selection, dropping a leaf when its group is chosen", () => {
    const b = createBudget(db, {
      name: "Essentials",
      note: "",
      items: [
        { categoryId: "cat-food", targetCents: 40000 },
        { categoryId: "cat-food-coffee", targetCents: 2000 }, // redundant: Food covers it
        { categoryId: "cat-housing-utilities", targetCents: null },
      ],
    });
    expect(listBudgets(db).map((x) => x.name)).toEqual(["Essentials"]);
    expect(listBudgetItems(db, b.id)).toEqual([
      { categoryId: "cat-food", targetCents: 40000 },
      { categoryId: "cat-housing-utilities", targetCents: null },
    ]);
  });

  it("rejects an empty selection and unknown categories", () => {
    expect(() => createBudget(db, { name: "X", note: "", items: [] })).toThrow();
    expect(() =>
      createBudget(db, { name: "X", note: "", items: [{ categoryId: "nope", targetCents: 1 }] }),
    ).toThrow(/Unknown category/);
  });

  it("reports a month against targets: group rows absorb their leaves, untargeted rows only track", () => {
    const b = createBudget(db, {
      name: "Essentials",
      note: "",
      items: [
        { categoryId: "cat-food", targetCents: 40000 },
        { categoryId: "cat-housing-utilities", targetCents: null },
        { categoryId: "cat-lifestyle-shopping", targetCents: 3000 },
      ],
    });
    const r = budgetReport(db, b.id, "2026-03");
    const by = Object.fromEntries(r.rows.map((x) => [x.categoryId, x]));
    // Whole Foods $86.42 (Groceries) + two $4.50 Blue Bottle coffees (Coffee) roll up to Food.
    expect(by["cat-food"]).toMatchObject({
      name: "Food",
      isGroup: true,
      actualCents: 9542,
      remainingCents: 30458,
      count: 3,
    });
    expect(by["cat-housing-utilities"]).toMatchObject({
      name: "Utilities",
      groupName: "Housing",
      actualCents: 14217,
      remainingCents: null,
    });
    // Amazon $37.99 against a $30 target → over by $7.99.
    expect(by["cat-lifestyle-shopping"]).toMatchObject({ actualCents: 3799, remainingCents: -799 });
    expect(r.targetCents).toBe(43000);
    expect(r.actualCents).toBe(9542 + 14217 + 3799);
    expect(r.targetedActualCents).toBe(9542 + 3799);
    expect(r.remainingCents).toBe(43000 - 9542 - 3799);
    expect(r.partial).toBe(false);
    // A month with no data is all zeros, not an error.
    expect(budgetReport(db, b.id, "2026-04").actualCents).toBe(0);
    expect(budgetSummaries(db, "2026-03").map((s) => s.budget.name)).toEqual(["Essentials"]);
  });

  it("updates name and selection, and delete removes the rows with it", () => {
    const b = createBudget(db, {
      name: "Old",
      note: "",
      items: [{ categoryId: "cat-food", targetCents: 1 }],
    });
    updateBudget(db, b.id, {
      name: "New",
      note: "renamed",
      items: [{ categoryId: "cat-food-groceries", targetCents: 20000 }],
    });
    expect(listBudgets(db)[0]).toMatchObject({ name: "New", note: "renamed" });
    expect(listBudgetItems(db, b.id)).toEqual([
      { categoryId: "cat-food-groceries", targetCents: 20000 },
    ]);
    deleteBudget(db, b.id);
    expect(listBudgets(db)).toHaveLength(0);
    expect(listBudgetItems(db, b.id)).toHaveLength(0);
  });

  it("works with no targets at all: shares, previous-month comparison and a month history", () => {
    const b = createBudget(db, {
      name: "Watch",
      note: "",
      items: [
        { categoryId: "cat-food", targetCents: null },
        { categoryId: "cat-housing-utilities", targetCents: null },
        { categoryId: "cat-lifestyle-shopping", targetCents: null },
      ],
    });
    const mar = budgetReport(db, b.id, "2026-03");
    expect(mar.hasTargets).toBe(false);
    expect(mar.targetCents).toBe(0);
    expect(mar.actualCents).toBe(9542 + 14217 + 3799);
    expect(mar.transactionCount).toBe(5);
    expect(mar.previousMonth).toBe("2026-02");
    expect(mar.previousActualCents).toBe(0);
    const shares = mar.rows.map((r) => r.share);
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    expect(mar.rows.find((r) => r.categoryId === "cat-housing-utilities")!.share).toBeCloseTo(
      14217 / (9542 + 14217 + 3799),
      6,
    );

    // April has nothing, so every line compares back to its March figure.
    const apr = budgetReport(db, b.id, "2026-04");
    expect(apr.actualCents).toBe(0);
    expect(apr.previousActualCents).toBe(mar.actualCents);
    expect(apr.rows.find((r) => r.categoryId === "cat-food")!.previousActualCents).toBe(9542);
    expect(apr.rows.every((r) => r.share === 0)).toBe(true);

    expect(budgetHistory(db, b.id, ["2026-02", "2026-03", "2026-04"])).toEqual([
      { month: "2026-02", actualCents: 0, partial: false },
      { month: "2026-03", actualCents: mar.actualCents, partial: false },
      { month: "2026-04", actualCents: 0, partial: true }, // imported through March only
    ]);
  });

  it("summarizes a period: the budget by line and month, against all spending, with every category marked", () => {
    const b = createBudget(db, {
      name: "Essentials",
      note: "",
      items: [
        { categoryId: "cat-food", targetCents: 40000 },
        { categoryId: "cat-housing-utilities", targetCents: null },
      ],
    });
    const p = budgetPeriod(db, b.id, ["2026-02", "2026-03"]);
    expect(p.lines).toEqual([
      { categoryId: "cat-food", name: "Food", isGroup: true },
      { categoryId: "cat-housing-utilities", name: "Utilities", isGroup: false },
    ]);
    expect(p.months[0]).toMatchObject({ month: "2026-02", actualCents: 0, allSpendCents: 0 });
    const mar = p.months[1]!;
    expect(mar.actualCents).toBe(9542 + 14217);
    expect(mar.targetCents).toBe(40000);
    expect(mar.byRow).toEqual({ "cat-food": 9542, "cat-housing-utilities": 14217 });
    // All spending = the month report's Spend: categorized expenses plus uncategorized outflows
    // (the card payment, the transfer to savings, Zelle and the check have no other account here).
    const uncategorizedOut = 240000 + 50000 + 12000 + 185000;
    expect(mar.allSpendCents).toBe(8642 + 900 + 14217 + 3799 + uncategorizedOut);
    expect(p.totals).toEqual({
      actualCents: 9542 + 14217,
      targetCents: 80000,
      allSpendCents: mar.allSpendCents,
    });
    const by = Object.fromEntries(p.breakdown.map((x) => [x.name, x]));
    expect(p.breakdown[0]!.name).toBe("Uncategorized");
    expect(by.Groceries).toMatchObject({ amountCents: 8642, inBudget: true, groupName: "Food" });
    expect(by.Coffee).toMatchObject({ amountCents: 900, inBudget: true });
    expect(by.Utilities).toMatchObject({ amountCents: 14217, inBudget: true });
    expect(by.Shopping).toMatchObject({ amountCents: 3799, inBudget: false });
    expect(by.Uncategorized).toMatchObject({
      amountCents: uncategorizedOut,
      inBudget: false,
      categoryId: null,
    });
    expect(by.Salary).toBeUndefined();
  });
});
