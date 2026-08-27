import Link from "next/link";
import { formatISO } from "@/domain/dates";
import { listAccounts } from "@/services/accounts";
import { getDb } from "@/services/context";
import { listBatches } from "@/services/imports";
import { listProfiles } from "@/services/profiles";
import { uploadAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  needs_profile: { label: "needs mapping", cls: "warn" },
  previewed: { label: "previewed", cls: "warn" },
  committed: { label: "committed", cls: "ok" },
  rolled_back: { label: "rolled back", cls: "bad" },
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const db = getDb();
  const accounts = listAccounts(db);
  const profiles = listProfiles(db);
  const batches = listBatches(db, 50);
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Import</div>
          <h1>Import a file</h1>
          <p className="sub">
            CSV, OFX, QFX or QBO exports from your bank or card. Overlapping date ranges are safe —
            duplicates are detected before anything is saved.
          </p>
        </div>
      </div>
      {error ? (
        <div className="notice bad">
          <p>{error}</p>
        </div>
      ) : null}
      <div className="card">
        <form action={uploadAction} className="form">
          <div className="row">
            <label className="field">
              File
              <input type="file" name="file" accept=".csv,.ofx,.qfx,.qbo,.txt" required />
            </label>
            <label className="field">
              Account
              <select name="accountId" defaultValue="">
                <option value="">Detect from file / choose later</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Format
              <select name="profileId" defaultValue="">
                <option value="">Auto-detect</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary">Preview import</button>
          </div>
          <p className="muted small">
            Pick the account for single-account CSVs. OFX/QFX files and YNAB exports name their
            accounts, so the account can be detected. Nothing is saved until you commit the preview.
          </p>
        </form>
      </div>

      <div className="section">
        <h2>History</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Covers</th>
                <th className="num">Rows</th>
                <th className="num">Added</th>
                <th className="num">Duplicates</th>
                <th className="num">Review</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    No imports yet.
                  </td>
                </tr>
              )}
              {batches.map((b) => {
                const s = STATUS[b.status]!;
                return (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/import/${b.id}`}>{b.fileName}</Link>
                      <span className="cell-sub">{formatISO(b.createdAt.slice(0, 10))}</span>
                    </td>
                    <td className="small">
                      {b.coverageStart && b.coverageEnd
                        ? `${formatISO(b.coverageStart, "short")} – ${formatISO(b.coverageEnd)}`
                        : "—"}
                    </td>
                    <td className="num">{b.rowCount}</td>
                    <td className="num">{b.status === "committed" ? b.insertedCount : "—"}</td>
                    <td className="num">{b.exactDuplicateCount}</td>
                    <td className="num">{b.probableDuplicateCount + b.pendingSkippedCount}</td>
                    <td>
                      <span className={`chip ${s.cls}`}>{s.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
