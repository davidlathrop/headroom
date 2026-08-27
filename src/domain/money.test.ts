import { describe, expect, it } from "vitest";
import { formatCents, mad, median, parseCents } from "./money";

describe("parseCents", () => {
  it("parses plain and formatted amounts without floats", () => {
    expect(parseCents("1234.56")).toBe(123456);
    expect(parseCents("$1,234.56")).toBe(123456);
    expect(parseCents("-12.34")).toBe(-1234);
    expect(parseCents("(12.34)")).toBe(-1234);
    expect(parseCents("12.34-")).toBe(-1234);
    expect(parseCents("−12")).toBe(-1200);
    expect(parseCents("0.1")).toBe(10);
    expect(parseCents(".5")).toBe(50);
    expect(parseCents("7")).toBe(700);
    expect(parseCents("+3.00")).toBe(300);
    expect(parseCents("-$0.07")).toBe(-7);
  });
  it("is exact where floats are not", () => {
    expect(parseCents("0.29")).toBe(29); // 0.29*100 = 28.999999999999996 in floating point
    expect(parseCents("1.005")).toBe(101); // rounds half up on the 3rd decimal
    expect(parseCents("4.35")).toBe(435);
  });
  it("rejects non-numbers", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("1.2.3")).toBeNull();
    expect(parseCents("--1")).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats with a true minus sign", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-1234)).toBe("−$12.34");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(500, "USD", { sign: true })).toBe("+$5.00");
  });
});

describe("median / mad", () => {
  it("computes robust statistics", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3); // (2+3)/2 rounded
    expect(median([])).toBe(0);
    expect(mad([10, 10, 10, 100])).toBe(0);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });
});
