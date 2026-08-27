import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/db/client";
import { addDays } from "@/domain/dates";
import { createAccount } from "@/services/accounts";
import { forecastView } from "@/services/forecast";
import { commitBatch, stageImport } from "@/services/imports";
import { addPlanned } from "@/services/planned";
import { listSeries, setSeriesStatus } from "@/services/recurring";
import { ensureSeeded } from "@/services/seed";

let db: Db;
let checking: string;

/** Six months of synthetic checking history: biweekly pay, monthly rent + Netflix, weekly-ish groceries. */
function history(): Buffer {
  const lines = ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #"];
  const row = (d: string, desc: string, amt: string) => lines.push(`DEBIT,${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)},${desc},${amt},DEBIT_CARD,0,`);
  let pay = "2026-03-06";
  for (let i = 0; i < 13; i++) {
    row(pay, "ACME CORP PAYROLL PPD ID: 9876543210", "3250.00");
    pay = addDays(pay, 14);
  }
  for (const m of ["03", "04", "05", "06", "07", "08"]) {
    row(`2026-${m}-01`, "OAKWOOD APARTMENTS RENT", "-2000.00");
    row(`2026-${m}-06`, "NETFLIX.COM", "-15.49");
    row(`2026-${m}-10`, "PG&E WEB ONLINE", `-${(120 + Number(m) * 7).toFixed(2)}`);
    for (const d of ["03", "11", "19", "26"]) row(`2026-${m}-${d}`, "SAFEWAY #1234 OAKLAND CA", `-${(60 + Number(d)).toFixed(2)}`);
    row(`2026-${m}-15`, "TST* THE MILL SAN FRANCISCO CA", "-42.00");
  }
  return Buffer.from(lines.join("\n") + "\n");
}

beforeEach(() => {
  process.env.HEADROOM_IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-forecast-"));
  db = openTestDb();
  ensureSeeded(db);
  checking = createAccount(db, { name: "Checking", kind: "checking", onBudget: true, currency: "USD", openingBalanceCents: 500000, openingBalanceDate: "2026-02-28" }).id;
  const b = stageImport(db, { fileName: "history.csv", bytes: history(), accountId: checking });
  commitBatch(db, b.id);
});

describe("forecastView", () => {
  it("detects paychecks, rent, subscriptions and utilities as series", () => {
    forecastView(db, "2026-08-26");
    const series = listSeries(db);
    const byPayee = (k: string) => series.find((s) => s.payeeKey.includes(k));
    expect(byPayee("ACME")?.cadence).toBe("biweekly");
    expect(byPayee("ACME")?.typicalAmountCents).toBe(325000);
    expect(byPayee("OAKWOOD")?.cadence).toBe("monthly");
    expect(byPayee("OAKWOOD")?.anchorDay).toBe(1);
    expect(byPayee("NETFLIX")?.typicalAmountCents).toBe(-1549);
    expect(byPayee("PG&E")?.cadence).toBe("monthly");
    // Groceries every 7–8 days is a weekly series — but a variable-amount one, so the forecast
    // uses the category median for it rather than treating it as a fixed bill.
    expect(byPayee("SAFEWAY")?.cadence).toBe("weekly");
    expect(byPayee("SAFEWAY")!.amountMadCents / Math.abs(byPayee("SAFEWAY")!.typicalAmountCents)).toBeGreaterThan(0.05);
  });

  it("projects twelve months, a 61-point cash curve, and safe-to-spend", () => {
    addPlanned(db, { name: "Flights", amountCents: -80000, date: "2026-10-03", categoryId: null });
    const f = forecastView(db, "2026-08-26");
    expect(f.months).toHaveLength(12);
    expect(f.cashCurve).toHaveLength(61);
    const oct = f.months.find((m) => m.month === "2026-10")!;
    expect(oct.incomeCents).toBeGreaterThanOrEqual(650000); // two or three paychecks
    expect(oct.fixedCents).toBeGreaterThanOrEqual(201549); // rent + netflix (+ utilities if fixed-amount)
    expect(oct.plannedCents).toBe(-80000);
    expect(oct.variableCents).toBeGreaterThan(0); // groceries + dining medians
    expect(oct.items.some((i) => i.label.toLowerCase().includes("safeway"))).toBe(false); // not double counted as fixed
    expect(f.variableMedians.some((v) => v.name === "Groceries")).toBe(true);
    expect(f.nextIncomeDate).not.toBeNull();
    expect(f.lowestPoint).not.toBeNull();
    expect(f.safeToSpendCents).toBe(f.lowestPoint!.balanceCents - f.bufferCents);
    expect(f.bufferCents).toBeGreaterThan(0);
    expect(f.emergencyFundMonths).not.toBeNull();
    expect(f.completeMonths).toEqual(["2026-07", "2026-06", "2026-05"]);
  });

  it("keeps your confirm/dismiss decisions across refreshes and drops dismissed series from the forecast", () => {
    forecastView(db, "2026-08-26");
    const netflix = listSeries(db).find((s) => s.payeeKey.includes("NETFLIX"))!;
    setSeriesStatus(db, netflix.id, "dismissed");
    const rent = listSeries(db).find((s) => s.payeeKey.includes("OAKWOOD"))!;
    setSeriesStatus(db, rent.id, "confirmed");
    const f = forecastView(db, "2026-08-27");
    expect(listSeries(db).find((s) => s.id === netflix.id)?.status).toBe("dismissed");
    expect(listSeries(db).find((s) => s.id === rent.id)?.status).toBe("confirmed");
    expect(f.series.some((s) => s.id === netflix.id)).toBe(false);
    expect(f.series.find((s) => s.id === rent.id)?.confirmed).toBe(true);
  });
});
