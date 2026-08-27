import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  diffDays,
  isISODate,
  monthEnd,
  monthKey,
  monthStart,
  parseDate,
} from "./dates";

describe("parseDate", () => {
  it("parses only with an explicit format — no guessing", () => {
    expect(parseDate("03/04/2026", "MM/DD/YYYY")).toBe("2026-03-04");
    expect(parseDate("03/04/2026", "DD/MM/YYYY")).toBe("2026-04-03");
    expect(parseDate("3/4/2026", "M/D/YYYY")).toBe("2026-03-04");
    expect(parseDate("2026-03-04", "YYYY-MM-DD")).toBe("2026-03-04");
    expect(parseDate("20260304", "YYYYMMDD")).toBe("2026-03-04");
    expect(parseDate("Mar 4, 2026", "MMM D, YYYY")).toBe("2026-03-04");
    expect(parseDate("4 Mar 2026", "D MMM YYYY")).toBe("2026-03-04");
    expect(parseDate("03/04/26", "MM/DD/YY")).toBe("2026-03-04");
  });
  it("tolerates a trailing time", () => {
    expect(parseDate("2026-03-04 13:22:01", "YYYY-MM-DD")).toBe("2026-03-04");
  });
  it("rejects invalid dates and format mismatches", () => {
    expect(parseDate("2026-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("13/01/2026", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("2026-03-04", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("", "YYYY-MM-DD")).toBeNull();
  });
});

describe("date arithmetic", () => {
  it("is DST-proof and leap-aware", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST switch day
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDays("2026-03-01", "2026-03-31")).toBe(30);
    expect(diffDays("2026-03-31", "2026-03-01")).toBe(-30);
  });
  it("handles months", () => {
    expect(monthKey("2026-03-15")).toBe("2026-03");
    expect(monthStart("2026-02")).toBe("2026-02-01");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-02-28")).toBe(true);
  });
});
