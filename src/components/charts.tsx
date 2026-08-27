"use client";
import { useId, useMemo, useState } from "react";
import { formatCents } from "@/domain/money";

/*
 * Small SVG chart kit following the data-viz spec: columns ≤ 24px with a 4px rounded data end and a
 * square baseline, 2px lines, ≥ 8px end markers ringed in the surface color, a 2px surface gap between
 * stacked segments, hairline solid gridlines, text in text tokens (never the series color), a legend
 * for two or more series, a per-mark / crosshair tooltip, and a table view under every chart.
 *
 * Marks can be links: pass `hrefs` (one per x position) and the mark becomes the way to zoom in.
 * Props stay serializable so server components can render these directly.
 */

export interface Series {
  key: string;
  color: string; // a CSS variable such as var(--viz-1)
}

interface Frame {
  W: number;
  H: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}
const FRAME: Frame = { W: 860, H: 260, padL: 60, padR: 16, padT: 16, padB: 30 };
const NARROW: Frame = { W: 430, H: 220, padL: 52, padR: 14, padT: 16, padB: 30 };

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}

export function compact(cents: number): string {
  const d = cents / 100;
  const abs = Math.abs(d);
  const s =
    abs >= 1_000_000
      ? `${(abs / 1_000_000).toFixed(1)}M`
      : abs >= 10_000
        ? `${Math.round(abs / 1000)}K`
        : abs >= 1000
          ? `${(abs / 1000).toFixed(1)}K`
          : `${Math.round(abs)}`;
  return `${d < 0 ? "−" : ""}$${s}`;
}

function yScale(lo: number, hi: number, f: Frame) {
  const span = Math.max(1, hi - lo);
  const step = niceStep(span / 4);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;
  const yOf = (v: number) =>
    f.padT + ((yMax - v) / Math.max(1, yMax - yMin)) * (f.H - f.padT - f.padB);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v);
  return { yOf, ticks, yMin, yMax };
}

/** Column with a rounded data end and a square baseline; handles negative values. */
function columnPath(x: number, y0: number, y1: number, w: number, r = 4): string {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const h = bottom - top;
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  if (y1 <= y0) {
    return `M${x},${bottom} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${bottom} Z`;
  }
  return `M${x},${top} V${bottom - rr} Q${x},${bottom} ${x + rr},${bottom} H${x + w - rr} Q${x + w},${bottom} ${x + w},${bottom - rr} V${top} Z`;
}

function Grid({ ticks, yOf, f }: { ticks: number[]; yOf: (v: number) => number; f: Frame }) {
  return (
    <>
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={f.padL}
            x2={f.W - f.padR}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="var(--rule)"
            strokeWidth={1}
          />
          <text x={f.padL - 8} y={yOf(v) + 4} textAnchor="end" fill="var(--muted)">
            {compact(v)}
          </text>
        </g>
      ))}
    </>
  );
}

function XLabels({
  labels,
  xCenter,
  f,
}: {
  labels: string[];
  xCenter: (i: number) => number;
  f: Frame;
}) {
  const every = labels.length > 20 ? 5 : labels.length > 14 ? 3 : labels.length > 8 ? 2 : 1;
  return (
    <>
      {labels.map((l, i) =>
        i % every === 0 || i === labels.length - 1 ? (
          <text key={i} x={xCenter(i)} y={f.H - 10} textAnchor="middle" fill="var(--muted)">
            {l}
          </text>
        ) : null,
      )}
    </>
  );
}

