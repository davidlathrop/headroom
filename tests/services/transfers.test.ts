import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/db/client";
import { createAccount, getAccount } from "@/services/accounts";
import { budgetReport, createBudget } from "@/services/budgets";
import { commitBatch, stageImport } from "@/services/imports";
import { monthReport } from "@/services/reports";
import { ensureSeeded } from "@/services/seed";
import { queryTransactions, setCategory } from "@/services/transactions";
import {
  accountsNeedingPaymentCategory,
  setPaymentCategory,
  unlinkTransfer,
} from "@/services/transfers";

let db: Db;
let checking: string;
let mortgage: string;

const HEADER = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n";
const checkingCsv = Buffer.from(
  HEADER +
    "DEBIT,03/01/2026,FUNDS TRANSFER ML MORTGAGE PAYMENT,-1897.39,ACH_DEBIT,0,\n" +
    "DEBIT,04/01/2026,FUNDS TRANSFER ML MORTGAGE PAYMENT,-1897.39,ACH_DEBIT,0,\n" +
    "DEBIT,03/05/2026,SAFEWAY #1234 OAKLAND CA,-80.00,DEBIT_CARD,0,\n",
);
const loanCsv = Buffer.from(
  HEADER +
    "CREDIT,03/02/2026,PAYMENT RECEIVED THANK YOU,1897.39,ACH_CREDIT,0,\n" +
    "CREDIT,04/02/2026,PAYMENT RECEIVED THANK YOU,1897.39,ACH_CREDIT,0,\n",
);

function importInto(name: string, bytes: Buffer, accountId: string) {
  return commitBatch(db, stageImport(db, { fileName: name, bytes, accountId }).id);
}

beforeEach(() => {
  process.env.HEADROOM_IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-transfers-"));
  db = openTestDb();
  ensureSeeded(db);
  checking = createAccount(db, {
    name: "Checking",
    kind: "checking",
    onBudget: true,
    currency: "USD",
    openingBalanceCents: 0,
  }).id;
  mortgage = createAccount(db, {
    name: "Mortgage",
    kind: "loan",
    onBudget: false,
    currency: "USD",
    openingBalanceCents: 0,
  }).id;
  importInto("checking.csv", checkingCsv, checking);
  importInto("loan.csv", loanCsv, mortgage);
});

const paying = () =>
  queryTransactions(db, { accountId: checking, search: "MORTGAGE" }).rows.sort((a, b) =>
    a.postedDate < b.postedDate ? -1 : 1,
  );

describe("mortgage payments to a tracked loan", () => {
  it("are auto-linked as transfers and therefore invisible to spend — and the home page nudges", () => {
    expect(paying().every((t) => t.transferId && t.categoryId === "cat-transfer")).toBe(true);
    expect(monthReport(db, "2026-03").spendCents).toBe(8000); // groceries only
    expect(accountsNeedingPaymentCategory(db)).toEqual([
      { id: mortgage, name: "Mortgage", kind: "loan", payments: 2 },
    ]);
  });

  it("count as Housing once the loan account says payments are Rent / Mortgage — past and future", () => {
    expect(setPaymentCategory(db, mortgage, "cat-housing-rent")).toBe(2);
    expect(getAccount(db, mortgage).paymentCategoryId).toBe("cat-housing-rent");
    expect(paying().every((t) => t.transferId && t.categoryId === "cat-housing-rent")).toBe(true);
    // The receiving side stays a transfer.
    const received = queryTransactions(db, { accountId: mortgage }).rows;
    expect(received.every((t) => t.categoryId === "cat-transfer")).toBe(true);

    const march = monthReport(db, "2026-03");
    expect(march.spendFixedCents).toBe(189739);
    expect(march.spendCents).toBe(189739 + 8000);
    expect(march.incomeCents).toBe(0);
    expect(march.byCategory.find((c) => c.name === "Rent / Mortgage")?.amountCents).toBe(189739);
    expect(accountsNeedingPaymentCategory(db)).toEqual([]);

    // Budgets see it too.
    const b = createBudget(db, {
      name: "Home",
      note: "",
      items: [{ categoryId: "cat-housing", targetCents: null }],
    });
    expect(budgetReport(db, b.id, "2026-04").actualCents).toBe(189739);

    // A later payment links straight into the category.
    importInto(
      "checking-may.csv",
      Buffer.from(
        HEADER + "DEBIT,05/01/2026,FUNDS TRANSFER ML MORTGAGE PAYMENT,-1897.39,ACH_DEBIT,0,\n",
      ),
      checking,
    );
    importInto(
      "loan-may.csv",
      Buffer.from(HEADER + "CREDIT,05/02/2026,PAYMENT RECEIVED THANK YOU,1897.39,ACH_CREDIT,0,\n"),
      mortgage,
    );
    const may = paying().find((t) => t.postedDate === "2026-05-01")!;
    expect(may.transferId).toBeTruthy();
    expect(may.categoryId).toBe("cat-housing-rent");
    expect(monthReport(db, "2026-05").spendFixedCents).toBe(189739);

    // Back to a plain transfer resets every paying side.
    setPaymentCategory(db, mortgage, null);
    expect(paying().every((t) => t.categoryId === "cat-transfer")).toBe(true);
    expect(monthReport(db, "2026-03").spendCents).toBe(8000);
  });

  it("can be categorized by hand on the paying side; 'always' sets the account default; the receiving side refuses", () => {
    const [first, second] = paying();
    setCategory(db, first!.id, "cat-housing-rent");
    expect(monthReport(db, "2026-03").spendCents).toBe(189739 + 8000);
    expect(monthReport(db, "2026-04").spendCents).toBe(0);
    expect(getAccount(db, mortgage).paymentCategoryId).toBeNull();

    setCategory(db, second!.id, "cat-housing-rent", { alwaysForPayee: true });
    expect(getAccount(db, mortgage).paymentCategoryId).toBe("cat-housing-rent");
    expect(paying().every((t) => t.categoryId === "cat-housing-rent")).toBe(true);

    const received = queryTransactions(db, { accountId: mortgage }).rows[0]!;
    expect(() => setCategory(db, received.id, "cat-housing-rent")).toThrow(/receiving side/);
    // Clearing the category on a transfer means "just a transfer", not uncategorized.
    setCategory(db, first!.id, null);
    expect(paying()[0]!.categoryId).toBe("cat-transfer");
    expect(() => setPaymentCategory(db, mortgage, "cat-income-salary")).toThrow(
      /expense or saving/,
    );
  });

  it("unlinking clears the transfer and its category, like before", () => {
    setPaymentCategory(db, mortgage, "cat-housing-rent");
    const t = paying()[0]!;
    unlinkTransfer(db, t.transferId!);
    const after = queryTransactions(db, { accountId: checking, search: "MORTGAGE" }).rows.find(
      (x) => x.id === t.id,
    )!;
    expect(after.transferId).toBeNull();
    expect(after.categoryId).toBeNull();
  });
});
