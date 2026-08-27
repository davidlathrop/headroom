/** Calendar date as YYYY-MM-DD. No time, no zone. */
export type ISODate = string;
/** Month key as YYYY-MM. */
export type MonthKey = string;
/** Integer minor units (cents). Negative = money left the account. */
export type Cents = number;

export const ACCOUNT_KINDS = [
  "checking",
  "savings",
  "credit_card",
  "loan",
  "investment",
  "other",
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const FLOWS = ["income", "expense", "saving", "transfer", "ignore"] as const;
export type Flow = (typeof FLOWS)[number];

export const SPEND_TYPES = ["fixed", "variable"] as const;
export type SpendType = (typeof SPEND_TYPES)[number];

/** A transaction as parsed from a file, before dedupe. Amount sign already normalized. */
export interface CandidateTransaction {
  /** Account the row belongs to. Multi-account files resolve this before dedupe. */
  accountId: string;
  postedDate: ISODate;
  txnDate: ISODate;
  amountCents: Cents;
  currency: string;
  payeeRaw: string;
  memoRaw: string;
  externalId: string | null;
  isPending: boolean;
  /** Optional category name carried by the file (YNAB exports). */
  categoryHint: string | null;
  /** 0-based data-row index in the source file, for diagnostics. */
  sourceRow: number;
}

/** The subset of a stored transaction the dedupe engine needs. */
export interface StoredTransactionLite {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amountCents: Cents;
  payeeRaw: string;
  payeeKey: string;
  externalId: string | null;
  fingerprint: string;
  fingerprintSeq: number;
}

export type DedupeStatus = "new" | "exact_duplicate" | "probable_duplicate" | "pending_skipped";

export interface LabeledCandidate {
  candidate: CandidateTransaction;
  fingerprint: string;
  status: DedupeStatus;
  /** Sequence number this row will take if inserted (1-based). Present when status is new or probable_duplicate. */
  fingerprintSeq: number | null;
  /** Why it got the status it did. */
  reason: string;
  /** For probable duplicates: the stored transaction it resembles. */
  matchedTransactionId: string | null;
  /** For probable duplicates: similarity score in [0,1]. */
  similarity: number | null;
}
