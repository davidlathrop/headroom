import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { advance, detectRecurring, expectedDates, type RecurringInputTxn } from "./recurring";

let n = 0;
function t(payeeKey: string, postedDate: string, amountCents: number, accountId = "chk", categoryId: string | null = "cat"): RecurringInputTxn {
  return { id: `t${n++}`, accountId, payeeKey, categoryId, postedDate, amountCents };
}
const monthly = (payee: string, day: number, amount: number, months: string[]) => months.map((m) => t(payee, `${m}-${String(day).padStart(2, "0")}`, amount));

describe("detectRecurring", () => {
  const today = "2026-08-26";
  it("finds a monthly fixed bill with an anchor day and predicts the next date", () => {
    const rows = monthly("NETFLIX.COM", 6, -1549, ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    const [s] = detectRecurring(rows, { today });
    expect(s).toBeDefined();
    expect(s!.cadence).toBe("monthly");
    expect(s!.typicalAmountCents).toBe(-1549);
    expect(s!.anchorDay).toBe(6);
    expect(s!.isFixedAmount).toBe(true);
    expect(s!.nextExpectedDate).toBe("2026-09-06");
    expect(s!.active).toBe(true);
    expect(s!.memberIds).toHaveLength(6);
  });

  it("finds biweekly paychecks", () => {
    const rows: RecurringInputTxn[] = [];
    let d = "2026-03-06";
    for (let i = 0; i < 12; i++) {
      rows.push(t("ACME CORP PAYROLL", d, 325000));
      d = addDays(d, 14);
    }
    const [s] = detectRecurring(rows, { today });
    expect(s!.cadence).toBe("biweekly");
    expect(s!.typicalAmountCents).toBe(325000);
    expect(s!.nextExpectedDate > today).toBe(true);
  });

  it("treats a variable-amount utility as recurring but not fixed-amount", () => {
    const rows = [t("PG&E", "2026-04-10", -14217), t("PG&E", "2026-05-11", -9850), t("PG&E", "2026-06-09", -12030), t("PG&E", "2026-07-10", -17600), t("PG&E", "2026-08-10", -16000)];
    const [s] = detectRecurring(rows, { today });
    expect(s!.cadence).toBe("monthly");
    expect(s!.isFixedAmount).toBe(false);
    expect(s!.amountMadCents).toBeGreaterThan(0);
  });

  it("ignores irregular payees and same-day repeats", () => {
    const random = [t("SAFEWAY", "2026-06-01", -5000), t("SAFEWAY", "2026-06-04", -3000), t("SAFEWAY", "2026-06-19", -8000), t("SAFEWAY", "2026-07-02", -2000), t("SAFEWAY", "2026-07-30", -4000)];
    expect(detectRecurring(random, { today })).toHaveLength(0);
    const coffees = [t("BLUE BOTTLE", "2026-08-04", -450), t("BLUE BOTTLE", "2026-08-04", -450), t("BLUE BOTTLE", "2026-08-11", -450)];
    expect(detectRecurring(coffees, { today })).toHaveLength(0); // only 2 distinct days
  });

  it("marks a series inactive after two missed expected dates", () => {
    const rows = monthly("GYM", 1, -4900, ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
    const [s] = detectRecurring(rows, { today });
    expect(s!.active).toBe(false);
  });

  it("finds annual series with only two occurrences", () => {
    const rows = [t("DOMAIN RENEWAL", "2024-09-12", -1499), t("DOMAIN RENEWAL", "2025-09-14", -1499)];
    const [s] = detectRecurring(rows, { today });
    expect(s!.cadence).toBe("annual");
    expect(s!.nextExpectedDate).toBe("2026-09-14");
  });
});

describe("advance / expectedDates", () => {
  it("snaps monthly to the anchor day and clamps short months", () => {
    expect(advance("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(advance("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    expect(advance("2026-08-15", "semimonthly", null)).toBe("2026-09-01");
    expect(advance("2026-09-01", "semimonthly", null)).toBe("2026-09-16");
    expect(advance("2026-08-26", "weekly", null)).toBe("2026-09-02");
    expect(advance("2026-08-26", "quarterly", 26)).toBe("2026-11-26");
  });
  it("lists occurrences within a window", () => {
    const s = { cadence: "biweekly" as const, anchorDay: null, nextExpectedDate: "2026-09-04" };
    expect(expectedDates(s, "2026-09-01", "2026-09-30")).toEqual(["2026-09-04", "2026-09-18"]);
    expect(expectedDates(s, "2026-10-01", "2026-10-31")).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
  });
});
