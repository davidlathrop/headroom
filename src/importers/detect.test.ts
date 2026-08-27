import { describe, expect, it } from "vitest";
import { detectFormat, matchCsvProfile, parseWithProfile } from "./detect";
import { BUILTIN_PROFILES } from "./csv/builtins";
import { fixture } from "./fixtures.test-util";

describe("detectFormat", () => {
  it("recognises SGML and XML OFX, and everything else as CSV", () => {
    expect(detectFormat(fixture("checking.ofx"))).toBe("ofx");
    expect(detectFormat(fixture("card.qfx"))).toBe("ofx");
    for (const f of [
      "chase-checking.csv",
      "chase-card.csv",
      "amex.csv",
      "capital-one-card.csv",
      "bofa-checking.csv",
      "ally.csv",
      "ynab-register.csv",
    ]) {
      expect(detectFormat(fixture(f))).toBe("csv");
    }
  });
});

describe("matchCsvProfile", () => {
  const expected: Array<[string, string, number]> = [
    ["chase-checking.csv", "builtin-chase-checking", 0],
    ["chase-card.csv", "builtin-chase-card", 0],
    ["amex.csv", "builtin-amex", 0],
    ["capital-one-card.csv", "builtin-capital-one-card", 0],
    ["bofa-checking.csv", "builtin-bofa-checking", 6],
    ["ally.csv", "builtin-ally", 0],
    ["ynab-register.csv", "builtin-ynab-register", 0],
  ];
  for (const [file, id, skip] of expected) {
    it(`picks ${id} for ${file}`, () => {
      const m = matchCsvProfile(fixture(file), BUILTIN_PROFILES)!;
      expect(m).not.toBeNull();
      expect(m.profile.id).toBe(id);
      expect(m.skipRows).toBe(skip);
    });
  }

  it("returns null for an unknown layout", () => {
    expect(matchCsvProfile("Foo,Bar,Baz\na,b,c\n", BUILTIN_PROFILES)).toBeNull();
  });

  it("prefers the most specific signature when a generic one also matches", () => {
    // Chase card headers contain Date-ish columns and Description/Amount, but not a plain "Date";
    // Bank of America contains Date,Description,Amount (Amex signature) plus Running Bal.
    const m = matchCsvProfile(fixture("bofa-checking.csv"), BUILTIN_PROFILES)!;
    expect(m.profile.id).toBe("builtin-bofa-checking");
  });
});

describe("parseWithProfile", () => {
  it("dispatches OFX and CSV and applies the skipRows override", () => {
    const ofx = BUILTIN_PROFILES.find((p) => p.id === "builtin-ofx")!;
    expect(parseWithProfile(fixture("checking.ofx"), ofx).rows).toHaveLength(10);

    const bofa = matchCsvProfile(fixture("bofa-checking.csv"), BUILTIN_PROFILES)!;
    const r = parseWithProfile(fixture("bofa-checking.csv"), bofa.profile, bofa.skipRows);
    expect(r.rows).toHaveLength(11);
    expect(r.issues).toHaveLength(1);
  });

  it("every fixture's purchases are negative and deposits/payments positive", () => {
    const checks: Array<[string, string[], string[]]> = [
      ["chase-checking.csv", ["WHOLEFDS", "PG&E"], ["PAYROLL", "INTEREST"]],
      ["chase-card.csv", ["NETFLIX", "SAFEWAY"], ["AUTOMATIC PAYMENT"]],
      ["amex.csv", ["DELTA", "COSTCO"], ["ONLINE PAYMENT"]],
      ["capital-one-card.csv", ["CHEVRON", "HULU"], ["ONLINE PYMT"]],
      ["bofa-checking.csv", ["COMCAST", "SHELL"], ["PAYROLL", "Interest"]],
      ["ally.csv", ["VENMO", "SPOTIFY"], ["PAYROLL", "Interest"]],
      ["ynab-register.csv", ["Whole Foods", "Landlord"], ["Acme Corp"]],
    ];
    for (const [file, negatives, positives] of checks) {
      const text = fixture(file);
      const m = matchCsvProfile(text, BUILTIN_PROFILES)!;
      const r = parseWithProfile(text, m.profile, m.skipRows);
      for (const needle of negatives) {
        const rows = r.rows.filter((x) => x.payeeRaw.includes(needle));
        expect(rows.length, `${file}: ${needle}`).toBeGreaterThan(0);
        expect(
          rows.every((x) => x.amountCents < 0),
          `${file}: ${needle} negative`,
        ).toBe(true);
      }
      for (const needle of positives) {
        const rows = r.rows.filter((x) => x.payeeRaw.includes(needle));
        expect(rows.length, `${file}: ${needle}`).toBeGreaterThan(0);
        expect(
          rows.every((x) => x.amountCents > 0),
          `${file}: ${needle} positive`,
        ).toBe(true);
      }
    }
  });
});
