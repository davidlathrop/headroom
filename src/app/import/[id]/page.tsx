import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { Money } from "@/components/Money";
import { transactions } from "@/db/schema";
import { DATE_FORMATS, formatISO } from "@/domain/dates";
import { ACCOUNT_KINDS, type DedupeStatus } from "@/domain/types";
import { AMOUNT_CONVENTIONS } from "@/importers/csv/profile";
import { listAccounts } from "@/services/accounts";
import { getDb } from "@/services/context";
import { annotatedRowsInBatch, getBatch, readPreview } from "@/services/imports";
import { getProfile } from "@/services/profiles";
import { assignProfileAction, commitAction, mapAccountsAction, rollbackAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<DedupeStatus, string> = {
  new: "New",
  exact_duplicate: "Duplicate",
  probable_duplicate: "Probable duplicate",
  pending_skipped: "Pending",
};
const KIND_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  loan: "Loan",
  investment: "Investment",
  other: "Other",
};

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { tab = "all", error, done } = await searchParams;
  const db = getDb();
  let batch;
  try {
    batch = getBatch(db, id);
  } catch {
    notFound();
  }
  const preview = readPreview(batch);
  const accounts = listAccounts(db);
  const accountName = (aid: string | null) => accounts.find((a) => a.id === aid)?.name ?? "?";

  if (batch.status === "needs_profile" && preview) {
    const headers = preview.headers ?? [];
    const Sel = ({ name, required = false }: { name: string; required?: boolean }) => (
      <select name={name} defaultValue="" required={required}>
        <option value="">{required ? "Choose…" : "— none —"}</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    );
    return (
      <>
        <div className="pagehead">
          <div>
            <div className="eyebrow">
              <Link href="/import">Import</Link>
            </div>
            <h1>Map the columns in {batch.fileName}</h1>
            <p className="sub">
              This layout isn’t one Headroom knows yet. Tell it which column is which once; it’s
              saved as a format for next time.
            </p>
          </div>
        </div>
        {error ? (
          <div className="notice bad">
            <p>{error}</p>
          </div>
        ) : null}
        <div className="card">
          <div className="tablewrap" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(preview.sample ?? []).map((r, i) => (
                  <tr key={i}>
                    {headers.map((_, j) => (
                      <td key={j} className="small">
                        {r[j] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={assignProfileAction} className="form">
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="skipRows" value={preview.skipRows ?? 0} />
            <div className="row">
              <label className="field">
                Format name
                <input type="text" name="profileName" placeholder="My Bank checking CSV" required />
              </label>
              <label className="field">
                Date column
                <Sel name="dateColumn" required />
              </label>
              <label className="field">
                Date format
                <select name="dateFormat" defaultValue="MM/DD/YYYY">
                  {DATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Posted date column
                <Sel name="postedDateColumn" />
              </label>
            </div>
            <div className="row">
              <label className="field">
                Payee / description
                <Sel name="payeeColumn" required />
              </label>
              <label className="field">
                Memo
                <Sel name="memoColumn" />
              </label>
              <label className="field">
                Transaction ID
                <Sel name="idColumn" />
              </label>
              <label className="field">
                Account name column
                <Sel name="accountColumn" />
              </label>
              <label className="field">
                Category column
                <Sel name="categoryColumn" />
              </label>
            </div>
            <div className="row">
              <label className="field">
                Amounts are
                <select name="amountConvention" defaultValue="signed_debit_negative">
                  {AMOUNT_CONVENTIONS.map((c) => (
                    <option key={c} value={c}>
                      {
                        {
                          signed_debit_negative: "One column, purchases negative",
                          signed_debit_positive: "One column, purchases positive",
                          debit_credit_columns: "Debit and Credit columns",
                          inflow_outflow_columns: "Outflow and Inflow columns",
                        }[c]
                      }
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Amount column
                <Sel name="amountColumn" />
              </label>
              <label className="field">
                Debit / Outflow column
                <Sel name="debitColumn" />
              </label>
              <label className="field">
                Credit / Inflow column
                <Sel name="creditColumn" />
              </label>
            </div>
            <div className="row">
              <label className="field">
                Status column
                <Sel name="statusColumn" />
              </label>
              <label className="field">
                Values that mean pending
                <input type="text" name="pendingValues" placeholder="Pending" />
              </label>
              <button className="btn primary">Save format and preview</button>
            </div>
          </form>
        </div>
      </>
    );
  }

  if (!preview)
    return (
      <div className="notice bad">
        <p>This import has no preview data.</p>
      </div>
    );

  const profile = batch.profileId ? getProfile(db, batch.profileId) : null;
  const labels = new Map(preview.labels.map((l) => [l.sourceRow, l]));
  const counts = {
    new: 0,
    exact_duplicate: 0,
    probable_duplicate: 0,
    pending_skipped: 0,
  } as Record<DedupeStatus, number>;
  for (const l of preview.labels) counts[l.status]++;
  const matchedIds = preview.labels
    .map((l) => l.matchedTransactionId)
    .filter((x): x is string => !!x);
  const matched = new Map(
    matchedIds.length
      ? db
          .select()
          .from(transactions)
          .where(inArray(transactions.id, matchedIds))
          .all()
          .map((t) => [t.id, t])
      : [],
  );
  const unmappedLabels = preview.accountsInFile.filter((l) => !preview.accountMap[l]);
  const needsSingle = preview.accountsInFile.length === 0 && !preview.singleAccountId;
  const rows = preview.rows.filter((r) => tab === "all" || labels.get(r.sourceRow)?.status === tab);
  const canCommit = batch.status === "previewed" && unmappedLabels.length === 0 && !needsSingle;
  const annotated = batch.status === "committed" ? annotatedRowsInBatch(db, batch.id) : 0;

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            <Link href="/import">Import</Link> · {profile?.name ?? batch.format}
          </div>
          <h1>{batch.fileName}</h1>
          <p className="sub">
            {preview.rows.length} rows
            {batch.coverageStart && batch.coverageEnd
              ? ` · ${formatISO(batch.coverageStart, "short")} – ${formatISO(batch.coverageEnd)}`
              : ""}
            {preview.accountsInFile.length
              ? ` · accounts in file: ${preview.accountsInFile.join(", ")}`
              : preview.singleAccountId
                ? ` · ${accountName(preview.singleAccountId)}`
                : ""}
          </p>
        </div>
        <span
          className={`chip ${batch.status === "committed" ? "ok" : batch.status === "rolled_back" ? "bad" : "warn"}`}
        >
          {batch.status.replace("_", " ")}
        </span>
      </div>

      {error ? (
        <div className="notice bad">
          <p>{error}</p>
        </div>
      ) : null}
      {done ? (
        <div className="notice">
          <p>
            <strong>Committed.</strong> {batch.insertedCount} transactions added.{" "}
            <Link href="/">See this month</Link> or{" "}
            <Link href="/transactions?uncategorized=1">categorize what’s new</Link>.
          </p>
        </div>
      ) : null}
      {preview.issues.length > 0 && (
        <details className="notice warn" style={{ marginBottom: 14 }}>
          <summary>
            {preview.issues.length} row{preview.issues.length === 1 ? "" : "s"} could not be read
            (skipped)
          </summary>
          <ul className="small">
            {preview.issues.slice(0, 20).map((i, k) => (
              <li key={k}>
                Row {i.row + 1}: {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {batch.status === "previewed" && (unmappedLabels.length > 0 || needsSingle) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Which account is this?</h2>
          <form action={mapAccountsAction} className="form" style={{ marginTop: 10 }}>
            <input type="hidden" name="batchId" value={batch.id} />
            {needsSingle && (
              <label className="field">
                Account for every row in this file
                <select name="singleAccountId" required defaultValue="">
                  <option value="">Choose…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {preview.accountsInFile.map((label) => (
              <div className="row" key={label}>
                <input type="hidden" name="label" value={label} />
                <label className="field">
                  “{label}” in the file is
                  <select
                    name={`map:${label}`}
                    defaultValue={preview.accountMap[label] ?? "__create__"}
                  >
                    <option value="__create__">Create a new account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  New account name
                  <input type="text" name={`name:${label}`} defaultValue={label} />
                </label>
                <label className="field">
                  Type
                  <select name={`kind:${label}`} defaultValue="checking">
                    {ACCOUNT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
            <div>
              <button className="btn primary">Save mapping</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <span className="label">Will be added</span>
          <span className="value">{counts.new}</span>
          <span className="hint">not seen before</span>
        </div>
        <div className="card stat">
          <span className="label">Already imported</span>
          <span className="value">{counts.exact_duplicate}</span>
          <span className="hint">skipped — same bank ID or identical content</span>
        </div>
        <div className="card stat">
          <span className="label">For review</span>
          <span className="value">{counts.probable_duplicate + counts.pending_skipped}</span>
          <span className="hint">
            {counts.probable_duplicate} probable duplicates · {counts.pending_skipped} pending
          </span>
        </div>
      </div>

      <form action={batch.status === "previewed" ? commitAction : undefined}>
        <input type="hidden" name="batchId" value={batch.id} />
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <div className="tabs">
            {(
              ["all", "new", "probable_duplicate", "pending_skipped", "exact_duplicate"] as const
            ).map((t) => (
              <Link
                key={t}
                href={`/import/${batch.id}?tab=${t}`}
                aria-current={tab === t ? "page" : undefined}
              >
                {t === "all" ? `All ${preview.rows.length}` : `${STATUS_LABEL[t]} ${counts[t]}`}
              </Link>
            ))}
          </div>
          {batch.status === "previewed" && (
            <button className="btn primary" disabled={!canCommit}>
              Commit {counts.new} transaction{counts.new === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {batch.status === "previewed" &&
          (counts.probable_duplicate > 0 || counts.pending_skipped > 0) && (
            <p className="muted small">
              Probable duplicates and pending rows are skipped unless you tick “import anyway”.
              Compare each with the stored transaction it resembles.
            </p>
          )}
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Memo</th>
                <th className="num">Amount</th>
                {preview.accountsInFile.length ? <th>Account</th> : null}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    Nothing in this tab.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const l = labels.get(r.sourceRow);
                const st = l?.status ?? "new";
                const m = l?.matchedTransactionId ? matched.get(l.matchedTransactionId) : null;
                const reviewable =
                  batch.status === "previewed" &&
                  (st === "probable_duplicate" || st === "pending_skipped");
                return (
                  <tr key={r.sourceRow} className={st === "exact_duplicate" ? "dim" : undefined}>
                    <td className="num small">
                      {r.postedDate}
                      {r.txnDate !== r.postedDate ? (
                        <span className="cell-sub">txn {r.txnDate}</span>
                      ) : null}
                    </td>
                    <td>
                      {r.payeeRaw}
                      {r.categoryHint ? <span className="cell-sub">{r.categoryHint}</span> : null}
                    </td>
                    <td className="small muted">{r.memoRaw}</td>
                    <td className="num">
                      <Money cents={r.amountCents} />
                    </td>
                    {preview.accountsInFile.length ? (
                      <td className="small">
                        {r.accountLabel
                          ? accountName(preview.accountMap[r.accountLabel] ?? null)
                          : "—"}
                      </td>
                    ) : null}
                    <td>
                      <span
                        className={`chip ${st === "new" ? "ok" : st === "exact_duplicate" ? "" : "warn"}`}
                      >
                        {STATUS_LABEL[st]}
                      </span>
                      {st !== "new" && l ? <span className="cell-sub">{l.reason}</span> : null}
                      {m ? (
                        <div className="diff" style={{ marginTop: 6 }}>
                          <div>
                            <span className="muted">this file</span>
                            <br />
                            {r.postedDate} · {r.payeeRaw}
                          </div>
                          <div>
                            <span className="muted">already stored</span>
                            <br />
                            {m.postedDate} · {m.payeeRaw}
                          </div>
                        </div>
                      ) : null}
                      {reviewable ? (
                        <label className="small" style={{ display: "block", marginTop: 6 }}>
                          <input type="checkbox" name="force" value={r.sourceRow} /> import anyway
                        </label>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>

      {batch.status === "committed" && (
        <div className="card section">
          <h2>Roll back this import</h2>
          <p className="small muted">
            Removes the {batch.insertedCount} transactions this file added
            {annotated > 0 ? `, including ${annotated} you have categorized or edited` : ""}.
            Transfers linked to them are unlinked. The file can be imported again afterwards.
          </p>
          <form action={rollbackAction}>
            <input type="hidden" name="batchId" value={batch.id} />
            <button className="btn danger">Roll back</button>
          </form>
        </div>
      )}
    </>
  );
}