function Tip({
  title,
  rows,
  left,
  hint,
}: {
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  left: number;
  hint?: string;
}) {
  return (
    <div className="tip" style={{ top: 8, left: `${Math.min(78, Math.max(2, left))}%` }}>
      <div className="t">{title}</div>
      {rows.map((r, i) => (
        <div className="r" key={i}>
          <span>
            {r.color ? <i style={{ background: r.color }} /> : null}
            {r.label}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
      {hint ? (
        <div className="t" style={{ marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Legend({ series, kind = "rect" }: { series: Series[]; kind?: "rect" | "line" }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}>
          <i className={kind} style={{ background: s.color }} />
          {s.key}
        </span>
      ))}
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details>
      <summary>View as table</summary>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={i > 0 ? "num" : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={j > 0 ? "num" : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Wrap marks in an SVG link when a target exists. */
function MaybeLink({
  href,
  title,
  children,
}: {
  href?: string;
  title?: string;
  children: React.ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} style={{ cursor: "pointer" }} aria-label={title}>
      {children}
    </a>
  );
}

function Head({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="chart-head">
      <h3>
        {title}
        {subtitle ? <span className="muted small"> · {subtitle}</span> : null}
      </h3>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ columns */

export interface ColumnDatum {
  label: string;
  values: Record<string, number>;
  /** Extra rows shown in the tooltip only. */
  extra?: Array<{ label: string; value: number }>;
  note?: string;
  /** Zoom target for this x position. */
  href?: string;
  /** Zoom targets per series key (stacked segments). */
  segmentHrefs?: Record<string, string>;
}

export function Columns({
  title,
  data,
  series,
  mode,
  subtitle,
  width = 860,
}: {
  title: string;
  data: ColumnDatum[];
  series: Series[];
  mode: "grouped" | "stacked";
  subtitle?: string;
  width?: number;
}) {
  const f = width < 600 ? NARROW : FRAME;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const { yOf, ticks, xCenter, band } = useMemo(() => {
    let hi = 0;
    for (const d of data) {
      if (mode === "stacked")
        hi = Math.max(
          hi,
          series.reduce((s, sr) => s + Math.max(0, d.values[sr.key] ?? 0), 0),
        );
      else for (const sr of series) hi = Math.max(hi, d.values[sr.key] ?? 0);
    }
    const sc = yScale(0, hi, f);
    const band = (f.W - f.padL - f.padR) / Math.max(1, data.length);
    return { ...sc, band, xCenter: (i: number) => f.padL + band * (i + 0.5) };
  }, [data, series, mode, f]);
  const colW = Math.min(24, mode === "grouped" ? (band * 0.7) / series.length : band * 0.6);
  const h = hover != null ? data[hover] : null;
  const clickable = data.some((d) => d.href || d.segmentHrefs);
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head title={title} subtitle={subtitle} right={<Legend series={series} />} />
      <svg
        viewBox={`0 0 ${f.W} ${f.H}`}
        role="img"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
      >
        <title id={id}>{title}</title>
        <Grid ticks={ticks} yOf={yOf} f={f} />
        {data.map((d, i) => {
          const cx = xCenter(i);
          const dim = hover != null && hover !== i ? 0.55 : 1;
          const marks: React.ReactNode[] = [];
          if (mode === "grouped") {
            const total = series.length * colW + (series.length - 1) * 2;
            series.forEach((sr, k) => {
              const v = d.values[sr.key] ?? 0;
              const x = cx - total / 2 + k * (colW + 2);
              marks.push(
                <path
                  key={sr.key}
                  d={columnPath(x, yOf(0), yOf(v), colW)}
                  fill={sr.color}
                  opacity={dim}
                />,
              );
            });
          } else {
            let acc = 0;
            const positives = series.filter((sr) => (d.values[sr.key] ?? 0) > 0);
            positives.forEach((sr, k) => {
              const v = d.values[sr.key] ?? 0;
              const y1 = yOf(acc + v);
              const y0 = yOf(acc);
              const isTop = k === positives.length - 1;
              const bottom = isTop ? y0 : y0 - 2; // 2px surface gap between segments
              const seg = isTop ? (
                <path
                  d={columnPath(cx - colW / 2, bottom, y1, colW)}
                  fill={sr.color}
                  opacity={dim}
                />
              ) : (
                <rect
                  x={cx - colW / 2}
                  y={y1}
                  width={colW}
                  height={Math.max(0, bottom - y1)}
                  fill={sr.color}
                  opacity={dim}
                />
              );
              marks.push(
                <MaybeLink
                  key={sr.key}
                  href={d.segmentHrefs?.[sr.key]}
                  title={`${sr.key}, ${d.label}`}
                >
                  {seg}
                </MaybeLink>,
              );
              acc += v;
            });
          }
          return (
            <g key={i}>
              <MaybeLink href={d.href} title={d.label}>
                <rect
                  x={cx - band / 2}
                  y={f.padT}
                  width={band}
                  height={f.H - f.padT - f.padB}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
                {mode === "grouped" ? marks : null}
              </MaybeLink>
              {mode === "stacked" ? <g onMouseEnter={() => setHover(i)}>{marks}</g> : null}
            </g>
          );
        })}
        <line
          x1={f.padL}
          x2={f.W - f.padR}
          y1={yOf(0)}
          y2={yOf(0)}
          stroke="var(--muted)"
          strokeWidth={1}
        />
        <XLabels labels={data.map((d) => d.label)} xCenter={xCenter} f={f} />
      </svg>
      {h && hover != null ? (
        <Tip
          title={h.note ? `${h.label} · ${h.note}` : h.label}
          left={(xCenter(hover) / f.W) * 100}
          rows={[
            ...series.map((sr) => ({
              label: sr.key,
              value: formatCents(h.values[sr.key] ?? 0),
              color: sr.color,
            })),
            ...(h.extra ?? []).map((e) => ({ label: e.label, value: formatCents(e.value) })),
          ]}
          hint={
            clickable
              ? mode === "stacked" && h.segmentHrefs
                ? "click a segment to zoom in"
                : h.href
                  ? "click to zoom in"
                  : undefined
              : undefined
          }
        />
      ) : null}
      <Table
        columns={[
          "Month",
          ...series.map((s) => s.key),
          ...(data[0]?.extra ?? []).map((e) => e.label),
        ]}
        rows={data.map((d) => [
          d.label,
          ...series.map((s) => formatCents(d.values[s.key] ?? 0)),
          ...(d.extra ?? []).map((e) => formatCents(e.value)),
        ])}
      />
    </figure>
  );
}

/* --------------------------------------------------------- diverging columns */

export function DivergingColumns({
  title,
  data,
  subtitle,
}: {
  title: string;
  data: Array<{ label: string; value: number; note?: string; href?: string }>;
  subtitle?: string;
}) {
  const f = FRAME;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const { yOf, ticks, xCenter, band } = useMemo(() => {
    const vals = data.map((d) => d.value);
    const sc = yScale(Math.min(0, ...vals), Math.max(0, ...vals), f);
    const band = (f.W - f.padL - f.padR) / Math.max(1, data.length);
    return { ...sc, band, xCenter: (i: number) => f.padL + band * (i + 0.5) };
  }, [data, f]);
  const colW = Math.min(24, band * 0.6);
  const h = hover != null ? data[hover] : null;
  const last = data[data.length - 1];
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head
        title={title}
        subtitle={subtitle}
        right={
          <div className="legend">
            <span>
              <i style={{ background: "var(--viz-pos)" }} /> money left over
            </span>
            <span>
              <i style={{ background: "var(--viz-neg)" }} /> spent more than earned
            </span>
            {data.some((d) => d.note) ? (
              <span>
                <i style={{ background: "var(--viz-pos)", opacity: 0.6 }} /> faded = partial
                coverage
              </span>
            ) : null}
          </div>
        }
      />
      <svg
        viewBox={`0 0 ${f.W} ${f.H}`}
        role="img"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
      >
        <title id={id}>{title}</title>
        <Grid ticks={ticks} yOf={yOf} f={f} />
        {data.map((d, i) => {
          const cx = xCenter(i);
          return (
            <MaybeLink key={i} href={d.href} title={d.label}>
              <g>
                <path
                  d={columnPath(cx - colW / 2, yOf(0), yOf(d.value), colW)}
                  fill={d.value >= 0 ? "var(--viz-pos)" : "var(--viz-neg)"}
                  opacity={(hover != null && hover !== i ? 0.55 : 1) * (d.note ? 0.6 : 1)}
                />
                <rect
                  x={cx - band / 2}
                  y={f.padT}
                  width={band}
                  height={f.H - f.padT - f.padB}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            </MaybeLink>
          );
        })}
        <line
          x1={f.padL}
          x2={f.W - f.padR}
          y1={yOf(0)}
          y2={yOf(0)}
          stroke="var(--muted)"
          strokeWidth={1}
        />
        {last ? (
          <text
            x={xCenter(data.length - 1)}
            y={yOf(last.value) + (last.value >= 0 ? -6 : 14)}
            textAnchor="middle"
            fill="var(--ink)"
          >
            {compact(last.value)}
          </text>
        ) : null}
        <XLabels labels={data.map((d) => d.label)} xCenter={xCenter} f={f} />
      </svg>
      {h && hover != null ? (
        <Tip
          title={h.note ? `${h.label} · ${h.note}` : h.label}
          left={(xCenter(hover) / f.W) * 100}
          rows={[{ label: "Headroom", value: formatCents(h.value) }]}
          hint={h.href ? "click to zoom in" : undefined}
        />
      ) : null}
      <Table
        columns={["Month", "Headroom"]}
        rows={data.map((d) => [d.note ? `${d.label} (${d.note})` : d.label, formatCents(d.value)])}
      />
    </figure>
  );
}

/* ---------------------------------------------------------- horizontal bars */

export function HBars({
  title,
  data,
  subtitle,
  color = "var(--viz-1)",
  width = 860,
}: {
  title: string;
  data: Array<{
    label: string;
    value: number;
    detail?: Array<{ label: string; value: number }>;
    href?: string;
  }>;
  subtitle?: string;
  color?: string;
  /** viewBox width; use ~430 when the chart sits in a half-width card so type stays legible. */
  width?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const rowH = 30;
  const W = width;
  const narrow = W < 600;
  const padL = narrow ? 118 : 150,
    padR = narrow ? 74 : 90,
    padT = 8,
    padB = 8;
  const H = padT + padB + rowH * Math.max(1, data.length);
  const max = Math.max(1, ...data.map((d) => d.value));
  const xOf = (v: number) => padL + (v / max) * (W - padL - padR);
  const h = hover != null ? data[hover] : null;
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head title={title} subtitle={subtitle} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
      >
        <title id={id}>{title}</title>
        {data.map((d, i) => {
          const y = padT + i * rowH + (rowH - 20) / 2;
          const w = Math.max(0, xOf(d.value) - padL);
          const r = Math.min(4, w / 2);
          return (
            <MaybeLink key={i} href={d.href} title={d.label}>
              <g onMouseEnter={() => setHover(i)}>
                <rect x={0} y={padT + i * rowH} width={W} height={rowH} fill="transparent" />
                <text
                  x={padL - 10}
                  y={y + 14}
                  textAnchor="end"
                  fill={d.href ? "var(--accent)" : "var(--ink)"}
                >
                  {d.label.length > (narrow ? 16 : 22)
                    ? `${d.label.slice(0, narrow ? 15 : 21)}…`
                    : d.label}
                </text>
                <path
                  d={`M${padL},${y} H${padL + w - r} Q${padL + w},${y} ${padL + w},${y + r} V${y + 20 - r} Q${padL + w},${y + 20} ${padL + w - r},${y + 20} H${padL} Z`}
                  fill={color}
                  opacity={hover != null && hover !== i ? 0.55 : 1}
                />
                <text x={padL + w + 8} y={y + 14} fill="var(--ink)">
                  {formatCents(d.value)}
                </text>
              </g>
            </MaybeLink>
          );
        })}
      </svg>
      {h && hover != null ? (
        <Tip
          title={h.label}
          left={40}
          rows={[
            { label: "Total", value: formatCents(h.value) },
            ...(h.detail ?? [])
              .slice(0, 6)
              .map((x) => ({ label: x.label, value: formatCents(x.value) })),
          ]}
          hint={h.href ? "click to zoom in" : undefined}
        />
      ) : null}
      <Table
        columns={["Category", "Amount"]}
        rows={data.flatMap((d) => [
          [d.label, formatCents(d.value)],
          ...(d.detail ?? []).map((x) => [`   ${x.label}`, formatCents(x.value)]),
        ])}
      />
    </figure>
  );
}

/* -------------------------------------------------------------------- lines */

export interface LineDatum {
  label: string;
  values: Record<string, number | null>;
  note?: string;
  href?: string;
}

export function Lines({
  title,
  data,
  series,
  subtitle,
  width = 860,
  xTitle = "Month",
}: {
  title: string;
  data: LineDatum[];
  series: Series[];
  subtitle?: string;
  width?: number;
  xTitle?: string;
}) {
  const f = width < 600 ? NARROW : FRAME;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const { xs, ticks, yOf, paths, area, yMin } = useMemo(() => {
    const vals = data.flatMap((d) =>
      series.map((s) => d.values[s.key]).filter((v): v is number => v != null),
    );
    const sc = yScale(Math.min(0, ...vals), Math.max(0, ...vals), f);
    const xs = data.map(
      (_, i) => f.padL + (i / Math.max(1, data.length - 1)) * (f.W - f.padL - f.padR),
    );
    const paths = series.map((s) => {
      let d = "";
      let pen = false;
      data.forEach((row, i) => {
        const v = row.values[s.key];
        if (v == null) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${xs[i]!.toFixed(1)},${sc.yOf(v).toFixed(1)} `;
        pen = true;
      });
      return d;
    });
    // Area wash only for a single series.
    let area = "";
    if (series.length === 1 && data.length > 1) {
      const pts = data
        .map((row, i) => [xs[i]!, row.values[series[0]!.key]] as const)
        .filter((p): p is readonly [number, number] => p[1] != null);
      if (pts.length > 1)
        area = `M${pts.map((p) => `${p[0].toFixed(1)},${sc.yOf(p[1]).toFixed(1)}`).join(" L")} L${pts[pts.length - 1]![0].toFixed(1)},${sc.yOf(sc.yMin)} L${pts[0]![0].toFixed(1)},${sc.yOf(sc.yMin)} Z`;
    }
    return { xs, ticks: sc.ticks, yOf: sc.yOf, paths, area, yMin: sc.yMin };
  }, [data, series, f]);
  void yMin;
  const h = hover != null ? data[hover] : null;
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head title={title} subtitle={subtitle} right={<Legend series={series} kind="line" />} />
      <svg
        viewBox={`0 0 ${f.W} ${f.H}`}
        role="img"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * f.W;
          let best = 0;
          for (let i = 1; i < xs.length; i++)
            if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
          setHover(best);
        }}
      >
        <title id={id}>{title}</title>
        <Grid ticks={ticks} yOf={yOf} f={f} />
        {area ? <path d={area} fill={series[0]!.color} opacity={0.1} /> : null}
        {series.map((s, k) => (
          <path
            key={s.key}
            d={paths[k]}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {(() => {
          // End marker + direct label on the last present value of each series. When end labels would
          // collide, only the first (subject) series keeps its label — the legend and tooltip carry the rest.
          const placed: number[] = [];
          return series.map((s) => {
            let li = -1;
            for (let i = data.length - 1; i >= 0; i--)
              if (data[i]!.values[s.key] != null) {
                li = i;
                break;
              }
            if (li < 0) return null;
            const v = data[li]!.values[s.key]!;
            const y = yOf(v);
            const labelFits = placed.every((py) => Math.abs(py - y) >= 14);
            if (labelFits) placed.push(y);
            return (
              <g key={s.key}>
                <circle
                  cx={xs[li]}
                  cy={y}
                  r={4}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                {labelFits ? (
                  <text x={xs[li]! - 8} y={y - 10} textAnchor="end" fill="var(--ink)">
                    {compact(v)}
                  </text>
                ) : null}
              </g>
            );
          });
        })()}
        {hover != null ? (
          <g>
            <line
              x1={xs[hover]}
              x2={xs[hover]}
              y1={f.padT}
              y2={f.H - f.padB}
              stroke="var(--muted)"
              strokeWidth={1}
            />
            {series.map((s) => {
              const v = data[hover]!.values[s.key];
              return v == null ? null : (
                <circle
                  key={s.key}
                  cx={xs[hover]}
                  cy={yOf(v)}
                  r={5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        ) : null}
        {/* Click targets per x position when zoomable. */}
        {data.map((d, i) =>
          d.href ? (
            <a key={i} href={d.href} aria-label={d.label} style={{ cursor: "pointer" }}>
              <rect
                x={i === 0 ? f.padL : (xs[i - 1]! + xs[i]!) / 2}
                y={f.padT}
                width={
                  i === 0
                    ? xs[1] != null
                      ? (xs[1] - xs[0]!) / 2
                      : f.W - f.padL - f.padR
                    : i === data.length - 1
                      ? f.W - f.padR - (xs[i - 1]! + xs[i]!) / 2
                      : (xs[i + 1]! - xs[i - 1]!) / 2
                }
                height={f.H - f.padT - f.padB}
                fill="transparent"
              />
            </a>
          ) : null,
        )}
        <XLabels labels={data.map((d) => d.label)} xCenter={(i) => xs[i] ?? 0} f={f} />
      </svg>
      {h && hover != null ? (
        <Tip
          title={h.note ? `${h.label} · ${h.note}` : h.label}
          left={(xs[hover]! / f.W) * 100}
          rows={series.map((s) => ({
            label: s.key,
            value: h.values[s.key] == null ? "—" : formatCents(h.values[s.key]!),
            color: s.color,
          }))}
          hint={h.href ? "click to zoom in" : undefined}
        />
      ) : null}
      <Table
        columns={[xTitle, ...series.map((s) => s.key)]}
        rows={data.map((d) => [
          d.label,
          ...series.map((s) => (d.values[s.key] == null ? "—" : formatCents(d.values[s.key]!))),
        ])}
      />
    </figure>
  );
}
