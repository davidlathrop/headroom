import Link from "next/link";
import { Money } from "@/components/Money";
import { formatMonth } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { getDb } from "@/services/context";
import { listMonthReports } from "@/services/reports";

export const dynamic = "force-dynamic";

export default async function MonthsPage({
  searchParams,
}: {
  searchParams: Promise<{ outliers?: string }>;
}) {
  const sp = await searchParams;
  const excludeOutliers = sp.outliers === "0";
  const reports = listMonthReports(getDb(), 36, { excludeOutliers });
  const flagged = reports.reduce((n, r) => n + r.outliers.count, 0);
  const monthHref = (m: string) => `/months/${m}${excludeOutliers ? "?outliers=0" : ""}`;
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">History</div>
          <h1>Months</h1>
          <p className="sub">
            Income, spend and headroom by calendar month, on posted date.
            {excludeOutliers
              ? " Flagged outliers are left out of every row."
              : flagged > 0
                ? ` Includes ${flagged} flagged outlier${flagged === 1 ? "" : "s"}.`
                : ""}
          </p>
        </div>
        <div className="tabs" style={{ marginBottom: 0 }} role="group" aria-label="Outliers">
          <Link href="/months" aria-current={!excludeOutliers ? "page" : undefined}>
            With outliers
          </Link>
          <Link href="/months?outliers=0" aria-current={excludeOutliers ? "page" : undefined}>
            Without outliers
          </Link>
        </div>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Fixed</th>
              <th className="num">Variable</th>
              <th className="num">Saved</th>
              <th className="num">Headroom</th>
              <th className="num">Kept</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  Import a file to see months here.
                </td>
              </tr>
            )}
            {reports.map((r) => (
              <tr key={r.month}>
                <td>
                  <Link href={monthHref(r.month)}>{formatMonth(r.month)}</Link>
                </td>
                <td className="num">
                  <Money cents={r.incomeCents} />
                </td>
                <td className="num">
                  <Money cents={-r.spendFixedCents} />
                </td>
                <td className="num">
                  <Money cents={-r.spendVariableCents} />
                </td>
                <td className="num">
                  <Money cents={-r.savedCents} />
                </td>
                <td className="num">
                  <Money cents={r.leftOverCents} />
                </td>
                <td className="num">
                  {r.savingsRate == null ? "—" : `${Math.round(r.savingsRate * 100)}%`}
                </td>
                <td>
                  {r.partial ? <span className="chip warn">partial</span> : null}{" "}
                  {r.uncategorizedCount > 0 ? (
                    <span className="chip">{r.uncategorizedCount} uncategorized</span>
                  ) : null}{" "}
                  {r.outliers.count > 0 ? (
                    <span
                      className="chip warn"
                      title="Counted in this row; left out of trends and forecast"
                    >
                      incl. {formatCents(r.outliers.spendCents + r.outliers.incomeCents)} outlier
                      {r.outliers.count === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
