import { formatCents } from "@/domain/money";

export function Money({
  cents,
  sign = false,
  currency = "USD",
  className = "",
}: {
  cents: number;
  sign?: boolean;
  currency?: string;
  className?: string;
}) {
  const cls = cents > 0 ? "money-pos" : "money-neg";
  return (
    <span className={`num ${cls} ${className}`.trim()}>
      {formatCents(cents, currency, { sign })}
    </span>
  );
}
