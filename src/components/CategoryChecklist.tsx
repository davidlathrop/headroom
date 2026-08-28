import type { Category } from "@/db/schema";

/**
 * The category picker inside a budget form: every money-out group with its categories, each
 * with a checkbox (`category`) and an optional monthly target (`target:<id>`). Plain form
 * fields, so the surrounding server-action form does the rest. Ticking a whole group counts
 * everything in it as one line; the service then ignores any of its categories ticked too.
 */
export function CategoryChecklist({
  groups,
  selected,
}: {
  groups: Array<{ group: Category; children: Category[] }>;
  /** categoryId → target cents (null = ticked, no target). */
  selected: Map<string, number | null>;
}) {
  const Row = ({ c, whole }: { c: Category; whole?: boolean }) => {
    const on = selected.has(c.id);
    const target = selected.get(c.id) ?? null;
    return (
      <div className={`pick-row${whole ? " whole" : ""}`}>
        <label>
          <input type="checkbox" name="category" value={c.id} defaultChecked={on} />{" "}
          {whole ? `All of ${c.name}` : c.name}
          {!whole && c.spendType ? <span className="chip">{c.spendType}</span> : null}
        </label>
        <input
          type="text"
          name={`target:${c.id}`}
          inputMode="decimal"
          placeholder="target (optional)"
          aria-label={`Monthly target for ${c.name}`}
          defaultValue={target == null ? "" : (target / 100).toFixed(2)}
        />
      </div>
    );
  };
  return (
    <div className="pick">
      {groups.map(({ group, children }) => (
        <div className="pick-group" key={group.id}>
          <div className="pick-head">
            {group.name} <span className="chip">{group.flow}</span>
          </div>
          <Row c={group} whole />
          {children.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </div>
      ))}
    </div>
  );
}
