import { csvProfileSchema, type CsvProfileInput, type ImportProfileRecord } from "./profile";

function csv(
  id: string,
  name: string,
  institution: string,
  config: CsvProfileInput,
): ImportProfileRecord {
  return {
    id,
    name,
    format: "csv",
    institution,
    config: csvProfileSchema.parse(config),
    isBuiltin: true,
  };
}

/**
 * Built-in profiles. Order matters only as a tie-break: detection prefers the profile whose
 * signature has the most columns; among equals the first listed wins. Generic signatures
 * (Amex's `Date,Description,Amount`) therefore sit last.
 */
export const BUILTIN_PROFILES: ImportProfileRecord[] = [
  csv("builtin-ynab-register", "YNAB register export", "YNAB", {
    dateFormat: "MM/DD/YYYY",
    dateColumn: "Date",
    amountConvention: "inflow_outflow_columns",
    debitColumn: "Outflow",
    creditColumn: "Inflow",
    payeeColumn: "Payee",
    memoColumn: "Memo",
    accountColumn: "Account",
    categoryColumn: "Category Group/Category",
    signature: ["Account", "Payee", "Category Group/Category", "Outflow", "Inflow"],
  }),
  csv("builtin-capital-one-card", "Capital One credit card", "Capital One", {
    dateFormat: "YYYY-MM-DD",
    dateColumn: "Transaction Date",
    postedDateColumn: "Posted Date",
    amountConvention: "debit_credit_columns",
    debitColumn: "Debit",
    creditColumn: "Credit",
    payeeColumn: "Description",
    signature: ["Transaction Date", "Posted Date", "Debit", "Credit"],
  }),
  csv("builtin-chase-card", "Chase credit card", "Chase", {
    dateFormat: "MM/DD/YYYY",
    dateColumn: "Transaction Date",
    postedDateColumn: "Post Date",
    amountConvention: "signed_debit_negative", // Chase card exports purchases as negative
    amountColumn: "Amount",
    payeeColumn: "Description",
    memoColumn: "Memo",
    signature: ["Transaction Date", "Post Date", "Description", "Amount"],
  }),
  csv("builtin-bofa-checking", "Bank of America checking", "Bank of America", {
    dateFormat: "MM/DD/YYYY",
    dateColumn: "Date",
    amountConvention: "signed_debit_negative",
    amountColumn: "Amount",
    payeeColumn: "Description",
    signature: ["Date", "Description", "Amount", "Running Bal."],
  }),
  csv("builtin-ally", "Ally Bank", "Ally", {
    dateFormat: "YYYY-MM-DD",
    dateColumn: "Date",
    amountConvention: "signed_debit_negative",
    amountColumn: "Amount",
    payeeColumn: "Description",
    memoColumn: "Type",
    signature: ["Date", "Time", "Amount", "Description"],
  }),
  csv("builtin-chase-checking", "Chase checking", "Chase", {
    dateFormat: "MM/DD/YYYY",
    dateColumn: "Posting Date",
    amountConvention: "signed_debit_negative",
    amountColumn: "Amount",
    payeeColumn: "Description",
    signature: ["Posting Date", "Description", "Amount"],
  }),
  csv("builtin-amex", "American Express", "American Express", {
    dateFormat: "MM/DD/YYYY",
    dateColumn: "Date",
    amountConvention: "signed_debit_positive", // Amex exports charges as positive
    amountColumn: "Amount",
    payeeColumn: "Description",
    memoColumn: "Extended Details", // optional; absent in the basic export
    idColumn: "Reference", // optional; absent in the basic export
    signature: ["Date", "Description", "Amount"],
  }),
  {
    id: "builtin-ofx",
    name: "OFX / QFX / QBO",
    format: "ofx",
    institution: null,
    config: null,
    isBuiltin: true,
  },
];
