import Link from "next/link";
import { CoverageBar } from "@/components/CoverageBar";
import { Money } from "@/components/Money";
import { addDays, formatISO, today } from "@/domain/dates";
import { ACCOUNT_KINDS } from "@/domain/types";
import { accountCoverage, listAccounts, mergeWindows } from "@/services/accounts";
import { listCategories } from "@/services/categories";
import { getDb } from "@/services/context";
import { accountBalance, latestSnapshot, reconcileAccount } from "@/services/reconcile";
import {
  addSnapshotAction,
  archiveAccountAction,
  createAccountAction,
  setPaymentCategoryAction,
  toggleOnBudgetAction,
} from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  loan: "Loan",
  investment: "Investment",
  other: "Other",
};

export default function AccountsPage() {
  const db = getDb();
  const accounts = listAccounts(db);
  const now = today();
  const rangeStart = addDays(now, -365);
  const cats = listCategories(db);
  const paymentOptions = cats.filter(
    (c) => !c.isSystem && (c.flow === "expense" || c.flow === "saving") && c.parentId,
  );
  const catLabel = (id: string | null) => {
    const c = id ? cats.find((x) => x.id === id) : null;
    if (!c) return null;
    const p = c.parentId ? cats.find((x) => x.id === c.parentId) : null;
    return p ? `${p.name}: ${c.name}` : c.name;
  };
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Accounts</div>
          <h1>Accounts</h1>
          <p className="sub">
            Balances are computed from your latest statement balance plus activity since. The
            coverage bar shows the last 12 months of imports.
          </p>
        </div>
      </div>

      {accounts.map((a) => {
        const bal = accountBalance(db, a.id);
        const rec = reconcileAccount(db, a.id);
        const snap = latestSnapshot(db, a.id);
        const windows = mergeWindows(accountCoverage(db, a.id));
        return (
          <div className="card" key={a.id}>
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <div>
                <h2>
                  {a.name} <span className="chip">{KIND_LABEL[a.kind]}</span>{" "}
                  {a.onBudget ? (
                    <span className="chip ok">on budget</span>
                  ) : (
                    <span className="chip">off budget</span>
                  )}
                </h2>
                <div className="muted small">
                  {a.institution ?? ""}
                  {a.externalLabel ? ` · file label “${a.externalLabel}”` : ""}
                  {a.paymentCategoryId
                    ? ` · payments in count as ${catLabel(a.paymentCategoryId) ?? "?"}`
                    : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="stat">
                  <span className="label">Balance</span>
                  <span className="value" style={{ fontSize: 26 }}>
                    <Money cents={bal.balanceCents} />
                  </span>
                  <span className="hint">
                    {bal.anchor
                      ? `anchored to ${bal.anchor.source === "opening" ? "opening balance" : `${bal.anchor.source} balance`} on ${formatISO(bal.anchor.date)}`
                      : "no statement balance yet — activity only"}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ margin: "14px 0 6px" }}>
              <CoverageBar windows={windows} rangeStart={rangeStart} rangeEnd={now} />
              <div className="muted small" style={{ marginTop: 4 }}>
                {windows.length === 0
                  ? "No imports yet."
                  : windows
                      .map((w) => `${formatISO(w.start, "short")} – ${formatISO(w.end)}`)
                      .join("  ·  ")}
              </div>
            </div>
            {rec && rec.differenceCents !== 0 ? (
              <div className="notice bad">
                <p>
                  <strong>Doesn’t reconcile.</strong> The {rec.snapshot.source} balance on{" "}
                  {formatISO(rec.snapshot.date)} is <Money cents={rec.snapshot.balanceCents} /> but
                  the ledger implies <Money cents={rec.computedCents} /> — off by{" "}
                  <Money cents={rec.differenceCents} sign />. Something between{" "}
                  {formatISO(rec.previous.date)} and {formatISO(rec.snapshot.date)} is missing or
                  duplicated.{" "}
                  <Link
                    href={`/transactions?account=${a.id}&from=${rec.previous.date}&to=${rec.snapshot.date}`}
                  >
                    Review that window
                  </Link>
                  .
                </p>
              </div>
            ) : rec ? (
              <div className="muted small">
                Reconciles: ledger matches the {rec.snapshot.source} balance on{" "}
                {formatISO(rec.snapshot.date)}
                {rec.explanation ? ` (${rec.explanation})` : ""}.
              </div>
            ) : snap ? null : (
              <div className="muted small">
                Add a statement balance below to enable reconciliation.
              </div>
            )}
            <details style={{ marginTop: 10 }}>
              <summary>Statement balance · settings</summary>
              <div className="row" style={{ marginTop: 10 }}>
                <form action={addSnapshotAction} className="row">
                  <input type="hidden" name="id" value={a.id} />
                  <label className="field">
                    As of
                    <input type="date" name="asOfDate" defaultValue={now} required />
                  </label>
                  <label className="field">
                    Statement balance
                    <input
                      type="text"
                      name="balance"
                      placeholder={a.kind === "credit_card" ? "-1234.56 (owed)" : "1234.56"}
                      required
                    />
                  </label>
                  <button className="btn">Add balance</button>
                </form>
                <form action={toggleOnBudgetAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="onBudget" value={a.onBudget ? "0" : "1"} />
                  <button className="btn">
                    {a.onBudget ? "Move off budget" : "Move on budget"}
                  </button>
                </form>
                <form action={archiveAccountAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="btn danger">Archive</button>
                </form>
              </div>
              <form action={setPaymentCategoryAction} className="row" style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={a.id} />
                <label className="field">
                  Money sent to this account counts as
                  <select name="paymentCategoryId" defaultValue={a.paymentCategoryId ?? ""}>
                    <option value="">a transfer (not spending)</option>
                    {paymentOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {catLabel(c.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn">Apply to all payments</button>
              </form>
              <p className="muted small" style={{ marginTop: 8 }}>
                {a.kind === "loan"
                  ? "For a loan, pick the expense it really is — Housing: Rent / Mortgage, or Transport: Car Payment — and every payment into it (past and future) counts as that on the paying side. "
                  : a.kind === "investment"
                    ? "For a brokerage or retirement account, pick a Saving category so contributions count as Saved. "
                    : "Leave this as a transfer for card payments and moving cash between your own accounts. "}
                Credit-card balances are negative (money owed). Off-budget accounts are excluded
                from income and spend.
                {a.kind === "loan" && a.onBudget
                  ? " Loans are usually best off budget: the payment counts as spend once; interest posted inside the loan would count again."
                  : ""}
              </p>
            </details>
          </div>
        );
      })}

      <div className="card section">
        <h2>Add an account</h2>
        <form action={createAccountAction} className="form" style={{ marginTop: 10 }}>
          <div className="row">
            <label className="field">
              Name
              <input type="text" name="name" placeholder="Chase Checking" required />
            </label>
            <label className="field">
              Institution
              <input type="text" name="institution" placeholder="Chase" />
            </label>
            <label className="field">
              Type
              <select name="kind" defaultValue="checking">
                {ACCOUNT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="onBudget" defaultChecked /> On budget
            </label>
          </div>
          <div className="row">
            <label className="field">
              Opening balance
              <input type="text" name="openingBalance" placeholder="0.00" />
            </label>
            <label className="field">
              as of
              <input type="date" name="openingBalanceDate" />
            </label>
            <label className="field">
              Label in files (optional)
              <input
                type="text"
                name="externalLabel"
                placeholder="e.g. YNAB account name or ACCTID"
              />
            </label>
            <button className="btn primary">Add account</button>
          </div>
          <p className="muted small">
            The opening balance is the balance at the end of that day, before the first transaction
            you’ll import. Leave it blank if you’ll import an OFX/QFX file — those carry a statement
            balance.
          </p>
        </form>
      </div>
    </>
  );
}
