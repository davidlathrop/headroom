import { FLOWS } from "@/domain/types";
import { listAccounts } from "@/services/accounts";
import { categoryTree, listCategories } from "@/services/categories";
import { getDb } from "@/services/context";
import { listProfiles } from "@/services/profiles";
import { listRules } from "@/services/rules";
import {
  applyRulesAction,
  archiveCategoryAction,
  createCategoryAction,
  createRuleAction,
  deleteProfileAction,
  deleteRuleAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = getDb();
  const tree = categoryTree(db);
  const cats = listCategories(db);
  const rules = listRules(db);
  const profiles = listProfiles(db);
  const accounts = listAccounts(db);
  const catName = (id: string) => {
    const c = cats.find((x) => x.id === id);
    if (!c) return id;
    const p = c.parentId ? cats.find((x) => x.id === c.parentId) : null;
    return p ? `${p.name}: ${c.name}` : c.name;
  };
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Categories, rules, formats</h1>
        </div>
      </div>

      <div className="section">
        <h2>Categories</h2>
        <p className="muted small">
          Every category has a flow — income, expense, saving (to off-budget accounts), transfer,
          ignore — and expense categories are fixed (commitments) or variable. That’s what makes the
          monthly numbers honest.
        </p>
        <div className="grid grid-2">
          {tree.map((g) => (
            <div className="card" key={g.id}>
              <h3>
                {g.name}{" "}
                <span className="chip">
                  {g.flow}
                  {g.spendType ? ` · ${g.spendType}` : ""}
                </span>
              </h3>
              <ul className="list small" style={{ marginTop: 6 }}>
                {g.children.map((c) => (
                  <li key={c.id}>
                    <span>
                      {c.name}{" "}
                      {c.spendType && c.spendType !== g.spendType ? (
                        <span className="chip">{c.spendType}</span>
                      ) : null}
                    </span>
                    <form action={archiveCategoryAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="btn link small muted">archive</button>
                    </form>
                  </li>
                ))}
                {g.children.length === 0 && !g.isSystem ? (
                  <li className="muted">No subcategories</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Add a category</h3>
          <form action={createCategoryAction} className="row" style={{ marginTop: 8 }}>
            <label className="field">
              Name
              <input type="text" name="name" required />
            </label>
            <label className="field">
              Group
              <select name="parentId" defaultValue="">
                <option value="">— top level —</option>
                {tree
                  .filter((g) => !g.isSystem)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Flow
              <select name="flow" defaultValue="expense">
                {FLOWS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Spend type
              <select name="spendType" defaultValue="variable">
                <option value="variable">variable</option>
                <option value="fixed">fixed</option>
              </select>
            </label>
            <button className="btn primary">Add</button>
          </form>
        </div>
      </div>

      <div className="section">
        <h2>Rules</h2>
        <p className="muted small">
          Rules run in priority order (lowest first); the first match wins. Priority 10 or below
          overrides categories that came with a file.
        </p>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th className="num">Priority</th>
                <th>When</th>
                <th>Pattern</th>
                <th>Set category</th>
                <th>Rename to</th>
                <th className="num">Hits</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.priority}</td>
                  <td className="small">
                    {r.matchField.replace("_", " ")} {r.matchType}
                  </td>
                  <td>
                    <code>{r.pattern}</code>
                    {r.amountMinCents != null || r.amountMaxCents != null ? (
                      <span className="cell-sub">
                        amount {r.amountMinCents ?? "…"} to {r.amountMaxCents ?? "…"} cents
                      </span>
                    ) : null}
                  </td>
                  <td className="small">{catName(r.setCategoryId)}</td>
                  <td className="small">{r.setPayeeDisplay ?? ""}</td>
                  <td className="num">{r.hitCount}</td>
                  <td>
                    <form action={deleteRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn link small">delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Add a rule</h3>
          <form action={createRuleAction} className="form" style={{ marginTop: 8 }}>
            <div className="row">
              <label className="field">
                Match
                <select name="matchField" defaultValue="payee_key">
                  <option value="payee_key">normalized payee</option>
                  <option value="payee_raw">bank text</option>
                  <option value="memo">memo</option>
                </select>
              </label>
              <label className="field">
                How
                <select name="matchType" defaultValue="contains">
                  <option value="contains">contains</option>
                  <option value="exact">equals</option>
                  <option value="regex">regex</option>
                </select>
              </label>
              <label className="field">
                Pattern
                <input type="text" name="pattern" required />
              </label>
              <label className="field">
                Category
                <select name="setCategoryId" required defaultValue="">
                  {[
                    <option key="" value="">
                      Choose…
                    </option>,
                    ...cats
                      .filter((c) => c.parentId || c.isSystem)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {catName(c.id)}
                        </option>
                      )),
                  ]}
                </select>
              </label>
            </div>
            <div className="row">
              <label className="field">
                Rename payee to
                <input type="text" name="setPayeeDisplay" placeholder="optional" />
              </label>
              <label className="field">
                Amount min
                <input type="text" name="amountMin" placeholder="-100.00" />
              </label>
              <label className="field">
                Amount max
                <input type="text" name="amountMax" placeholder="" />
              </label>
              <label className="field">
                Only account
                <select name="accountId" defaultValue="">
                  <option value="">any</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Priority
                <input type="number" name="priority" defaultValue={100} />
              </label>
              <button className="btn primary">Add rule</button>
            </div>
          </form>
          <form action={applyRulesAction} style={{ marginTop: 10 }}>
            <button className="btn small">Apply rules to all uncategorized transactions</button>
          </form>
        </div>
      </div>

      <div className="section">
        <h2>Import formats</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Format</th>
                <th>Detected by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.isBuiltin ? (
                      <span className="chip" style={{ marginLeft: 6 }}>
                        built-in
                      </span>
                    ) : null}
                  </td>
                  <td className="small">
                    {p.format.toUpperCase()}
                    {p.config
                      ? ` · ${p.config.dateFormat} · ${p.config.amountConvention.replace(/_/g, " ")}`
                      : ""}
                  </td>
                  <td className="small muted">{p.config?.signature.join(", ") ?? "file header"}</td>
                  <td>
                    {!p.isBuiltin ? (
                      <form action={deleteProfileAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn link small">delete</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
