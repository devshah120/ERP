"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { ModuleAnalysis } from "@/lib/analytics/types";
import KpiGrid from "@/components/analytics/KpiGrid";
import InsightCard from "@/components/analytics/InsightCard";
import ChartView from "@/components/charts/ChartView";
import PeriodPicker, {
  periodQuery,
  isPeriodReady,
  type PeriodState,
} from "@/components/analytics/PeriodPicker";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import { IconRefresh, IconInfo } from "@/components/icons";
import PageHeader from "@/components/ui/PageHeader";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";

const MODULES = [
  { module: "sales", label: "Sales" },
  { module: "purchase", label: "Purchase" },
  { module: "inventory", label: "Inventory" },
  { module: "customers", label: "Customers" },
  { module: "vendors", label: "Suppliers" },
  { module: "accounting", label: "Cash & settlement" },
];

type Result = ModuleAnalysis & {
  period: { key: string; label: string; fromDate: string; toDate: string };
};

/**
 * One module's analysis. It reuses the same insight and chart components as
 * the dashboard and reads the same API, so a figure shown here and the same
 * figure on the dashboard are computed once, in one place.
 */
export default function AnalysisView({ module, title }: { module: string; title: string }) {
  const [period, setPeriod] = useState<PeriodState>({ period: "month", fromDate: "", toDate: "" });
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isPeriodReady(period)) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<Result>(`/api/analytics/${module}?${periodQuery(period)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this analysis");
    } finally {
      setLoading(false);
    }
  }, [module, period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  return (
    <>
      <PageHeader
        title={data?.title ?? title}
        description={
          data
            ? `${data.period.label} · ${new Date(data.period.fromDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} – ${new Date(data.period.toDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
            : "Findings stated as sentences, with the numbers and records behind them."
        }
        actions={
          <button type="button" className="button buttonSecondary" onClick={load} disabled={loading} title="Refresh (Ctrl + R)">
            {loading ? <span className="spinner" /> : <IconRefresh />} Refresh
          </button>
        }
      />

      <div className="tabBar" role="tablist" aria-label="Analysis module">
        {MODULES.map((m) => (
          <Link key={m.module} href={`/analysis/${m.module}`} role="tab" aria-selected={m.module === module} className="tabBarItem">
            {m.label}
          </Link>
        ))}
      </div>

      <div className="toolbar">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {error && !data && (
        <div className="card">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}
      {!data && loading && (
        <div style={{ display: "grid", gap: "1rem" }} aria-busy="true">
          <div className="kpiGrid">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} lines={2} />
            ))}
          </div>
          <SkeletonBlock lines={3} />
        </div>
      )}

      {data && (
        <>
          <KpiGrid kpis={data.kpis} />

          {data.insights.length > 0 && (
            <>
              <div className="sectionHeading">
                <span>What the numbers say</span>
                <small>Each finding links to the records behind it</small>
              </div>
              <div className="insightList">
                {data.insights.map((i) => (
                  <InsightCard key={i.key} insight={i} />
                ))}
              </div>
            </>
          )}

          {data.charts.length > 0 && (
            <>
              <div className="sectionHeading">Charts</div>
              <div className="chartGrid">
                {data.charts.map((c) => (
                  <ChartView key={c.key} chart={c} />
                ))}
              </div>
            </>
          )}

          {data.caveats && data.caveats.length > 0 && (
            <details className="caveatBox">
              <summary>
                <IconInfo /> How to read this — and what it can&apos;t see
              </summary>
              <ul>
                {data.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
