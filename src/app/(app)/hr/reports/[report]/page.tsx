"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { hrReport } from "@/lib/hr/reportCatalog";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { MonthPicker, downloadHref, fmtDate } from "@/components/hr/HrKit";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import { IconDownload, IconRefresh } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Report {
  title: string;
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, string>;
  summary?: { label: string; value: string }[];
  filterNote?: string;
}

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function cell(v: unknown, type?: string) {
  if (v === null || v === undefined || v === "") return <span className="cellMuted">—</span>;
  if (type === "money") return formatMoney(String(v));
  if (type === "number") return formatQuantity(String(v));
  if (type === "date") return fmtDate(String(v));
  return String(v);
}

/** One HR report (each has its own entry under HR Reports in the sidebar). */
export default function HrReportPage() {
  const { report: key } = useParams<{ report: string }>();
  const def = hrReport(key);
  if (!def) notFound();
  const [period, setPeriod] = useState(lastMonth());
  const [financial, setFinancial] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const needs = def.needs;
  const params: Record<string, number> =
    needs === "month" ? { year: period.year, month: period.month } : needs === "year" ? { year: period.year } : needs === "period" ? { year: period.year, fy: financial ? 1 : 0 } : needs === "fy" ? { year: period.year, fy: 1 } : {};
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

  // Bumped by the refresh button to fetch the same report again.
  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setReport(null);
    apiFetch<Report>(`/api/hr/reports/${key}?${qs}`)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, qs, tick]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title={def.label}
        description={def.description}
        actions={
          <>
            <a href={downloadHref(`/api/hr/reports/${key}`, params, "xlsx")} className="button buttonSecondary">
              <IconDownload /> Excel
            </a>
            <a href={downloadHref(`/api/hr/reports/${key}`, params, "csv")} className="button buttonSecondary">
              <IconDownload /> CSV
            </a>
          </>
        }
      />

      <div className="toolbar">
        {needs === "none" && <span className="hrMuted">As of today</span>}
        {needs === "month" && <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />}
        {needs === "period" && (
          <>
            <Select className="select" style={{ width: "auto" }} value={financial ? "FY" : "CY"} onChange={(e) => setFinancial(e.target.value === "FY")} aria-label="Year type">
              <option value="CY">Calendar year</option>
              <option value="FY">Financial year</option>
            </Select>
            <Select className="select" style={{ width: "auto" }} value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} aria-label="Year">
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 4 + i).map((y) => (
                <option key={y} value={y}>
                  {financial ? `${y}-${String((y + 1) % 100).padStart(2, "0")} (Apr–Mar)` : y}
                </option>
              ))}
            </Select>
          </>
        )}
        {needs === "fy" && (
          <Select className="select" style={{ width: "auto" }} value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} aria-label="Financial year">
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 4 + i).map((y) => (
              <option key={y} value={y}>
                FY {y}-{String((y + 1) % 100).padStart(2, "0")} (Apr–Mar)
              </option>
            ))}
          </Select>
        )}
        {needs === "year" && (
          <Select className="select" style={{ width: "auto" }} value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} aria-label="Year">
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 4 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        )}
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      {report?.summary && (
        <div className="hrKpis">
          {report.summary.map((s) => (
            <div key={s.label} className="hrKpi">
              <span className="hrKpiLabel">{s.label}</span>
              <span className="hrKpiValue">{/^-?\d+(\.\d+)?$/.test(s.value) && s.value.includes(".") ? formatMoney(s.value) : s.value}</span>
            </div>
          ))}
        </div>
      )}
      {report?.filterNote && <p className="hrMuted">{report.filterNote}</p>}

      {error !== null && !isForbidden(error) && (
        <ErrorState title="Report unavailable" message={error instanceof ApiError ? error.message : "Could not load the report."} onRetry={load} />
      )}

      {!error && (
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                {(report?.columns ?? []).map((c) => (
                  <th key={c.key} className={c.type === "money" || c.type === "number" ? "numCell" : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!report && <SkeletonRows columns={6} rows={5} />}
              {report && report.rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(1, report.columns.length)}>
                    <EmptyState title="Nothing to report for this period" />
                  </td>
                </tr>
              )}
              {report?.rows.map((r, i) => (
                <tr key={i}>
                  {report.columns.map((c) => (
                    <td key={c.key} className={c.type === "money" || c.type === "number" ? "numCell" : undefined}>
                      {cell(r[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              ))}
              {report?.totals && report.rows.length > 0 && (
                <tr>
                  {report.columns.map((c, i) => (
                    <td key={c.key} className={c.type === "money" || c.type === "number" ? "numCell" : undefined}>
                      <strong>{i === 0 ? "Total" : report.totals?.[c.key] !== undefined ? formatMoney(report.totals[c.key]) : ""}</strong>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
