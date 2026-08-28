"use client";
import { useState, useTransition } from "react";
import { setCategoryAction } from "@/app/transactions/actions";

export interface CategoryOption {
  id: string;
  label: string;
  group: string;
}

export function CategoryPicker({
  txnId,
  value,
  options,
  payeeDisplay,
  alwaysTitle,
}: {
  txnId: string;
  value: string | null;
  options: CategoryOption[];
  payeeDisplay: string;
  /** Tooltip for the "always" box; defaults to the payee-rule wording. */
  alwaysTitle?: string;
}) {
  const [current, setCurrent] = useState(value ?? "");
  const [always, setAlways] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select
        className="inline"
        value={current}
        disabled={pending}
        aria-label={`Category for ${payeeDisplay}`}
        onChange={(e) => {
          const next = e.target.value || null;
          setCurrent(e.target.value);
          start(async () => {
            const r = await setCategoryAction(txnId, next, always);
            setError(r.ok ? null : r.error);
          });
        }}
      >
        <option value="">Uncategorized</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <label
        className="small muted"
        title={alwaysTitle ?? `Create a rule so every “${payeeDisplay}” gets this category`}
      >
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />{" "}
        always
      </label>
      {error ? <span className="chip bad">{error}</span> : null}
    </span>
  );
}
