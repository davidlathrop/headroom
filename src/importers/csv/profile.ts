import { z } from "zod";
import { DATE_FORMATS } from "@/domain/dates";

export const AMOUNT_CONVENTIONS = [
  "signed_debit_negative", // one column; charges/withdrawals negative (most bank exports)
  "signed_debit_positive", // one column; charges positive (Amex, some card exports)
  "debit_credit_columns", // two columns of positive numbers: Debit (out) and Credit (in)
  "inflow_outflow_columns", // two columns: Outflow (out) and Inflow (in) — YNAB
] as const;
export type AmountConvention = (typeof AMOUNT_CONVENTIONS)[number];

/**
 * How to read one institution's CSV. Stored as JSON on import_profiles.
 * Column references are header names (case-insensitive, trimmed). When has_header is false they are
 * 0-based indexes encoded as strings ("0", "3").
 */
export const csvProfileSchema = z.object({
  hasHeader: z.boolean().default(true),
  /** Rows to skip before the header. Detection computes this automatically for files with preambles. */
  skipRows: z.number().int().min(0).default(0),
  delimiter: z.string().length(1).default(","),
  dateFormat: z.enum(DATE_FORMATS),
  /** The transaction date column. */
  dateColumn: z.string(),
  /** If the file has both, the posting date column; otherwise omitted and posted = txn date. */
  postedDateColumn: z.string().nullable().default(null),
  amountConvention: z.enum(AMOUNT_CONVENTIONS),
  amountColumn: z.string().nullable().default(null),
  debitColumn: z.string().nullable().default(null),
  creditColumn: z.string().nullable().default(null),
  payeeColumn: z.string(),
  memoColumn: z.string().nullable().default(null),
  idColumn: z.string().nullable().default(null),
  /** Multi-account files: the column naming the account. */
  accountColumn: z.string().nullable().default(null),
  /** Optional category name column (YNAB). */
  categoryColumn: z.string().nullable().default(null),
  statusColumn: z.string().nullable().default(null),
  /** Values in statusColumn that mean "pending" (case-insensitive). */
  pendingValues: z.array(z.string()).default([]),
  /** Header names that must all be present for auto-detection to pick this profile. */
  signature: z.array(z.string()).default([]),
});

export type CsvProfile = z.infer<typeof csvProfileSchema>;
export type CsvProfileInput = z.input<typeof csvProfileSchema>;

export interface ImportProfileRecord {
  id: string;
  name: string;
  format: "ofx" | "csv";
  institution: string | null;
  config: CsvProfile | null;
  isBuiltin: boolean;
}
