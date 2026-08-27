import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/db/client";
import { createAccount, accountCoverage } from "@/services/accounts";
import { commitBatch, readPreview, rollbackBatch, stageImport } from "@/services/imports";
import { monthReport } from "@/services/reports";
import { ensureSeeded } from "@/services/seed";
import { queryTransactions } from "@/services/transactions";
import { accountBalance, reconcileAccount } from "@/services/reconcile";

const FIX = path.join(process.cwd(), "tests", "fixtures");
const read = (name: string) => fs.readFileSync(path.join(FIX, name));

let db: Db;
let checkingId: string;
let cardId: string;

beforeEach(() => {
  process.env.HEADROOM_IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-imports-"));
  db = openTestDb();
  ensureSeeded(db);
  checkingId = createAccount(db, {
    name: "Chase Checking",
    kind: "checking",
    onBudget: true,
    currency: "USD",
    openingBalanceCents: 430000,
    openingBalanceDate: "2026-03-01",
  }).id;
  cardId = createAccount(db, {
    name: "Chase Card",
    kind: "credit_card",
    onBudget: true,
    currency: "USD",
    openingBalanceCents: 0,
  }).id;
});

function importFile(name: string, accountId: string | null, force: number[] = []) {
  const batch = stageImport(db, { fileName: name, bytes: read(name), accountId });
  expect(batch.status).toBe("previewed");
  return commitBatch(db, batch.id, { forceRows: force });
}

