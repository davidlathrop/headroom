# Headroom — Design Document

*Working name. "Headroom" is the one number the app exists to answer: after income and spending, how much room do I have?*

Status: **Phases 1–2 implemented** (2026-08-26; see `README.md` and §11) · Audience: the engineer building it (you, or a future Claude session)

---

## 1. Problem and goals

YNAB answers "where should each dollar go?" and makes you do the assigning. That is a different question from the one you actually ask: **what did I earn, what did I spend, what is left, and what can that leftover do?** Headroom answers those four questions directly from your bank and credit-card exports and does the bookkeeping itself.

### 1.1 Goals

1. **Import files** from any bank or card (CSV, OFX/QFX/QBO) on whatever schedule you like — weekly, monthly, whenever.
2. **Never double count.** Re-importing the same file, overlapping date ranges, or the same transaction from two exports must be safe. This is the load-bearing requirement of the whole design (§5).
3. **Report the three numbers per month** — Income, Spend, Left over — computed correctly under personal-finance rules (§6): transfers and credit-card payments are not spending, refunds are not income, spend is recognized when you swipe, not when you pay the card.
4. **Forecast** what your money can do (§8): the next 12 months of expected income, committed bills, typical variable spend, projected leftover, and a 60-day cash curve that says what is safe to spend before the next paycheck.
5. **Be trustworthy.** Reconcile to statement balances, flag months with missing data, keep source data immutable, keep an audit trail.

### 1.2 Non-goals (v1)

- Bank API aggregation (Plaid/Finicity). File import only — no credentials stored, no third party sees your data. Can be added later behind the same import pipeline.
- Envelope/zero-based budgeting. Category *targets* are a v3 nicety, not the core model.
- Multi-user, multi-currency, investments performance, tax reporting, bill pay.
- Mobile app. The web UI is responsive; that is enough.

### 1.3 Assumptions made on your behalf

| Assumption | Why |
|---|---|
| Single user, self-hosted, runs on your Mac (or a small VM) | Financial data stays local; no auth complexity in v1 |
| USD only, but every amount carries a currency code | Costs nothing now, avoids a painful migration later |
| Calendar-month reporting on **posted date**, cash basis | Matches bank statements; simplest to reconcile |
| You will keep using a consistent export format per account | Different formats describe the same transaction differently; the design tolerates it but works best when you don't |
| Your YNAB history is worth keeping | A YNAB register export is a first-class import source, so you start with years of categorized history |

---

## 2. Domain model (the vocabulary)

| Term | Meaning |
|---|---|
| **Account** | A real account at an institution: checking, savings, credit card, loan, investment. Has `kind` and `on_budget`. On-budget cash accounts (checking, savings) plus credit cards form your **budget position**; investment/retirement accounts are off-budget. |
| **Transaction** | One movement of money in one account, as the bank reported it. Source fields are immutable; your annotations (category, payee display name, notes, splits) are overlays. Sign convention is normalized: **negative = money left the account**, regardless of how the institution exports it. |
| **Transfer** | Two transactions in two of your accounts that are the same money (checking → credit card payment, checking → savings). Linked by a `transfer_id`; **excluded from both Income and Spend**. |
| **Category** | A node in a tree. Every category has a `flow`: `income`, `expense`, `saving` (money leaving the budget into an off-budget account), `transfer`, or `ignore`. Expense categories also have a `spend_type`: `fixed` (rent, insurance, subscriptions — commitments) or `variable` (groceries, dining, fuel). |
| **Payee** | The merchant/counterparty. `payee_raw` is what the bank sent; `payee_key` is a normalized key used for rules and grouping; `payee_display` is what you see. |
| **Import batch** | One uploaded file: its hash, format, what it covered, what it inserted. The unit of rollback. |
| **Balance snapshot** | "Account X had balance B as of date D" — from an OFX ledger balance, a statement, or typed in. The anchor for reconciliation. |
| **Recurring series** | A detected pattern: this payee, about this amount, on this cadence. Drives the forecast. |
| **Month** | The reporting period. A month is **complete** for an account when import coverage spans it; reports mark months with gaps as *partial*. |

---

## 3. Architecture

