import { formatCents, maskCents } from "@/domain/money";

/**
 * A dollar figure that honors the hide-amounts switch. Both the value and its mask are in the
 * markup; CSS shows one or the other off `html[data-privacy]`, so server components can use this
 * anywhere text goes and nothing re-renders when the switch flips.
 */
export function Amount({
  cents,
  sign = false,
  currency = "USD",
  className,
}: {
  cents: number;
  sign?: boolean;
  currency?: string;
  className?: string;
}) {
  return (
    <span className={className ? `amt ${className}` : "amt"}>
      <span className="amt-v">{formatCents(cents, currency, { sign })}</span>
      <span className="amt-m" role="img" aria-label="amount hidden">
        {maskCents(cents, { sign })}
      </span>
    </span>
  );
}
