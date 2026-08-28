"use client";
import { useRouter } from "next/navigation";
import { formatMonth } from "@/domain/dates";

/** A month dropdown that navigates to `${basePath}?month=YYYY-MM` on change. */
export function MonthPicker({
  months,
  value,
  basePath,
}: {
  months: string[];
  value: string;
  basePath: string;
}) {
  const router = useRouter();
  return (
    <select
      className="inline"
      aria-label="Month"
      value={value}
      onChange={(e) => router.push(`${basePath}?month=${e.target.value}`)}
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {formatMonth(m)}
        </option>
      ))}
    </select>
  );
}
