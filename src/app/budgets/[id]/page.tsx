import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryChecklist } from "@/components/CategoryChecklist";
import { Columns, HBars, type Series } from "@/components/charts";
import { Money } from "@/components/Money";
import { MonthPicker } from "@/components/MonthPicker";
import { Stat } from "@/components/Stat";
import {
  addMonths,
  daysInMonth,
  formatMonth,
  isMonthKey,
  monthKey,
  splitISO,
  today,
} from "@/domain/dates";
import { formatCents } from "@/domain/money";
import {
  budgetHistory,
  budgetPeriod,
  budgetReport,
  listBudgetItems,
  selectableCategoryGroups,
} from "@/services/budgets";
import { AppError, getDb } from "@/services/context";
import { listMonthKeys } from "@/services/reports";
import { deleteBudgetAction, updateBudgetAction } from "../actions";

export const dynamic = "force-dynamic";
const STRIP = 6;
const PERIODS = [3, 6, 12] as const;
const SLOTS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
];
const MAX_STACK = 6;

function shortMonth(m: string): string {
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${names[Number(m.slice(5, 7)) - 1]} ’${m.slice(2, 4)}`;
}

/** Change vs the month before: up is red (more spent), down is green. */
function Delta({ cents }: { cents: number }) {
  if (cents === 0) return <span className="muted">—</span>;
  return (
    <span className={`num ${cents > 0 ? "delta-up" : "delta-down"}`}>
      {cents > 0 ? "▲" : "▼"} {formatCents(Math.abs(cents))}
    </span>
  );
}

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; months?: string; edit?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const now = today();
  const thisMonth = monthKey(now);
  const month = sp.month && isMonthKey(sp.month) ? sp.month : thisMonth;
  let r;
  try {
    r = budgetReport(db, id, month);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const items = listBudgetItems(db, id);
  const groups = selectableCategoryGroups(db);
  const selected = new Map(items.map((i) => [i.categoryId, i.targetCents]));

  // Every month with data, plus this month and the one being viewed, newest first.
  const pickerMonths = [...new Set([...listMonthKeys(db), thisMonth, month])].sort((a, b) =>
    a < b ? 1 : -1,
  );
  // A strip of recent months for one-click comparison, always containing the viewed month.
  const stripEnd = month > thisMonth ? month : thisMonth;
  const stripStart =
    month < addMonths(stripEnd, -(STRIP - 1)) ? month : addMonths(stripEnd, -(STRIP - 1));
  const stripMonths: string[] = [];
  for (let m = stripStart; m <= stripEnd && stripMonths.length < STRIP; m = addMonths(m, 1))
    stripMonths.push(m);
  const history = budgetHistory(db, id, stripMonths);

  // Charts: N months ending at the viewed month.
  const n = (PERIODS as readonly number[]).includes(Number(sp.months)) ? Number(sp.months) : 6;
  const periodMonths: string[] = [];
  for (let i = n - 1; i >= 0; i--) periodMonths.push(addMonths(month, -i));
  const period = budgetPeriod(db, id, periodMonths);
  const periodStart = periodMonths[0]!;
  const withMonths = (m: string) => `${base}?month=${m}${n !== 6 ? `&months=${n}` : ""}`;
  // Stack the budget's lines by their spend over the period; the tail folds into Other.
  const lineTotals = period.lines
    .map((l) => ({
      ...l,
      total: period.months.reduce((s, m) => s + (m.byRow[l.categoryId] ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total);
  const stackLines = lineTotals.slice(0, MAX_STACK);
  const folded = lineTotals.slice(MAX_STACK);
  const stackSeries: Series[] = [
    ...stackLines.map((l, i) => ({ key: l.name, color: SLOTS[i % SLOTS.length]! })),
    ...(folded.length ? [{ key: "Other", color: "var(--viz-other)" }] : []),
  ];
  const monthlyTarget = r.hasTargets ? r.targetCents : 0;
  const periodShare =
    period.totals.allSpendCents > 0
      ? period.totals.actualCents / period.totals.allSpendCents
      : null;

  const { y, m, d } = splitISO(now);
  const isCurrent = month === thisMonth;
  // How far through the month we are: 1 for past months, 0 for future ones.
  const pace = month < thisMonth ? 1 : month > thisMonth ? 0 : d / daysInMonth(y, m);
  const over = r.remainingCents < 0;
  const targeted = r.rows.filter((x) => x.targetCents != null);
  const untargeted = r.rows.filter((x) => x.targetCents == null);
  const plural = (n: number) => `${n} categor${n === 1 ? "y" : "ies"}`;
  const delta = r.actualCents - r.previousActualCents;
  const base = `/budgets/${id}`;

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            <Link href="/budgets">Budgets</Link> ·{" "}
            <Link href={`${base}?month=${addMonths(month, -1)}`}>← prev</Link> ·{" "}
            <Link href={`${base}?month=${addMonths(month, 1)}`}>next →</Link>
            {!isCurrent ? (
              <>
                {" "}
                · <Link href={base}>this month</Link>
              </>
            ) : null}
          </div>
          <h1>{r.budget.name}</h1>
          <p className="sub">
            {r.budget.note ? `${r.budget.note} · ` : ""}
            {plural(r.rows.length)}
            {r.hasTargets ? "" : " · no targets, tracking spend"}
            {isCurrent ? ` · day ${d} of ${daysInMonth(y, m)}` : ""}
            {r.partial
              ? ` · coverage incomplete (${r.gaps.map((g) => g.accountName).join(", ")})`
              : ""}
          </p>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <label className="field">
            Month
            <MonthPicker months={pickerMonths} value={month} basePath={base} />
          </label>
          <Link className="btn" href={`${base}?month=${month}&edit=1#edit`}>
            Edit budget
          </Link>
        </div>
      </div>

      {sp.error ? (
        <div className="notice bad">
          <p>{sp.error}</p>
        </div>
      ) : null}

      <div className="tabs" aria-label="Recent months">
        {history.map((h) => (
          <Link
            key={h.month}
            href={`${base}?month=${h.month}`}
            aria-current={h.month === month ? "page" : undefined}
            title={
              h.partial ? `${formatMonth(h.month)} · coverage incomplete` : formatMonth(h.month)
            }
          >
            {shortMonth(h.month)} <span className="num">{formatCents(h.actualCents)}</span>
            {h.partial ? "*" : ""}
          </Link>
        ))}
      </div>

      {r.hasTargets ? (
        <div className="grid grid-3">
          <Stat
            label="Target"
            cents={r.targetCents}
            hint={`${plural(targeted.length)} with a target`}
          />
          <Stat
            label="Spent"
            cents={r.targetedActualCents}
            hint={
              untargeted.length
                ? `plus ${formatCents(r.actualCents - r.targetedActualCents)} in ${plural(untargeted.length)} without a target`
                : isCurrent && r.targetCents > 0
                  ? `on pace would be ${formatCents(Math.round(r.targetCents * pace))}`
                  : `${formatCents(r.previousActualCents)} in ${formatMonth(r.previousMonth)}`
            }
          />
          <Stat
            label={over ? "Over" : "Left"}
            cents={Math.abs(r.remainingCents)}
            tone={over ? "neg" : "headroom"}
            hint={`${Math.round((r.targetedActualCents / Math.max(1, r.targetCents)) * 100)}% of target used`}
          />
        </div>
      ) : (
        <div className="grid grid-3">
          <Stat
            label={`Spent in ${formatMonth(month)}`}
            cents={r.actualCents}
            hint={`${r.transactionCount} transaction${r.transactionCount === 1 ? "" : "s"} across ${plural(r.rows.length)}`}
          />
          <Stat
            label={formatMonth(r.previousMonth)}
            cents={r.previousActualCents}
            hint="the month before, same categories"
          />
          <Stat
            label="Change"
            cents={delta}
            tone={delta > 0 ? "neg" : "headroom"}
            hint={
              r.previousActualCents > 0
                ? `${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}${delta === 0 ? "" : ` ${Math.round((Math.abs(delta) / r.previousActualCents) * 100)}%`} vs ${formatMonth(r.previousMonth)}`
                : "nothing to compare with"
            }
          />
        </div>
      )}

      <div className="section">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Spent</th>
                <th className="num">Share</th>
                <th className="num">vs {shortMonth(r.previousMonth)}</th>
                {r.hasTargets ? (
                  <>
                    <th className="num">Target</th>
                    <th className="num">Left</th>
                  </>
                ) : null}
                <th style={{ width: "24%" }}>{r.hasTargets ? "Progress" : "Share"}</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => {
                const pct =
                  row.targetCents && row.targetCents > 0
                    ? (row.actualCents / row.targetCents) * 100
                    : null;
                const rowOver = row.remainingCents != null && row.remainingCents < 0;
                const ahead = isCurrent && pct != null && pct > pace * 100;
                return (
                  <tr key={row.categoryId}>
                    <td>
                      <Link
                        href={`/transactions?month=${month}&category=${row.categoryId}`}
                        title="Open these transactions"
                      >
                        {row.isGroup ? `All of ${row.name}` : row.name}
                      </Link>
                      <span className="cell-sub">
                        {row.groupName ?? (row.isGroup ? "whole group" : "")}
                        {row.count
                          ? ` · ${row.count} transaction${row.count === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </td>
                    <td className="num">
                      <Money cents={row.actualCents} />
                    </td>
                    <td className="num muted">
                      {row.actualCents > 0 ? `${Math.round(row.share * 100)}%` : "—"}
                    </td>
                    <td className="num">
                      <Delta cents={row.actualCents - row.previousActualCents} />
                    </td>
                    {r.hasTargets ? (
                      <>
                        <td className="num">
                          {row.targetCents == null ? (
                            <span className="muted">—</span>
                          ) : (
                            formatCents(row.targetCents)
                          )}
                        </td>
                        <td className="num">
                          {row.remainingCents == null ? (
                            <span className="muted">—</span>
                          ) : rowOver ? (
                            <span className="chip bad">
                              over {formatCents(-row.remainingCents)}
                            </span>
                          ) : (
                            formatCents(row.remainingCents)
                          )}
                        </td>
                      </>
                    ) : null}
                    <td>
                      {pct != null ? (
                        <div
                          className={`progress${rowOver ? " over" : ahead ? " warn" : ""}`}
                          title={`${Math.round(pct)}% of target`}
                        >
                          <span style={{ width: `${Math.min(100, pct)}%` }} />
                          {isCurrent ? <i style={{ left: `${pace * 100}%` }} /> : null}
                        </div>
                      ) : (
                        <div
                          className="progress share"
                          title={`${Math.round(row.share * 100)}% of this budget’s spend`}
                        >
                          <span style={{ width: `${row.share * 100}%` }} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>
                    <Money cents={r.actualCents} />
                  </strong>
                  {r.hasTargets && untargeted.length ? (
                    <span className="cell-sub">
                      {formatCents(r.targetedActualCents)} against targets
                    </span>
                  ) : null}
                </td>
                <td className="num muted">{r.actualCents > 0 ? "100%" : "—"}</td>
                <td className="num">
                  <Delta cents={delta} />
                </td>
                {r.hasTargets ? (
                  <>
                    <td className="num">
                      <strong>{formatCents(r.targetCents)}</strong>
                    </td>
                    <td className="num">
                      <strong>
                        {over ? (
                          <span className="chip bad">over {formatCents(-r.remainingCents)}</span>
                        ) : (
                          formatCents(r.remainingCents)
                        )}
                      </strong>
                    </td>
                  </>
                ) : null}
                <td className="muted small">
                  {r.hasTargets && isCurrent && r.targetCents > 0
                    ? "marker = on pace for today"
                    : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="chart-head" style={{ alignItems: "flex-end" }}>
          <div>
            <h2>Over time</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {formatMonth(periodStart)} – {formatMonth(month)} · click a month to open it
            </p>
          </div>
          <div className="tabs" style={{ marginBottom: 0 }} role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`${base}?month=${month}&months=${p}`}
                aria-current={p === n ? "page" : undefined}
              >
                {p} months
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <Stat
            label="Spent in this budget"
            cents={period.totals.actualCents}
            hint={`${formatCents(Math.round(period.totals.actualCents / n))} a month on average`}
          />
          {r.hasTargets ? (
            <Stat
              label={
                period.totals.targetCents - period.totals.actualCents < 0
                  ? "Over target"
                  : "Under target"
              }
              cents={Math.abs(period.totals.targetCents - period.totals.actualCents)}
              tone={period.totals.targetCents - period.totals.actualCents < 0 ? "neg" : "headroom"}
              hint={`target ${formatCents(period.totals.targetCents)} over ${n} months`}
            />
          ) : (
            <Stat
              label="All spending"
              cents={period.totals.allSpendCents}
              hint="every expense category, transfers excluded"
            />
          )}
          <div className="card stat">
            <span className="label">Share of all spending</span>
            <span className="value">
              {periodShare == null ? "—" : `${Math.round(periodShare * 100)}%`}
            </span>
            <span className="hint">
              {r.hasTargets
                ? `of ${formatCents(period.totals.allSpendCents)} spent in total`
                : "of everything spent in the period"}
            </span>
          </div>
        </div>

        <div className="card">
          <Columns
            title="Spend in this budget, by category"
            subtitle={
              r.hasTargets
                ? `stacked by category · dashed line = monthly target`
                : folded.length
                  ? `top ${MAX_STACK} lines; the rest folded into Other`
                  : "stacked by category"
            }
            mode="stacked"
            series={stackSeries}
            refLine={monthlyTarget > 0 ? { value: monthlyTarget, label: "target" } : undefined}
            data={period.months.map((m) => ({
              label: shortMonth(m.month),
              values: {
                ...Object.fromEntries(
                  stackLines.map((l) => [l.name, Math.max(0, m.byRow[l.categoryId] ?? 0)]),
                ),
                ...(folded.length
                  ? {
                      Other: folded.reduce(
                        (s, l) => s + Math.max(0, m.byRow[l.categoryId] ?? 0),
                        0,
                      ),
                    }
                  : {}),
              },
              extra: [
                { label: "Total", value: m.actualCents },
                ...(r.hasTargets ? [{ label: "Target", value: m.targetCents }] : []),
              ],
              note: m.partial ? "partial coverage" : undefined,
              href: m.month === month ? undefined : withMonths(m.month),
            }))}
          />
        </div>

        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <div className="card">
            <Columns
              title="This budget vs all spending"
              subtitle="by month"
              mode="grouped"
              width={430}
              series={[
                { key: "This budget", color: "var(--viz-1)" },
                { key: "All spending", color: "var(--viz-other)" },
              ]}
              refLine={monthlyTarget > 0 ? { value: monthlyTarget, label: "target" } : undefined}
              data={period.months.map((m) => ({
                label: shortMonth(m.month),
                values: { "This budget": m.actualCents, "All spending": m.allSpendCents },
                note:
                  [
                    m.allSpendCents > 0
                      ? `${Math.round((m.actualCents / m.allSpendCents) * 100)}% of spending`
                      : null,
                    m.partial ? "partial coverage" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined,
                href: m.month === month ? undefined : withMonths(m.month),
              }))}
            />
          </div>
          <div className="card">
            <div className="legend" style={{ marginBottom: 6 }}>
              <span>
                <i style={{ background: "var(--viz-1)" }} /> in this budget
              </span>
              <span>
                <i style={{ background: "var(--viz-other)" }} /> everything else
              </span>
            </div>
            <HBars
              title="Where all the money went"
              subtitle={`every expense category, ${n} months`}
              width={430}
              data={period.breakdown.slice(0, 14).map((b) => ({
                label: b.groupName ? `${b.name} (${b.groupName})` : b.name,
                value: b.amountCents,
                color: b.inBudget ? "var(--viz-1)" : "var(--viz-other)",
                suffix:
                  period.totals.allSpendCents > 0
                    ? `${Math.round((b.amountCents / period.totals.allSpendCents) * 100)}%`
                    : undefined,
                href:
                  b.categoryId && (n === 6 || n === 12)
                    ? `/trends?months=${n}&category=${b.categoryId}`
                    : undefined,
              }))}
            />
            {period.breakdown.length > 14 ? (
              <p className="muted small" style={{ marginTop: 6 }}>
                Showing the largest 14 of {period.breakdown.length} categories.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card section" id="edit">
        <details open={sp.edit === "1"}>
          <summary>Edit budget</summary>
          <form action={updateBudgetAction} className="form" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="month" value={month} />
            <div className="row">
              <label className="field">
                Name
                <input type="text" name="name" defaultValue={r.budget.name} required />
              </label>
              <label className="field" style={{ flex: 1 }}>
                Note
                <input type="text" name="note" defaultValue={r.budget.note} />
              </label>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                Categories to include
              </div>
              <p className="muted small">
                Targets are optional. Leave them blank to track spending; add one to see what’s
                left.
              </p>
              <CategoryChecklist groups={groups} selected={selected} />
            </div>
            <div className="row">
              <button className="btn primary">Save changes</button>
              <Link className="btn" href={`${base}?month=${month}`}>
                Cancel
              </Link>
            </div>
          </form>
          <form action={deleteBudgetAction} style={{ marginTop: 18 }}>
            <input type="hidden" name="id" value={id} />
            <button className="btn danger small">Delete this budget</button>
            <span className="muted small" style={{ marginLeft: 8 }}>
              Only the budget goes; transactions and categories stay.
            </span>
          </form>
        </details>
      </div>
    </>
  );
}
