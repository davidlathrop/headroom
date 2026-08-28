import Link from "next/link";
import { Money } from "@/components/Money";
import { Stat } from "@/components/Stat";
import { daysInMonth, formatISO, formatMonth, monthKey, splitISO, today } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { listAccounts } from "@/services/accounts";
import { budgetSummaries } from "@/services/budgets";
import { getDb } from "@/services/context";
import { listBatches } from "@/services/imports";
import { reconcileAccount } from "@/services/reconcile";
import { categoryBreakdown, listMonthKeys } from "@/services/reports";
import { queryTransactions } from "@/services/transactions";
import { accountsNeedingPaymentCategory } from "@/services/transfers";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const db = getDb();
  const now = today();
  const month = monthKey(now);
  const { y, m, d } = splitISO(now);
  const dim = daysInMonth(y, m);
  const { report, groups } = categoryBreakdown(db, month);
  const accounts = listAccounts(db);
  const uncategorized = queryTransactions(db, { uncategorized: true, limit: 1 }).total;
  const recon = accounts
    .map((a) => ({ a, r: reconcileAccount(db, a.id) }))
    .filter((x) => x.r && x.r.differenceCents !== 0);
  const batches = listBatches(db, 3);
  const budgetRows = budgetSummaries(db, month);
  const paymentNudges = accountsNeedingPaymentCategory(db);
  const hasData = report.transactionCount > 0;
  const latestMonth = listMonthKeys(db).find((m) => m < month) ?? null;

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">This month</div>
          <h1>{formatMonth(month)}</h1>
          <p className="sub">
            Day {d} of {dim} · {report.transactionCount} transactions
            {report.partial ? " · coverage incomplete" : ""}
          </p>
        </div>
        <Link className="btn primary" href="/import">
          Import a file
        </Link>
      </div>

      {accounts.length === 0 ? (
        <div className="notice">
          <p>
            <strong>Welcome.</strong> Start by <Link href="/accounts">adding an account</Link>{" "}
            (checking, credit card…), then <Link href="/import">import an export</Link> from your
            bank. Headroom does the rest.
          </p>
        </div>
      ) : null}

      {!hasData && latestMonth ? (
        <div className="notice">
          <p>
            Nothing imported for {formatMonth(month)} yet. The latest month with data is{" "}
            <Link href={`/months/${latestMonth}`}>{formatMonth(latestMonth)}</Link>.
          </p>
        </div>
      ) : null}

      <div className="progress" aria-hidden="true" style={{ marginBottom: 16 }}>
        <span style={{ width: `${(d / dim) * 100}%` }} />
      </div>

      <div className="grid grid-3">
        <Stat label="Income" cents={report.incomeCents} hint="entered the budget from outside" />
        <Stat
          label="Spent"
          cents={report.spendCents}
          hint={`${formatCents(report.spendFixedCents)} fixed · ${formatCents(report.spendVariableCents)} variable`}
        />
        <Stat
          label="Headroom"
          cents={report.leftOverCents}
          tone="headroom"
          hint={
            report.savedCents > 0
              ? `after ${formatCents(report.savedCents)} saved`
              : report.savingsRate != null
                ? `${Math.round(report.savingsRate * 100)}% of income kept`
                : "income − spend − saved"
          }
        />
      </div>

      {(uncategorized > 0 || report.partial || recon.length > 0 || paymentNudges.length > 0) && (
        <div className="section">
          <h2>Needs attention</h2>
          <div className="card">
            <ul className="list">
              {uncategorized > 0 && (
                <li>
                  <span>
                    <strong>{uncategorized}</strong> uncategorized transaction
                    {uncategorized === 1 ? "" : "s"} — they count as variable spend until sorted
                  </span>
                  <Link href="/transactions?uncategorized=1">Categorize</Link>
                </li>
              )}
              {report.partial && (
                <li>
                  <span>
                    Coverage gap this month: {report.gaps.map((g) => g.accountName).join(", ")}.
                    Export and import a range that overlaps your last import.
                  </span>
                  <Link href="/accounts">Accounts</Link>
                </li>
              )}
              {paymentNudges.map((a) => (
                <li key={a.id}>
                  <span>
                    <strong>{a.payments}</strong> payment{a.payments === 1 ? "" : "s"} to{" "}
                    <strong>{a.name}</strong> count as transfers, not spending. Choose what they
                    count as
                    {a.kind === "loan"
                      ? " (e.g. Housing: Rent / Mortgage)"
                      : " (a Saving category)"}
                    .
                  </span>
                  <Link href="/accounts">Accounts</Link>
                </li>
              ))}
              {recon.map(({ a, r }) => (
                <li key={a.id}>
                  <span>
                    <strong>{a.name}</strong> is off by <Money cents={r!.differenceCents} sign />{" "}
                    between {formatISO(r!.previous.date)} and {formatISO(r!.snapshot.date)} — a
                    missing or duplicated transaction in that window
                  </span>
                  <Link href={`/transactions?account=${a.id}`}>Review</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {budgetRows.length > 0 && (
        <div className="section">
          <h2>Budgets</h2>
          <div className="card">
            <ul className="list">
              {budgetRows.map((b) => {
                const over = b.remainingCents < 0;
                const pct = b.targetCents > 0 ? (b.targetedActualCents / b.targetCents) * 100 : 0;
                return (
                  <li key={b.budget.id} style={{ flexDirection: "column", gap: 6 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <Link href={`/budgets/${b.budget.id}`}>{b.budget.name}</Link>
                      <span className="num">
                        {b.targetCents > 0
                          ? `${formatCents(b.targetedActualCents)} of ${formatCents(b.targetCents)}`
                          : `${formatCents(b.actualCents)} spent`}
                        {b.targetCents > 0 ? (
                          <span className={`chip ${over ? "bad" : "ok"}`} style={{ marginLeft: 8 }}>
                            {over
                              ? `over ${formatCents(-b.remainingCents)}`
                              : `${formatCents(b.remainingCents)} left`}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {b.targetCents > 0 ? (
                      <div
                        className={`progress${over ? " over" : pct > (d / dim) * 100 ? " warn" : ""}`}
                      >
                        <span style={{ width: `${Math.min(100, pct)}%` }} />
                        <i style={{ left: `${(d / dim) * 100}%` }} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="section grid grid-2">
        <div>
          <h2>Where it went</h2>
          <div className="card">
            {!hasData ? (
              <div className="empty">No transactions this month yet.</div>
            ) : (
              <ul className="list">
                {groups
                  .filter((g) => g.flow !== "income")
                  .slice(0, 10)
                  .map((g) => (
                    <li key={g.name}>
                      <span>
                        {g.name}
                        <span className="cell-sub">
                          {g.items
                            .map((i) => i.name)
                            .slice(0, 4)
                            .join(" · ")}
                        </span>
                      </span>
                      <Money cents={-g.amountCents} />
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <h2>Recent imports</h2>
          <div className="card">
            {batches.length === 0 ? (
              <div className="empty">Nothing imported yet.</div>
            ) : (
              <ul className="list">
                {batches.map((b) => (
                  <li key={b.id}>
                    <span>
                      <Link href={`/import/${b.id}`}>{b.fileName}</Link>
                      <span className="cell-sub">
                        {b.coverageStart && b.coverageEnd
                          ? `${formatISO(b.coverageStart, "short")} – ${formatISO(b.coverageEnd)}`
                          : "—"}
                      </span>
                    </span>
                    <span
                      className={`chip ${b.status === "committed" ? "ok" : b.status === "rolled_back" ? "bad" : "warn"}`}
                    >
                      {b.status === "committed"
                        ? `${b.insertedCount} added`
                        : b.status.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