### 3.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript end-to-end | One language, one toolchain, shared types between server and UI |
| Web framework | Next.js 15 (App Router), React 19 | One deployable; server components render reports without a separate API tier; route handlers where an API is needed |
| Database | SQLite (`better-sqlite3`) via Drizzle ORM + drizzle-kit migrations | Single file, zero ops, trivial backup, local-first for sensitive data. Drizzle keeps a Postgres swap possible if it is ever hosted multi-user |
| Validation | Zod at every boundary (file parsers, route handlers, settings) | Untrusted input (bank files) never reaches the domain unvalidated |
| CSV / OFX | `csv-parse`; a small in-house OFX 1.x/2.x parser (OFX 1.x is SGML with unclosed tags — existing libs are flaky) | Full control over the one format that carries a real transaction ID (`FITID`) |
| Charts | Lightweight SVG components (or `recharts`) | Nothing heavy; the reports are tables first |
| Testing | Vitest; `fast-check` for property tests; golden-file tests over anonymized bank fixtures | The dedup guarantees are stated as properties (§5.6) and tested that way |
| Quality gates | ESLint, `tsc --noEmit`, Vitest in CI (GitHub Actions); Prettier | Standard |
| Logging | `pino`, structured; plus an `audit_log` table for data changes | Import problems must be diagnosable after the fact |

### 3.2 Modular monolith, hexagonal boundaries

```
src/
  domain/         Pure TypeScript. No I/O, no DB, no framework imports.
    money.ts        integer cents, parse/format, never floats
    dates.ts        ISO dates, month keys, business-day helpers
    payee.ts        normalization → payee_key
    fingerprint.ts  stable transaction fingerprint (§5.3)
    dedupe.ts       multiset diff + near-duplicate scoring (§5.4)
    transfers.ts    transfer pair detection (§6.3)
    rules.ts        category rules engine (§7)
    recurring.ts    recurring-series detection (§8.2)
    forecast.ts     forecast engine (§8.3)
    reports.ts      month rollups (§6)
  importers/      File → CandidateTransaction[]
    detect.ts       format sniffing
    ofx/            OFX/QFX/QBO parser
    csv/            generic CSV + institution profiles + YNAB register profile
  db/             Drizzle schema, migrations, repositories (the only code that touches SQLite)
  services/       Use cases: importFile, commitBatch, rollbackBatch, categorize, linkTransfers,
                  buildMonthReport, buildForecast, reconcile
  app/            Next.js routes: pages + route handlers (thin; validate → call service → render)
  components/     UI
tests/
  fixtures/       anonymized real-world exports, one per institution profile
  properties/     fast-check suites for dedupe/idempotence
```

Rules of the road:

- **`domain/` is pure.** Every financial rule lives there and is unit-tested without a database. Services orchestrate; routes are thin.
- **Money is integer cents.** `amount_cents: number` (safe up to $90 trillion), plus `currency`. Parsing goes string → cents with decimal-string arithmetic, never through `parseFloat`.
- **Dates are `YYYY-MM-DD` strings.** Bank dates have no meaningful time or zone; storing them as instants invents one and creates off-by-one-day bugs.
- **Source data is immutable.** Nothing overwrites `payee_raw`, `amount_cents`, `posted_date`, `external_id`. User changes are separate columns or tables and are audit-logged.
- **Every write that changes reported numbers is transactional** (batch commit, rollback, transfer link, split).

### 3.3 Security and privacy

- Local-first: binds to `localhost` by default. If exposed on a network: single-user password (argon2id), HTTP-only session cookie, behind TLS (Caddy/Tailscale).
- Raw uploaded files are kept (hash-named, under `data/imports/`) so a batch can be re-parsed after a parser fix; a retention setting can purge them.
- Backups: nightly `VACUUM INTO data/backups/headroom-YYYY-MM-DD.sqlite`, keep 30. Optional Litestream replication to a bucket you own.
- No telemetry, no external calls at runtime. Fonts and assets bundled.
- Secrets (if any) via environment; `.env` git-ignored; `data/` git-ignored.

---

## 4. Data model

Money columns are `INTEGER` cents. Dates are `TEXT` ISO. All tables have `id` (ULID), `created_at`, `updated_at` unless noted.

