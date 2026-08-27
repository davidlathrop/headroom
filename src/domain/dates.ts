import type { ISODate, MonthKey } from "./types";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(s: string): s is ISODate {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  return isValidYMD(Number(y), Number(mo), Number(d));
}

function isValidYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function splitISO(iso: ISODate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toEpochDays(iso: ISODate): number {
  const { y, m, d } = splitISO(iso);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromEpochDays(days: number): ISODate {
  const dt = new Date(days * 86_400_000);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromEpochDays(toEpochDays(iso) + n);
}

/** b − a in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toEpochDays(b) - toEpochDays(a);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function monthKey(iso: ISODate): MonthKey {
  return iso.slice(0, 7);
}

export function monthStart(month: MonthKey): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: MonthKey): ISODate {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return toISO(y, m, daysInMonth(y, m));
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${pad2(nm + 1)}`;
}

export function isMonthKey(s: string): s is MonthKey {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Today's calendar date in the machine's local zone. */
export function today(): ISODate {
  const d = new Date();
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function formatMonth(month: MonthKey): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatISO(iso: ISODate, style: "short" | "medium" = "medium"): string {
  const { y, m, d } = splitISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: style === "medium" ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

/**
 * Supported explicit date formats for import profiles. Never guessed:
 * "03/04/2026" is ambiguous and a profile must say which it is.
 */
export const DATE_FORMATS = [
  "YYYY-MM-DD",
  "MM/DD/YYYY",
  "M/D/YYYY",
  "DD/MM/YYYY",
  "D/M/YYYY",
  "MM-DD-YYYY",
  "DD-MM-YYYY",
  "YYYYMMDD",
  "MM/DD/YY",
  "M/D/YY",
  "YYYY/MM/DD",
  "MMM D, YYYY",
  "D MMM YYYY",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Parse a date string with an explicit format. Returns null if it does not match. */
export function parseDate(input: string, format: DateFormat): ISODate | null {
  const s = input.trim();
  if (s === "") return null;
  // Tokenize the format into a regex.
  const tokens = format.match(/YYYY|YY|MMM|MM|M|DD|D|[^A-Z]+/g);
  if (!tokens) return null;
  let re = "^";
  const order: string[] = [];
  for (const t of tokens) {
    switch (t) {
      case "YYYY":
        re += "(\\d{4})";
        order.push("Y4");
        break;
      case "YY":
        re += "(\\d{2})";
        order.push("Y2");
        break;
      case "MMM":
        re += "([A-Za-z]{3})";
        order.push("MMM");
        break;
      case "MM":
        re += "(\\d{2})";
        order.push("M");
        break;
      case "M":
        re += "(\\d{1,2})";
        order.push("M");
        break;
      case "DD":
        re += "(\\d{2})";
        order.push("D");
        break;
      case "D":
        re += "(\\d{1,2})";
        order.push("D");
        break;
      default:
        re += t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    }
  }
  // Tolerate a trailing time component ("2026-03-04 13:22:01").
  re += "(?:[ T].*)?$";
  const m = new RegExp(re).exec(s);
  if (!m) return null;
  let y = 0,
    mo = 0,
    d = 0;
  order.forEach((k, i) => {
    const v = m[i + 1]!;
    if (k === "Y4") y = Number(v);
    else if (k === "Y2") y = 2000 + Number(v);
    else if (k === "M") mo = Number(v);
    else if (k === "D") d = Number(v);
    else if (k === "MMM") mo = MONTHS.indexOf(v.toUpperCase()) + 1;
  });
  if (!isValidYMD(y, mo, d)) return null;
  return toISO(y, mo, d);
}
