import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/db/client";
import { createAccount } from "@/services/accounts";
import { commitBatch, stageImport } from "@/services/imports";
import { addSnapshot, reconcileAccount } from "@/services/reconcile";
import { isMonthPartial } from "@/services/reports";
import { ensureSeeded } from "@/services/seed";

let db: Db;
let checking: string;
const HEADER = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n";

function importCsv(rows: string, name = "file.csv") {
  return commitBatch(
    db,
    stageImport(db, { fileName: name, bytes: Buffer.from(HEADER + rows), accountId: checking }).id,
  );
}

beforeEach(() => {
  process.env.HEADROOM_IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-reconcile-"));
  db = openTestDb();
  ensureSeeded(db);
  checking = createAccount(db, {
    name: "Checking",
    kind: "checking",
    onBudget: true,
    currency: "USD",
    openingBalanceCents: 0,
  }).id;
  // Three postings on Aug 27; nothing on Aug 28.
  importCsv(
    "DEBIT,08/27/2026,ENBRIDGE GAS,-33.06,ACH_DEBIT,0,\n" +
      "DEBIT,08/27/2026,WITHDRAWAL OR CHECK,-75.00,CHECK_PAID,0,\n" +
      "CREDIT,08/27/2026,ACH DEPOSIT PAYROLL,6694.14,ACH_CREDIT,0,\n",
  );
});

describe("reconcileAccount", () => {
  it("reconciles when both anchors are end-of-day balances", () => {
    addSnapshot(db, checking, "2026-08-26", 3511956, "ofx");
    addSnapshot(db, checking, "2026-08-28", 3511956 + 658608, "ofx");
    expect(reconcileAccount(db, checking)).toMatchObject({ differenceCents: 0, explanation: null });
  });

  it("recognizes a balance captured before that day's postings instead of flagging a one-day gap", () => {
    addSnapshot(db, checking, "2026-08-26", 3511956, "ofx");
    addSnapshot(db, checking, "2026-08-27", 3511956, "ofx"); // downloaded mid-day: Aug 27 not yet posted
    addSnapshot(db, checking, "2026-08-28", 3511956 + 658608, "ofx");
    const r = reconcileAccount(db, checking)!;
    expect(r.differenceCents).toBe(0);
    expect(r.computedCents).toBe(3511956 + 658608);
    expect(r.explanation).toMatch(
      /ofx balance on 2026-08-27 was taken before that day's transactions posted/,
    );
  });

  it("recognizes a snapshot that predates its own day's postings", () => {
    addSnapshot(db, checking, "2026-08-20", 3511956, "ofx");
    addSnapshot(db, checking, "2026-08-27", 3511956, "ofx"); // as of Aug 27 morning
    const r = reconcileAccount(db, checking)!;
    expect(r.differenceCents).toBe(0);
    expect(r.explanation).toMatch(/balance on 2026-08-27 was taken before/);
  });

  it("still reports a genuine mismatch, unexplained, with the end-of-day computation", () => {
    addSnapshot(db, checking, "2026-08-26", 3511956, "ofx");
    addSnapshot(db, checking, "2026-08-28", 3511956 + 658608 + 10000, "ofx"); // $100 the ledger lacks
    const r = reconcileAccount(db, checking)!;
    expect(r.differenceCents).toBe(10000);
    expect(r.computedCents).toBe(3511956 + 658608);
    expect(r.explanation).toBeNull();
    expect(r.previous.date).toBe("2026-08-26");
    expect(r.snapshot.date).toBe("2026-08-28");
  });
});

describe("isMonthPartial — current month grace", () => {
  it("does not call coverage ending a day or two ago a gap, but does flag stale imports and holes", () => {
    // The import above covers only 2026-08-27.
    expect(isMonthPartial(db, "2026-08", "2026-08-28").partial).toBe(false);
    expect(isMonthPartial(db, "2026-08", "2026-08-30").partial).toBe(false);
    expect(isMonthPartial(db, "2026-08", "2026-08-31").partial).toBe(true);
    // A past month is judged in full: the account's first import is Aug 27, so August through the
    // 31st is a gap once September has begun.
    expect(isMonthPartial(db, "2026-08", "2026-09-15").partial).toBe(true);
    // Months before the account's first import are never gaps.
    expect(isMonthPartial(db, "2026-07", "2026-09-15").partial).toBe(false);
  });
});
