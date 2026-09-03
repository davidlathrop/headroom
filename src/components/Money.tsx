import { Amount } from "./Amount";

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
    <Amount
      cents={cents}
      sign={sign}
      currency={currency}
      className={`num ${cls} ${className}`.trim()}
    />
  );
}
