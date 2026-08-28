import type { CandidateTransaction } from "@/domain/types";

export interface ParseIssue {
  /** 0-based data-row index (or transaction index for OFX). */
  row: number;
  message: string;
}

/**
 * A row as read from a file. `accountId` is "" until the import service resolves it;
 * `accountLabel` is whatever the file said about the account (a name, or an OFX ACCTID).
 */
export type ParsedRow = Omit<CandidateTransaction, "accountId"> & {
  accountId: string;
  accountLabel: string | null;
};

export interface ParsedBalance {
  accountLabel: string | null;
  asOfDate: string;
  balanceCents: number;
}

/** The date range a statement says it covers (OFX DTSTART/DTEND) — coverage even with no rows. */
export interface ParsedRange {
  accountLabel: string | null;
  start: string;
  end: string;
}

export interface ParseResult {
  format: "ofx" | "csv";
  rows: ParsedRow[];
  issues: ParseIssue[];
  /** Unique account labels seen in the file, in order of first appearance. */
  accountsInFile: string[];
  balances: ParsedBalance[];
  ranges: ParsedRange[];
}
