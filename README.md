# Headroom

A personal budget and cash-flow app. Import the CSV/OFX/QFX exports from your bank and credit card; Headroom tells you what came in, what went out, and what's left — without ever double counting a transaction.

![Headroom walkthrough — import, categorize, budgets, forecast, trends](docs/headroom-demo.gif)

The design is in [`docs/DESIGN.md`](docs/DESIGN.md). Phases 1 and 2 are built: import with three-layer dedupe, categorization rules, transfer linking, monthly reports with reconciliation, recurring-series detection, a 12-month forecast, a 60-day cash curve and safe-to-spend. Phase 3 (what-if, projection ranges, budget targets, backups UI) is next.

## Run it

```sh
npm install
npm run dev          # http://localhost:3000
```

The SQLite database is created at `~/.headroom/headroom.sqlite` on first run (migrations and seed data apply automatically); uploaded files are kept in `~/.headroom/imports/`. Set `HEADROOM_DATA_DIR` to keep both somewhere else, or `HEADROOM_DB` / `HEADROOM_IMPORT_DIR` individually. (Earlier versions used `./data` in the project; if that exists and `~/.headroom` doesn't yet, the first start copies it across and leaves the original in place.)

To see it with sample data:

```sh
HEADROOM_DB=./data/demo.sqlite HEADROOM_IMPORT_DIR=./data/demo-imports npx tsx scripts/demo.ts
HEADROOM_DB=./data/demo.sqlite HEADROOM_IMPORT_DIR=./data/demo-imports npm run dev
```

## Using it

1. **Accounts** — add each account (checking, credit card…). An opening balance is optional; OFX/QFX files carry statement balances.
2. **Import** — upload an export. Known layouts (Chase, Amex, Capital One, Bank of America, Ally, YNAB register, any OFX/QFX/QBO) are detected; anything else gets a one-time column mapping that's saved as a format.
3. **Preview** — see what will be added, what's already imported, and what needs a look (probable duplicates, pending rows). Nothing is saved until you commit.
4. **Transactions** — categorize inline; tick _always_ to turn a choice into a rule. Card payments and transfers between your accounts are linked automatically and excluded from income and spend. If you track a loan or brokerage account, tell Headroom on the Accounts page what money sent to it counts as (Housing: Rent / Mortgage, a Saving category) and every payment into it is counted that way on the paying side — or pick the category on the paying transaction itself. Flag a one-off (a big tax payment, a bonus) as an _outlier_: it keeps its category and counts in its month, but stays out of Trends and the Forecast so it doesn't skew what "typical" looks like. And if something posted at the edge of a month — a mortgage paid 7/31 that belongs to August — open its date and pick the month it should count in: reports, trends and budgets follow, while reconciliation keeps the bank's posted date.
5. **This month / Months** — Income, Spent (fixed vs variable), Saved, and Headroom, with partial-coverage and reconciliation warnings so a number is never quietly wrong.
6. **Forecast** — paychecks, bills and subscriptions are detected from your history (confirm or dismiss them); the next 12 months are projected from those plus the median of your recent variable spend; the 60-day cash curve shows the lowest point before your next paycheck, and _safe to spend_ is that minus a buffer. Add planned one-offs (a trip, a tax bill) and they flow through.
7. **Budgets** — create a budget by picking the categories to include (a whole group, or individual categories) and giving each a monthly target. Each month shows spent vs target per line, what's left, and a marker for where "on pace" sits today. Leave a target blank to just watch a category. Pick any month, and the "Over time" charts show the budget stacked by category across 3/6/12 months against its target, the budget next to all your spending, and every spend category with the budget's own highlighted.

**Hide amounts** — the switch at the bottom of the sidebar masks every dollar figure and relabels the charts in percentages (of income, of the target, of the peak month, of the total) so the shape of your money still reads while the numbers stay private — for screen-sharing or working somewhere public. Each browser remembers its own setting.

Overlapping exports are safe and encouraged: re-importing a file inserts nothing; two identical coffees on the same day both survive; a pending charge that later posts under a different description is flagged for review rather than silently duplicated or dropped.

## Demo video

`video/` is a Remotion project that renders a short walkthrough from real screens of the app on demo data — see [`video/README.md`](video/README.md).

## Desktop app

The `electron` branch wraps the same server in an Electron window with data in your OS profile folder. `npm run electron:dev` for development, `npm run electron:build` to package; details in [`docs/ELECTRON.md`](docs/ELECTRON.md).

## Develop

```sh
npm run check        # typecheck + lint + tests
npm test             # vitest (domain properties, importer fixtures, end-to-end import pipeline)
npm run db:generate  # after editing src/db/schema.ts
```

Layout follows the design: `src/domain` (pure financial logic, no I/O), `src/importers` (file → candidates), `src/db` (Drizzle schema + SQLite), `src/services` (use cases), `src/app` (Next.js pages and server actions).
