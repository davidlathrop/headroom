import { formatCents } from "@/domain/money";

export function Stat({
  label,
  cents,
  hint,
  tone,
}: {
  label: string;
  cents: number;
  hint?: string;
  tone?: "headroom" | "neg";
}) {
  const cls = [
    "stat",
    tone === "headroom" ? (cents < 0 ? "neg" : "headroom") : tone === "neg" ? "neg" : "",
  ].join(" ");
  return (
    <div className={`card ${cls}`}>
      <span className="label">{label}</span>
      <span className="value">{formatCents(cents)}</span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
