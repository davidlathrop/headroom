import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Amount } from "@/components/Amount";
import { Money } from "@/components/Money";
import { Stat } from "@/components/Stat";
import { addMonths, formatMonth, isMonthKey } from "@/domain/dates";
import { getDb } from "@/services/context";
import { categoryBreakdown } from "@/services/reports";

export const dynamic = "force-dynamic";

export default async function MonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>;
  searchParams: Promise<{ outliers?: string }>;
}) {
  const { month } = await params;
  const sp = await searchParams;
  if (!isMonthKey(month)) notFound();
  const excludeOutliers = sp.outliers === "0";
  const qs = excludeOutliers ? "?outliers=0" : "";
  const { report, groups } = categoryBreakdown(getDb(), month, { excludeOutliers });
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            <Link href={`/months${qs}`}>Months</Link> ·{" "}
            <Link href={`/months/${addMonths(month, -1)}${qs}`}>← prev</Link> ·{" "}
            <Link href={`/months/${addMonths(month, 1)}${qs}`}>next →</Link>
          </div>
          <h1>{formatMonth(month)}</h1>
          <p className="sub">
            {report.transactionCount} transactions
            {report.partial
              ? ` · coverage incomplete (${report.gaps.map((g) => g.accountName).join(", ")})`
              : ""}
            {excludeOutliers ? (
              <>
                {" · "}flagged outliers left out ·{" "}
                <Link href={`/months/${month}`}>include them</Link>
              </>
            ) : report.outliers.count > 0 ? (
              <>
                {" · "}including {report.outliers.count} flagged outlier
                {report.outliers.count === 1 ? "" : "s"} (
                <Amount cents={report.outliers.spendCents + report.outliers.incomeCents} />) ·{" "}
                <Link href={`/months/${month}?outliers=0`}>leave them out</Link>
              </>
            ) : null}
          </p>
        </div>
        <Link className="btn" href={`/transactions?month=${month}`}>
          All transactions
        </Link>
      </div>
      <div className="grid grid-3">
        <Stat label="Income" cents={report.incomeCents} />
        <Stat
          label="Spent"
          cents={report.spendCents}
          hint={
            <>
              <Amount cents={report.spendFixedCents} /> fixed ·{" "}
              <Amount cents={report.spendVariableCents} /> variable
              {report.outliers.spendCents ? (
                <>
                  {" "}
                  · incl. <Amount cents={report.outliers.spendCents} /> flagged outlier
                  {report.outliers.count === 1 ? "" : "s"}
                </>
              ) : null}
            </>
          }
        />
        <Stat
          label="Headroom"
          cents={report.leftOverCents}
          tone="headroom"
          hint={
            report.savedCents ? (
              <>
                after <Amount cents={report.savedCents} /> saved
              </>
            ) : undefined
          }
        />
      </div>
      <div className="section">
        <h2>By category</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Category</th>
                <th className="num">Count</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.name}>
                  <tr>
                    <td>
                      <strong>{g.name}</strong>
                    </td>
                    <td></td>
                    <td></td>
                    <td className="num">
                      <strong>
                        <Money cents={g.flow === "income" ? g.amountCents : -g.amountCents} />
                      </strong>
                    </td>
                  </tr>
                  {g.items.map((c) => (
                    <tr key={`${g.name}-${c.name}`} className="dim">
                      <td></td>
                      <td>
                        <Link
                          href={`/transactions?month=${month}${c.categoryId ? `&category=${c.categoryId}` : "&uncategorized=1"}`}
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="num">{c.count}</td>
                      <td className="num">
                        <Money cents={c.flow === "income" ? c.amountCents : -c.amountCents} />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    Nothing here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
