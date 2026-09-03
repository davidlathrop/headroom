"use client";
import { useMemo, useState } from "react";
import { type Basis, useAmountFormat } from "@/components/privacy";
import { formatISO } from "@/domain/dates";

export interface CurvePoint {
  date: string;
  balanceCents: number;
  events: Array<{ label: string; amountCents: number }>;
}

/**
 * 60-day projected cash balance. One series, so no legend; the title carries it.
 * Marks per the chart spec: 2px line, 10% area wash, hairline grid, ≥8px end markers with a surface ring,
 * a crosshair + tooltip on hover, and the lowest point directly labeled.
 * With amounts hidden the curve reads as % of today's cash (or of its peak when today is at or below zero).
 */
export function CashCurve({
  points,
  bufferCents,
  lowestDate,
}: {
  points: CurvePoint[];
  bufferCents: number;
  lowestDate: string | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 860,
    H = 260,
    padL = 64,
    padR = 16,
    padT = 16,
    padB = 32;
  const basis = useMemo<Basis | null>(() => {
    const first = points[0]?.balanceCents ?? 0;
    if (first > 0) return { value: first, label: "today's cash" };
    const peak = Math.max(0, ...points.map((p) => Math.abs(p.balanceCents)), Math.abs(bufferCents));
    return peak > 0 ? { value: peak, label: "the peak" } : null;
  }, [points, bufferCents]);
  const fmt = useAmountFormat(basis);
  const unit = fmt.unit;
  const { xs, ys, ticks, path, area, yOf } = useMemo(() => {
    const vals = points.map((p) => p.balanceCents);
    const lo = Math.min(0, bufferCents, ...vals) / unit;
    const hi = Math.max(bufferCents, ...vals) / unit;
    const span = Math.max(1, hi - lo);
    const step = niceStep(span / 4);
    const yMin = Math.floor(lo / step) * step;
    const yMax = Math.ceil(hi / step) * step;
    const yOf = (v: number) =>
      padT + ((yMax - v / unit) / Math.max(1, yMax - yMin)) * (H - padT - padB);
    const xOf = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - padR);
    const xs = points.map((_, i) => xOf(i));
    const ys = vals.map(yOf);
    const ticks: number[] = [];
    for (let v = yMin; v <= yMax; v += step) ticks.push(v * unit);
    const path = xs
      .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`)
      .join(" ");
    const floor = yOf(yMin * unit).toFixed(1);
    const area = `${path} L${xs[xs.length - 1]!.toFixed(1)},${floor} L${xs[0]!.toFixed(1)},${floor} Z`;
    return { xs, ys, ticks, path, area, yOf };
  }, [points, bufferCents, unit]);

  const lowestIdx = lowestDate ? points.findIndex((p) => p.date === lowestDate) : -1;
  const eventIdx = points.map((p, i) => (p.events.length ? i : -1)).filter((i) => i >= 0);
  const h = hover != null ? points[hover] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Projected cash balance over the next 60 days"
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          for (let i = 1; i < xs.length; i++)
            if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
          setHover(best);
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={yOf(v) + 4}
              textAnchor="end"
              fill="var(--muted)"
              className={fmt.cls}
            >
              {fmt.short(v)}
            </text>
          </g>
        ))}
        <line
          x1={padL}
          x2={W - padR}
          y1={yOf(bufferCents)}
          y2={yOf(bufferCents)}
          stroke="var(--amber)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text
          x={W - padR}
          y={yOf(bufferCents) - 5}
          textAnchor="end"
          fill="var(--muted)"
          className={fmt.cls}
        >
          buffer {fmt.short(bufferCents)}
        </text>
        {[0, 15, 30, 45, 60]
          .filter((i) => i < points.length)
          .map((i) => (
            <text
              key={i}
              x={xs[i]}
              y={H - 10}
              textAnchor={i === 0 ? "start" : i === 60 ? "end" : "middle"}
              fill="var(--muted)"
            >
              {i === 0 ? "today" : formatISO(points[i]!.date, "short")}
            </text>
          ))}
        <path d={area} fill="var(--accent)" opacity={0.1} />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {eventIdx.map((i) => (
          <circle
            key={i}
            cx={xs[i]}
            cy={ys[i]}
            r={3.5}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}
        {lowestIdx >= 0 && (
          <g>
            <circle
              cx={xs[lowestIdx]}
              cy={ys[lowestIdx]}
              r={5}
              fill="var(--amber)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
            <text
              x={xs[lowestIdx]}
              y={ys[lowestIdx]! + 18}
              textAnchor="middle"
              fill="var(--ink)"
              className={fmt.cls}
            >
              lowest {fmt.short(points[lowestIdx]!.balanceCents)}
            </text>
          </g>
        )}
        <circle
          cx={xs[xs.length - 1]}
          cy={ys[ys.length - 1]}
          r={4}
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth={2}
        />
        {hover != null && (
          <g>
            <line
              x1={xs[hover]}
              x2={xs[hover]}
              y1={padT}
              y2={H - padB}
              stroke="var(--muted)"
              strokeWidth={1}
            />
            <circle
              cx={xs[hover]}
              cy={ys[hover]}
              r={5}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      {fmt.note ? (
        <div className="muted small" style={{ marginTop: 4 }}>
          Balances {fmt.note}
        </div>
      ) : null}
      {h && hover != null ? (
        <div
          className="card small"
          style={{
            position: "absolute",
            top: 8,
            left: `${Math.min(80, (xs[hover]! / W) * 100)}%`,
            padding: "8px 10px",
            pointerEvents: "none",
            minWidth: 180,
          }}
        >
          <div className="muted">{formatISO(h.date)}</div>
          <div className="num" style={{ fontWeight: 600 }}>
            {fmt.full(h.balanceCents)}
          </div>
          {h.events.map((e, i) => (
            <div key={i} className="num muted">
              {e.label} {fmt.full(e.amountCents, { sign: true })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}
