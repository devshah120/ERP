"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type * as echarts from "echarts";
import EChart from "@/components/charts/EChart";
import { formatCompact, formatMoney, formatQuantity } from "@/lib/format/number";
import type { ItemPerformance, PartyAging } from "@/lib/analytics/overview";
import { chartTokens, esc, tipRow, tipTitle, tooltipBase } from "./chartTokens";

export interface SeriesPoint {
  label: string;
  value: number;
  href?: string;
}

const rupees = (v: number) => `₹${formatCompact(v)}`;

/* ------------------------------------------------------------------ */
/* Sparkline — the shape of a period, no axes                          */
/* ------------------------------------------------------------------ */

export function Sparkline({ points, slot = 0, name }: { points: SeriesPoint[]; slot?: number; name: string }) {
  const t = chartTokens();
  const color = t.cat[slot];
  const empty = points.length < 2 || points.every((p) => p.value === 0);

  const option: echarts.EChartsOption = useMemo(
    () => ({
      animationDuration: 500,
      grid: { top: 4, bottom: 2, left: 0, right: 0 },
      tooltip: {
        ...tooltipBase(t),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (ps: any) => {
          const p = Array.isArray(ps) ? ps[0] : ps;
          return tipTitle(esc(String(p.axisValueLabel))) + tipRow(color, name, `₹${formatMoney(p.value)}`);
        },
      },
      xAxis: { type: "category", show: false, boundaryGap: false, data: points.map((p) => p.label) },
      yAxis: { type: "value", show: false, min: 0 },
      series: [
        {
          type: "line",
          data: points.map((p) => p.value),
          smooth: 0.35,
          symbol: "circle",
          symbolSize: 8,
          showSymbol: false,
          lineStyle: { width: 2, color },
          itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}33` },
                { offset: 1, color: `${color}00` },
              ],
            },
          },
        },
      ],
    }),
    [points, color, name, t]
  );

  if (empty) return <div className="plSparkEmpty" aria-hidden />;
  return <EChart option={option} height={48} />;
}

/* ------------------------------------------------------------------ */
/* Money in vs money out — diverging columns on one axis + net line   */
/* ------------------------------------------------------------------ */

export function InOutChart({ sales, purchase }: { sales: SeriesPoint[]; purchase: SeriesPoint[] }) {
  const router = useRouter();
  const t = chartTokens();
  const [cIn, cOut] = [t.cat[0], t.cat[1]];
  const labels = useMemo(() => sales.map((p) => p.label), [sales]);
  const net = useMemo(() => sales.map((p, i) => p.value - (purchase[i]?.value ?? 0)), [sales, purchase]);
  const empty = labels.length === 0 || [...sales, ...purchase].every((p) => p.value === 0);

  const option: echarts.EChartsOption = useMemo(
    () => ({
      animationDuration: 600,
      legend: {
        top: 0,
        left: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 18,
        textStyle: { color: t.inkSecondary, fontSize: 12 },
      },
      grid: { top: 40, left: 4, right: 8, bottom: 4, containLabel: true },
      tooltip: {
        ...tooltipBase(t),
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(100,116,139,0.08)" } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (ps: any) => {
          const i = Array.isArray(ps) ? ps[0].dataIndex : ps.dataIndex;
          const n = net[i];
          return (
            tipTitle(esc(labels[i])) +
            tipRow(cIn, "Billed to customers", `₹${formatMoney(sales[i]?.value ?? 0)}`) +
            tipRow(cOut, "Bought from suppliers", `₹${formatMoney(purchase[i]?.value ?? 0)}`) +
            tipRow(t.ink, n < 0 ? "Net (more out)" : "Net (more in)", `${n < 0 ? "−" : ""}₹${formatMoney(Math.abs(n))}`)
          );
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: t.inkSecondary, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.inkMuted, fontSize: 11, formatter: (v: number) => (v === 0 ? "0" : `${v < 0 ? "−" : ""}${rupees(Math.abs(v))}`) },
      },
      series: [
        {
          name: "Billed to customers",
          type: "bar",
          stack: "flow",
          barMaxWidth: 22,
          data: sales.map((p) => p.value),
          itemStyle: { color: cIn, borderRadius: [4, 4, 0, 0] },
          emphasis: { focus: "series" },
        },
        {
          name: "Bought from suppliers",
          type: "bar",
          stack: "flow",
          barMaxWidth: 22,
          data: purchase.map((p) => -p.value),
          itemStyle: { color: cOut, borderRadius: [0, 0, 4, 4] },
          emphasis: { focus: "series" },
        },
        {
          name: "Net",
          type: "line",
          data: net,
          smooth: 0.25,
          symbol: "circle",
          symbolSize: 8,
          lineStyle: { width: 2, color: t.ink },
          itemStyle: { color: t.ink, borderColor: t.surface, borderWidth: 2 },
          z: 5,
        },
      ],
    }),
    [labels, sales, purchase, net, cIn, cOut, t]
  );

  return (
    <EChart
      option={option}
      height={300}
      empty={empty}
      emptyMessage="Nothing billed or bought in this period yet."
      onPointClick={(p) => {
        const src = p.seriesIndex === 1 ? purchase : sales;
        const href = src[p.dataIndex]?.href;
        if (href) router.push(href);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Who owes you — stacked age bands per party                          */
/* ------------------------------------------------------------------ */

export const AGE_BANDS: { key: "b0_30" | "b31_60" | "b61_90" | "b90"; label: string; min: number; max?: number; ramp: number }[] = [
  { key: "b0_30", label: "Up to 30 days", min: 0, max: 30, ramp: 2 },
  { key: "b31_60", label: "31–60 days", min: 31, max: 60, ramp: 4 },
  { key: "b61_90", label: "61–90 days", min: 61, max: 90, ramp: 6 },
  { key: "b90", label: "Over 90 days", min: 91, ramp: 8 },
];

export function AgingBars({ rows, side }: { rows: PartyAging[]; side: "receivable" | "payable" }) {
  const router = useRouter();
  const t = chartTokens();
  // Horizontal category axes draw bottom-up; reverse so the biggest balance sits on top.
  const ordered = useMemo(() => rows.slice(0, 8).reverse(), [rows]);

  const option: echarts.EChartsOption = useMemo(
    () => ({
      animationDuration: 600,
      legend: {
        top: 0,
        left: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 16,
        textStyle: { color: t.inkSecondary, fontSize: 12 },
      },
      grid: { top: 36, left: 4, right: 16, bottom: 4, containLabel: true },
      tooltip: {
        ...tooltipBase(t),
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(100,116,139,0.08)" } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (ps: any) => {
          const r = ordered[Array.isArray(ps) ? ps[0].dataIndex : ps.dataIndex];
          if (!r) return "";
          return (
            tipTitle(esc(r.name)) +
            AGE_BANDS.map((b) => tipRow(t.ramp[b.ramp], b.label, `₹${formatMoney(r[b.key])}`)).join("") +
            tipRow(t.ink, "Total", `₹${formatMoney(r.total)}`)
          );
        },
      },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.inkMuted, fontSize: 11, formatter: (v: number) => rupees(v) },
      },
      yAxis: {
        type: "category",
        data: ordered.map((r) => r.name),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.ink, fontSize: 12, width: 120, overflow: "truncate" },
      },
      series: AGE_BANDS.map((b) => ({
        name: b.label,
        type: "bar" as const,
        stack: "age",
        barMaxWidth: 18,
        data: ordered.map((r) => Number(r[b.key])),
        itemStyle: { color: t.ramp[b.ramp], borderColor: t.surface, borderWidth: 1, borderRadius: 3 },
        emphasis: { focus: "series" as const },
      })),
    }),
    [ordered, t]
  );

  return (
    <EChart
      option={option}
      height={Math.max(220, ordered.length * 34 + 60)}
      empty={ordered.length === 0}
      emptyMessage={side === "receivable" ? "No customer owes you anything right now." : "You don't owe any supplier right now."}
      onPointClick={(p) => {
        const r = ordered[p.dataIndex];
        const b = AGE_BANDS[p.seriesIndex ?? 0];
        if (!r || !b) return;
        const base = side === "receivable" ? "/sales-invoices" : "/purchase-invoices";
        const qs = new URLSearchParams({ outstanding: "true", partyName: r.name });
        if (b.min > 0) qs.set("minAgeDays", String(b.min));
        if (b.max !== undefined) qs.set("maxAgeDays", String(b.max));
        router.push(`${base}?${qs.toString()}`);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Where revenue comes from — category treemap                         */
/* ------------------------------------------------------------------ */

export function CategoryTreemap({ categories }: { categories: { name: string; value: string; percent: string }[] }) {
  const t = chartTokens();
  const data = useMemo(() => categories.filter((c) => Number(c.value) > 0), [categories]);

  const option: echarts.EChartsOption = useMemo(
    () => ({
      animationDuration: 500,
      tooltip: {
        ...tooltipBase(t),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          const c = data.find((d) => d.name === p.name);
          return tipTitle(esc(String(p.name))) + (c ? tipRow(t.ramp[5], `${Number(c.percent).toFixed(1)}% of sales`, `₹${formatMoney(c.value)}`) : "");
        },
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: "100%",
          height: "100%",
          top: 0,
          left: 0,
          itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2, borderRadius: 6 },
          label: {
            show: true,
            position: "insideTopLeft",
            padding: [8, 10],
            color: t.ink,
            overflow: "truncate",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (p: any) => {
              const c = data.find((d) => d.name === p.name);
              return `{name|${p.name}}\n{share|${c ? `${Number(c.percent).toFixed(0)}%` : ""}}`;
            },
            rich: {
              name: { fontSize: 12, fontWeight: 600, color: t.ink, lineHeight: 18 },
              share: { fontSize: 16, fontWeight: 700, color: t.ink, lineHeight: 22 },
            },
          },
          emphasis: { itemStyle: { color: t.ramp[2] } },
          data: data.map((c) => ({
            name: c.name,
            value: Number(c.value),
            itemStyle: { color: c.name === "Others" ? t.grid : t.ramp[0] },
          })),
        },
      ],
    }),
    [data, t]
  );

  return <EChart option={option} height={260} empty={data.length === 0} emptyMessage="No sales in this period yet." />;
}

/* ------------------------------------------------------------------ */
/* Product map — units sold × revenue, bubble = number of bills        */
/* ------------------------------------------------------------------ */

export function ProductMap({ items }: { items: ItemPerformance[] }) {
  const router = useRouter();
  const t = chartTokens();
  const color = t.cat[0];

  const plotted = useMemo(() => [...items].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 40), [items]);
  const maxBills = Math.max(1, ...plotted.map((i) => i.bills));
  const labelled = useMemo(() => new Set(plotted.slice(0, 3).map((i) => i.itemId)), [plotted]);

  const option: echarts.EChartsOption = useMemo(
    () => ({
      animationDuration: 600,
      grid: { top: 16, left: 8, right: 24, bottom: 28, containLabel: true },
      tooltip: {
        ...tooltipBase(t),
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          const i = plotted[p.dataIndex];
          if (!i) return "";
          return (
            tipTitle(esc(i.name)) +
            tipRow(color, "Revenue", `₹${formatMoney(i.amount)}`) +
            tipRow(color, "Units sold", formatQuantity(i.quantity)) +
            tipRow(color, "On bills", String(i.bills)) +
            (i.margin !== null ? tipRow(color, "Est. margin", `₹${formatMoney(i.margin)}`) : "")
          );
        },
      },
      xAxis: {
        type: "value",
        name: "Units sold",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: t.inkSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
        axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.inkMuted, fontSize: 11, formatter: (v: number) => formatCompact(v) },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.inkMuted, fontSize: 11, formatter: (v: number) => rupees(v) },
      },
      series: [
        {
          type: "scatter",
          data: plotted.map((i) => [i.quantity, Number(i.amount)]),
          symbolSize: (_: unknown, p: { dataIndex: number }) => 10 + Math.sqrt((plotted[p.dataIndex]?.bills ?? 1) / maxBills) * 26,
          itemStyle: { color: `${color}b3`, borderColor: t.surface, borderWidth: 2 },
          emphasis: { scale: 1.15, itemStyle: { color } },
          label: {
            show: true,
            position: "right",
            color: t.inkSecondary,
            fontSize: 11,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (p: any) => (labelled.has(plotted[p.dataIndex]?.itemId) ? plotted[p.dataIndex].name : ""),
          },
        },
      ],
    }),
    [plotted, maxBills, labelled, color, t]
  );

  return (
    <EChart
      option={option}
      height={300}
      empty={plotted.length === 0}
      emptyMessage="Products appear here once something is sold."
      onPointClick={(p) => {
        const i = plotted[p.dataIndex];
        if (i?.itemId) router.push(`/items/${i.itemId}`);
      }}
    />
  );
}
