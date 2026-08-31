import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/db/client";
import { createAccount } from "@/services/accounts";
import { createBudget } from "@/services/budgets";
import { budgetReport } from "@/services/budgets";
import { commitBatch, stageImport } from "@/services/imports";
import { accountBalance } from "@/services/reconcile";
import { listMonthKeys, monthReport } from "@/services/reports";
import { ensureSeeded } from "@/services/seed";
import { getTransaction, queryTransactions, setEffectiveMonth } from "@/services/transactions";
import { monthZoom } from "@/services/trends";

const FIX = path.join(process.cwd(), "tests", "fixtures");
let db: Db;
let checking: string;
let groceries: string; // $86.42 Groceries, posted 2026-03-02
let interest: string; // $1.12 income, posted 2026-03-31

beforeEach(() => {
  process.env.HEADROOM_IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-effective-"));
  db = openTestDb();
  ensureSeeded(db);
  checking = createAccount(db, {
    name: "Checking",
    kind: "checking",
    onBudget: true,
    currency: "USD",
    openingBalanceCents: 0,
  }).id;
  commitBatch(
    db,
    stageImport(db, {
      fileName: "chase-checking.csv",
      bytes: fs.readFileSync(path.join(FIX, "chase-checking.csv")),
      accountId: checking,
    }).id,
  );
  groceries = queryTransactions(db, { search: "WHOLEFDS" }).rows[0]!.id;
  interest = queryTransactions(db, { search: "INTEREST" }).rows[0]!.id;
});

describe("setEffectiveMonth", () => {
  it("moves a month-end transaction into the next month for every report", () => {
    const march = monthReport(db, "2026-03");
    const balanceBefore = accountBalance(db, checking, "2026-03-31").balanceCents;
    setEffectiveMonth(db, interest, "2026-04");

    // Clamped to the nearest day of the chosen month: 3/31 counts as 4/1.
    expect(getTransaction(db, interest).effectiveDate).toBe("2026-04-01");

    // March loses it, April gains it, and April now exists as a month.
    expect(monthReport(db, "2026-03").incomeCents).toBe(march.incomeCents - 112);
    expect(monthReport(db, "2026-04").incomeCents).toBe(112);
    expect(listMonthKeys(db)).toContain("2026-04");

    // The ledger's month filter follows the reports.
    expect(queryTransactions(db, { month: "2026-04" }).rows.map((t) => t.id)).toEqual([interest]);
    expect(queryTransactions(db, { month: "2026-03" }).rows.map((t) => t.id)).not.toContain(
      interest,
    );

    // Reconciliation still sees the posted date: the 3/31 balance is unchanged.
    expect(accountBalance(db, checking, "2026-03-31").balanceCents).toBe(balanceBefore);
  });

  it("moves spend into the previous month and the budgets follow", () => {
    const budget = createBudget(db, {
      name: "Essentials",
      note: "",
      items: [{ categoryId: "cat-food-groceries", targetCents: 50000 }],
    });
    expect(budgetReport(db, budget.id, "2026-03").actualCents).toBe(8642);

    setEffectiveMonth(db, groceries, "2026-02");
    expect(getTransaction(db, groceries).effectiveDate).toBe("2026-02-28"); // 3/2 → end of Feb

    expect(budgetReport(db, budget.id, "2026-03").actualCents).toBe(0);
    expect(budgetReport(db, budget.id, "2026-02").actualCents).toBe(8642);
    // Cumulative spend places it on its effective day.
    const z = monthZoom(db, "2026-02", "2026-03-31");
    expect(z.cumulative[27]!.thisMonth).toBe(8642);
  });

  it("clears on null or on the posted month, and rejects garbage", () => {
    const march = monthReport(db, "2026-03").spendCents;
    setEffectiveMonth(db, groceries, "2026-04");
    setEffectiveMonth(db, groceries, null);
    expect(getTransaction(db, groceries).effectiveDate).toBeNull();

    setEffectiveMonth(db, groceries, "2026-04");
    setEffectiveMonth(db, groceries, "2026-03"); // the posted month = no override
    expect(getTransaction(db, groceries).effectiveDate).toBeNull();
    expect(monthReport(db, "2026-03").spendCents).toBe(march);

    expect(() => setEffectiveMonth(db, groceries, "2026-13")).toThrow(/Not a month/);
  });

  it("keeps a mid-month transaction on its posted day when moved within range", () => {
    // 3/2 moved to March is a no-op; moved to April clamps forward to 4/1.
    setEffectiveMonth(db, groceries, "2026-04");
    expect(getTransaction(db, groceries).effectiveDate).toBe("2026-04-01");
  });
});
