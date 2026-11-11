"use client";

import Link from "next/link";
import type { Kpi } from "@/lib/analytics/types";
import { formatByKind, formatMoney } from "@/lib/format/number";
import { IconArrowRight } from "@/components/icons";

const TONE_LABEL: Record<string, string> = {
  good: "On track",
  warn: "Needs attention",
  bad: "Action required",
};

/**
 * A KPI tile. The `kind` on the figure decides the formatting, so a count of
 * invoices can never be rendered as a rupee amount — the mistake that makes
 * "30 invoices" and "₹30" look like the same fact. Tone is shown as a dot
 * plus an accessible label, never colour alone.
 */
export function KpiCard({ kpi, compact = false }: { kpi: Kpi; compact?: boolean }) {
  const display = formatByKind(kpi.value, kpi.kind, { compact: kpi.kind === "money" });
  // Money is abbreviated on the tile but shown in full on hover, so nobody
  // has to guess whether "1.25 L" is 125,000 or 1,250,000.
  const full = kpi.kind === "money" ? `₹${formatMoney(kpi.value)}` : undefined;
  const tone = kpi.tone ?? "neutral";
  const toneLabel = TONE_LABEL[tone];

  const body = compact ? (
    <>
      <div className="kpiValue" title={full}>
        {display}
      </div>
      <div className="kpiLabel">{kpi.label}</div>
    </>
  ) : (
    <>
      <div className="kpiTop">
        <span className="kpiLabel">{kpi.label}</span>
        {toneLabel && <span className="kpiTone" title={toneLabel} aria-label={toneLabel} role="img" />}
      </div>
      <div className="kpiValue" title={full}>
        {display}
      </div>
      {kpi.hint && <div className="kpiHint">{kpi.hint}</div>}
      {kpi.href && (
        <span className="kpiArrow" aria-hidden>
          <IconArrowRight />
        </span>
      )}
    </>
  );

  const className = `kpiCard kpiTone-${tone} ${compact ? "kpiCompact" : ""}`;
  const title = [full, kpi.hint].filter(Boolean).join(" — ") || undefined;

  if (kpi.href) {
    return (
      <Link href={kpi.href} className={`${className} kpiClickable`} title={title ?? `View ${kpi.label.toLowerCase()}`}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} title={title}>
      {body}
    </div>
  );
}

export default function KpiGrid({
  kpis,
  compact = false,
  columns,
}: {
  kpis: Kpi[];
  compact?: boolean;
  /** Fixed 4-up layout for a headline row. */
  columns?: 4;
}) {
  if (kpis.length === 0) return null;
  return (
    <div className={`kpiGrid ${compact ? "kpiGridCompact" : ""} ${columns === 4 ? "kpiGrid4" : ""}`}>
      {kpis.map((k) => (
        <KpiCard key={k.key} kpi={k} compact={compact} />
      ))}
    </div>
  );
}
