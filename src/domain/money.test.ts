import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatCompactCents,
  formatShare,
  mad,
  maskCents,
  median,
  parseCents,
} from "./money";

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

describe("formatCompactCents", () => {
  it("shortens to K and M with the app's minus sign", () => {
    expect(formatCompactCents(0)).toBe("$0");
    expect(formatCompactCents(99_950)).toBe("$1000");
    expect(formatCompactCents(123_456)).toBe("$1.2K");
    expect(formatCompactCents(1_234_500)).toBe("$12K");
    expect(formatCompactCents(123_456_700)).toBe("$1.2M");
    expect(formatCompactCents(-5_000)).toBe("−$50");
  });
});

describe("maskCents", () => {
  it("keeps only the sign", () => {
    expect(maskCents(123_456)).toBe("$••••");
    expect(maskCents(1)).toBe("$••••");
    expect(maskCents(0)).toBe("$••••");
    expect(maskCents(-7)).toBe("−$••••");
    expect(maskCents(-999_999_99)).toBe("−$••••");
    expect(maskCents(500, { sign: true })).toBe("+$••••");
    expect(maskCents(-500, { sign: true })).toBe("−$••••");
    expect(maskCents(0, { sign: true })).toBe("$••••");
  });
});

describe("formatShare", () => {
  it("rounds to whole percents from 10% and one decimal below", () => {
    expect(formatShare(25_000, 100_000)).toBe("25%");
    expect(formatShare(100_000, 100_000)).toBe("100%");
    expect(formatShare(150_000, 100_000)).toBe("150%");
    expect(formatShare(9_949, 100_000)).toBe("9.9%");
    expect(formatShare(9_950, 100_000)).toBe("10%");
    expect(formatShare(2_500, 100_000)).toBe("2.5%");
    expect(formatShare(40, 100_000)).toBe("0%");
    expect(formatShare(0, 100_000)).toBe("0%");
    expect(formatShare(33_333, 100_000)).toBe("33%");
  });
  it("carries sign like formatCents", () => {
    expect(formatShare(-25_000, 100_000)).toBe("−25%");
    expect(formatShare(-500, 100_000)).toBe("−0.5%");
    expect(formatShare(25_000, 100_000, { sign: true })).toBe("+25%");
    expect(formatShare(0, 100_000, { sign: true })).toBe("0%");
  });
  it("has nothing to say without a whole", () => {
    expect(formatShare(500, 0)).toBe("—");
    expect(formatShare(500, -100)).toBe("—");
    expect(formatShare(500, NaN)).toBe("—");
  });
});
