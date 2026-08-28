import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { ACCOUNT_KINDS, FLOWS, SPEND_TYPES } from "@/domain/types";

const id = () => text("id").primaryKey();
const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const accounts = sqliteTable("accounts", {
  id: id(),
  name: text("name").notNull(),
  institution: text("institution"),
  kind: text("kind", { enum: ACCOUNT_KINDS }).notNull(),
  onBudget: integer("on_budget", { mode: "boolean" }).notNull().default(true),
  currency: text("currency").notNull().default("USD"),
  openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
  openingBalanceDate: text("opening_balance_date"),
  defaultProfileId: text("default_profile_id"),
  /** Account identifier as it appears in files (OFX ACCTID, YNAB account name) for auto-mapping. */
  externalLabel: text("external_label"),
  /**
   * What money sent *into* this account counts as on the paying side: null = a plain transfer
   * (card payments, moving cash); an expense category for a tracked loan (mortgage → Housing);
   * a saving category for a tracked brokerage. Applied to every linked transfer into the account.
   */
  paymentCategoryId: text("payment_category_id"),
  archivedAt: text("archived_at"),
  ...timestamps,
});

export const importProfiles = sqliteTable("import_profiles", {
  id: id(),
  name: text("name").notNull(),
  format: text("format", { enum: ["ofx", "csv"] }).notNull(),
  institution: text("institution"),
  /** CsvProfile JSON (null for OFX). */
  configJson: text("config_json"),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: id(),
    accountId: text("account_id"),
    profileId: text("profile_id"),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileBytes: integer("file_bytes").notNull(),
    format: text("format", { enum: ["ofx", "csv"] }),
    rowCount: integer("row_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    exactDuplicateCount: integer("exact_duplicate_count").notNull().default(0),
    probableDuplicateCount: integer("probable_duplicate_count").notNull().default(0),
    pendingSkippedCount: integer("pending_skipped_count").notNull().default(0),
    issueCount: integer("issue_count").notNull().default(0),
    coverageStart: text("coverage_start"),
    coverageEnd: text("coverage_end"),
    status: text("status", {
      enum: ["needs_profile", "previewed", "committed", "rolled_back"],
    }).notNull(),
    /** Preview payload: labeled candidates, issues, account mapping. */
    previewJson: text("preview_json"),
    committedAt: text("committed_at"),
    ...timestamps,
  },
  (t) => [uniqueIndex("import_batches_sha_idx").on(t.fileSha256)],
);

/** Which dates a committed batch covers for each account it touched. Coverage is per account, not per file. */
export const batchCoverage = sqliteTable(
  "batch_coverage",
  {
    id: id(),
    batchId: text("batch_id").notNull(),
    accountId: text("account_id").notNull(),
    coverageStart: text("coverage_start").notNull(),
    coverageEnd: text("coverage_end").notNull(),
  },
  (t) => [
    index("batch_coverage_account_idx").on(t.accountId),
    index("batch_coverage_batch_idx").on(t.batchId),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    batchId: text("batch_id").notNull(),
    postedDate: text("posted_date").notNull(),
    txnDate: text("txn_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    // --- source fields: immutable ---
    payeeRaw: text("payee_raw").notNull(),
    memoRaw: text("memo_raw").notNull().default(""),
    externalId: text("external_id"),
    fingerprint: text("fingerprint").notNull(),
    fingerprintSeq: integer("fingerprint_seq").notNull(),
    // --- derived / user-editable overlays ---
    payeeKey: text("payee_key").notNull(),
    payeeDisplay: text("payee_display").notNull(),
    categoryId: text("category_id"),
    transferId: text("transfer_id"),
    isReviewed: integer("is_reviewed", { mode: "boolean" }).notNull().default(false),
    notes: text("notes").notNull().default(""),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("txn_fingerprint_idx").on(t.accountId, t.fingerprint, t.fingerprintSeq),
    uniqueIndex("txn_external_idx").on(t.accountId, t.externalId),
    index("txn_account_date_idx").on(t.accountId, t.postedDate),
    index("txn_category_date_idx").on(t.categoryId, t.postedDate),
    index("txn_payee_key_idx").on(t.payeeKey),
    index("txn_batch_idx").on(t.batchId),
  ],
);

export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: id(),
    transactionId: text("transaction_id").notNull(),
    categoryId: text("category_id"),
    amountCents: integer("amount_cents").notNull(),
    memo: text("memo").notNull().default(""),
    ...timestamps,
  },
  (t) => [index("splits_txn_idx").on(t.transactionId)],
);

