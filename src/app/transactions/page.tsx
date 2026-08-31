import Link from "next/link";
import { CategoryPicker, type CategoryOption } from "@/components/CategoryPicker";
import { Money } from "@/components/Money";
import { addMonths, formatISO, formatMonth, isISODate, isMonthKey, monthKey } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { listAccounts } from "@/services/accounts";
import { listCategories } from "@/services/categories";
import { getDb } from "@/services/context";
import { listMonthKeys } from "@/services/reports";
import { queryTransactions } from "@/services/transactions";
import { transferCandidatesFor } from "@/services/transferCandidates";
import {
  linkTransferAction,
  renamePayeeAction,
  setEffectiveMonthAction,
  setOutlierAction,
  unlinkTransferAction,
} from "./actions";

export const dynamic = "force-dynamic";
const PAGE = 150;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const db = getDb();
  const month = sp.month && isMonthKey(sp.month) ? sp.month : null;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const from = sp.from && isISODate(sp.from) ? sp.from : null;
  const to = sp.to && isISODate(sp.to) ? sp.to : null;
  const filters = {
    accountId: sp.account ?? null,
    month,
    from,
    to,
    categoryId: sp.category ?? null,
    uncategorized: sp.uncategorized === "1",
    transfersOnly: sp.transfers === "1",
    outliersOnly: sp.outliers === "1",
    search: sp.q ?? null,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  };
  const { rows, total, totals } = queryTransactions(db, filters);
  const accounts = listAccounts(db);
  const cats = listCategories(db);
  const parentName = new Map(cats.filter((c) => !c.parentId).map((c) => [c.id, c.name]));
  const options: CategoryOption[] = cats
    .filter((c) => c.parentId || c.isSystem || !cats.some((x) => x.parentId === c.id))
    .map((c) => ({
      id: c.id,
      label: c.name,
      group: c.parentId ? (parentName.get(c.parentId) ?? "Other") : c.isSystem ? "System" : "Other",
    }));
  const months = listMonthKeys(db);
  const expand = sp.link ?? null;
  const candidates = expand ? transferCandidatesFor(db, expand) : [];
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/transactions?${p.toString()}`;
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Ledger</div>
          <h1>Transactions</h1>
          <p className="sub">
            {total} matching. Change a category inline; tick “always” to make it a rule for that
            payee. A transfer’s paying side can take a category too (a mortgage payment is Housing);
            “always” then applies it to every payment into that account. Flag a one-off as an{" "}
            <em>outlier</em> and it keeps its category and its month but stays out of trends and the
            forecast. Open a date to count a transaction in a different month — a mortgage paid 7/31
            that belongs to August — and every report and budget follows; reconciliation keeps the
            posted date.
          </p>
        </div>
      </div>
      {from || to ? (
        <div className="notice">
          <p>
            Showing transactions posted{from ? ` from ${formatISO(from)}` : ""}
            {to ? ` through ${formatISO(to)}` : ""}
            {sp.account
              ? ` in ${accounts.find((a) => a.id === sp.account)?.name ?? "this account"}`
              : ""}
            . Look for something missing, duplicated, or posted on the wrong date.{" "}
            <Link href={qs({ from: undefined, to: undefined })}>Show all dates</Link>.
          </p>
        </div>
      ) : null}
      <form method="get" className="toolbar">
        <select name="account" defaultValue={sp.account ?? ""} className="inline">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select name="month" defaultValue={month ?? ""} className="inline">
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={sp.category ?? ""} className="inline">
          <option value="">All categories</option>
          {cats
            .filter((c) => !c.parentId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <input type="text" name="q" placeholder="Search payee or memo" defaultValue={sp.q ?? ""} />
        <label className="small muted">
          from <input type="date" name="from" defaultValue={from ?? ""} className="inline" />
        </label>
        <label className="small muted">
          to <input type="date" name="to" defaultValue={to ?? ""} className="inline" />
        </label>
        <label className="small">
          <input
            type="checkbox"
            name="uncategorized"
            value="1"
            defaultChecked={filters.uncategorized}
          />{" "}
          uncategorized
        </label>
        <label className="small">
          <input
            type="checkbox"
            name="transfers"
            value="1"
            defaultChecked={filters.transfersOnly}
          />{" "}
          transfers
        </label>
        <label className="small">
          <input type="checkbox" name="outliers" value="1" defaultChecked={filters.outliersOnly} />{" "}
          outliers
        </label>
        <button className="btn small">Filter</button>
        <Link href="/transactions" className="small">
          clear
        </Link>
      </form>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Payee</th>
              <th>Account</th>
              <th>Category</th>
              <th className="num">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No transactions match.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="num small">
                  <details>
                    <summary
                      style={{ color: "inherit", listStyle: "none", cursor: "pointer" }}
                      title={`Posted ${formatISO(t.postedDate)}. Open to count it in a different month.`}
                    >
                      {formatISO(t.postedDate, "short")}
                      {t.effectiveDate ? (
                        <span className="cell-sub">
                          <span
                            className="chip"
                            title={`Posted ${formatISO(t.postedDate)}; counts in ${formatMonth(monthKey(t.effectiveDate))}`}
                          >
                            → {monthKey(t.effectiveDate)}
                          </span>
                        </span>
                      ) : null}
                    </summary>
                    <form action={setEffectiveMonthAction} className="row" style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={t.id} />
                      <select
                        name="month"
                        className="inline"
                        defaultValue={t.effectiveDate ? monthKey(t.effectiveDate) : ""}
                      >
                        {[-3, -2, -1, 0, 1, 2, 3].map((off) => {
                          const m = addMonths(monthKey(t.postedDate), off);
                          return (
                            <option key={m} value={off === 0 ? "" : m}>
                              {formatMonth(m)}
                              {off === 0 ? " (posted)" : ""}
                            </option>
                          );
                        })}
                      </select>
                      <button className="btn small" title="Count this transaction in that month">
                        Count there
                      </button>
                    </form>
                  </details>
                </td>
                <td>
                  <details>
                    <summary style={{ color: "inherit", listStyle: "none" }}>
                      {t.payeeDisplay}
                      {t.memoRaw ? <span className="cell-sub">{t.memoRaw}</span> : null}
                    </summary>
                    <div className="small muted" style={{ marginTop: 6 }}>
                      <div>
                        Bank text: <code>{t.payeeRaw}</code>
                      </div>
                      <form action={renamePayeeAction} className="row" style={{ marginTop: 6 }}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="text" name="payeeDisplay" defaultValue={t.payeeDisplay} />
                        <button className="btn small">Rename</button>
                      </form>
                    </div>
                  </details>
                </td>
                <td className="small">{t.accountName}</td>
                <td>
                  {t.transferId && t.amountCents > 0 ? (
                    <span className="chip ok">
                      Transfer{t.counterpartAccountName ? ` ← ${t.counterpartAccountName}` : ""}
                    </span>
                  ) : t.transferId ? (
                    <span
                      style={{
                        display: "inline-flex",
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <CategoryPicker
                        txnId={t.id}
                        value={t.categoryId}
                        options={options}
                        payeeDisplay={t.payeeDisplay}
                        alwaysTitle={`Count every payment to ${t.counterpartAccountName ?? "that account"} this way`}
                      />
                      <span
                        className="chip ok"
                        title="Linked transfer; pick a category to count it as spend"
                      >
                        → {t.counterpartAccountName ?? "transfer"}
                      </span>
                    </span>
                  ) : (
                    <CategoryPicker
                      txnId={t.id}
                      value={t.categoryId}
                      options={options}
                      payeeDisplay={t.payeeDisplay}
                    />
                  )}
                  {t.splitCount > 0 ? <span className="chip">{t.splitCount} splits</span> : null}
                </td>
                <td className="num">
                  <Money cents={t.amountCents} />
                  {t.isOutlier ? (
                    <span className="cell-sub">
                      <span
                        className="chip warn"
                        title="Counts this month; left out of trends and forecast"
                      >
                        outlier
                      </span>
                    </span>
                  ) : null}
                </td>
                <td className="small">
                  <form action={setOutlierAction} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="isOutlier" value={t.isOutlier ? "0" : "1"} />
                    <button
                      className="btn link small muted"
                      title={
                        t.isOutlier
                          ? "Count this in trends and the forecast again"
                          : "Keep the category and the month, but leave it out of trends and the forecast"
                      }
                    >
                      {t.isOutlier ? "not an outlier" : "outlier?"}
                    </button>
                  </form>
                  {" · "}
                  {t.transferId ? (
                    <form action={unlinkTransferAction}>
                      <input type="hidden" name="transferId" value={t.transferId} />
                      <button className="btn link small">unlink</button>
                    </form>
                  ) : expand === t.id ? (
                    <div>
                      {candidates.length === 0 ? (
                        <span className="muted">
                          No opposite-amount transaction within 7 days in another account.
                        </span>
                      ) : (
                        <form action={linkTransferAction} className="row">
                          <input type="hidden" name="id" value={t.id} />
                          <select name="otherId" className="inline">
                            {candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {formatISO(c.postedDate, "short")} · {c.accountName} ·{" "}
                                {c.payeeDisplay}
                              </option>
                            ))}
                          </select>
                          <button className="btn small">Link</button>
                        </form>
                      )}
                      <Link href={qs({ link: undefined })} className="muted">
                        cancel
                      </Link>
                    </div>
                  ) : (
                    <Link href={qs({ link: t.id })} className="muted">
                      transfer?
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <strong>Total</strong>
                  <span className="cell-sub">
                    {totals.count} transaction{totals.count === 1 ? "" : "s"}
                    {total > PAGE ? " across all pages" : ""}
                  </span>
                </td>
                <td className="num">
                  <strong>
                    <Money cents={totals.netCents} />
                  </strong>
                  <span className="cell-sub num">
                    in {formatCents(totals.inflowCents)} · out {formatCents(totals.outflowCents)}
                  </span>
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {total > PAGE && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          {page > 1 ? (
            <Link className="btn small" href={qs({ page: String(page - 1) })}>
              ← Newer
            </Link>
          ) : null}
          <span className="muted small">
            Page {page} of {Math.ceil(total / PAGE)}
          </span>
          {page * PAGE < total ? (
            <Link className="btn small" href={qs({ page: String(page + 1) })}>
              Older →
            </Link>
          ) : null}
        </div>
      )}
    </>
  );
}
