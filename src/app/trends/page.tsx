import Link from "next/link";
import { Columns, DivergingColumns, HBars, Lines, type Series } from "@/components/charts";
import { Money } from "@/components/Money";
import { Stat } from "@/components/Stat";
import { addMonths, formatISO, formatMonth, isMonthKey } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { getDb } from "@/services/context";
import { categoryZoom, monthZoom, trends } from "@/services/trends";

export const dynamic = "force-dynamic";

const PERIODS = [6, 12, 24] as const;
const SLOTS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
];
const UNCATEGORIZED = "uncategorized";

function monthLabel(m: string, first: boolean): string {
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
  const mo = names[Number(m.slice(5, 7)) - 1]!;
  return first || mo === "Jan" ? `${mo} ’${m.slice(2, 4)}` : mo;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string; month?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const n = (PERIODS as readonly number[]).includes(Number(sp.months)) ? Number(sp.months) : 12;
  const month = sp.month && isMonthKey(sp.month) ? sp.month : null;
  const categoryParam = sp.category || null;
  const db = getDb();

  const url = (p: { month?: string | null; category?: string | null; months?: number }) => {
    const q = new URLSearchParams();
    q.set("months", String(p.months ?? n));
    if (p.month) q.set("month", p.month);
    if (p.category) q.set("category", p.category);
    return `/trends?${q.toString()}`;
  };
  const catParam = (id: string | null) => id ?? UNCATEGORIZED;

  const crumbs: Array<{ label: string; href?: string }> = [
    { label: "Trends", href: month || categoryParam ? url({}) : undefined },
  ];
  if (month)
    crumbs.push({ label: formatMonth(month), href: categoryParam ? url({ month }) : undefined });

  /* ------------------------------------------------------------ category zoom */
  if (categoryParam) {
    const z = categoryZoom(db, categoryParam === UNCATEGORIZED ? null : categoryParam, month, n);
    if (!z) {
      return (
        <div className="notice bad">
          <p>
            That category doesn’t exist. <Link href={url({ month })}>Back</Link>.
          </p>
        </div>
      );
    }
    if (z.groupName) crumbs.push({ label: z.groupName });
    crumbs.push({ label: z.name });
    const scopeLabel = month ? formatMonth(month) : `last ${n} months`;
    const hist = z.history;
    return (
      <>
        <Breadcrumb crumbs={crumbs} />
        <div className="pagehead">
          <div>
            <div className="eyebrow">
              {z.isGroup ? "Category group" : `Category · ${z.groupName ?? ""}`}
            </div>
            <h1>{z.name}</h1>
            <p className="sub">
              {formatCents(z.totalCents)} over {scopeLabel} · {z.transactionCount} transaction
              {z.transactionCount === 1 ? "" : "s"}
            </p>
          </div>
          <Link
            className="btn"
            href={`/transactions?${month ? `month=${month}&` : ""}${z.id ? `category=${z.id}` : "uncategorized=1"}`}
          >
            Open in Transactions
          </Link>
        </div>

        <div className={z.children.length > 0 ? "grid grid-2" : ""}>
          <div className="card">
            <Columns
              title={`${z.name} by month`}
              subtitle="click a month to zoom"
              mode="grouped"
              width={z.children.length > 0 ? 430 : 860}
              series={[{ key: z.name, color: "var(--viz-1)" }]}
              data={hist.map((h, i) => ({
                label: monthLabel(h.month, i === 0),
                values: { [z.name]: h.amountCents },
                note: h.partial ? "partial coverage" : undefined,
                href:
                  h.month === month ? undefined : url({ month: h.month, category: categoryParam }),
              }))}
            />
          </div>
          {z.children.length > 0 ? (
            <div className="card">
              <HBars
                title="Within the group"
                subtitle={`${scopeLabel} · click to zoom`}
                width={430}
                data={z.children.map((c) => ({
                  label: c.name,
                  value: c.amountCents,
                  href: url({ month, category: catParam(c.id) }),
                }))}
              />
            </div>
          ) : null}
        </div>

        <div className="section">
          <h2>Transactions · {scopeLabel}</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Account</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {z.transactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No transactions here.
                    </td>
                  </tr>
                )}
                {z.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="num small">{formatISO(t.postedDate, "short")}</td>
                    <td>
                      {t.payeeDisplay}
                      {t.memoRaw ? <span className="cell-sub">{t.memoRaw}</span> : null}
                    </td>
                    <td className="small">{t.accountName}</td>
                    <td className="small">
                      {t.categoryName ?? <span className="chip warn">uncategorized</span>}
                    </td>
                    <td className="num">
                      <Money cents={t.amountCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {z.transactions.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4}>
                      <strong>Total</strong>
                      {z.transactionCount > z.transactions.length ? (
                        <span className="cell-sub">
                          showing the first {z.transactions.length} of {z.transactionCount}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">
                      <strong>
                        <Money cents={z.transactions.reduce((s, t) => s + t.amountCents, 0)} />
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </>
    );
  }

  /* --------------------------------------------------------------- month zoom */
  if (month) {
    const z = monthZoom(db, month);
    const r = z.report;
    const cumSeries: Series[] = [
      { key: formatMonth(month), color: "var(--viz-1)" },
      { key: formatMonth(z.prevMonth), color: "var(--viz-2)" },
    ];
    return (
      <>
        <Breadcrumb crumbs={crumbs} />
        <div className="pagehead">
          <div>
            <div className="eyebrow">
              <Link href={url({ month: addMonths(month, -1) })}>← prev</Link> ·{" "}
              <Link href={url({ month: addMonths(month, 1) })}>next →</Link>
            </div>
            <h1>{formatMonth(month)}</h1>
            <p className="sub">
              {r.transactionCount} transactions
              {r.partial
                ? ` · coverage incomplete (${r.gaps.map((g) => g.accountName).join(", ")})`
                : ""}
            </p>
          </div>
          <Link className="btn" href={`/transactions?month=${month}`}>
            Open in Transactions
          </Link>
        </div>
        <div className="grid grid-3">
          <Stat label="Income" cents={r.incomeCents} />
          <Stat
            label="Spent"
            cents={r.spendCents}
            hint={`${formatCents(r.spendFixedCents)} fixed · ${formatCents(r.spendVariableCents)} variable`}
          />
          <Stat
            label="Headroom"
            cents={r.leftOverCents}
            tone="headroom"
            hint={r.savedCents ? `after ${formatCents(r.savedCents)} saved` : undefined}
          />
        </div>
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <div className="card">
            <HBars
              title="Spend by category"
              subtitle="click to zoom"
              width={430}
              data={z.groups.map((g) => ({
                label: g.name,
                value: g.amountCents,
                detail: g.items.map((i) => ({ label: i.name, value: i.amountCents })),
                href: url({ month, category: catParam(g.id) }),
              }))}
            />
          </div>
          <div className="card">
            <Lines
              title="Spending pace"
              subtitle="cumulative spend by day, vs the month before"
              width={430}
              xTitle="Day"
              series={cumSeries}
              data={z.cumulative.map((c) => ({
                label: String(c.day),
                values: { [cumSeries[0]!.key]: c.thisMonth, [cumSeries[1]!.key]: c.prevMonth },
              }))}
            />
          </div>
        </div>
        {r.uncategorizedCount > 0 ? (
          <div className="notice warn" style={{ marginTop: 16 }}>
            <p>
              {r.uncategorizedCount} transaction{r.uncategorizedCount === 1 ? "" : "s"} this month{" "}
              {r.uncategorizedCount === 1 ? "is" : "are"} uncategorized (
              {formatCents(-r.uncategorizedCents)}).{" "}
              <Link href={`/transactions?month=${month}&uncategorized=1`}>Categorize them</Link> and
              the picture sharpens.
            </p>
          </div>
        ) : null}
      </>
    );
  }

  /* ---------------------------------------------------------------- overview */
  const t = trends(db, n);
  const hasData = t.months.some((m) => m.incomeCents || m.spendCents);
  const label = (i: number) => monthLabel(t.months[i]!.month, i === 0);
  const note = (partial: boolean) => (partial ? "partial coverage" : undefined);
  const incomeSpend: Series[] = [
    { key: "Income", color: "var(--viz-1)" },
    { key: "Spend", color: "var(--viz-2)" },
  ];
  const mixSeries: Series[] = t.stackGroups.map((g, i) => ({
    key: g,
    color: g === "Other" ? "var(--viz-other)" : SLOTS[i % SLOTS.length]!,
  }));

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Trends</div>
          <h1>The picture over time</h1>
          <p className="sub">
            Calendar months on posted date; transfers excluded; months with an import gap are
            marked. Click a month or a category to zoom in; hover for the numbers, or open a chart’s
            table.
          </p>
        </div>
      </div>

      <div className="toolbar" role="group" aria-label="Period">
        <span className="muted small">Show the last</span>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {PERIODS.map((p) => (
            <Link key={p} href={url({ months: p })} aria-current={p === n ? "page" : undefined}>
              {p} months
            </Link>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="notice">
          <p>
            Nothing to chart yet. <Link href="/import">Import a file</Link> and the trends fill in.
          </p>
        </div>
      ) : null}

      <div className="card">
        <Columns
          title="Income and spend"
          subtitle="by month · click a month to zoom"
          mode="grouped"
          series={incomeSpend}
          data={t.months.map((m, i) => ({
            label: label(i),
            values: { Income: m.incomeCents, Spend: m.spendCents },
            extra: [
              { label: "Fixed", value: m.fixedCents },
              { label: "Variable", value: m.variableCents },
              { label: "Saved", value: m.savedCents },
              { label: "Headroom", value: m.leftOverCents },
            ],
            note: note(m.partial),
            href: url({ month: m.month }),
          }))}
        />
      </div>

      <div className="card">
        <DivergingColumns
          title="Headroom"
          subtitle="income − spend − saved, by month"
          data={t.months.map((m, i) => ({
            label: label(i),
            value: m.leftOverCents,
            note: note(m.partial),
            href: url({ month: m.month }),
          }))}
        />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <HBars
            width={430}
            title="Where it went"
            subtitle={`last ${n} months · click to zoom`}
            data={t.spendByGroup
              .slice(0, 12)
              .map((g) => ({
                label: g.name,
                value: g.amountCents,
                detail: g.items.map((i) => ({ label: i.name, value: i.amountCents })),
                href: url({ category: catParam(g.id) }),
              }))}
          />
        </div>
        <div className="card">
          <Lines
            width={430}
            title="Net cash position"
            subtitle="cash accounts − card balances, month end"
            series={[{ key: "Net cash", color: "var(--viz-1)" }]}
            data={t.months.map((m, i) => ({
              label: label(i),
              values: { "Net cash": m.netCashCents },
              note: note(m.partial),
              href: url({ month: m.month }),
            }))}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <Columns
          title="Spend mix"
          subtitle={`${t.stackGroups.includes("Other") ? "top five groups; the rest folded into Other" : "by category group"} · click a segment to zoom`}
          mode="stacked"
          series={mixSeries}
          data={t.stack.map((s, i) => ({
            label: label(i),
            values: s.values,
            note: note(t.months[i]!.partial),
            segmentHrefs: Object.fromEntries(
              t.stackGroups
                .filter((g) => g !== "Other")
                .map((g) => [g, url({ month: s.month, category: catParam(s.ids[g] ?? null) })]),
            ),
          }))}
        />
      </div>
    </>
  );
}

function Breadcrumb({ crumbs }: { crumbs: Array<{ label: string; href?: string }> }) {
  return (
    <nav className="eyebrow" aria-label="Breadcrumb" style={{ marginBottom: 6 }}>
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 ? " › " : ""}
          {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
        </span>
      ))}
    </nav>
  );
}
