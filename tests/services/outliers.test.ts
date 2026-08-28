import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/db/client";
import { createAccount } from "@/services/accounts";
import { commitBatch, stageImport } from "@/services/imports";
import { categoryBreakdown, listMonthReports, monthReport } from "@/services/reports";
import { ensureSeeded } from "@/services/seed";
import { queryTransactions, setOutlier } from "@/services/transactions";
import { categoryZoom, monthZoom, trends } from "@/services/trends";

const FIX = path.join(process.cwd(), "tests", "fixtures");
let db: Db;
let whole: string;

beforeEach(() => {
  process.env.HEADROOM_IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-outliers-"));
  db = openTestDb();
  ensureSeeded(db);
  const checking = createAccount(db, {
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
  whole = queryTransactions(db, { search: "WHOLEFDS" }).rows[0]!.id; // $86.42 groceries, 2026-03-02
});

describe("outliers", () => {
  it("keep their category and their month, but leave the trends unless asked back in", () => {
    const plain = monthReport(db, "2026-03");
    setOutlier(db, whole, true);
    expect(queryTransactions(db, { outliersOnly: true }).rows.map((t) => t.id)).toEqual([whole]);
    expect(queryTransactions(db, { outliersOnly: true }).rows[0]!.categoryName).toBe("Groceries");

    // The month still counts it — and says so.
    const r = monthReport(db, "2026-03");
    expect(r.spendCents).toBe(plain.spendCents);
    expect(r.outliers).toEqual({ count: 1, incomeCents: 0, spendCents: 8642, savedCents: 0 });
    expect(monthReport(db, "2026-03", { excludeOutliers: true }).spendCents).toBe(
      plain.spendCents - 8642,
    );

    // Trends leave it out by default and can include it.
    const t = trends(db, 1, "2026-03-31");
    expect(t.months[0]!.spendCents).toBe(plain.spendCents - 8642);
    expect(t.outliers).toEqual({ count: 1, spendCents: 8642, incomeCents: 0 });
    expect(t.includeOutliers).toBe(false);
    const tIn = trends(db, 1, "2026-03-31", { includeOutliers: true });
    expect(tIn.months[0]!.spendCents).toBe(plain.spendCents);
    expect(tIn.outliers.count).toBe(1);

    const z = monthZoom(db, "2026-03", "2026-03-31");
    expect(z.report.spendCents).toBe(plain.spendCents - 8642);
    expect(z.groups.find((g) => g.name === "Food")?.amountCents).toBe(900); // just the coffees
    const c = categoryZoom(db, "cat-food-groceries", "2026-03", 3, "2026-03-31")!;
    expect(c.totalCents).toBe(0);
    expect(c.outliers).toEqual({ count: 1, spendCents: 8642, incomeCents: 0 });
    expect(
      categoryZoom(db, "cat-food-groceries", "2026-03", 3, "2026-03-31", { includeOutliers: true })!
        .totalCents,
    ).toBe(8642);

    // Unflagging restores everything; flagging twice is a no-op.
    setOutlier(db, whole, false);
    setOutlier(db, whole, false);
    expect(trends(db, 1, "2026-03-31").months[0]!.spendCents).toBe(plain.spendCents);
    expect(monthReport(db, "2026-03").outliers.count).toBe(0);
  });

  it("the Months list and a month's breakdown can leave them out", () => {
    const plain = monthReport(db, "2026-03");
    setOutlier(db, whole, true);
    const withRow = listMonthReports(db, 36).find((r) => r.month === "2026-03")!;
    const withoutRow = listMonthReports(db, 36, { excludeOutliers: true }).find(
      (r) => r.month === "2026-03",
    )!;
    expect(withRow.spendCents).toBe(plain.spendCents);
    expect(withoutRow.spendCents).toBe(plain.spendCents - 8642);
    expect(withRow.outliers.count).toBe(1);
    const groceries = (r: ReturnType<typeof categoryBreakdown>) =>
      r.groups.find((g) => g.name === "Food")?.items.find((c) => c.name === "Groceries")
        ?.amountCents ?? 0;
    expect(groceries(categoryBreakdown(db, "2026-03"))).toBe(8642);
    expect(groceries(categoryBreakdown(db, "2026-03", { excludeOutliers: true }))).toBe(0);
  });
});
