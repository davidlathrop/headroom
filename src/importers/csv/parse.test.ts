import { describe, expect, it } from "vitest";
import { parseCsv, readHeader } from "./parse";
import { csvProfileSchema } from "./profile";
import { BUILTIN_PROFILES } from "./builtins";
import { fixture } from "../fixtures.test-util";

function builtin(id: string) {
  const p = BUILTIN_PROFILES.find((b) => b.id === id);
  if (!p || !p.config) throw new Error(`no builtin ${id}`);
  return p.config;
}

describe("readHeader", () => {
  it("finds the header at line 0 for a plain file", () => {
    const h = readHeader(fixture("chase-checking.csv"))!;
    expect(h.headerLineIndex).toBe(0);
    expect(h.headers[1]).toBe("Posting Date");
  });

  it("finds the Bank of America header below the summary preamble", () => {
    const h = readHeader(fixture("bofa-checking.csv"))!;
    expect(h.headerLineIndex).toBe(6);
    expect(h.headers).toEqual(["Date", "Description", "Amount", "Running Bal."]);
  });

  it("returns null for a file with no plausible header", () => {
    expect(readHeader("1,2\n3,4\n")).toBeNull();
  });
});

describe("parseCsv — Chase checking", () => {
  const result = parseCsv(fixture("chase-checking.csv"), builtin("builtin-chase-checking"));

  it("parses with no issues", () => {
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(12);
    expect(result.accountsInFile).toEqual([]);
    expect(result.balances).toEqual([]);
  });

  it("reads MM/DD/YYYY unambiguously: 03/04/2026 → 2026-03-04", () => {
    expect(result.rows[2]!.postedDate).toBe("2026-03-04");
    expect(result.rows[2]!.txnDate).toBe("2026-03-04");
  });

  it("keeps sign as-is: debits negative, payroll positive", () => {
    expect(result.rows[0]!.amountCents).toBe(-8642);
    expect(result.rows[1]!.amountCents).toBe(325000);
    expect(result.rows[4]!.amountCents).toBe(-240000);
    expect(result.rows[11]!.amountCents).toBe(112);
  });

  it("keeps two identical same-day rows", () => {
    const coffees = result.rows.filter((r) => r.payeeRaw === "SQ *BLUE BOTTLE COFFEE");
    expect(coffees).toHaveLength(2);
    expect(coffees.map((c) => c.sourceRow)).toEqual([2, 3]);
  });
});

describe("parseCsv — Chase card", () => {
  const result = parseCsv(fixture("chase-card.csv"), builtin("builtin-chase-card"));

  it("uses transaction and post dates separately", () => {
    expect(result.issues).toEqual([]);
    const netflix = result.rows[0]!;
    expect(netflix.txnDate).toBe("2026-03-01");
    expect(netflix.postedDate).toBe("2026-03-02");
  });

  it("purchases negative, payment and return positive", () => {
    expect(result.rows[0]!.amountCents).toBe(-1549);
    expect(result.rows[3]!.amountCents).toBe(240000);
    expect(result.rows[5]!.amountCents).toBe(12900);
  });
});

describe("parseCsv — Amex (charges exported positive)", () => {
  const result = parseCsv(fixture("amex.csv"), builtin("builtin-amex"));

  it("flips the sign so charges are negative and payments positive", () => {
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(8);
    expect(result.rows[0]!.amountCents).toBe(-6418);
    expect(result.rows[1]!.amountCents).toBe(-41260);
    const payment = result.rows[4]!;
    expect(payment.payeeRaw).toBe("ONLINE PAYMENT - THANK YOU");
    expect(payment.amountCents).toBe(49048);
    expect(result.rows[7]!.amountCents).toBe(1240); // a return
  });

  it("reads the optional Reference column as the external id", () => {
    expect(result.rows[0]!.externalId).toBe("'320260630001234567'");
    expect(result.rows[0]!.memoRaw).toBe("TRADER JOE'S #123 SAN FRANCISCO CA");
  });

  it("tolerates the basic export that lacks the optional columns", () => {
    const basic =
      "Date,Description,Amount\n03/03/2026,TRADER JOE'S #123,64.18\n03/15/2026,ONLINE PAYMENT - THANK YOU,-490.48\n";
    const r = parseCsv(basic, builtin("builtin-amex"));
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => x.amountCents)).toEqual([-6418, 49048]);
    expect(r.rows[0]!.externalId).toBeNull();
    expect(r.rows[0]!.memoRaw).toBe("");
  });
});

