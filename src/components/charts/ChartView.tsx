"use client";

import { useRouter } from "next/navigation";
import type { Chart, ChartPoint } from "@/lib/analytics/types";
import { formatByKind, formatCompact } from "@/lib/format/number";

/**
 * Charts are hand-drawn SVG rather than a charting library: the shapes here
 * are simple, and every bar/slice/point has to be a drill-through target,
 * which is easier to guarantee with plain elements than with a library's
 * event model. It also keeps the client bundle free of a ~500 KB dependency.
 */

const CHART_HEIGHT = 200;

function valueLabel(chart: Chart, value: number): string {
  return formatByKind(value, chart.valueKind, { compact: true });
}

function fullLabel(chart: Chart, point: ChartPoint): string {
  return `${point.label}: ${formatByKind(point.value, chart.valueKind)}`;
}

function useNavigate() {
  const router = useRouter();
  return (href?: string) => {
    if (href) router.push(href);
  };
}

/** Nothing to plot — say so rather than showing an empty axis. */
function EmptyChart({ message }: { message: string }) {
  return <div className="chartEmpty">{message}</div>;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/* ------------------------------------------------------------------ */

function VerticalBars({ chart, grouped }: { chart: Chart; grouped: boolean }) {
  const go = useNavigate();
  const labels = chart.series[0]?.points.map((p) => p.label) ?? [];
  const allValues = chart.series.flatMap((s) => s.points.map((p) => p.value));
  const max = niceMax(Math.max(0, ...allValues));

  if (labels.length === 0 || allValues.every((v) => v === 0)) {
    return <EmptyChart message={chart.emptyMessage ?? "No data for this period."} />;
  }

  const groupCount = labels.length;
  const seriesCount = grouped ? chart.series.length : 1;
  const slot = 100 / groupCount;
  const barWidth = (slot * 0.7) / seriesCount;

  return (
    <div className="chartBody">
      <div className="chartPlot" style={{ height: CHART_HEIGHT }}>
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <div key={f} className="chartGridLine" style={{ bottom: `${f * 100}%` }}>
            <span>{valueLabel(chart, max * f)}</span>
          </div>
        ))}

        {chart.series.map((series, si) =>
          series.points.map((point, pi) => {
            const height = max > 0 ? (point.value / max) * 100 : 0;
            const left = pi * slot + slot * 0.15 + (grouped ? si * barWidth : 0);
            return (
              <button
                key={`${series.name}-${point.label}`}
                type="button"
                className={`chartBar ${point.href ? "chartBarLink" : ""}`}
                style={{
                  left: `${left}%`,
                  width: `${barWidth}%`,
                  height: `${Math.max(height, point.value > 0 ? 1 : 0)}%`,
                  background: series.color,
                }}
                title={`${series.name} — ${fullLabel(chart, point)}`}
                onClick={() => go(point.href)}
                disabled={!point.href}
              >
                <span className="chartBarValue">{valueLabel(chart, point.value)}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="chartAxis">
        {labels.map((label) => (
          <span key={label} style={{ width: `${slot}%` }} title={label}>
            {label}
          </span>
        ))}
      </div>

      {grouped && chart.series.length > 1 && (
        <div className="chartLegend">
          {chart.series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function HorizontalBars({ chart }: { chart: Chart }) {
  const go = useNavigate();
  const points = chart.series[0]?.points ?? [];
  const color = chart.series[0]?.color ?? "#2f80ed";
  const max = Math.max(0, ...points.map((p) => p.value));

  if (points.length === 0 || max === 0) {
    return <EmptyChart message={chart.emptyMessage ?? "No data for this period."} />;
  }

  return (
    <div className="chartHBars">
      {points.map((point) => (
        <button
          key={point.label}
          type="button"
          className={`chartHRow ${point.href ? "chartHRowLink" : ""}`}
          onClick={() => go(point.href)}
          disabled={!point.href}
          title={fullLabel(chart, point)}
        >
          <span className="chartHLabel">{point.label}</span>
          <span className="chartHTrack">
            <span
              className="chartHFill"
              style={{ width: `${max > 0 ? Math.max((point.value / max) * 100, 1) : 0}%`, background: color }}
            />
          </span>
          <span className="chartHValue">{valueLabel(chart, point.value)}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LineChart({ chart }: { chart: Chart }) {
  const go = useNavigate();
  const series = chart.series[0];
  const points = series?.points ?? [];
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));

  if (points.length === 0 || points.every((p) => p.value === 0)) {
    return <EmptyChart message={chart.emptyMessage ?? "No data for this period."} />;
  }

  const width = 100;
  const height = 100;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: points.length === 1 ? width / 2 : i * step,
    y: height - (max > 0 ? (p.value / max) * height : 0),
    point: p,
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const area = `${path} L${coords[coords.length - 1].x.toFixed(2)},${height} L${coords[0].x.toFixed(2)},${height} Z`;

  // Long ranges get too many ticks to read, so label roughly eight of them.
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="chartBody">
      <div className="chartPlot" style={{ height: CHART_HEIGHT }}>
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <div key={f} className="chartGridLine" style={{ bottom: `${f * 100}%` }}>
            <span>{valueLabel(chart, max * f)}</span>
          </div>
        ))}
        <svg
          className="chartSvg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={area} fill={series.color} fillOpacity={0.12} />
          <path
            d={path}
            fill="none"
            stroke={series.color}
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {coords.map((c) => (
          <button
            key={c.point.label}
            type="button"
            className={`chartDot ${c.point.href ? "chartDotLink" : ""}`}
            style={{ left: `${c.x}%`, bottom: `${height - c.y}%`, borderColor: series.color }}
            title={fullLabel(chart, c.point)}
            onClick={() => go(c.point.href)}
            disabled={!c.point.href}
          />
        ))}
      </div>
      <div className="chartAxis chartAxisSparse">
        {points.map((p, i) => (
          <span key={p.label} style={{ width: `${100 / points.length}%` }}>
            {i % labelEvery === 0 ? p.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

// First three are status colours (paid / partly / unpaid); the rest follow the categorical order.
const DONUT_COLORS = ["#16a34a", "#d97706", "#dc2626", "#2f80ed", "#0f9f8c", "#8b5cf6"];

function DonutChart({ chart }: { chart: Chart }) {
  const go = useNavigate();
  const points = chart.series[0]?.points ?? [];
  const total = points.reduce((a, p) => a + p.value, 0);

  if (total === 0) return <EmptyChart message={chart.emptyMessage ?? "No data for this period."} />;

  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  // Each arc starts where the previous one ended. The running offset is
  // computed up front rather than mutated inside the map, so rendering stays
  // a pure function of the data.
  const arcs: { point: ChartPoint; dash: number; offset: number; color: string }[] = [];
  let cursor = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.value <= 0) continue;
    const dash = (p.value / total) * circumference;
    arcs.push({ point: p, dash, offset: cursor, color: DONUT_COLORS[i % DONUT_COLORS.length] });
    cursor += dash;
  }

  return (
    <div className="chartDonutWrap">
      <svg viewBox="0 0 120 120" className="chartDonut" role="img" aria-label={chart.title}>
        {arcs.map((arc) => (
          <circle
            key={arc.point.label}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth="16"
            strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
            strokeDashoffset={-arc.offset}
            transform="rotate(-90 60 60)"
            style={{ cursor: arc.point.href ? "pointer" : "default" }}
            onClick={() => go(arc.point.href)}
          >
            <title>{fullLabel(chart, arc.point)}</title>
          </circle>
        ))}
        <text x="60" y="57" textAnchor="middle" className="chartDonutTotal">
          {formatCompact(total)}
        </text>
        <text x="60" y="71" textAnchor="middle" className="chartDonutCaption">
          total
        </text>
      </svg>

      <div className="chartDonutLegend">
        {points.map((p, i) => (
          <button
            key={p.label}
            type="button"
            className={p.href ? "chartLegendLink" : undefined}
            onClick={() => go(p.href)}
            disabled={!p.href}
          >
            <i style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="chartLegendLabel">{p.label}</span>
            <span className="chartLegendValue">
              {formatByKind(p.value, chart.valueKind, { compact: true })}
              <em>{total > 0 ? ` · ${((p.value / total) * 100).toFixed(0)}%` : ""}</em>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function ChartView({ chart }: { chart: Chart }) {
  return (
    <div className="chartCard">
      <div className="chartTitle">{chart.title}</div>
      {chart.type === "donut" && <DonutChart chart={chart} />}
      {chart.type === "line" && <LineChart chart={chart} />}
      {chart.type === "hbar" && <HorizontalBars chart={chart} />}
      {chart.type === "bar" && <VerticalBars chart={chart} grouped={false} />}
      {chart.type === "groupedBar" && <VerticalBars chart={chart} grouped />}
    </div>
  );
}
