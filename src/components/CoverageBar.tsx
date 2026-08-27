import { diffDays } from "@/domain/dates";

export function CoverageBar({
  windows,
  rangeStart,
  rangeEnd,
}: {
  windows: Array<{ start: string; end: string }>;
  rangeStart: string;
  rangeEnd: string;
}) {
  const total = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);
  return (
    <div className="coverage" title={`${rangeStart} → ${rangeEnd}`}>
      {windows.map((w, i) => {
        const left = (Math.max(0, diffDays(rangeStart, w.start)) / total) * 100;
        const width =
          ((diffDays(
            w.start < rangeStart ? rangeStart : w.start,
            w.end > rangeEnd ? rangeEnd : w.end,
          ) +
            1) /
            total) *
          100;
        return <span key={i} style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%` }} />;
      })}
    </div>
  );
}
