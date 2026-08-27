/**
 * Load the anonymized fixture files through the real import pipeline.
 * Usage: HEADROOM_DB=./data/demo.sqlite HEADROOM_IMPORT_DIR=./data/demo-imports npx tsx scripts/demo.ts
 */
import fs from "node:fs";
import path from "node:path";
import { addDays } from "../src/domain/dates";
import { createAccount, listAccounts } from "../src/services/accounts";
import { getDb } from "../src/services/context";
import { commitBatch, stageImport } from "../src/services/imports";

const db = getDb();
const fixtures = path.join(process.cwd(), "tests", "fixtures");
function account(
  name: string,
  kind: "checking" | "savings" | "credit_card",
  opening = 0,
  openingDate: string | null = null,
) {
  const existing = listAccounts(db).find((a) => a.name === name);
  if (existing) return existing.id;
  return createAccount(db, {
    name,
    kind,
    onBudget: true,
    currency: "USD",
    openingBalanceCents: opening,
    openingBalanceDate: openingDate,
  }).id;
}
const checking = account("Chase Checking", "checking", 430000, "2026-02-28");
const card = account("Chase Card", "credit_card");
const amex = account("Amex", "credit_card");
for (const [file, accountId] of [
  ["chase-checking.csv", checking],
  ["chase-card.csv", card],
  ["amex.csv", amex],
] as const) {
  try {
    const b = stageImport(db, {
      fileName: file,
      bytes: fs.readFileSync(path.join(fixtures, file)),
      accountId,
    });
    const r = commitBatch(db, b.id);
    console.log(
      `${file}: +${r.inserted} rows, ${r.categorized} categorized, ${r.transfersLinked} transfers`,
    );
  } catch (e) {
    console.log(`${file}: ${(e as Error).message}`);
  }
}

// Six months of synthetic checking history so the forecast has paychecks, rent and bills to work with.
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
    row(`2026-${m}-12`, "Payment to Chase card ending in 1234", "-1400.00");
    row(`2026-${m}-15`, "ONLINE TRANSFER TO BROKERAGE", "-500.00");
    for (const d of ["03", "11", "19", "26"]) row(`2026-${m}-${d}`, "SAFEWAY #1234 OAKLAND CA", `-${(60 + Number(d)).toFixed(2)}`);
    row(`2026-${m}-15`, "TST* THE MILL SAN FRANCISCO CA", "-42.00");
    row(`2026-${m}-22`, "SHELL OIL 12345678", "-58.30");
  }
  return Buffer.from(lines.join("\n") + "\n");
}
try {
  const b = stageImport(db, { fileName: "checking-history.csv", bytes: history(), accountId: checking });
  const r = commitBatch(db, b.id);
  console.log(`checking-history.csv: +${r.inserted} rows, ${r.categorized} categorized, ${r.transfersLinked} transfers`);
} catch (e) {
  console.log(`checking-history.csv: ${(e as Error).message}`);
}
