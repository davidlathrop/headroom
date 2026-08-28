import Link from "next/link";
import { CashCurve } from "@/components/CashCurve";
import { Money } from "@/components/Money";
import { formatISO, formatMonth, today } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { listCategories } from "@/services/categories";
import { getDb } from "@/services/context";
import { forecastView } from "@/services/forecast";
import { listPlanned } from "@/services/planned";
import { listSeries } from "@/services/recurring";
import { getSetting } from "@/services/settings";
import {
  addPlannedAction,
  deletePlannedAction,
  seriesAmountAction,
  seriesStatusAction,
  setBufferAction,
} from "./actions";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "weekly",
  biweekly: "every 2 weeks",
  semimonthly: "twice a month",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "yearly",
};

export default function ForecastPage() {
  const db = getDb();
  const now = today();
  const f = forecastView(db, now, 12);
  const allSeries = listSeries(db);
  const planned = listPlanned(db);
  const categories = listCategories(db);
  const catName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "") : "";
  const bufferSetting = getSetting<number | null>(db, "forecast.bufferCents", null);
  const trailing = getSetting<number>(db, "forecast.trailingMonths", 3);
  const hasHistory = f.completeMonths.length > 0 || f.series.length > 0;
  const seriesById = new Map(f.series.map((s) => [s.id, s]));

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Forecast</div>
          <h1>What your money can do</h1>
          <p className="sub">
            Built from {f.series.length} recurring series and the median of{" "}
            {f.completeMonths.length
              ? f.completeMonths.map(formatMonth).join(", ")
              : "no complete months yet"}
            .
            {f.unconfirmedSeriesCount > 0
              ? ` ${f.unconfirmedSeriesCount} detected series are unconfirmed — review them below.`
              : ""}
          </p>
        </div>
      </div>

      {f.partialMonthsUsed.length > 0 ? (
        <div className="notice warn">
          <p>
            {f.partialMonthsUsed.map(formatMonth).join(", ")} had an account with missing imports,
            but there weren’t enough complete months, so the forecast uses{" "}
            {f.partialMonthsUsed.length === 1 ? "it" : "them"} anyway. Import the missing range — or{" "}
            <Link href="/accounts">archive</Link> an account you no longer use — and this warning
            goes away.
          </p>
        </div>
      ) : null}
      {!hasHistory ? (
        <div className="notice">
          <p>
            Import a few months of history and the forecast fills in: paychecks, bills and typical
            spending are detected from what you’ve imported.{" "}
            <Link href="/import">Import a file</Link>.
          </p>
        </div>
      ) : null}

      <div className="grid grid-3">
        <div
          className={`card stat ${f.safeToSpendCents != null && f.safeToSpendCents < 0 ? "neg" : "headroom"}`}
        >
          <span className="label">
            Safe to spend
            {f.nextIncomeDate
              ? ` until ${formatISO(f.nextIncomeDate, "short")}`
              : " (next 60 days)"}
          </span>
          <span className="value">
            {f.safeToSpendCents == null ? "—" : formatCents(f.safeToSpendCents)}
          </span>
          <span className="hint">
            {f.lowestPoint
              ? `lowest cash ${formatCents(f.lowestPoint.balanceCents)} on ${formatISO(f.lowestPoint.date, "short")}, minus a ${formatCents(f.bufferCents)} buffer`
              : "needs a cash balance"}
          </span>
        </div>
        <div className="card stat">
          <span className="label">Emergency fund</span>
          <span className="value">
            {f.emergencyFundMonths == null ? "—" : `${f.emergencyFundMonths.toFixed(1)} mo`}
          </span>
          <span className="hint">net cash ÷ average monthly spend</span>
        </div>
        <div className="card stat">
          <span className="label">Projected headroom, next 12 months</span>
          <span className="value">
            {formatCents(f.months.slice(1).reduce((s, m) => s + m.leftOverCents, 0))}
          </span>
          <span className="hint">
            ending net cash{" "}
            {f.months.length ? formatCents(f.months[f.months.length - 1]!.netCashEndCents) : "—"}
          </span>
        </div>
      </div>

      <div className="section">
        <h2>Cash in checking and savings, next 60 days</h2>
        <div className="card">
          <CashCurve
            points={f.cashCurve}
            bufferCents={f.bufferCents}
            lowestDate={f.lowestPoint?.date ?? null}
          />
          <p className="muted small" style={{ marginTop: 10 }}>
            Expected paychecks, bills and card payments land on their usual dates; everyday spending
            that hits these accounts is spread evenly. Hover for the events on any day.
          </p>
        </div>
      </div>

      <div className="section">
        <h2>Month by month</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Income</th>
                <th className="num">Fixed</th>
                <th className="num">Variable</th>
                <th className="num">Saved</th>
                <th className="num">Planned</th>
                <th className="num">Headroom</th>
                <th className="num">Net cash</th>
              </tr>
            </thead>
            <tbody>
              {f.months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {formatMonth(m.month)}
                    {m.isCurrent ? (
                      <span className="chip" style={{ marginLeft: 6 }}>
                        so far + expected
                      </span>
                    ) : null}
                  </td>
                  <td className="num">
                    <Money cents={m.incomeCents} />
                  </td>
                  <td className="num">
                    <Money cents={-m.fixedCents} />
                  </td>
                  <td className="num">
                    <Money cents={-m.variableCents} />
                  </td>
                  <td className="num">
                    <Money cents={-m.savedCents} />
                  </td>
                  <td className="num">
                    {m.plannedCents ? (
                      <Money cents={m.plannedCents} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">
                    <Money cents={m.leftOverCents} />
                  </td>
                  <td className="num">
                    <Money cents={m.netCashEndCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {f.variableMedians.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary>
              Typical variable spend used (
              {formatCents(f.variableMedians.reduce((s, v) => s + v.medianCents, 0))} / month)
            </summary>
            <ul className="list small">
              {f.variableMedians.map((v) => (
                <li key={v.categoryId ?? "u"}>
                  <span>{v.name}</span>
                  <Money cents={-v.medianCents} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="section grid grid-2">
        <div>
          <h2>Recurring</h2>
          <p className="muted small">
            Detected from your history. Confirm the ones that are real; dismiss the rest. Confirmed
            series are trusted by the forecast.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Payee</th>
                  <th>Cadence</th>
                  <th className="num">Typical</th>
                  <th>Next</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {allSeries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      Nothing recurring detected yet — it takes about three occurrences.
                    </td>
                  </tr>
                )}
                {allSeries.map((s) => {
                  const v = seriesById.get(s.id);
                  return (
                    <tr
                      key={s.id}
                      className={
                        s.status === "dismissed" || s.status === "inactive" ? "dim" : undefined
                      }
                    >
                      <td>
                        {v?.label ?? s.payeeKey}
                        <span className="cell-sub">
                          {catName(s.categoryId) || "uncategorized"}
                          {v?.occurrencesLabel ? ` · ${v.occurrencesLabel}` : ""}
                        </span>
                      </td>
                      <td className="small">
                        {CADENCE_LABEL[s.cadence]}
                        {s.amountMadCents / Math.max(1, Math.abs(s.typicalAmountCents)) > 0.05 ? (
                          <span className="cell-sub">varies ±{formatCents(s.amountMadCents)}</span>
                        ) : null}
                      </td>
                      <td className="num">
                        <form
                          action={seriesAmountAction}
                          className="row"
                          style={{ justifyContent: "flex-end", gap: 4 }}
                        >
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="categoryId" value={s.categoryId ?? ""} />
                          <input
                            type="text"
                            name="amount"
                            defaultValue={(s.typicalAmountCents / 100).toFixed(2)}
                            style={{ width: 96, textAlign: "right" }}
                            aria-label="Typical amount"
                          />
                        </form>
                      </td>
                      <td className="small">
                        {s.status === "inactive"
                          ? "stopped"
                          : formatISO(s.nextExpectedDate, "short")}
                      </td>
                      <td>
                        <span
                          className={`chip ${s.status === "confirmed" ? "ok" : s.status === "detected" ? "warn" : ""}`}
                        >
                          {s.status}
                        </span>
                        <span style={{ display: "inline-flex", gap: 8, marginLeft: 6 }}>
                          {s.status !== "confirmed" ? (
                            <form action={seriesStatusAction.bind(null, s.id, "confirmed")}>
                              <button className="btn link small">confirm</button>
                            </form>
                          ) : null}
                          {s.status !== "dismissed" ? (
                            <form action={seriesStatusAction.bind(null, s.id, "dismissed")}>
                              <button className="btn link small muted">dismiss</button>
                            </form>
                          ) : (
                            <form action={seriesStatusAction.bind(null, s.id, "detected")}>
                              <button className="btn link small">restore</button>
                            </form>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>Planned one-offs</h2>
          <p className="muted small">
            Things you know are coming that history can’t predict: a trip, a tax bill, a bonus.
          </p>
          <div className="card">
            <ul className="list">
              {planned.length === 0 && <li className="muted">Nothing planned.</li>}
              {planned.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.name}
                    <span className="cell-sub">{formatISO(p.date)}</span>
                  </span>
                  <span className="row" style={{ gap: 8, alignItems: "center" }}>
                    <Money cents={p.amountCents} sign />
                    <form action={deletePlannedAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="btn link small muted">remove</button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
            <form action={addPlannedAction} className="row" style={{ marginTop: 12 }}>
              <label className="field">
                What
                <input type="text" name="name" placeholder="Flights to Lisbon" required />
              </label>
              <label className="field">
                Amount
                <input
                  type="text"
                  name="amount"
                  placeholder="800.00"
                  required
                  style={{ width: 100 }}
                />
              </label>
              <label className="field">
                Direction
                <select name="direction" defaultValue="out">
                  <option value="out">cost</option>
                  <option value="in">money in</option>
                </select>
              </label>
              <label className="field">
                Date
                <input type="date" name="date" required defaultValue={now} />
              </label>
              <button className="btn">Add</button>
            </form>
          </div>

          <h2 style={{ marginTop: 24 }}>Assumptions</h2>
          <div className="card">
            <form action={setBufferAction} className="row">
              <label className="field">
                Buffer to keep in cash
                <input
                  type="text"
                  name="buffer"
                  placeholder={`${(f.bufferCents / 100).toFixed(2)} (one month of fixed spend)`}
                  defaultValue={bufferSetting == null ? "" : (bufferSetting / 100).toFixed(2)}
                  style={{ width: 180 }}
                />
              </label>
              <label className="field">
                Typical spend from the last
                <select name="trailingMonths" defaultValue={String(trailing)}>
                  <option value="3">3 complete months</option>
                  <option value="6">6 complete months</option>
                </select>
              </label>
              <button className="btn">Save</button>
            </form>
            <p className="muted small" style={{ marginTop: 8 }}>
              Leave the buffer blank to use one month of fixed spend. Medians, not averages, so one
              expensive month doesn’t haunt the forecast — and transactions you flag as outliers on
              the Transactions page are left out of them entirely.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