describe("import pipeline (end to end)", () => {
  it("stages with the right profile and labels every row", () => {
    const batch = stageImport(db, {
      fileName: "chase-checking.csv",
      bytes: read("chase-checking.csv"),
      accountId: checkingId,
    });
    expect(batch.profileId).toBe("builtin-chase-checking");
    const p = readPreview(batch)!;
    expect(p.rows.length).toBeGreaterThan(8);
    expect(p.labels.every((l) => l.status === "new")).toBe(true);
    expect(batch.coverageStart).toBe("2026-03-02");
  });

  it("re-importing the same file is refused; an overlapping export inserts nothing new", () => {
    const first = importFile("chase-checking.csv", checkingId);
    expect(first.inserted).toBe(readPreview(first.batch)!.rows.length);
    expect(() =>
      stageImport(db, {
        fileName: "again.csv",
        bytes: read("chase-checking.csv"),
        accountId: checkingId,
      }),
    ).toThrow(/already imported/);

    // Same rows, different bytes (a comment line appended) → a new file, but every row is a duplicate.
    const overlapping = Buffer.concat([read("chase-checking.csv"), Buffer.from("\n")]);
    const b2 = stageImport(db, {
      fileName: "overlap.csv",
      bytes: overlapping,
      accountId: checkingId,
    });
    const p2 = readPreview(b2)!;
    expect(p2.labels.every((l) => l.status === "exact_duplicate")).toBe(true);
    const r2 = commitBatch(db, b2.id);
    expect(r2.inserted).toBe(0);
    expect(queryTransactions(db, { accountId: checkingId }).total).toBe(first.inserted);
  });

  it("keeps both identical same-day coffees and does not duplicate them on re-import", () => {
    importFile("chase-checking.csv", checkingId);
    const coffees = queryTransactions(db, { accountId: checkingId, search: "BLUE BOTTLE" }).rows;
    expect(coffees).toHaveLength(2);
    expect(coffees.map((c) => c.fingerprintSeq).sort()).toEqual([1, 2]);
  });

  it("links the card payment across two files as a transfer and excludes it from spend", () => {
    importFile("chase-checking.csv", checkingId);
    const r = importFile("chase-card.csv", cardId);
    expect(r.transfersLinked).toBeGreaterThanOrEqual(1);
    const linked = queryTransactions(db, { transfersOnly: true }).rows;
    expect(linked.some((t) => t.amountCents === -240000)).toBe(true);
    expect(linked.some((t) => t.amountCents === 240000)).toBe(true);
    const report = monthReport(db, "2026-03");
    // Paying the card is not spending; salary (2 × $3,250) and $1.12 interest are income; card purchases are spend.
    expect(report.incomeCents).toBe(650112);
    expect(queryTransactions(db, { search: "INTEREST" }).rows[0]?.categoryName).toBe("Interest");
    expect(report.byCategory.find((c) => c.name === "Transfer")).toBeUndefined();
    expect(report.spendCents).toBeGreaterThan(0);
    expect(report.spendCents).toBeLessThan(240000 + 200000);
  });

  it("applies seed rules (payroll → Salary, Netflix → Streaming) and hints from YNAB files", () => {
    importFile("chase-checking.csv", checkingId);
    const payroll = queryTransactions(db, { search: "PAYROLL" }).rows;
    expect(payroll.length).toBeGreaterThan(0);
    expect(payroll.every((t) => t.categoryName === "Salary")).toBe(true);

    // YNAB register: two accounts named in the file → auto-mapped by name.
    createAccount(db, {
      name: "Checking",
      kind: "checking",
      onBudget: true,
      currency: "USD",
      openingBalanceCents: 0,
    });
    const staged = stageImport(db, {
      fileName: "ynab-register.csv",
      bytes: read("ynab-register.csv"),
    });
    const p = readPreview(staged)!;
    expect(p.accountsInFile).toContain("Checking");
    expect(p.accountMap["Checking"]).toBeTruthy();
    expect(p.accountMap["Chase Card"]).toBe(cardId); // matched by name
    const res = commitBatch(db, staged.id);
    expect(res.inserted).toBeGreaterThan(0);
    const groceries = queryTransactions(db, { search: "Whole Foods" }).rows.find(
      (t) => t.postedDate === "2026-01-04",
    );
    expect(groceries?.categoryName).toBe("Groceries");
    const start = queryTransactions(db, { search: "Starting Balance" }).rows[0];
    expect(start?.categoryName).toBe("Ignore");
  });

  it("OFX: FITIDs dedupe, ledger balance becomes a snapshot, reconciliation uses it", () => {
    const r1 = importFile("checking.ofx", checkingId);
    expect(r1.inserted).toBeGreaterThan(5);
    const again = stageImport(db, {
      fileName: "checking-2.ofx",
      bytes: Buffer.concat([read("checking.ofx"), Buffer.from("\n")]),
      accountId: checkingId,
    });
    expect(readPreview(again)!.labels.every((l) => l.status === "exact_duplicate")).toBe(true);
    const bal = accountBalance(db, checkingId, "2026-12-31");
    expect(bal.anchor?.source).toBe("ofx");
    const rec = reconcileAccount(db, checkingId);
    expect(rec).not.toBeNull();
    expect(rec!.previous.source).toBe("opening");
  });

  it("flags a pending→posted drift as probable, skips it by default, imports it when forced", () => {
    importFile("chase-checking.csv", checkingId);
    const drift = Buffer.from(
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,03/05/2026,SQUARE BLUE BOTTLE COFFEE #12,-4.50,DEBIT_CARD,0,\nDEBIT,03/25/2026,PHILZ COFFEE,-6.00,DEBIT_CARD,0,\n",
    );
    const staged = stageImport(db, { fileName: "drift.csv", bytes: drift, accountId: checkingId });
    const p = readPreview(staged)!;
    expect(p.labels.map((l) => l.status)).toEqual(["probable_duplicate", "new"]);
    expect(commitBatch(db, staged.id).inserted).toBe(1);

    const staged2 = stageImport(db, {
      fileName: "drift2.csv",
      bytes: Buffer.concat([drift, Buffer.from("\n")]),
      accountId: checkingId,
    });
    const res = commitBatch(db, staged2.id, { forceRows: [0] });
    expect(res.inserted).toBe(1);
    expect(queryTransactions(db, { search: "BLUE BOTTLE" }).total).toBe(3);
  });

  it("rollback removes exactly the batch's rows, unlinks transfers, and a re-import re-adds them", () => {
    importFile("chase-checking.csv", checkingId);
    const card = importFile("chase-card.csv", cardId);
    const before = queryTransactions(db, {}).total;
    const cardRows = queryTransactions(db, { accountId: cardId }).total;
    rollbackBatch(db, card.batch.id);
    expect(queryTransactions(db, {}).total).toBe(before - cardRows);
    expect(queryTransactions(db, { transfersOnly: true }).total).toBe(0);
    expect(accountCoverage(db, cardId)).toHaveLength(0);
    const again = importFile("chase-card.csv", cardId);
    expect(again.inserted).toBe(cardRows);
    expect(queryTransactions(db, {}).total).toBe(before);
  });

  it("records coverage per account and marks months partial when a gap exists", () => {
    importFile("chase-checking.csv", checkingId);
    const cov = accountCoverage(db, checkingId);
    expect(cov).toHaveLength(1);
    expect(cov[0]!.start).toBe("2026-03-02");
    expect(cov[0]!.end).toBe("2026-03-31");
    // February has no coverage, but the account had no imports before March → not a gap. March is fully covered from its first import.
    expect(monthReport(db, "2026-02").partial).toBe(false);
    expect(monthReport(db, "2026-03").partial).toBe(false);

    // A card file that stops on the 25th leaves a gap for the rest of March.
    const short = Buffer.from(
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n03/05/2026,03/06/2026,NETFLIX.COM,Bills,Sale,-15.49,\n03/24/2026,03/25/2026,SAFEWAY #1234,Groceries,Sale,-52.10,\n",
    );
    const staged = stageImport(db, { fileName: "short-card.csv", bytes: short, accountId: cardId });
    commitBatch(db, staged.id);
    const march = monthReport(db, "2026-03");
    expect(march.partial).toBe(true);
    expect(march.gaps.map((g) => g.accountName)).toEqual(["Chase Card"]);
  });

  it("asks for a column mapping when no profile matches", () => {
    const weird = Buffer.from("When,What,HowMuch\n2026-03-01,Thing,-1.00\n");
    const b = stageImport(db, { fileName: "weird.csv", bytes: weird, accountId: checkingId });
    expect(b.status).toBe("needs_profile");
    expect(readPreview(b)!.headers).toEqual(["When", "What", "HowMuch"]);
  });
});
