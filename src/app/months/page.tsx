import Link from "next/link";
import { Money } from "@/components/Money";
import { formatMonth } from "@/domain/dates";
import { getDb } from "@/services/context";
import { listMonthReports } from "@/services/reports";

export const dynamic = "force-dynamic";

export default function MonthsPage() {
  const reports = listMonthReports(getDb(), 36);
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">History</div>
          <h1>Months</h1>
          <p className="sub">Income, spend and headroom by calendar month, on posted date.</p>
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
                  <Link href={`/months/${r.month}`}>{formatMonth(r.month)}</Link>
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
