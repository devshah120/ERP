import { z } from "zod";

/**
 * A single headline figure. `kind` exists so the UI never has to guess
 * whether 30 means thirty invoices or thirty rupees — the count/value
 * confusion is the easiest way to make a dashboard lie.
 */
export interface Kpi {
  key: string;
  label: string;
  /** Already formatted for display; money is a plain decimal string. */
  value: string;
  kind: "money" | "count" | "quantity" | "percent";
  /** Drill-through target, carrying the filters that produced this figure. */
  href?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  hint?: string;
}

export interface ChartPoint {
  label: string;
  value: number;
  href?: string;
}

export interface ChartSeries {
  name: string;
  color: string;
  points: ChartPoint[];
}

export interface Chart {
  key: string;
  title: string;
  type: "bar" | "groupedBar" | "line" | "donut" | "hbar";
  series: ChartSeries[];
  valueKind: "money" | "count" | "quantity";
  /** Shown instead of the chart when there is nothing to plot. */
  emptyMessage?: string;
}

/**
 * A stated business finding — the sentence a manager would say out loud,
 * plus the numbers behind it and where to go to act on it.
 */
export interface Insight {
  key: string;
  headline: string;
  detail?: string;
  tone: "neutral" | "good" | "warn" | "bad";
  metrics: Kpi[];
  chart?: Chart;
  /** Primary call to action, e.g. "View 15 pending orders". */
  action?: { label: string; href: string };
}

export interface ModuleAnalysis {
  module: string;
  title: string;
  kpis: Kpi[];
  insights: Insight[];
  charts: Chart[];
  /** Honest statements about what this analysis cannot yet see. */
  caveats?: string[];
}

export interface DashboardResult {
  period: { key: string; label: string; fromDate: string; toDate: string };
  kpis: Kpi[];
  charts: Chart[];
  insights: Insight[];
  caveats: string[];
  generatedAt: string;
}

export const PERIOD_KEYS = [
  "today",
  "week",
  "month",
  "quarter",
  "year",
  "custom",
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const analyticsQuerySchema = z.object({
  period: z.enum(PERIOD_KEYS).default("month"),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/**
 * Chart colours. sales/purchase/accent are categorical slots in a fixed order
 * (blue → teal → amber), validated together for colour-blind separation and
 * contrast on white. received/outstanding/warn are status colours and only
 * ever mean good / bad / attention — never "series 4".
 */
export const COLORS = {
  sales: "#2f80ed",
  purchase: "#0f9f8c",
  received: "#16a34a",
  outstanding: "#dc2626",
  neutral: "#64748b",
  warn: "#d97706",
  accent: "#c9730f",
} as const;