export const categories = sqliteTable("categories", {
  id: id(),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  flow: text("flow", { enum: FLOWS }).notNull(),
  spendType: text("spend_type", { enum: SPEND_TYPES }),
  sortOrder: integer("sort_order").notNull().default(0),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  archivedAt: text("archived_at"),
  ...timestamps,
});

export const categoryRules = sqliteTable("category_rules", {
  id: id(),
  priority: integer("priority").notNull().default(100),
  matchField: text("match_field", { enum: ["payee_key", "payee_raw", "memo"] }).notNull(),
  matchType: text("match_type", { enum: ["contains", "exact", "regex"] }).notNull(),
  pattern: text("pattern").notNull(),
  amountMinCents: integer("amount_min_cents"),
  amountMaxCents: integer("amount_max_cents"),
  accountId: text("account_id"),
  setCategoryId: text("set_category_id").notNull(),
  setPayeeDisplay: text("set_payee_display"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  hitCount: integer("hit_count").notNull().default(0),
  createdFromTxnId: text("created_from_txn_id"),
  ...timestamps,
});

export const transfers = sqliteTable("transfers", {
  id: id(),
  fromTxnId: text("from_txn_id").notNull(),
  toTxnId: text("to_txn_id").notNull(),
  confidence: real("confidence").notNull(),
  linkedBy: text("linked_by", { enum: ["auto", "user"] }).notNull(),
  ...timestamps,
});

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    asOfDate: text("as_of_date").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    source: text("source", { enum: ["ofx", "statement", "manual"] }).notNull(),
    batchId: text("batch_id"),
    ...timestamps,
  },
  (t) => [index("snapshots_account_date_idx").on(t.accountId, t.asOfDate)],
);

export const recurringSeries = sqliteTable("recurring_series", {
  id: id(),
  accountId: text("account_id"),
  payeeKey: text("payee_key").notNull(),
  categoryId: text("category_id"),
  cadence: text("cadence", {
    enum: ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "annual"],
  }).notNull(),
  typicalAmountCents: integer("typical_amount_cents").notNull(),
  amountMadCents: integer("amount_mad_cents").notNull().default(0),
  anchorDay: integer("anchor_day"),
  lastSeenDate: text("last_seen_date").notNull(),
  nextExpectedDate: text("next_expected_date").notNull(),
  status: text("status", { enum: ["detected", "confirmed", "dismissed", "inactive"] })
    .notNull()
    .default("detected"),
  ...timestamps,
});

export const plannedItems = sqliteTable("planned_items", {
  id: id(),
  name: text("name").notNull(),
  amountCents: integer("amount_cents").notNull(),
  date: text("date").notNull(),
  categoryId: text("category_id"),
  note: text("note").notNull().default(""),
  ...timestamps,
});

/** A named set of categories to watch against monthly targets ("Essentials", "Fun money"). */
export const budgets = sqliteTable("budgets", {
  id: id(),
  name: text("name").notNull(),
  note: text("note").notNull().default(""),
  archivedAt: text("archived_at"),
  ...timestamps,
});

/** One category in a budget. `target_cents` is the monthly target; null = tracked, no target. */
export const budgetCategories = sqliteTable(
  "budget_categories",
  {
    id: id(),
    budgetId: text("budget_id").notNull(),
    categoryId: text("category_id").notNull(),
    targetCents: integer("target_cents"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("budget_categories_budget_category_idx").on(t.budgetId, t.categoryId),
    index("budget_categories_category_idx").on(t.categoryId),
  ],
);

export const auditLog = sqliteTable("audit_log", {
  id: id(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  at: text("at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type ImportProfile = typeof importProfiles.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type CategoryRuleRow = typeof categoryRules.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type BudgetCategory = typeof budgetCategories.$inferSelect;