```sql
accounts
  name, institution, kind ENUM(checking, savings, credit_card, loan, investment, other),
  on_budget BOOL, currency, opening_balance_cents, opening_balance_date,
  default_profile_id → import_profiles, archived_at

import_profiles                      -- how to read one institution's file
  name, format ENUM(ofx, csv), institution,
  csv: has_header, skip_rows, delimiter, date_format, date_column, posted_date_column?,
       amount_convention ENUM(signed_debit_negative, signed_debit_positive, debit_credit_columns, inflow_outflow_columns),
       amount_column / debit_column / credit_column, payee_column, memo_column, id_column?,
       account_column? (multi-account files, e.g. YNAB export), status_column? + pending_values[]
  is_builtin BOOL

import_batches
  account_id?, profile_id, file_name, file_sha256 UNIQUE, file_bytes, format,
  row_count, inserted_count, exact_duplicate_count, probable_duplicate_count, pending_skipped_count,
  coverage_start, coverage_end,            -- min/max posted_date in the file
  status ENUM(previewed, committed, rolled_back), committed_at, preview_json

transactions
  account_id, batch_id,
  posted_date, txn_date,                   -- txn_date = posted_date when the file has only one
  amount_cents, currency,
  payee_raw, memo_raw, external_id?,       -- source fields: immutable
  fingerprint, fingerprint_seq,            -- §5.3
  payee_key, payee_display,                -- derived / user-editable
  category_id?, transfer_id?, is_reviewed BOOL, notes, deleted_at
  UNIQUE(account_id, fingerprint, fingerprint_seq)
  UNIQUE(account_id, external_id) WHERE external_id IS NOT NULL
  INDEX(account_id, posted_date), INDEX(category_id, posted_date), INDEX(payee_key)

transaction_splits                     -- optional; when present, sum(amount_cents) == transaction.amount_cents
  transaction_id, category_id, amount_cents, memo

categories
  parent_id?, name, flow ENUM(income, expense, saving, transfer, ignore),
  spend_type ENUM(fixed, variable) NULL, sort_order, is_system BOOL, archived_at

category_rules                         -- first match by priority wins
  priority, match_field ENUM(payee_key, payee_raw, memo), match_type ENUM(contains, exact, regex),
  pattern, amount_min_cents?, amount_max_cents?, account_id?,
  set_category_id, set_payee_display?, enabled BOOL, hit_count, created_from_txn_id?

transfers
  from_txn_id, to_txn_id, confidence REAL, linked_by ENUM(auto, user)

balance_snapshots
  account_id, as_of_date, balance_cents, source ENUM(ofx, statement, manual), batch_id?

recurring_series
  account_id?, payee_key, category_id, cadence ENUM(weekly, biweekly, semimonthly, monthly, quarterly, annual),
  typical_amount_cents, amount_mad_cents,  -- median absolute deviation
  anchor_day?, last_seen_date, next_expected_date,
  status ENUM(detected, confirmed, dismissed, inactive)

planned_items                          -- future one-offs you know about (trip, tax bill, bonus)
  name, amount_cents, date, category_id, note

budgets                                -- a named set of categories to watch ("Essentials")
  name, note, archived_at

budget_categories                      -- one line per watched category; a group line counts all its leaves
  budget_id, category_id, target_cents?, sort_order    -- target is monthly; null = track only
  UNIQUE(budget_id, category_id)

audit_log                              -- every user-driven change to money-affecting data
  entity, entity_id, action, before_json, after_json, at

settings (key PRIMARY KEY, value_json)
```

Why some of these exist:

- `fingerprint_seq` is what lets two genuinely identical transactions on the same day (two $4.50 coffees) coexist while a re-import of them is still rejected (§5.4).
- `file_bytes` on the batch: a parser bug found later can be fixed and the batch re-parsed in place, instead of asking you to find the file.
- `preview_json` lets the preview screen be reloaded or the commit be resumed after a crash without re-parsing.
- `amount_mad_cents` (not stddev): recurring amounts have outliers (an annual true-up on a utility bill); MAD is robust to them.

---

## 5. Import pipeline — and why nothing gets counted twice

This is the heart of the app. Every guarantee below is a tested property, not a hope.

### 5.1 Stages

