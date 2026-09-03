"use client";
import { useId, useMemo, useState } from "react";
import { type AmountFormat, type Basis, useAmountFormat } from "@/components/privacy";
import { maskCents } from "@/domain/money";

/*
 * Small SVG chart kit following the data-viz spec: columns ≤ 24px with a 4px rounded data end and a
 * square baseline, 2px lines, ≥ 8px end markers ringed in the surface color, a 2px surface gap between
 * stacked segments, hairline solid gridlines, text in text tokens (never the series color), a legend
 * for two or more series, a per-mark / crosshair tooltip, and a table view under every chart.
 *
 * Marks can be links: pass `hrefs` (one per x position) and the mark becomes the way to zoom in.
 * Props stay serializable so server components can render these directly.
 *
 * Every chart formats amounts through useAmountFormat: dollars normally, and with amounts hidden
 * percentages of a basis the chart names in its head (the target, income, the peak month, the total).
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

function yScale(lo: number, hi: number, f: Frame, unit = 1) {
  const span = Math.max(1, (hi - lo) / unit);
  const step = niceStep(span / 4);
  const yMin = Math.floor(lo / unit / step) * step;
  const yMax = Math.ceil(hi / unit / step) * step;
  const yOf = (v: number) =>
    f.padT + ((yMax - v / unit) / Math.max(1, yMax - yMin)) * (f.H - f.padT - f.padB);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax; v += step) ticks.push(v * unit);
  return { yOf, ticks, yMin: yMin * unit, yMax: yMax * unit };
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

function Grid({
  ticks,
  yOf,
  f,
  fmt,
}: {
  ticks: number[];
  yOf: (v: number) => number;
  f: Frame;
  fmt: AmountFormat;
}) {
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
          <text
            x={f.padL - 8}
            y={yOf(v) + 4}
            textAnchor="end"
            fill="var(--muted)"
            className={fmt.cls}
          >
            {fmt.short(v)}
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
  // The last label always shows; a cadence label too close to it is dropped so they never collide.
  const last = labels.length - 1;
  return (
    <>
      {labels.map((l, i) =>
        i === last || (i % every === 0 && i < last - every / 2) ? (
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
  note,
  right,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** "as % of Income": what the numbers mean while amounts are hidden. */
  note?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <div className="chart-head">
      <h3>
        {title}
        {subtitle ? <span className="muted small"> · {subtitle}</span> : null}
        {note ? <span className="muted small"> · {note}</span> : null}
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
  refLine,
}: {
  title: string;
  data: ColumnDatum[];
  series: Series[];
  mode: "grouped" | "stacked";
  subtitle?: React.ReactNode;
  width?: number;
  /** A dashed horizontal reference (a target, a budget) drawn across the whole chart. */
  refLine?: { value: number; label: string };
}) {
  const f = width < 600 ? NARROW : FRAME;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  // With amounts hidden, bars read as % of the reference line, else of the tallest column.
  const basis = useMemo<Basis | null>(() => {
    if (refLine) return { value: refLine.value, label: refLine.label };
    let best: Basis | null = null;
    for (const d of data) {
      if (mode === "stacked") {
        const t = series.reduce((s, sr) => s + Math.max(0, d.values[sr.key] ?? 0), 0);
        if (!best || t > best.value) best = { value: t, label: d.label };
      } else {
        for (const sr of series) {
          const v = d.values[sr.key] ?? 0;
          if (!best || v > best.value)
            best = { value: v, label: series.length > 1 ? `${sr.key}, ${d.label}` : d.label };
        }
      }
    }
    return best;
  }, [data, series, mode, refLine]);
  const fmt = useAmountFormat(basis);
  const { yOf, ticks, xCenter, band } = useMemo(() => {
    let hi = refLine ? refLine.value : 0;
    for (const d of data) {
      if (mode === "stacked")
        hi = Math.max(
          hi,
          series.reduce((s, sr) => s + Math.max(0, d.values[sr.key] ?? 0), 0),
        );
      else for (const sr of series) hi = Math.max(hi, d.values[sr.key] ?? 0);
    }
    const sc = yScale(0, hi, f, fmt.unit);
    const band = (f.W - f.padL - f.padR) / Math.max(1, data.length);
    return { ...sc, band, xCenter: (i: number) => f.padL + band * (i + 0.5) };
  }, [data, series, mode, f, refLine, fmt.unit]);
  const colW = Math.min(24, mode === "grouped" ? (band * 0.7) / series.length : band * 0.6);
  const h = hover != null ? data[hover] : null;
  const clickable = data.some((d) => d.href || d.segmentHrefs);
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head title={title} subtitle={subtitle} note={fmt.note} right={<Legend series={series} />} />
      <svg
        viewBox={`0 0 ${f.W} ${f.H}`}
        role="img"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
      >
        <title id={id}>{title}</title>
        <Grid ticks={ticks} yOf={yOf} f={f} fmt={fmt} />
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
        {refLine ? (
          <g>
            <line
              x1={f.padL}
              x2={f.W - f.padR}
              y1={yOf(refLine.value)}
              y2={yOf(refLine.value)}
              stroke="var(--amber)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={f.W - f.padR}
              y={yOf(refLine.value) - 5}
              textAnchor="end"
              fill="var(--amber)"
              stroke="var(--surface)"
              strokeWidth={3}
              paintOrder="stroke"
              className={fmt.cls}
            >
              {refLine.label} {fmt.short(refLine.value)}
            </text>
          </g>
        ) : null}
        <XLabels labels={data.map((d) => d.label)} xCenter={xCenter} f={f} />
      </svg>
      {h && hover != null ? (
        <Tip
          title={h.note ? `${h.label} · ${h.note}` : h.label}
          left={(xCenter(hover) / f.W) * 100}
          rows={[
            ...series.map((sr) => ({
              label: sr.key,
              value: fmt.full(h.values[sr.key] ?? 0),
              color: sr.color,
            })),
            ...(h.extra ?? []).map((e) => ({ label: e.label, value: fmt.full(e.value) })),
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
          ...series.map((s) => fmt.full(d.values[s.key] ?? 0)),
          ...(d.extra ?? []).map((e) => fmt.full(e.value)),
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
  subtitle?: React.ReactNode;
}) {
  const f = FRAME;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  // Hidden amounts read as % of the largest month either way.
  const basis = useMemo<Basis | null>(() => {
    let best: Basis | null = null;
    for (const d of data)
      if (!best || Math.abs(d.value) > best.value)
        best = { value: Math.abs(d.value), label: d.label };
    return best;
  }, [data]);
  const fmt = useAmountFormat(basis);
  const { yOf, ticks, xCenter, band } = useMemo(() => {
    const vals = data.map((d) => d.value);
    const sc = yScale(Math.min(0, ...vals), Math.max(0, ...vals), f, fmt.unit);
    const band = (f.W - f.padL - f.padR) / Math.max(1, data.length);
    return { ...sc, band, xCenter: (i: number) => f.padL + band * (i + 0.5) };
  }, [data, f, fmt.unit]);
  const colW = Math.min(24, band * 0.6);
  const h = hover != null ? data[hover] : null;
  const last = data[data.length - 1];
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head
        title={title}
        subtitle={subtitle}
        note={fmt.note}
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
        <Grid ticks={ticks} yOf={yOf} f={f} fmt={fmt} />
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
            className={fmt.cls}
          >
            {fmt.short(last.value)}
          </text>
        ) : null}
        <XLabels labels={data.map((d) => d.label)} xCenter={xCenter} f={f} />
      </svg>
      {h && hover != null ? (
        <Tip
          title={h.note ? `${h.label} · ${h.note}` : h.label}
          left={(xCenter(hover) / f.W) * 100}
          rows={[{ label: "Headroom", value: fmt.full(h.value) }]}
          hint={h.href ? "click to zoom in" : undefined}
        />
      ) : null}
      <Table
        columns={["Month", "Headroom"]}
        rows={data.map((d) => [d.note ? `${d.label} (${d.note})` : d.label, fmt.full(d.value)])}
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
  total,
}: {
  title: string;
  data: Array<{
    label: string;
    value: number;
    detail?: Array<{ label: string; value: number }>;
    href?: string;
    /** Overrides the chart color for this bar (e.g. to mute bars outside a selection). */
    color?: string;
    /** Appended after the value label ("42%"). */
    suffix?: string;
  }>;
  subtitle?: React.ReactNode;
  color?: string;
  /** viewBox width; use ~430 when the chart sits in a half-width card so type stays legible. */
  width?: number;
  /** The whole these bars are part of, for the shares shown when amounts are hidden. Defaults to their sum. */
  total?: Basis;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const sum = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const fmt = useAmountFormat(total ?? { value: sum, label: "the total" });
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
      <Head title={title} subtitle={subtitle} note={fmt.note} />
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
                  fill={d.color ?? color}
                  opacity={hover != null && hover !== i ? 0.55 : 1}
                />
                <text x={padL + w + 8} y={y + 14} fill="var(--ink)" className={fmt.cls}>
                  {fmt.full(d.value)}
                  {d.suffix && !fmt.hidden ? <tspan fill="var(--muted)"> {d.suffix}</tspan> : null}
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
            { label: "Total", value: fmt.full(h.value) },
            ...(h.detail ?? [])
              .slice(0, 6)
              .map((x) => ({ label: x.label, value: fmt.full(x.value) })),
          ]}
          hint={h.href ? "click to zoom in" : undefined}
        />
      ) : null}
      <Table
        columns={["Category", "Amount"]}
        rows={data.flatMap((d) => [
          [d.label, fmt.full(d.value)],
          ...(d.detail ?? []).map((x) => [`   ${x.label}`, fmt.full(x.value)]),
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
  subtitle?: React.ReactNode;
  width?: number;
  xTitle?: string;
}) {
  const f = width < 600 ? NARROW : FRAME;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  // Hidden amounts read as % of the highest point on any line.
  const basis = useMemo<Basis | null>(() => {
    let best: Basis | null = null;
    for (const d of data)
      for (const s of series) {
        const v = d.values[s.key];
        if (v == null || (best && Math.abs(v) <= best.value)) continue;
        const at = xTitle === "Month" ? d.label : `${xTitle.toLowerCase()} ${d.label}`;
        best = { value: Math.abs(v), label: series.length > 1 ? `${s.key}, ${at}` : at };
      }
    return best;
  }, [data, series, xTitle]);
  const fmt = useAmountFormat(basis);
  const { xs, ticks, yOf, paths, area, yMin } = useMemo(() => {
    const vals = data.flatMap((d) =>
      series.map((s) => d.values[s.key]).filter((v): v is number => v != null),
    );
    const sc = yScale(Math.min(0, ...vals), Math.max(0, ...vals), f, fmt.unit);
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
  }, [data, series, f, fmt.unit]);
  void yMin;
  const h = hover != null ? data[hover] : null;
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head
        title={title}
        subtitle={subtitle}
        note={fmt.note}
        right={<Legend series={series} kind="line" />}
      />
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
        <Grid ticks={ticks} yOf={yOf} f={f} fmt={fmt} />
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
            // A peak that lands on the top gridline (always so as a percentage) keeps its label in frame.
            const ly = Math.max(y - 10, f.padT - 4);
            const labelFits = placed.every((py) => Math.abs(py - ly) >= 14);
            if (labelFits) placed.push(ly);
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
                  <text
                    x={xs[li]! - 8}
                    y={ly}
                    textAnchor="end"
                    fill="var(--ink)"
                    className={fmt.cls}
                  >
                    {fmt.short(v)}
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
            value: h.values[s.key] == null ? "—" : fmt.full(h.values[s.key]!),
            color: s.color,
          }))}
          hint={h.href ? "click to zoom in" : undefined}
        />
      ) : null}
      <Table
        columns={[xTitle, ...series.map((s) => s.key)]}
        rows={data.map((d) => [
          d.label,
          ...series.map((s) => (d.values[s.key] == null ? "—" : fmt.full(d.values[s.key]!))),
        ])}
      />
    </figure>
  );
}

