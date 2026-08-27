import { describe, expect, it } from "vitest";
import { canonForFingerprint, displayFromKey, normalizePayee } from "./payee";

describe("canonForFingerprint", () => {
  it("only uppercases and collapses whitespace", () => {
    expect(canonForFingerprint("  Sq *Blue   Bottle ")).toBe("SQ *BLUE BOTTLE");
  });
});

describe("normalizePayee", () => {
  const cases: Array<[string, string]> = [
    ["SQ *BLUE BOTTLE COFFEE", "BLUE BOTTLE COFFEE"],
    ["POS DEBIT 1234 WHOLEFDS MKT 10259 SAN FRANCISCO CA", "WHOLEFDS MKT"],
    ["AMZN Mktp US*2K4TR8XZ1", "AMZN MKTP"],
    ["TST* THE MILL SAN FRANCISCO CA", "THE MILL"],
    ["PAYPAL *SPOTIFY 402-935-7733 CA", "SPOTIFY"],
    ["NETFLIX.COM", "NETFLIX.COM"],
    ["CHECKCARD 0304 SAFEWAY #1234 OAKLAND CA", "SAFEWAY"],
    ["Zelle payment to Jane Doe 18234567890", "ZELLE PAYMENT TO JANE DOE"],
    ["ACME CORP PAYROLL PPD ID: 1234567890", "ACME CORP PAYROLL"],
  ];
  for (const [raw, key] of cases) {
    it(`${raw} → ${key}`, () => {
      expect(normalizePayee(raw)).toBe(key);
    });
  }
  it("never returns an empty key", () => {
    expect(normalizePayee("123456789")).not.toBe("");
    expect(normalizePayee("***")).not.toBe("");
  });
});

describe("displayFromKey", () => {
  it("title-cases", () => {
    expect(displayFromKey("WHOLE FOODS MKT")).toBe("Whole Foods Mkt");
  });
});
