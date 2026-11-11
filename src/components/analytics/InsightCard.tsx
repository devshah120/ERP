"use client";

import Link from "next/link";
import type { Insight } from "@/lib/analytics/types";
import { KpiCard } from "./KpiGrid";
import ChartView from "@/components/charts/ChartView";
import { IconChevronRight } from "@/components/icons";

/**
 * One stated business finding: the sentence, the numbers behind it, an
 * optional chart, and the link that takes you to the records to act on.
 */
export default function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className={`insightCard insightTone-${insight.tone}`}>
      <div className="insightAccent" />
      <div className="insightBody">
        <p className="insightHeadline">{insight.headline}</p>
        {insight.detail && <p className="insightDetail">{insight.detail}</p>}

        {insight.metrics.length > 0 && (
          <div className="kpiGrid kpiGridCompact">
            {insight.metrics.map((m) => (
              <KpiCard key={m.key} kpi={m} compact />
            ))}
          </div>
        )}

        {insight.chart && (
          <div className="insightChart">
            <ChartView chart={insight.chart} />
          </div>
        )}

        {insight.action && (
          <Link href={insight.action.href} className="insightAction">
            {insight.action.label}
            <IconChevronRight />
          </Link>
        )}
      </div>
    </div>
  );
}
