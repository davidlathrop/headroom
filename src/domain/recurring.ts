import { addDays, addMonths, daysInMonth, diffDays, monthKey, splitISO, toISO } from "./dates";
import { mad, median } from "./money";
import type { Cents, ISODate } from "./types";

export const CADENCES = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "annual"] as const;
export type Cadence = (typeof CADENCES)[number];

/** Median gap in days and the tolerance a gap may deviate and still count. */
export const CADENCE_SPEC: Record<Cadence, { days: number; tol: number }> = {
  weekly: { days: 7, tol: 1 },
  biweekly: { days: 14, tol: 2 },
  semimonthly: { days: 15.2, tol: 3 },
  monthly: { days: 30.4, tol: 4 },
  quarterly: { days: 91, tol: 10 },
  annual: { days: 365, tol: 20 },
};

export interface RecurringInputTxn {
  id: string;
  accountId: string;
  payeeKey: string;
  categoryId: string | null;
  postedDate: ISODate;
  amountCents: Cents;
}

export interface DetectedSeries {
  /** Stable identity: accountId|payeeKey|sign */
  key: string;
  accountId: string;
  payeeKey: string;
  /** Most common category among members. */
  categoryId: string | null;
  cadence: Cadence;
  /** Signed: negative for bills, positive for income. */
  typicalAmountCents: Cents;
  amountMadCents: Cents;
  /** For monthly series: the day of month it usually lands on. */
  anchorDay: number | null;
  lastSeenDate: ISODate;
  nextExpectedDate: ISODate;
  occurrences: number;
  memberIds: string[];
  /** MAD/median ≤ 5%: rent, streaming. Otherwise a variable-amount bill (utilities). */
  isFixedAmount: boolean;
  /** False after two expected dates were missed. */
  active: boolean;
}

export interface DetectOptions {
  today: ISODate;
  lookbackMonths?: number; // default 26 (so annual series can show 3 occurrences)
  minOccurrences?: number; // default 3 (annual: 2)
}

/** The date one cadence step after `from`. Monthly-ish cadences snap to the anchor day. */
export function advance(from: ISODate, cadence: Cadence, anchorDay: number | null): ISODate {
  switch (cadence) {
    case "monthly":
    case "quarterly":
    case "annual": {
      const step = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
      const { d } = splitISO(from);
      const m = addMonths(monthKey(from), step);
      const y = Number(m.slice(0, 4));
      const mo = Number(m.slice(5, 7));
      const day = Math.min(anchorDay ?? d, daysInMonth(y, mo));
      return toISO(y, mo, day);
    }
    case "semimonthly": {
      // 1st/15th style: alternate between the anchor and anchor+15 (clamped).
      const { y, m, d } = splitISO(from);
      if (d < 15) return toISO(y, m, Math.min(d + 15, daysInMonth(y, m)));
      const next = addMonths(monthKey(from), 1);
      const ny = Number(next.slice(0, 4));
      const nm = Number(next.slice(5, 7));
      return toISO(ny, nm, Math.min(Math.max(1, d - 15), daysInMonth(ny, nm)));
    }
    case "weekly":
      return addDays(from, 7);
    case "biweekly":
      return addDays(from, 14);
  }
}

/** Expected occurrence dates in [from, to], starting from the series' next expected date. */
export function expectedDates(series: Pick<DetectedSeries, "cadence" | "anchorDay" | "nextExpectedDate">, from: ISODate, to: ISODate, cap = 400): ISODate[] {
  const out: ISODate[] = [];
  let d = series.nextExpectedDate;
  let n = 0;
  while (d <= to && n < cap) {
    if (d >= from) out.push(d);
    d = advance(d, series.cadence, series.anchorDay);
    n++;
  }
  return out;
}

function classify(gaps: number[]): Cadence | null {
  if (gaps.length === 0) return null;
  const med = median(gaps);
  let best: Cadence | null = null;
  let bestDist = Infinity;
  for (const c of CADENCES) {
    const { days, tol } = CADENCE_SPEC[c];
    const dist = Math.abs(med - days);
    if (dist <= tol && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  if (!best) return null;
  // Most gaps must agree, not just the median, and none may be far shorter than the cadence:
  // a grocery store hit at random intervals is not a series.
  const { days, tol } = CADENCE_SPEC[best];
  const agree = gaps.filter((g) => Math.abs(g - days) <= tol).length;
  if (Math.min(...gaps) < days / 2) return null;
  return agree / gaps.length >= 0.75 ? best : null;
}

export function detectRecurring(txns: RecurringInputTxn[], opts: DetectOptions): DetectedSeries[] {
  const lookbackMonths = opts.lookbackMonths ?? 26;
  const minOcc = opts.minOccurrences ?? 3;
  const since = `${addMonths(monthKey(opts.today), -lookbackMonths)}-01`;
  const groups = new Map<string, RecurringInputTxn[]>();
  for (const t of txns) {
    if (t.postedDate < since || t.postedDate > opts.today || t.amountCents === 0) continue;
    const key = `${t.accountId}|${t.payeeKey}|${t.amountCents < 0 ? "-" : "+"}`;
    const g = groups.get(key) ?? [];
    g.push(t);
    groups.set(key, g);
  }
  const out: DetectedSeries[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.postedDate < b.postedDate ? -1 : a.postedDate > b.postedDate ? 1 : 0));
    // Same-day repeats (two coffees) are one occurrence for cadence purposes.
    const byDay = new Map<ISODate, RecurringInputTxn>();
    for (const t of list) if (!byDay.has(t.postedDate)) byDay.set(t.postedDate, t);
    const occ = [...byDay.values()];
    if (occ.length < 2) continue;
    const gaps: number[] = [];
    for (let i = 1; i < occ.length; i++) gaps.push(diffDays(occ[i - 1]!.postedDate, occ[i]!.postedDate));
    const cadence = classify(gaps);
    if (!cadence) continue;
    if (occ.length < (cadence === "annual" ? 2 : minOcc)) continue;

    const amounts = occ.map((t) => t.amountCents);
    const typical = median(amounts);
    const spread = mad(amounts);
    const days = occ.map((t) => splitISO(t.postedDate).d);
    // Monthly series anchor to their usual day; longer cadences to the most recent one.
    const anchorDay = cadence === "monthly" ? (mad(days) <= 3 ? median(days) : null) : cadence === "quarterly" || cadence === "annual" ? days[days.length - 1]! : null;
    const last = occ[occ.length - 1]!;

    // Roll the next expected date forward past misses; two misses = inactive.
    const { tol } = CADENCE_SPEC[cadence];
    let next = advance(last.postedDate, cadence, anchorDay);
    let missed = 0;
    while (next < addDays(opts.today, -tol) && missed < 2) {
      next = advance(next, cadence, anchorDay);
      missed++;
    }
    const catCounts = new Map<string, number>();
    for (const t of list) if (t.categoryId) catCounts.set(t.categoryId, (catCounts.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    out.push({
      key,
      accountId: list[0]!.accountId,
      payeeKey: list[0]!.payeeKey,
      categoryId,
      cadence,
      typicalAmountCents: typical,
      amountMadCents: spread,
      anchorDay,
      lastSeenDate: last.postedDate,
      nextExpectedDate: next,
      occurrences: occ.length,
      memberIds: list.map((t) => t.id),
      isFixedAmount: Math.abs(typical) > 0 && spread / Math.abs(typical) <= 0.05,
      active: missed < 2,
    });
  }
  return out.sort((a, b) => Math.abs(b.typicalAmountCents) - Math.abs(a.typicalAmountCents));
}
