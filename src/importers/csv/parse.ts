import { parse } from "csv-parse/sync";
import { parseCents } from "@/domain/money";
import { parseDate } from "@/domain/dates";
import type { CsvProfile } from "./profile";
import type { ParsedRow, ParseIssue, ParseResult } from "../types";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Find the header line in a file that may have a preamble (Bank of America puts summary rows
 * above the real header). The header is the first line with ≥ 3 columns where most cells are
 * non-numeric text.
 */
export function readHeader(
  text: string,
  delimiter = ",",
): { headers: string[]; headerLineIndex: number } | null {
  const lines = text.split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length && seen < 30; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    seen++;
    let cells: string[];
    try {
      const parsed = parse(line, {
        delimiter,
        relax_column_count: true,
        bom: true,
        trim: true,
      }) as string[][];
      cells = parsed[0] ?? [];
    } catch {
      continue;
    }
    if (cells.length < 3) continue;
    const nonEmpty = cells.filter((c) => c !== "");
    if (nonEmpty.length < 3) continue;
    const textual = nonEmpty.filter(
      (c) => parseCents(c) == null && !/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(c),
    );
    if (textual.length * 2 > nonEmpty.length) return { headers: cells, headerLineIndex: i };
  }
  return null;
}

type Resolver = (record: string[], col: string | null) => string | null;

/** Build a column accessor. Missing optional header names resolve to null rather than throwing. */
function makeResolver(headers: string[] | null): Resolver {
  const index = new Map<string, number>();
  if (headers) headers.forEach((h, i) => index.set(norm(h), i));
  return (record, col) => {
    if (col == null) return null;
    let i: number | undefined;
    if (headers) {
      i = index.get(norm(col));
      if (i === undefined && /^\d+$/.test(col)) i = Number(col);
    } else {
      i = Number(col);
      if (!Number.isInteger(i)) return null;
    }
    if (i === undefined || i < 0) return null;
    const v = record[i];
    return v === undefined ? null : v;
  };
}

function nonEmpty(v: string | null): string | null {
  return v == null || v.trim() === "" ? null : v.trim();
}

export function parseCsv(text: string, profile: CsvProfile): ParseResult {
  const records = parse(text, {
    delimiter: profile.delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
    from_line: profile.skipRows + 1,
  }) as string[][];

  const headers = profile.hasHeader ? (records.shift() ?? []) : null;
  const get = makeResolver(headers);
  const missingRequired = [profile.dateColumn, profile.payeeColumn].filter(
    (c) => headers && !headers.some((h) => norm(h) === norm(c)) && !/^\d+$/.test(c),
  );
  if (missingRequired.length > 0) {
    return {
      format: "csv",
      rows: [],
      issues: [
        { row: -1, message: `Column(s) not found in header: ${missingRequired.join(", ")}` },
      ],
      accountsInFile: [],
      balances: [],
    };
  }

  const rows: ParsedRow[] = [];
  const issues: ParseIssue[] = [];
  const accountsInFile: string[] = [];
  const pending = new Set(profile.pendingValues.map(norm));

  records.forEach((record, i) => {
    const dateRaw = nonEmpty(get(record, profile.dateColumn));
    const txnDate = dateRaw ? parseDate(dateRaw, profile.dateFormat) : null;
    if (!txnDate) {
      issues.push({
        row: i,
        message: `Unreadable date "${dateRaw ?? ""}" (expected ${profile.dateFormat})`,
      });
      return;
    }
    const postedRaw = nonEmpty(get(record, profile.postedDateColumn));
    const postedDate = (postedRaw ? parseDate(postedRaw, profile.dateFormat) : null) ?? txnDate;

    const amount = readAmount(record, profile, get);
    if (amount.error != null) {
      issues.push({ row: i, message: amount.error });
      return;
    }

    const accountLabel = nonEmpty(get(record, profile.accountColumn));
    if (accountLabel && !accountsInFile.includes(accountLabel)) accountsInFile.push(accountLabel);
    const status = nonEmpty(get(record, profile.statusColumn));

    rows.push({
      accountId: "",
      accountLabel,
      postedDate,
      txnDate,
      amountCents: amount.cents,
      currency: "USD",
      payeeRaw: get(record, profile.payeeColumn)?.trim() ?? "",
      memoRaw: get(record, profile.memoColumn)?.trim() ?? "",
      externalId: nonEmpty(get(record, profile.idColumn)),
      isPending: status != null && pending.has(norm(status)),
      categoryHint: nonEmpty(get(record, profile.categoryColumn)),
      sourceRow: i,
    });
  });

  return { format: "csv", rows, issues, accountsInFile, balances: [] };
}

function readAmount(
  record: string[],
  profile: CsvProfile,
  get: Resolver,
): { cents: number; error: null } | { cents: null; error: string } {
  const fail = (error: string) => ({ cents: null, error }) as const;
  switch (profile.amountConvention) {
    case "signed_debit_negative":
    case "signed_debit_positive": {
      const raw = nonEmpty(get(record, profile.amountColumn));
      if (raw == null) return fail("Empty amount");
      const cents = parseCents(raw);
      if (cents == null) return fail(`Unreadable amount "${raw}"`);
      return {
        cents: profile.amountConvention === "signed_debit_positive" ? -cents : cents,
        error: null,
      };
    }
    case "debit_credit_columns": {
      const debit = nonEmpty(get(record, profile.debitColumn));
      const credit = nonEmpty(get(record, profile.creditColumn));
      if (debit != null) {
        const c = parseCents(debit);
        if (c == null) return fail(`Unreadable debit "${debit}"`);
        return { cents: -Math.abs(c), error: null };
      }
      if (credit != null) {
        const c = parseCents(credit);
        if (c == null) return fail(`Unreadable credit "${credit}"`);
        return { cents: Math.abs(c), error: null };
      }
      return fail("Empty amount (no debit or credit)");
    }
    case "inflow_outflow_columns": {
      const outflow = nonEmpty(get(record, profile.debitColumn));
      const inflow = nonEmpty(get(record, profile.creditColumn));
      const out = outflow == null ? null : parseCents(outflow);
      const inn = inflow == null ? null : parseCents(inflow);
      if (outflow != null && out == null) return fail(`Unreadable outflow "${outflow}"`);
      if (inflow != null && inn == null) return fail(`Unreadable inflow "${inflow}"`);
      if (out != null && out !== 0) return { cents: -Math.abs(out), error: null };
      if (inn != null) return { cents: Math.abs(inn), error: null };
      if (out === 0) return { cents: 0, error: null };
      return fail("Empty amount (no outflow or inflow)");
    }
  }
}