```
upload ─▶ hash ─▶ detect format ─▶ parse ─▶ normalize ─▶ dedupe ─▶ PREVIEW ─▶ commit ─▶ post-commit
          │                                                          (you)      │         (transfers, rules,
          └─ sha256 already seen? ▶ reject: "imported on <date> as batch N"     │          recurring, reconcile)
                                                                                └─ one DB transaction
```

1. **Upload.** The file is stored under its SHA-256. If that hash exists, the upload is rejected with a pointer to the earlier batch. Cheap, and it catches the most common mistake outright.
2. **Detect format.** `OFXHEADER`/`<OFX>` → OFX. Otherwise CSV: the header row is matched against known profiles (built-ins for common institutions + YNAB register export + any you've saved). No match → the column-mapping screen, which saves a new profile so you never map that bank twice.
3. **Parse** into `RawRow[]` (strings only). Parser failures are per-row and reported, not fatal.
4. **Normalize** into `CandidateTransaction`:
   ```ts
   { account_id, posted_date, txn_date, amount_cents, currency,
     payee_raw, memo_raw, external_id?, is_pending: boolean }
   ```
   Amount sign is normalized to *negative = outflow* using the profile's `amount_convention` (credit-card CSVs commonly export charges as positive; OFX credit-card statements usually already use negative). Dates are parsed with the profile's explicit `date_format` — never guessed, because `03/04/2026` is ambiguous.
5. **Dedupe** (§5.2–5.4). Each candidate is labeled `new`, `exact_duplicate`, `probable_duplicate`, or `pending_skipped`.
6. **Preview.** Counts, the coverage window this file adds, any gap it leaves against existing coverage, and a side-by-side for every `probable_duplicate` with a default action (skip) you can flip. Nothing is written yet.
7. **Commit.** One SQLite transaction: insert `new` rows (and any probable duplicates you forced), record the batch with its counts and coverage, store balance snapshots from OFX. If anything fails, nothing is committed.
8. **Post-commit.** Run transfer detection, category rules, recurring-series refresh, and reconciliation against the newest snapshot. These only annotate; they never insert or delete transactions.

### 5.2 Layer 1 — bank-provided IDs

OFX files carry `FITID`, unique per account. Some CSVs carry a reference/transaction ID column. When present it is stored as `external_id` and `UNIQUE(account_id, external_id)` makes re-import impossible at the database level. A candidate whose `external_id` already exists is `exact_duplicate`, no further checks.

Caveats the design respects: some institutions regenerate FITIDs across exports, or derive them from content such that a pending→posted change produces a new ID. So Layer 1 is necessary but not sufficient; Layers 2 and 3 always run too.

### 5.3 Layer 2 — content fingerprint

```
fingerprint = sha256( account_id | posted_date | amount_cents | canon(payee_raw) )
canon(s)    = uppercase(s), collapse whitespace, trim      -- deliberately *light*
```

The fingerprint uses a light canonicalization of the raw payee, **not** the heavy `payee_key` normalization. `payee_key` will evolve (you'll improve the merchant cleanup rules); the fingerprint must never change for a stored row, or old rows would stop matching new imports. The fingerprint function is versioned (`FINGERPRINT_V1`) and frozen.

### 5.4 Layer 2, continued — the multiset rule

Two identical fingerprints can be two real transactions (two identical coffees the same day). So a fingerprint is not a unique key; `(fingerprint, seq)` is. On import, for each fingerprint:

```
k_file = occurrences of fingerprint in this file
k_db   = occurrences already stored for this account
insert max(0, k_file − k_db) rows, with seq = k_db+1 … k_file
mark the remaining min(k_file, k_db) candidates exact_duplicate
```

Worked cases:

| Already stored | In new file | Result |
|---|---|---|
| 0 | 2 | insert 2 (seq 1, 2) |
| 2 | 2 | insert 0 — a straightforward re-import |
| 2 | 3 | insert 1 (seq 3) — a third identical purchase |
| 1 | 0 | nothing; files never delete |

This makes import **idempotent** (same file twice = once) and **coverage-additive** (overlapping exports union cleanly).

### 5.5 Layer 3 — near-duplicates need a human

Layers 1–2 are exact. Two real-world things defeat exactness:

- **Pending → posted.** A pending charge shows one date and description ("SQ *BLUE BOTTLE"), and posts days later with another ("SQUARE BLUE BOTTLE COFFEE #12") — sometimes a different amount (tips, fuel pre-auth).
- **Format drift.** The same transaction exported as OFX and CSV, or as CSV after the bank changed its description format.

Layer 3 scores each remaining `new` candidate against stored transactions in the same account:

```
same amount (exact)                                   required
|posted_date − stored.posted_date| ≤ 3 days           required
payee similarity (Jaro-Winkler on payee_key) ≥ 0.85    OR both look like the same fuel/tip pattern
not already used as a match for another candidate     required
```

A hit is `probable_duplicate`, shown side by side in the preview, **default action: skip**. You can flip it to import if you know they're different. Pending rows (`is_pending = true`, as declared by the profile's status column or OFX `<STATUS>`) are `pending_skipped` by default — they'll arrive properly on a later export once posted. You can opt in to importing them, in which case the posted version later shows as a probable duplicate of the pending one.

Layer 3 never auto-drops anything silently: every skipped row is in the batch's preview record, and the count is on the import history screen.

### 5.6 Properties under test

Stated as `fast-check` properties over generated files, and as golden-file tests over the fixtures:

1. `import(F); import(F)` inserts exactly what `import(F)` alone inserts. *(idempotence)*
2. For any split of a file into overlapping parts A, B: `import(A); import(B)` yields the same stored set as `import(A ∪ B)`. *(coverage-additive)*
3. `n` identical rows in a file insert `n` rows; re-import inserts 0; `n+1` in a later file inserts 1.
4. Rows with a stored `external_id` are never inserted, regardless of fingerprint.
5. `rollback(batch)` restores the exact prior stored set, and a subsequent `import(F)` re-inserts the same rows.
6. Amount sign is `< 0` for every debit across every fixture, whatever the institution's convention.
7. The sum of any month's stored amounts for an account equals the difference between two balance snapshots bracketing it (given full coverage) — the reconciliation identity.

### 5.7 Coverage and gaps

Each batch records `coverage_start..coverage_end` per account: the span of the rows it held, widened by the statement's own range when the file states one (OFX `DTSTART`/`DTEND`, capped at the balance date) — so a statement for an idle account still vouches for its window. An account's coverage is the union of its committed batches' windows. The Accounts screen draws it as a bar; the month report marks a month **partial** if any on-budget account lacks coverage for part of it, and the forecast excludes partial months from its trailing statistics. Exports should overlap generously (the app suggests "export from <last coverage end − 14 days>") — overlap is free because of §5.4.

### 5.8 Reconciliation

Computed balance at date D for an account = latest snapshot ≤ D + Σ amounts of transactions with `posted_date` in `(snapshot.as_of_date, D]`. After every commit, the newest OFX ledger balance (or a statement balance you enter) is compared against the computed balance. A mismatch is surfaced as a reconciliation alert with the amount and the window it must be in; *Review* opens the ledger filtered to exactly that window. This is the backstop: if something ever *was* double-counted or missed, the numbers cannot quietly stay wrong.

One subtlety: an OFX `DTASOF` is a moment, not a day. A file downloaded mid-afternoon carries a balance that excludes transactions that post later that day, which the next download then includes. So when the end-of-day reading is off, `reconcileAccount` tries the intraday readings — the previous anchor before its own day's postings, the newest anchor before its own, or both — and if one matches exactly it reconciles with a note rather than raising a false one-day alert. Only a difference no reading explains is reported.

Coverage for the *current* month is judged through `today − 3 days` (`COVERAGE_LAG_DAYS`): an export never contains today, and banks post overnight, so coverage ending yesterday is not a gap. Past months are judged in full.

### 5.9 Rollback

`DELETE FROM transactions WHERE batch_id = ?` inside a transaction, plus unlinking any transfers/splits attached, plus marking the batch `rolled_back`. The file hash stays recorded (status visible) so re-uploading is allowed and re-inserts cleanly. Transactions you've annotated are listed on the confirmation screen before the rollback proceeds.

---

## 6. The three numbers

### 6.1 Definitions (per calendar month, posted date, on-budget accounts)

```
Income(m)    = Σ amount  for inflows  whose category.flow = income
Spend(m)     = −Σ amount for outflows whose category.flow = expense
             + Σ amount for inflows  whose category.flow = expense     ← refunds reduce spend
Saved(m)     = −Σ amount for outflows whose category.flow = saving     ← to off-budget (brokerage, 401k)
Left over(m) = Income − Spend − Saved
Savings rate = (Saved + Left over) / Income
Net cash position = Σ on-budget cash balances − Σ credit-card balances
```

Spend is broken out as **Fixed** (commitments: `spend_type = fixed`) and **Variable**.

### 6.2 Rules that make the numbers honest

| Rule | Consequence |
|---|---|
| Transfers between your accounts are neither income nor spend | Paying the credit card doesn't "spend" $2,400 again; moving $500 to savings doesn't lower your leftover |
| …except that a transfer's *paying* side may carry a real category | A mortgage payment to a tracked loan is `Housing: Rent / Mortgage`; a contribution to a tracked brokerage is Saved. Set once per account ("money sent here counts as…") or per transaction; the receiving side always stays a transfer, so nothing counts twice |
| Spend is recognized when you swipe the card, not when you pay it | Monthly spend reflects what you bought that month; the card payment is a transfer |
| A refund is a negative expense in its category, not income | Returning a $80 jacket puts Clothing back to where it was; income is unchanged |
| Income counts only what enters the budget from outside | Interest, salary, reimbursements; not a transfer from savings |
| Contributions to off-budget accounts are "Saved", shown separately from Spend | Investing $1,000 isn't spending it, but it isn't sitting in your leftover either |
| Categories with `flow = ignore` are excluded everywhere | Balance-adjustment rows, opening balances, YNAB "Starting Balance" |
| Partial-coverage months are labeled | You never mistake "we only have half of August" for "August was cheap" |

### 6.3 Transfer detection

After each commit, every new transaction is scored against candidates in *other* accounts:

```
amount_a == −amount_b                                      required
|date_a − date_b| ≤ 4 days  (card payments take 2–3 business days)  required
neither already linked                                     required
score += 0.5 if payee matches /PAYMENT|TRANSFER|AUTOPAY|ONLINE PMT|XFER|ZELLE|VENMO/
score += 0.3 if this account pair has ≥ 2 confirmed transfers before
score += 0.2 if one side is a credit_card/loan account and the other is checking
```

Score ≥ 0.7 → auto-link (`linked_by = auto`, visible and reversible). 0.4–0.7 → suggested on the review queue. A transfer whose other side is in an account you don't import (mortgage at another bank) is not a transfer; categorize it as an expense (`Housing: Mortgage`) or as `saving` (contribution to an outside brokerage). If you *do* track the loan or brokerage, set `accounts.payment_category_id` on it: linking then puts that category on the paying side (`countsInReport` in `reports.ts` is the single rule that admits such lines), while the receiving side stays `Transfer`.

---

## 7. Categorization

1. **Payee normalization** (`payee.ts`): uppercase; strip card-processor prefixes (`SQ *`, `TST*`, `PAYPAL *`, `PP*`, `POS DEBIT`, `DEBIT CARD PURCHASE`, `CHECKCARD`); strip trailing store numbers, dates, phone numbers, city/state; collapse whitespace → `payee_key`. Versioned; recomputable for all rows at any time (unlike the fingerprint).
2. **Rules engine** (`rules.ts`): ordered rules, first match wins. A rule matches on `payee_key`/`payee_raw`/`memo` (contains, exact, regex), optionally constrained by amount range and account. It sets a category and optionally a display name ("AMZN MKTP US*2K4…" → "Amazon").
3. **History suggestion**: when no rule matches, suggest the category most often used for the same `payee_key` in the past.
4. **Learning loop**: when you change a category, the UI offers "Always categorize `<payee>` as `<category>`" → creates a rule with `created_from_txn_id`. Rules are data, exportable, and diff-able.
5. **Splits**: a Costco run can be 70% Groceries / 30% Household; splits carry the category for reporting.
6. **Seeded tree** (edit freely):

   ```
   Income:  Salary · Bonus · Interest · Reimbursement · Other income
   Housing (fixed):  Rent/Mortgage · Utilities · Internet · Insurance
   Transport:  Fuel (var) · Car payment (fixed) · Insurance (fixed) · Transit (var) · Maintenance (var)
   Food:  Groceries (var) · Dining (var)
   Health (var):  Medical · Pharmacy · Fitness (fixed)
   Subscriptions (fixed)
   Shopping (var) · Travel (var) · Gifts (var) · Personal care (var) · Entertainment (var)
   Fees & Interest (var)
   Saving:  Brokerage · Retirement · Emergency fund (off-budget)
   Transfer  (system) · Ignore (system)
   ```

A YNAB register import maps YNAB's `Category Group/Category` onto this tree (creating missing categories) so your history arrives categorized.

---

## 8. Forecast — what your money can do

### 8.1 Outputs

- **Monthly projection, 12 months out:** expected income, fixed spend (committed), variable spend (typical), planned one-offs, projected leftover, projected net cash position.
- **60-day cash curve:** today's checking balance, then each expected paycheck, bill, and card payment on its date → the *lowest point* before the next income and when it happens.
- **Safe to spend** = lowest projected cash balance before next income − your buffer setting (default: one month of fixed spend).
- **Health metrics:** savings rate (trailing 3/6/12 months), emergency-fund months = net cash ÷ average monthly spend, months to a goal at the current leftover rate.
- **What-if:** "cut Dining 25%", "add a $400/month car payment", "skip the trip" — recomputed instantly, since the engine is pure and fast.

### 8.2 Recurring-series detection (`recurring.ts`)

Group transactions by `(payee_key, account_id)` with ≥ 3 occurrences in the last 15 months. For each group compute gaps between consecutive dates; classify the cadence if the median gap is within tolerance:

| Cadence | Median gap | Tolerance |
|---|---|---|
| weekly | 7 | ±1 |
| biweekly | 14 | ±2 |
| semimonthly | 15.2 | ±3 and day-of-month clusters (1st/15th) |
| monthly | 30.4 | ±4 |
| quarterly | 91 | ±10 |
| annual | 365 | ±20 |

Typical amount = median; variability = MAD. Series with MAD/median ≤ 5% are **fixed-amount** (rent, streaming); larger are **variable-amount** (utilities, phone) and forecast at the median. `next_expected_date` = last seen + cadence (snapped to anchor day for semimonthly/monthly). A series goes `inactive` after two missed expected dates. Paychecks are detected the same way on income categories.

Detected series appear on a review list: confirm, edit the amount, or dismiss. Confirmed series are trusted for the forecast; detected-but-unreviewed ones are used with a visual "unconfirmed" mark.

### 8.3 Forecast engine (`forecast.ts`)

For each future month `m`:

```
income(m)    = Σ confirmed/detected income series expected in m
             + median of non-recurring income over the last 6 complete months
fixed(m)     = Σ expense series (spend_type fixed or fixed-amount) expected in m
variable(m)  = Σ over variable categories of median(category spend over last 3 complete months)
planned(m)   = Σ planned_items dated in m
leftover(m)  = income − fixed − variable − planned
net_cash(m)  = net_cash(m−1) + leftover(m) − saved(m)      (saved = saving-flow series)
```

Current month blends actuals-to-date with the remainder: `expected − actual_so_far`, floored at 0, per series and per variable category.

Why **median over 3 complete months**: it ignores the one big month (a vacation, a car repair) that a mean would smear across the future, and 3 months tracks lifestyle changes faster than 12. A setting switches to 6 for smoother estimates; partial-coverage months are always excluded.

Ranges (v3): show p25–p75 of the trailing distribution per variable category as a band on the projection, so "leftover ≈ $600–$1,100" is visible rather than a false-precision single number.

---

## 9. Screens

1. **This month** — Income · Spent · Left over as three large figures; a thin bar showing day-of-month progress; a spending donut by category group (≤ 6 slices + Other, legend with amounts and shares, slices zoom into Trends) and an Income vs Spent (fixed + variable) vs Saved bar; counts needing attention (uncategorized, payments to a loan with no category, reconciliation alerts, partial coverage); budget summaries; recent imports.
2. **Import** — drop zone; format/profile detection; preview table with `new / duplicate / probable duplicate / pending` tabs, side-by-side comparisons, coverage bar showing what this file adds; **Commit**. Import history with counts and **Roll back**.
3. **Transactions** — ledger with filters (account, month, category, uncategorized, transfers); inline category edit; split; link/unlink transfer; "always categorize as…".
4. **Months** — one row per month: Income, Fixed, Variable, Saved, Left over, Savings rate; partial-month badge; drill into category breakdown; 12-month trend.
5. **Forecast** — 12-month projection table + chart; 60-day cash curve with lowest-point callout; recurring series manager; planned items; what-if panel.
6. **Accounts** — balances (computed vs last snapshot), last import, coverage bar, reconcile.
6b. **Budgets** — named sets of categories, with or without monthly targets. Pick any month: dollars per line, share of the budget, change vs the month before, and a strip of recent months; with targets, what’s left and an on-pace marker; an *Over time* section (3/6/12 months ending at the viewed month) charts the budget stacked by category with the target as a reference line, the budget vs all spending, and a breakdown of every expense category with the budget's own highlighted. This month shows a summary.
7. **Settings** — categories tree, rules, import profiles, buffer & forecast window, backup now / restore.

---

## 10. Key decisions (ADR summary)

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| 1 | File import only; no aggregator in v1 | Plaid, SimpleFIN | No stored credentials, no monthly fee, no third party; the pipeline is aggregator-agnostic so it can be added later as another `importer` |
| 2 | SQLite + Drizzle | Postgres in Docker | Single-user local data; one-file backups; zero ops. Drizzle keeps the door open |
| 3 | Integer cents, ISO date strings | Decimal library, `Date` objects | Correctness by construction; no float rounding, no timezone shifts |
| 4 | Fingerprint uses *light* canonicalization; heavy normalization is separate | Fingerprint on `payee_key` | The fingerprint must be frozen forever; normalization must be free to improve |
| 5 | `(fingerprint, seq)` multiset dedup | Treat identical rows as duplicates | Two real identical purchases in a day are common; dropping one is silent data loss |
| 6 | Near-duplicates go to a review queue, default skip | Auto-merge with fuzzy match | A fuzzy auto-merge is exactly the silent double-count/loss this app exists to prevent |
| 7 | Pending transactions skipped by default | Import and later replace | Pending rows change date, description, and amount; importing them creates the duplicate problem instead of solving it |
| 8 | Spend at swipe; card payment is a transfer | Cash-basis on payment | Standard personal-finance practice; monthly spend reflects behavior, not billing cycles |
| 9 | Median of last 3 complete months for variable spend | Mean of 12 | Robust to outliers, responsive to change |
| 10 | Source rows immutable + overlay columns + audit log | Editable rows | Re-parsing, rollback, and "why does this number say that?" all depend on it |
| 11 | Reconciliation against balance snapshots after every commit | Trust the import | The only independent check that the ledger is complete and not double-counted |

---

## 11. Delivery plan

**Phase 0 — Scaffold (½ day).** Next.js + TypeScript strict + Drizzle + SQLite; migrations; Vitest; ESLint/Prettier; CI; `data/` layout; fixtures directory with 3–4 anonymized exports (a checking CSV, a credit-card CSV with positive-charge convention, an OFX with FITIDs, a YNAB register export).

**Phase 1 — The three numbers (MVP).**
Accounts · import profiles (OFX, generic CSV with mapping UI, YNAB) · full dedupe pipeline with preview/commit/rollback · payee normalization · rules engine + learning loop · transfer detection · This month + Months screens · Transactions ledger · coverage tracking.
*Done when:* every property in §5.6 passes; a month of your real data reconciles to your statement balance.

**Phase 2 — Forecast.**
Balance snapshots + reconciliation alerts · recurring-series detection and review · forecast engine · Forecast screen with 60-day cash curve and safe-to-spend · Accounts screen.

**Phase 3 — Polish and planning.**
Planned items (done) · budgets with category targets (done, §9 6b) · what-if panel · projection ranges · backups UI · exports (CSV of anything) · rule import/export.

---

## 12. Open questions (answered with defaults; change freely)

| Question | Default chosen |
|---|---|
| Which institutions first? | Generic CSV mapper covers any bank on day one; built-in profiles for Chase, Amex, Capital One, Bank of America, Ally, and YNAB register |
| Include savings accounts on budget? | Yes — cash is cash; moving it is a transfer |
| Buffer for "safe to spend"? | One month of fixed spend; setting |
| Trailing window for variable spend? | 3 complete months; setting (3/6) |
| Auto-link transfer threshold? | 0.7; setting |
