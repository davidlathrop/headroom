import { describe, expect, it } from "vitest";
import { parseOfx, parseOfxDate, parseOfxTree } from "./parse";
import { fixture } from "../fixtures.test-util";

describe("parseOfxDate", () => {
  it("keeps only the calendar day, ignoring time and zone", () => {
    expect(parseOfxDate("20260304120000.000[-5:EST]")).toBe("2026-03-04");
    expect(parseOfxDate("20260304")).toBe("2026-03-04");
    expect(parseOfxDate("20260304120000")).toBe("2026-03-04");
    expect(parseOfxDate("garbage")).toBeNull();
    expect(parseOfxDate("20261340")).toBeNull();
  });
});

describe("parseOfxTree", () => {
  it("treats SGML leaves without closing tags as leaves", () => {
    const tree = parseOfxTree("<OFX><A><B>hello<C>world</A></OFX>");
    const ofx = tree.children[0]!;
    const a = ofx.children[0]!;
    expect(a.name).toBe("A");
    expect(a.children.map((c) => [c.name, c.text])).toEqual([
      ["B", "hello"],
      ["C", "world"],
    ]);
  });
});

describe("parseOfx — OFX 1.x SGML checking statement", () => {
  const result = parseOfx(fixture("checking.ofx"));

  it("parses every transaction with no issues", () => {
    expect(result.format).toBe("ofx");
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(10);
  });

  it("carries FITIDs, dates, amounts and payees", () => {
    const first = result.rows[0]!;
    expect(first.externalId).toBe("2026030200001");
    expect(first.postedDate).toBe("2026-03-02");
    expect(first.amountCents).toBe(-8642);
    expect(first.payeeRaw).toBe("POS DEBIT 1234 WHOLEFDS MKT 10259");
    expect(first.memoRaw).toBe("SAN FRANCISCO CA");
    expect(first.accountLabel).toBe("000123456789");
    expect(first.currency).toBe("USD");
    expect(first.isPending).toBe(false);
    expect(first.sourceRow).toBe(0);
  });

  it("uses DTUSER as the transaction date when present", () => {
    const payroll = result.rows[1]!;
    expect(payroll.postedDate).toBe("2026-03-03");
    expect(payroll.txnDate).toBe("2026-03-02");
    expect(payroll.amountCents).toBe(325000);
  });

  it("parses a date with time and zone suffix", () => {
    expect(result.rows[2]!.postedDate).toBe("2026-03-04");
  });

  it("does not flip signs: debits negative, credits positive", () => {
    expect(result.rows.filter((r) => r.amountCents < 0)).toHaveLength(8);
    expect(result.rows[9]!.amountCents).toBe(112);
  });

  it("keeps two identical same-day rows with distinct FITIDs", () => {
    const coffees = result.rows.filter((r) => r.payeeRaw === "SQ *BLUE BOTTLE COFFEE");
    expect(coffees).toHaveLength(2);
    expect(new Set(coffees.map((c) => c.externalId)).size).toBe(2);
  });

  it("unescapes SGML entities", () => {
    expect(result.rows[6]!.payeeRaw).toBe("PG&E WEB ONLINE");
  });

  it("reads the ledger balance", () => {
    expect(result.balances).toEqual([
      { accountLabel: "000123456789", asOfDate: "2026-03-31", balanceCents: 565554 },
    ]);
    expect(result.accountsInFile).toEqual(["000123456789"]);
  });
});

describe("parseOfx — OFX 2.x XML credit card statement", () => {
  const result = parseOfx(fixture("card.qfx"));

  it("parses every transaction with no issues", () => {
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(8);
    expect(result.accountsInFile).toEqual(["4111111111111234"]);
  });

  it("carries FITIDs and DTUSER", () => {
    const netflix = result.rows[0]!;
    expect(netflix.externalId).toBe("CC2026030200001");
    expect(netflix.postedDate).toBe("2026-03-02");
    expect(netflix.txnDate).toBe("2026-03-01");
    expect(netflix.amountCents).toBe(-1549);
  });

  it("charges are negative and the payment is positive", () => {
    const payment = result.rows.find((r) => r.payeeRaw.startsWith("AUTOMATIC PAYMENT"))!;
    expect(payment.amountCents).toBe(240000);
    const charges = result.rows.filter(
      (r) => !r.payeeRaw.startsWith("AUTOMATIC") && r.memoRaw !== "RETURN",
    );
    expect(charges.every((r) => r.amountCents < 0)).toBe(true);
    const refund = result.rows.find((r) => r.memoRaw === "RETURN")!;
    expect(refund.amountCents).toBe(12900);
  });

  it("reads the ledger balance", () => {
    expect(result.balances).toEqual([
      { accountLabel: "4111111111111234", asOfDate: "2026-03-31", balanceCents: -20812 },
    ]);
  });
});
