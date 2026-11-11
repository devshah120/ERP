"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PeriodState } from "@/components/analytics/PeriodPicker";
import type { PeriodKey } from "@/lib/analytics/types";
import { usePopover } from "@/components/ui/usePopover";
import { formatCompact, formatMoney, formatCount, formatQuantity } from "@/lib/format/number";
import { IconCalendar, IconTrendUp } from "@/components/icons";

/* ------------------------------------------------------------------ */
/* Date range pill                                                     */
/* ------------------------------------------------------------------ */

const PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
];

export function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** "01 Nov 2026 – 30 Nov 2026" with a preset/custom picker behind it. */
export function DateRangePill({
  value,
  onChange,
  range,
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  range?: { fromDate: string; toDate: string };
}) {
  const { open, toggle, close, ref } = usePopover<HTMLDivElement>();
  const [from, setFrom] = useState(value.fromDate);
  const [to, setTo] = useState(value.toDate);

  return (
    <div className="menuWrap" ref={ref}>
      <button type="button" className="dateRangePill" onClick={toggle} aria-expanded={open} aria-haspopup="dialog">
        <IconCalendar />
        {range ? `${fmtDay(range.fromDate)} – ${fmtDay(range.toDate)}` : "Select dates"}
      </button>
      {open && (
        <div className="menu menuLeft" role="dialog" aria-label="Date range" style={{ minWidth: "17rem" }}>
          <div className="menuLabel">Quick ranges</div>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="menuItem"
              aria-pressed={value.period === p.key}
              style={value.period === p.key ? { background: "var(--accent-soft)", color: "var(--accent-text)", fontWeight: 600 } : undefined}
              onClick={() => {
                onChange({ ...value, period: p.key });
                close();
              }}
            >
              {p.label}
            </button>
          ))}
          <div className="menuSep" />
          <div className="menuLabel">Custom range</div>
          <form
            style={{ display: "grid", gap: "0.5rem", padding: "0.25rem 0.625rem 0.5rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!from || !to) return;
              onChange({ period: "custom", fromDate: from, toDate: to });
              close();
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <input className="input" type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              <input className="input" type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button type="submit" className="button buttonPrimary buttonSm" disabled={!from || !to}>
              Apply range
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** The period a card covers, shown read-only on cards that follow the page-level range. */
export function RangeTag({ range }: { range?: { fromDate: string; toDate: string } }) {
  if (!range) return null;
  return (
    <span className="dateRangePill dateRangeTag" title="Follows the date range set on Overview">
      <IconCalendar />
      {fmtDay(range.fromDate)} – {fmtDay(range.toDate)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Deltas and overview tiles                                           */
/* ------------------------------------------------------------------ */

export type Tint = "green" | "violet" | "amber" | "rose" | "blue";

export interface TileSpec {
  key: string;
  label: string;
  value: string;
  kind: "money" | "count" | "quantity" | "percent";
  href?: string;
  tint: Tint;
  /** Previous-period value; omitted for snapshot figures that have no "previous". */
  previous?: string;
  /** For returns and costs a fall is the good direction. */
  goodWhen?: "up" | "down";
  hint?: string;
}

function display(value: string, kind: TileSpec["kind"]) {
  if (kind === "money") return `₹${formatCompact(value)}`;
  if (kind === "percent") return `${Number(value).toFixed(2)}%`;
  if (kind === "quantity") return formatCompact(value).replace("₹", "");
  return formatCount(value);
}

export function Delta({ current, previous, goodWhen = "up" }: { current: string; previous: string; goodWhen?: "up" | "down" }) {
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0) {
    if (cur === 0) return <span className="delta deltaFlat" title="No change vs previous period">— 0.00%</span>;
    return (
      <span className="delta deltaUp" title="Nothing in the previous period to compare with">
        New
      </span>
    );
  }
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct > 0;
  const good = pct === 0 ? null : up === (goodWhen === "up");
  const cls = good === null ? "deltaFlat" : good ? "deltaUp" : "deltaDown";
  return (
    <span className={`delta ${cls}`} title={`Previous period: ${previous}`}>
      <IconTrendUp style={up ? undefined : { transform: "scaleY(-1)" }} aria-hidden />
      {Math.abs(pct).toFixed(2)}%
      <span className="srOnly">{up ? "up" : "down"} vs previous period</span>
    </span>
  );
}

export function OverviewTile({ t }: { t: TileSpec }) {
  const full = t.kind === "money" ? `₹${formatMoney(t.value)}` : t.kind === "quantity" ? formatQuantity(t.value) : undefined;
  const body = (
    <>
      <div className="ovTop">
        <span className="ovValue" title={full}>
          {display(t.value, t.kind)}
        </span>
        {t.previous !== undefined && <Delta current={t.value} previous={t.previous} goodWhen={t.goodWhen} />}
      </div>
      <div className="ovLabel">{t.label}</div>
    </>
  );
  const cls = `ovTile ovTile-${t.tint}`;
  return t.href ? (
    <Link href={t.href} className={cls} title={[full, t.hint].filter(Boolean).join(" — ") || `Open ${t.label.toLowerCase()}`}>
      {body}
    </Link>
  ) : (
    <div className={cls} title={[full, t.hint].filter(Boolean).join(" — ") || undefined}>
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Semicircle gauge                                                    */
/* ------------------------------------------------------------------ */

export function Gauge({ percent, label, caption }: { percent: number | null; label: string; caption?: ReactNode }) {
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const r = 80;
  const c = Math.PI * r;
  const color = percent === null ? "var(--border)" : p >= 80 ? "#16a34a" : p >= 40 ? "#d97706" : "#dc2626";
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 112" role="img" aria-label={`${label}: ${percent === null ? "no data" : `${p.toFixed(1)}%`}`}>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#e8eef4" strokeWidth="16" strokeLinecap="round" />
        {p > 0 && (
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`}
        />
        )}
        <text x="100" y="86" textAnchor="middle" className="gaugeValue">
          {percent === null ? "—" : `${p.toFixed(1)}%`}
        </text>
        <text x="100" y="104" textAnchor="middle" className="gaugeLabel">
          {label}
        </text>
      </svg>
      {caption && <div className="gaugeCaption">{caption}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Two-series trend line with crosshair tooltip                        */
/* ------------------------------------------------------------------ */

export interface TrendSeries {
  name: string;
  color: string;
  points: { label: string; value: number; href?: string }[];
}

export function TrendChart({ series, height = 220 }: { series: TrendSeries[]; height?: number }) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const max = useMemo(() => {
    const m = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value)));
    if (m <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(m)));
    const n = m / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }, [series]);

  if (labels.length === 0 || series.every((s) => s.points.every((p) => p.value === 0))) {
    return <div className="chartEmpty">No sales or purchases in this period.</div>;
  }

  const W = 640;
  const H = height;
  const padL = 44;
  const padB = 24;
  const padT = 8;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const x = (i: number) => padL + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="trend">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trendSvg"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - padL) / plotW) * (labels.length - 1));
          setHover(Math.max(0, Math.min(labels.length - 1, i)));
        }}
        onClick={() => {
          if (hover === null) return;
          const href = series[0]?.points[hover]?.href;
          if (href) router.push(href);
        }}
        role="img"
        aria-label={`${series.map((s) => s.name).join(" and ")} by ${labels.length > 31 ? "month" : "day"}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#eef2f6" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="trendTick">
              {formatCompact(t).replace("₹", "")}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === labels.length - 1 ? (
            <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" className="trendTick">
              {l}
            </text>
          ) : null
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="#cbd5e1" strokeDasharray="3 3" />}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
            />
            {s.points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 4.5 : 3} fill={hover === i ? s.color : "#fff"} stroke={s.color} strokeWidth="2" />
            ))}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="trendTip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{labels[hover]}</strong>
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name} <b>₹{formatMoney(s.points[hover]?.value ?? 0)}</b>
            </span>
          ))}
        </div>
      )}
      <div className="chartLegend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut with legend                                                   */
