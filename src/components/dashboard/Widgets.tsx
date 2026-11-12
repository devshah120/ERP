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
  if (prev === 0 && cur === 0) return <span className="delta deltaFlat" title="No change vs previous period">— 0.00%</span>;
  // From nothing to something reads as a full 100% move (the true ratio is undefined).
  const fromZero = prev === 0;
  const pct = fromZero ? (cur > 0 ? 100 : -100) : ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct > 0;
  const good = pct === 0 ? null : up === (goodWhen === "up");
  const cls = good === null ? "deltaFlat" : good ? "deltaUp" : "deltaDown";
  return (
    <span className={`delta ${cls}`} title={fromZero ? "Nothing in the previous period to compare with" : `Previous period: ${previous}`}>
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

import * as echarts from "echarts";
import EChart from "@/components/charts/EChart";

/* ------------------------------------------------------------------ */
/* Semicircle gauge                                                    */
/* ------------------------------------------------------------------ */

export function Gauge({ percent, label, caption }: { percent: number | null; label: string; caption?: ReactNode }) {
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const color = percent === null ? "#cbd5e1" : p >= 80 ? "#16a34a" : p >= 40 ? "#d97706" : "#dc2626";

  const option: echarts.EChartsOption = useMemo(() => {
    return {
      series: [
        {
          type: "gauge",
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 100,
          radius: "100%",
          center: ["50%", "75%"],
          progress: {
            show: percent !== null,
            roundCap: true,
            width: 14,
            itemStyle: { color },
          },
          pointer: { show: false },
          axisLine: {
            roundCap: true,
            lineStyle: { width: 14, color: [[1, "#f1f5f9"]] },
          },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          detail: {
            offsetCenter: [0, "-12%"],
            fontSize: 22,
            fontWeight: "bold",
            color: "#0f172a",
            formatter: percent === null ? "—" : "{value}%",
          },
          title: {
            offsetCenter: [0, "20%"],
            fontSize: 12,
            color: "#64748b",
          },
          data: [{ value: Number(p.toFixed(1)), name: label }],
        },
      ],
    };
  }, [percent, p, color, label]);

  return (
    <div className="gauge" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <EChart option={option} height={120} width={200} />
      {caption && <div className="gaugeCaption" style={{ marginTop: -8 }}>{caption}</div>}
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

export function TrendChart({ series, height = 230 }: { series: TrendSeries[]; height?: number }) {
  const router = useRouter();
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const isEmpty = labels.length === 0 || series.every((s) => s.points.every((p) => p.value === 0));

  const option: echarts.EChartsOption = useMemo(() => {
    if (isEmpty) return {};

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", crossStyle: { color: "#94a3b8" } },
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        borderColor: "transparent",
        textStyle: { color: "#ffffff", fontSize: 12 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const header = `<div style="font-weight:600;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:2px">${params[0].axisValueLabel}</div>`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = params.map((p: any) => {
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:2px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
              <span style="color:#cbd5e1">${p.seriesName}:</span>
              <strong style="margin-left:auto">₹${formatMoney(p.value)}</strong>
            </div>`;
          });
          return `${header}${rows.join("")}`;
        },
      },
      legend: {
        top: 0,
        right: 0,
        icon: "circle",
        textStyle: { color: "#64748b", fontSize: 12 },
      },
      grid: {
        top: 32,
        left: 12,
        right: 16,
        bottom: 12,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "#e2e8f0" } },
        axisLabel: { color: "#64748b", fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          formatter: (v: number) => `₹${formatCompact(v).replace("₹", "")}`,
        },
      },
      series: series.map((s) => ({
        name: s.name,
        type: "line",
        smooth: true,
        data: s.points.map((p) => p.value),
        symbol: "circle",
        symbolSize: 6,
        itemStyle: { color: s.color },
        lineStyle: { width: 2.5, color: s.color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: s.color ? `${s.color}33` : "rgba(10, 123, 191, 0.2)" },
            { offset: 1, color: "rgba(255, 255, 255, 0.0)" },
          ]),
        },
      })),
    };
  }, [series, labels, isEmpty]);

  return (
    <EChart
      option={option}
      height={height}
      empty={isEmpty}
      emptyMessage="No sales or purchases in this period."
      onPointClick={(p) => {
        const href = series[0]?.points[p.dataIndex]?.href;
        if (href) router.push(href);
      }}
    />
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
  const isEmpty = total <= 0;

  const option: echarts.EChartsOption = useMemo(() => {
    if (isEmpty) return {};

    return {
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        borderColor: "transparent",
        textStyle: { color: "#ffffff", fontSize: 12 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const slice = slices.find((s) => s.label === params.name);
          const display = slice ? slice.display : `₹${formatMoney(params.value)}`;
          return `<div style="font-weight:600">${params.name}</div>
                  <div style="color:#cbd5e1;margin-top:2px">${display} (${params.percent}%)</div>`;
        },
      },
      legend: {
        orient: "horizontal",
        bottom: 0,
        icon: "circle",
        textStyle: { color: "#64748b", fontSize: 11 },
        formatter: (name: string) => {
          const slice = slices.find((s) => s.label === name);
          if (!slice) return name;
          return `${name} · ${slice.percent ? `${slice.percent}%` : `${((slice.value / total) * 100).toFixed(0)}%`}`;
        },
      },
      title: {
        text: centerValue,
        subtext: centerLabel.toUpperCase(),
        left: "center",
        top: "32%",
        textStyle: {
          fontSize: 18,
          fontWeight: 700,
          color: "#0f172a",
        },
        subtextStyle: {
          fontSize: 11,
          fontWeight: 600,
          color: "#64748b",
        },
      },
      series: [
        {
          name: centerLabel,
          type: "pie",
          radius: ["50%", "72%"],
          center: ["50%", "40%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: "#ffffff",
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: false },
            scaleSize: 6,
          },
          data: slices
            .filter((s) => s.value > 0)
            .map((s, i) => ({
              name: s.label,
              value: s.value,
              itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
            })),
        },
      ],
    };
  }, [slices, total, centerLabel, centerValue, isEmpty]);

  return (
    <EChart
      option={option}
      height={260}
      empty={isEmpty}
      emptyMessage="Nothing recorded in this period."
    />
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
