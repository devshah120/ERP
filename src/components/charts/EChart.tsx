"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export interface EChartProps {
  option: echarts.EChartsOption;
  height?: number | string;
  width?: number | string;
  onPointClick?: (params: {
    dataIndex: number;
    seriesIndex?: number;
    name?: string;
    value?: unknown;
    seriesName?: string;
  }) => void;
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Universal, high-performance ECharts component for Next.js App Router (React 19).
 * - Automatic canvas/SVG initialization
 * - ResizeObserver for fluid responsive scaling when window/sidebar changes
 * - Graceful cleanup on unmount to prevent canvas/event memory leaks
 * - Drill-through click event handling for ERP analytics navigation
 */
export default function EChart({
  option,
  height = 260,
  width = "100%",
  onPointClick,
  empty = false,
  emptyMessage = "No data for this period.",
  className = "",
  style,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current || empty) return;

    // Initialize or reuse existing chart instance
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(containerRef.current, undefined, {
        renderer: "canvas",
      });
    }

    const chart = chartInstanceRef.current;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });

    // Handle drill-down clicks
    const handleClick = (params: unknown) => {
      if (onPointClick) {
        const p = params as {
          dataIndex: number;
          seriesIndex?: number;
          name?: string;
          value?: unknown;
          seriesName?: string;
        };
        onPointClick(p);
      }
    };

    chart.off("click");
    chart.on("click", handleClick);

    // Responsive resize observer
    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.off("click", handleClick);
    };
  }, [option, empty, onPointClick]);

  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  if (empty) {
    return (
      <div
        className={`chartEmpty ${className}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: typeof height === "number" ? `${height}px` : height,
          width,
          color: "var(--text-tertiary)",
          fontSize: "0.875rem",
          ...style,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        height: typeof height === "number" ? `${height}px` : height,
        width,
        ...style,
      }}
    />
  );
}