/* ------------------------------------------------------------------ */

/** Categorical order, validated for colour-blind separation (see lib/analytics/types COLORS). */
export const SERIES_COLORS = ["#2f80ed", "#0f9f8c", "#c9730f", "#8b5cf6", "#e0559a", "#94a3b8"];

export function Donut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; value: number; display: string; percent?: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  // Where each slice starts along the ring — computed up front, not mutated while rendering.
  const lengths = slices.map((s) => (total > 0 ? (s.value / total) * c : 0));
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));

  if (total <= 0) return <div className="chartEmpty">Nothing recorded in this period.</div>;

  return (
    <div className="donutWrap">
      <svg viewBox="0 0 180 180" className="donutSvg" role="img" aria-label={`${centerLabel} ${centerValue}`}>
        <circle cx="90" cy="90" r={r} fill="none" stroke="#eef2f6" strokeWidth="26" />
        {slices.map((s, i) => {
          const len = lengths[i];
          // A 2px surface gap between slices keeps adjacent colours distinct.
          const gap = slices.length > 1 ? Math.min(2, len / 2) : 0;
          const el = (
            <circle
              key={s.label}
              cx="90"
              cy="90"
              r={r}
              fill="none"
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth="26"
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
              strokeDashoffset={-starts[i]}
              transform="rotate(-90 90 90)"
            >
              <title>
                {s.label}: {s.display}
                {s.percent ? ` (${s.percent}%)` : ""}
              </title>
            </circle>
          );
          return el;
        })}
        <text x="90" y="84" textAnchor="middle" className="donutCaption">
          {centerLabel}
        </text>
        <text x="90" y="104" textAnchor="middle" className="donutTotal">
          {centerValue}
        </text>
      </svg>
      <ul className="donutLegend">
        {slices.map((s, i) => (
          <li key={s.label}>
            <i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span className="donutLegendLabel" title={s.label}>
              {s.label}
            </span>
            <span className="donutLegendValue">{s.display}</span>
            {s.percent && <span className="donutLegendPct">{s.percent}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card shell                                                          */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  actions,
  children,
  className = "",
  bodyClass = "",
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`dPanel ${className}`}>
      <header className="dPanelHead">
        <h2 className="dPanelTitle">{title}</h2>
        {actions && <div className="dPanelActions">{actions}</div>}
      </header>
      <div className={`dPanelBody ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="dTabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className="dTab" onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