describe("parseCsv — Capital One (debit/credit columns)", () => {
  const result = parseCsv(fixture("capital-one-card.csv"), builtin("builtin-capital-one-card"));

  it("debit → negative, credit → positive; YYYY-MM-DD dates", () => {
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(9);
    expect(result.rows[0]!.amountCents).toBe(-5421);
    expect(result.rows[0]!.txnDate).toBe("2026-03-01");
    expect(result.rows[0]!.postedDate).toBe("2026-03-02");
    expect(result.rows[2]!.amountCents).toBe(32500);
    expect(result.rows[5]!.amountCents).toBe(7312);
  });
});

describe("parseCsv — Bank of America (preamble)", () => {
  const profile = { ...builtin("builtin-bofa-checking"), skipRows: 6 };
  const result = parseCsv(fixture("bofa-checking.csv"), profile);

  it("skips the preamble and flags only the beginning-balance row", () => {
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.row).toBe(0);
    expect(result.issues[0]!.message).toMatch(/Empty amount/);
    expect(result.rows).toHaveLength(11);
  });

  it("parses quoted thousands and signs", () => {
    expect(result.rows[0]!.amountCents).toBe(190056);
    expect(result.rows[1]!.amountCents).toBe(-450);
    expect(result.rows[10]!.amountCents).toBe(56);
  });
});

describe("parseCsv — Ally (spaces after delimiters)", () => {
  const result = parseCsv(fixture("ally.csv"), builtin("builtin-ally"));

  it("trims cells and reads the Type column as memo", () => {
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(8);
    expect(result.rows[0]!.amountCents).toBe(-4500);
    expect(result.rows[0]!.memoRaw).toBe("Withdrawal");
    expect(result.rows[1]!.amountCents).toBe(310000);
    expect(result.rows[1]!.postedDate).toBe("2026-03-03");
  });
});

describe("parseCsv — YNAB register", () => {
  const result = parseCsv(fixture("ynab-register.csv"), builtin("builtin-ynab-register"));

  it("parses both accounts and categories", () => {
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(12);
    expect(result.accountsInFile).toEqual(["Checking", "Chase Card"]);
    expect(result.rows[2]!.categoryHint).toBe("Food: Groceries");
    expect(result.rows[3]!.categoryHint).toBeNull();
  });

  it("outflow $86.42 → -8642, inflow $3,250.00 → 325000, return $12.34 → 1234", () => {
    expect(result.rows[2]!.amountCents).toBe(-8642);
    expect(result.rows[1]!.amountCents).toBe(325000);
    expect(result.rows[9]!.amountCents).toBe(1234);
  });

  it("keeps the two identical coffee rows and the transfer pair", () => {
    expect(result.rows.filter((r) => r.payeeRaw === "Blue Bottle Coffee")).toHaveLength(2);
    const xfer = result.rows.filter((r) => r.payeeRaw.startsWith("Transfer :"));
    expect(xfer.map((r) => r.amountCents)).toEqual([-120000, 120000]);
  });
});

describe("parseCsv — pending status and error rows", () => {
  it("flags pending rows and reports unreadable dates without aborting", () => {
    const profile = csvProfileSchema.parse({
      dateFormat: "YYYY-MM-DD",
      dateColumn: "Date",
      amountConvention: "signed_debit_negative",
      amountColumn: "Amount",
      payeeColumn: "Payee",
      statusColumn: "Status",
      pendingValues: ["Pending"],
    });
    const text =
      "Date,Payee,Amount,Status\n2026-03-01,Coffee,-4.50,PENDING\nnot-a-date,Bad,-1.00,Posted\n2026-03-02,Rent,-1850,Posted\n";
    const r = parseCsv(text, profile);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.isPending).toBe(true);
    expect(r.rows[1]!.isPending).toBe(false);
    expect(r.issues).toEqual([
      { row: 1, message: 'Unreadable date "not-a-date" (expected YYYY-MM-DD)' },
    ]);
  });

  it("supports headerless files with index columns", () => {
    const profile = csvProfileSchema.parse({
      hasHeader: false,
      dateFormat: "DD/MM/YYYY",
      dateColumn: "0",
      amountConvention: "signed_debit_negative",
      amountColumn: "2",
      payeeColumn: "1",
    });
    const r = parseCsv("04/03/2026,Shop,-10.00\n", profile);
    expect(r.rows[0]!.postedDate).toBe("2026-03-04");
    expect(r.rows[0]!.amountCents).toBe(-1000);
  });

  it("reports a missing required column instead of throwing", () => {
    const r = parseCsv("Foo,Bar,Baz\n1,2,3\n", builtin("builtin-chase-checking"));
    expect(r.rows).toEqual([]);
    expect(r.issues[0]!.message).toMatch(/Column\(s\) not found/);
  });
});
