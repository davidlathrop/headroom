import Link from "next/link";
import { CategoryChecklist } from "@/components/CategoryChecklist";
import { Amount } from "@/components/Amount";
import { Money } from "@/components/Money";
import { formatMonth, monthKey, today } from "@/domain/dates";
import { budgetSummaries, selectableCategoryGroups } from "@/services/budgets";
import { getDb } from "@/services/context";
import { createBudgetAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const db = getDb();
  const month = monthKey(today());
  const summaries = budgetSummaries(db, month);
  const groups = selectableCategoryGroups(db);

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Budgets</div>
          <h1>Budgets</h1>
          <p className="sub">
            A budget is a set of categories you want to watch together — with monthly targets, or
            without. Pick any month to see what went into each. Spend is counted the same way as
            everywhere else: on posted date, transfers excluded, refunds subtracted.
          </p>
        </div>
      </div>

      {error ? (
        <div className="notice bad">
          <p>{error}</p>
        </div>
      ) : null}

      {summaries.length === 0 ? (
        <div className="notice">
          <p>
            No budgets yet. Create one below — pick the categories to include. Targets are optional.
          </p>
        </div>
      ) : (
        <div className="grid grid-2">
          {summaries.map((s) => {
            const pct = s.targetCents > 0 ? (s.targetedActualCents / s.targetCents) * 100 : 0;
            const over = s.remainingCents < 0;
            const n = s.rows.length;
            return (
              <div className="card" key={s.budget.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <h2>
                      <Link href={`/budgets/${s.budget.id}`}>{s.budget.name}</Link>
                    </h2>
                    <div className="muted small">
                      {s.budget.note ? `${s.budget.note} · ` : ""}
                      {formatMonth(month)} · {n} categor{n === 1 ? "y" : "ies"}
                      {s.partial ? " · coverage incomplete" : ""}
                    </div>
                  </div>
                  {s.targetCents > 0 ? (
                    <div
                      className={`stat${over ? " neg" : " headroom"}`}
                      style={{ textAlign: "right" }}
                    >
                      <span className="label">{over ? "Over by" : "Left"}</span>
                      <span className="value" style={{ fontSize: 24 }}>
                        <Amount cents={Math.abs(s.remainingCents)} />
                      </span>
                    </div>
                  ) : null}
                </div>
                {s.targetCents > 0 ? (
                  <>
                    <div className={`progress${over ? " over" : ""}`} style={{ marginTop: 12 }}>
                      <span style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      <Money cents={s.targetedActualCents} /> of <Amount cents={s.targetCents} />{" "}
                      targeted
                      {s.actualCents !== s.targetedActualCents ? (
                        <>
                          {" "}
                          · <Amount cents={s.actualCents - s.targetedActualCents} /> more in
                          untargeted categories
                        </>
                      ) : (
                        ""
                      )}
                    </div>
                  </>
                ) : (
                  <div className="row" style={{ marginTop: 12, alignItems: "baseline" }}>
                    <span className="num" style={{ fontSize: 22, fontWeight: 600 }}>
                      <Amount cents={s.actualCents} />
                    </span>
                    <span className="muted small">
                      spent so far ·{" "}
                      {s.previousActualCents > 0 ? (
                        <>
                          <Amount cents={s.previousActualCents} /> in {formatMonth(s.previousMonth)}
                        </>
                      ) : (
                        "no targets, tracking spend"
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="card section">
        <h2>Create a budget</h2>
        <form action={createBudgetAction} className="form" style={{ marginTop: 10 }}>
          <div className="row">
            <label className="field">
              Name
              <input type="text" name="name" placeholder="Essentials" required />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Note (optional)
              <input type="text" name="note" placeholder="Rent, bills and groceries" />
            </label>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Categories to include
            </div>
            <p className="muted small">
              Tick the categories that belong in this budget. Tick “All of …” to track a whole group
              as one line. Targets are optional — leave them blank and the budget simply shows what
              went into each category in any month you pick; add one to see what’s left.
            </p>
            <CategoryChecklist groups={groups} selected={new Map()} />
          </div>
          <div>
            <button className="btn primary">Create budget</button>
          </div>
        </form>
      </div>
    </>
  );
}
