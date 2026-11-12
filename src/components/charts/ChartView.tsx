"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import * as echarts from "echarts";
import type { Chart } from "@/lib/analytics/types";
import { formatByKind, formatCompact } from "@/lib/format/number";
import EChart from "./EChart";

const CHART_HEIGHT = 240;

const DONUT_COLORS = [
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#0a7bbf",
  "#0f9f8c",
  "#8b5cf6",
  "#e0559a",
  "#64748b",
];

function useNavigate() {
  const router = useRouter();
  return (href?: string) => {
    if (href) router.push(href);
  };
}

/* ------------------------------------------------------------------ */
/* Vertical & Grouped Bars                                            */
/* ------------------------------------------------------------------ */

function VerticalBars({ chart, grouped }: { chart: Chart; grouped: boolean }) {
  const go = useNavigate();
  const labels = chart.series[0]?.points.map((p) => p.label) ?? [];
  const allValues = chart.series.flatMap((s) => s.points.map((p) => p.value));
  const isEmpty = labels.length === 0 || allValues.every((v) => v === 0);

  const option: echarts.EChartsOption = useMemo(() => {
    if (isEmpty) return {};

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        borderColor: "transparent",
        textStyle: { color: "#ffffff", fontSize: 12 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const header = `<div style="font-weight:600;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:2px">${params[0].axisValueLabel}</div>`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = params.map((p: any) => {
            const val = formatByKind(p.value, chart.valueKind);
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:2px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
              <span style="color:#cbd5e1">${p.seriesName}:</span>
              <strong style="margin-left:auto">${val}</strong>
            </div>`;
          });
          return `${header}${rows.join("")}`;
        },
      },
      legend:
        grouped && chart.series.length > 1
          ? {
              top: "top",
              icon: "circle",
              textStyle: { color: "#64748b", fontSize: 12 },
            }
          : undefined,
      grid: {
        top: grouped && chart.series.length > 1 ? 40 : 16,
        left: 12,
        right: 12,
        bottom: 8,
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
          formatter: (v: number) => formatByKind(v, chart.valueKind, { compact: true }),
        },
      },
      series: chart.series.map((s) => ({
        name: s.name,
        type: "bar",
        data: s.points.map((p) => p.value),
        barMaxWidth: 36,
        itemStyle: {
          color: s.color || "#0a7bbf",
          borderRadius: [4, 4, 0, 0],
        },
      })),
    };
  }, [chart, labels, isEmpty, grouped]);

  return (
    <EChart
      option={option}
      height={CHART_HEIGHT}
      empty={isEmpty}
      emptyMessage={chart.emptyMessage ?? "No data for this period."}
      onPointClick={(p) => {
        const seriesIdx = p.seriesIndex ?? 0;
        const point = chart.series[seriesIdx]?.points[p.dataIndex];
        if (point?.href) go(point.href);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal Bars                                                    */
/* ------------------------------------------------------------------ */

function HorizontalBars({ chart }: { chart: Chart }) {
  const go = useNavigate();
  const series = chart.series[0];
  const points = series?.points ?? [];
  const color = series?.color ?? "#0a7bbf";
  const isEmpty = points.length === 0 || points.every((p) => p.value === 0);

  // ECharts renders bottom-to-top on horizontal category axes, so reverse for natural top-to-bottom reading
  const reversedPoints = useMemo(() => [...points].reverse(), [points]);

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
          const val = formatByKind(params.value, chart.valueKind);
          return `<div style="font-weight:600">${params.name}</div>
                  <div style="color:#cbd5e1;margin-top:2px">${val}</div>`;
        },
      },
      grid: {
        top: 12,
        left: 12,
        right: 48,
        bottom: 8,
        containLabel: true,
      },
      xAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          formatter: (v: number) => formatByKind(v, chart.valueKind, { compact: true }),
        },
      },
      yAxis: {
        type: "category",
        data: reversedPoints.map((p) => p.label),
        axisLine: { lineStyle: { color: "#e2e8f0" } },
        axisTick: { show: false },
        axisLabel: { color: "#475569", fontSize: 12 },
      },
      series: [
        {
          type: "bar",
          data: reversedPoints.map((p) => p.value),
          barMaxWidth: 20,
          itemStyle: {
            color,
            borderRadius: [0, 4, 4, 0],
          },
          label: {
            show: true,
            position: "right",
            color: "#64748b",
            fontSize: 11,
            formatter: (p: { value: unknown }) =>
              formatByKind(Number(p.value), chart.valueKind, { compact: true }),
          },
        },
      ],
    };
  }, [chart, reversedPoints, color, isEmpty]);

  return (
    <EChart
      option={option}
      height={Math.max(CHART_HEIGHT, points.length * 34 + 40)}
      empty={isEmpty}
      emptyMessage={chart.emptyMessage ?? "No data for this period."}
      onPointClick={(p) => {
        const point = reversedPoints[p.dataIndex];
        if (point?.href) go(point.href);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Line Chart                                                         */
/* ------------------------------------------------------------------ */

function LineChart({ chart }: { chart: Chart }) {
  const go = useNavigate();
  const series = chart.series[0];
  const points = series?.points ?? [];
  const color = series?.color ?? "#0a7bbf";
  const isEmpty = points.length === 0 || points.every((p) => p.value === 0);

  const option: echarts.EChartsOption = useMemo(() => {
    if (isEmpty) return {};

    return {
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        borderColor: "transparent",
        textStyle: { color: "#ffffff", fontSize: 12 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const p = params[0];
          const val = formatByKind(p.value, chart.valueKind);
          return `<div style="font-weight:600">${p.axisValueLabel}</div>
                  <div style="color:#93c5fd;margin-top:2px">${series.name}: <b>${val}</b></div>`;
        },
      },
      grid: {
        top: 16,
        left: 12,
        right: 16,
        bottom: 8,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: points.map((p) => p.label),
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
          formatter: (v: number) => formatByKind(v, chart.valueKind, { compact: true }),
        },
      },
      series: [
        {
          name: series.name,
          type: "line",
          smooth: true,
          data: points.map((p) => p.value),
          symbol: "circle",
          symbolSize: 6,
          itemStyle: { color },
          lineStyle: { width: 2.5, color },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(10, 123, 191, 0.35)" },
              { offset: 1, color: "rgba(10, 123, 191, 0.02)" },
            ]),
          },
        },
      ],
    };
  }, [chart, series, points, color, isEmpty]);

  return (
    <EChart
      option={option}
      height={CHART_HEIGHT}
      empty={isEmpty}
      emptyMessage={chart.emptyMessage ?? "No data for this period."}
      onPointClick={(p) => {
        const point = points[p.dataIndex];
        if (point?.href) go(point.href);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Donut Chart                                                        */
/* ------------------------------------------------------------------ */

function DonutChart({ chart }: { chart: Chart }) {
  const go = useNavigate();
  const points = chart.series[0]?.points ?? [];
  const total = points.reduce((a, p) => a + p.value, 0);
  const isEmpty = total === 0;

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
          const val = formatByKind(params.value, chart.valueKind);
          return `<div style="font-weight:600">${params.name}</div>
                  <div style="color:#cbd5e1;margin-top:2px">${val} (${params.percent}%)</div>`;
        },
      },
      legend: {
        orient: "horizontal",
        bottom: 0,
        icon: "circle",
        textStyle: { color: "#64748b", fontSize: 11 },
        formatter: (name: string) => {
          const point = points.find((p) => p.label === name);
          if (!point) return name;
          const pct = total > 0 ? ((point.value / total) * 100).toFixed(0) : "0";
          return `${name} · ${pct}%`;
        },
      },
      title: {
        text: formatCompact(total),
        subtext: "total",
        left: "center",
        top: "34%",
        textStyle: {
          fontSize: 20,
          fontWeight: 700,
          color: "#0f172a",
        },
        subtextStyle: {
          fontSize: 12,
          color: "#64748b",
        },
      },
      series: [
        {
          name: chart.title,
          type: "pie",
          radius: ["50%", "72%"],
          center: ["50%", "42%"],
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
          data: points
            .filter((p) => p.value > 0)
            .map((p, i) => ({
              name: p.label,
              value: p.value,
              itemStyle: { color: DONUT_COLORS[i % DONUT_COLORS.length] },
            })),
        },
      ],
    };
  }, [chart, points, total, isEmpty]);

  return (
    <EChart
      option={option}
      height={260}
      empty={isEmpty}
      emptyMessage={chart.emptyMessage ?? "No data for this period."}
      onPointClick={(p) => {
        const point = points.find((pt) => pt.label === p.name);
        if (point?.href) go(point.href);
      }}
    />
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
