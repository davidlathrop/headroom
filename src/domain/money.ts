import type { Cents } from "./types";

/**
 * Parse a money string into integer cents without ever touching floats.
 * Accepts: "1234.56", "-12.34", "(12.34)", "12.34-", "$1,234.56", "−12", "1.234,56" is NOT supported (US formats only).
 * Returns null when the string is not a number.
 */
export function parseCents(input: string): Cents | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/[$€£,\s]/g, "").replace(/^−/, "-");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return null;
  const [intPart = "0", fracPartRaw = ""] = s.split(".");
  let frac = fracPartRaw;
  let carry = 0;
  if (frac.length > 2) {
    // round half up on the third decimal digit
    const third = Number(frac[2]);
    frac = frac.slice(0, 2);
    if (third >= 5) carry = 1;
  }
  frac = frac.padEnd(2, "0");
  const cents = Number(intPart) * 100 + Number(frac) + carry;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Format cents for display: 123456 → "$1,234.56"; -1234 → "−$12.34". */
export function formatCents(cents: Cents, currency = "USD", opts: { sign?: boolean } = {}): string {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 });
    formatters.set(currency, f);
  }
  const abs = f.format(Math.abs(cents) / 100);
  if (cents < 0) return `−${abs}`;
  if (opts.sign && cents > 0) return `+${abs}`;
  return abs;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Median absolute deviation. */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}