/* -------------------------------------------------------------------- donut */

export interface DonutSlice {
  label: string;
  value: number;
  /** Rows shown in the tooltip and the table (the members of an "Other" slice). */
  detail?: Array<{ label: string; value: number }>;
  href?: string;
}

function arcPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 0.0001); // a lone slice still needs a closed ring
  const end = a0 + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const pt = (rad: number, a: number) =>
    `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  return `M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, end)} L${pt(r, end)} A${r},${r} 0 ${large} 0 ${pt(r, a0)} Z`;
}

/**
 * Part-to-whole at a glance: at most six slices plus Other (fold with foldSlices), a 2px surface
 * gap between slices, the total as the hero number in the middle, identity carried by the legend
 * (swatch + name + value + share — never text in the series color), hover tooltip, table view.
 */
export function Donut({
  title,
  subtitle,
  data,
  centerLabel,
  colors = [
    "var(--viz-1)",
    "var(--viz-2)",
    "var(--viz-3)",
    "var(--viz-4)",
    "var(--viz-5)",
    "var(--viz-6)",
  ],
}: {
  title: string;
  subtitle?: React.ReactNode;
  data: DonutSlice[];
  centerLabel: string;
  colors?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const fmt = useAmountFormat({ value: total, label: centerLabel });
  const S = 196,
    cx = S / 2,
    cy = S / 2,
    R = 90,
    r = 58;
  let a = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = total > 0 ? Math.max(0, d.value) / total : 0;
    const a0 = a;
    a += frac * Math.PI * 2;
    return {
      ...d,
      i,
      a0,
      a1: a,
      frac,
      color: d.label === "Other" ? "var(--viz-other)" : colors[i % colors.length]!,
    };
  });
  const h = hover != null ? slices[hover] : null;
  const pctOf = (sl: { frac: number }) => `${Math.round(sl.frac * 100)}%`;
  // The hero number: a slice's share on hover; at rest the total, which has no percentage to become.
  const hero = h
    ? fmt.hidden
      ? pctOf(h)
      : fmt.short(h.value)
    : fmt.hidden
      ? maskCents(total)
      : fmt.short(total);
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head title={title} subtitle={subtitle} note={fmt.note} />
      <div className="donut">
        <svg
          viewBox={`0 0 ${S} ${S}`}
          role="img"
          aria-labelledby={id}
          style={{ width: S, maxWidth: "100%", flex: "none" }}
          onMouseLeave={() => setHover(null)}
        >
          <title id={id}>{title}</title>
          {total === 0 ? (
            <circle
              cx={cx}
              cy={cy}
              r={(R + r) / 2}
              fill="none"
              stroke="var(--surface-2)"
              strokeWidth={R - r}
            />
          ) : (
            slices.map((sl) => (
              <MaybeLink key={sl.i} href={sl.href} title={`${sl.label}: ${fmt.full(sl.value)}`}>
                <path
                  d={arcPath(cx, cy, R, r, sl.a0, sl.a1)}
                  fill={sl.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  opacity={hover != null && hover !== sl.i ? 0.45 : 1}
                  onMouseEnter={() => setHover(sl.i)}
                />
              </MaybeLink>
            ))
          )}
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="var(--ink)"
            style={{ fontSize: 22, fontWeight: 600 }}
            className={fmt.cls}
          >
            {hero}
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--muted)">
            {h ? (fmt.hidden ? h.label : `${h.label} · ${pctOf(h)}`) : centerLabel}
          </text>
        </svg>
        <ul className="donut-legend">
          {slices.map((sl) => (
            <li
              key={sl.i}
              onMouseEnter={() => setHover(sl.i)}
              onMouseLeave={() => setHover(null)}
              style={{ opacity: hover != null && hover !== sl.i ? 0.55 : 1 }}
            >
              <i style={{ background: sl.color }} />
              <span className="name">{sl.href ? <a href={sl.href}>{sl.label}</a> : sl.label}</span>
              {fmt.hidden ? null : <span className="num amt-v">{fmt.full(sl.value)}</span>}
              <span className="num muted">{pctOf(sl)}</span>
            </li>
          ))}
          {slices.length === 0 ? <li className="muted">Nothing spent yet.</li> : null}
        </ul>
      </div>
      {h && h.detail && h.detail.length ? (
        <Tip
          title={`${h.label} · ${fmt.full(h.value)}`}
          left={4}
          rows={h.detail.slice(0, 8).map((d) => ({ label: d.label, value: fmt.full(d.value) }))}
        />
      ) : null}
      {fmt.hidden ? (
        <Table
          columns={["Category", "Share"]}
          rows={slices.flatMap((sl) => [
            [sl.label, fmt.full(sl.value)],
            ...(sl.detail ?? []).map((d) => [`   ${d.label}`, fmt.full(d.value)]),
          ])}
        />
      ) : (
        <Table
          columns={["Category", "Amount", "Share"]}
          rows={slices.flatMap((sl) => [
            [sl.label, fmt.full(sl.value), pctOf(sl)],
            ...(sl.detail ?? []).map((d) => [`   ${d.label}`, fmt.full(d.value), ""]),
          ])}
        />
      )}
    </figure>
  );
}

/* ------------------------------------------------------------ stacked hbars */

export interface StackedRow {
  label: string;
  values: Record<string, number>;
  note?: string;
}

/**
 * A few magnitudes side by side, each optionally split into parts (Income vs Spent = fixed +
 * variable). Horizontal so the labels read; <= 24px bars, 2px surface gap between parts, rounded
 * data end; totals labeled at the end of each bar; legend for the parts; hover tooltip; table.
 */
export function StackedHBars({
  title,
  subtitle,
  rows,
  series,
  width = 430,
}: {
  title: string;
  subtitle?: React.ReactNode;
  rows: StackedRow[];
  series: Array<Series & { opacity?: number }>;
  width?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = width;
  const rowH = 40;
  const padL = 70,
    padR = 92,
    padT = 6,
    padB = 6;
  const H = padT + padB + rowH * Math.max(1, rows.length);
  const totalOf = (r: StackedRow) =>
    series.reduce((s, sr) => s + Math.max(0, r.values[sr.key] ?? 0), 0);
  const max = Math.max(1, ...rows.map(totalOf));
  // Hidden amounts read as % of the longest bar (Income, in the month view).
  const top = rows.reduce<StackedRow | null>(
    (b, r) => (!b || totalOf(r) > totalOf(b) ? r : b),
    null,
  );
  const fmt = useAmountFormat(top ? { value: totalOf(top), label: top.label } : null);
  const xOf = (v: number) => padL + (v / max) * (W - padL - padR);
  const h = hover != null ? rows[hover] : null;
  return (
    <figure className="chart" style={{ position: "relative" }}>
      <Head title={title} subtitle={subtitle} note={fmt.note} right={<Legend series={series} />} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
      >
        <title id={id}>{title}</title>
        {rows.map((row, i) => {
          const y = padT + i * rowH + (rowH - 22) / 2;
          const total = totalOf(row);
          const parts = series.filter((sr) => (row.values[sr.key] ?? 0) > 0);
          let x = padL;
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              opacity={hover != null && hover !== i ? 0.6 : 1}
            >
              <rect x={0} y={padT + i * rowH} width={W} height={rowH} fill="transparent" />
              <text x={padL - 10} y={y + 15} textAnchor="end" fill="var(--ink)">
                {row.label}
              </text>
              {parts.map((sr, k) => {
                const w = Math.max(0, xOf(row.values[sr.key]!) - padL);
                const last = k === parts.length - 1;
                const gap = last ? 0 : 2;
                const x0 = x;
                x += w;
                const ww = Math.max(0, w - gap);
                const rr = last ? Math.min(4, ww / 2) : 0;
                return (
                  <path
                    key={sr.key}
                    d={`M${x0},${y} H${x0 + ww - rr} Q${x0 + ww},${y} ${x0 + ww},${y + rr} V${y + 22 - rr} Q${x0 + ww},${y + 22} ${x0 + ww - rr},${y + 22} H${x0} Z`}
                    fill={sr.color}
                    opacity={sr.opacity ?? 1}
                  />
                );
              })}
              {total === 0 ? (
                <rect x={padL} y={y + 10} width={2} height={2} fill="var(--muted)" />
              ) : null}
              <text x={xOf(total) + 8} y={y + 15} fill="var(--ink)" className={fmt.cls}>
                {fmt.full(total)}
              </text>
            </g>
          );
        })}
      </svg>
      {h && hover != null ? (
        <Tip
          title={h.note ? `${h.label} · ${h.note}` : h.label}
          left={20}
          rows={series
            .filter((sr) => (h.values[sr.key] ?? 0) !== 0)
            .map((sr) => ({
              label: sr.key,
              value: fmt.full(h.values[sr.key] ?? 0),
              color: sr.color,
            }))}
        />
      ) : null}
      <Table
        columns={["", ...series.map((s) => s.key), "Total"]}
        rows={rows.map((r) => [
          r.label,
          ...series.map((s) => fmt.full(r.values[s.key] ?? 0)),
          fmt.full(totalOf(r)),
        ])}
      />
    </figure>
  );
}
