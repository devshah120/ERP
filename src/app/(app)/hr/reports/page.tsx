"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { MonthPicker, downloadHref, fmtDate } from "@/components/hr/HrKit";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import { IconDownload, IconRefresh } from "@/components/icons";

interface Catalog {
  items: { key: string; label: string; needs: "none" | "month" | "year" }[];
}

interface Report {
  title: string;
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, string>;
  summary?: { label: string; value: string }[];
  filterNote?: string;
}

const DESCRIPTIONS: Record<string, string> = {
  headcount: "Everyone currently employed, with department, designation and monthly gross.",
  "attendance-summary": "Present, absent, leave, late and loss-of-pay days per employee for a month.",
  "leave-register": "Every leave request filed in a year.",
  "salary-register": "Each employee's earnings, deductions and net pay for a month's payroll.",
  "pf-statement": "EPF/EPS wages and contributions in the EPFO ECR layout.",
  "esi-statement": "ESI wages and employee/employer contributions.",
  "bank-transfer": "Account, IFSC and net pay for uploading salary payments to your bank.",
  "loans-outstanding": "Active loans and advances with what is still to be recovered.",
  exits: "Employees who left in a year, with an approximate attrition rate.",
};

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

export default function HrReportsPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [key, setKey] = useState("salary-register");
  const [period, setPeriod] = useState(lastMonth());
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<Catalog>("/api/hr/reports")
      .then(setCatalog)
      .catch((err) => setError(err));
  }, []);

  const needs = catalog?.items.find((i) => i.key === key)?.needs ?? "month";
  const params: Record<string, number> = needs === "month" ? { year: period.year, month: period.month } : needs === "year" ? { year: period.year } : {};
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
        title="HR reports"
        description={DESCRIPTIONS[key] ?? "Payroll, statutory and people reports."}
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
        <select className="select" style={{ width: "auto" }} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Report">
          {(catalog?.items ?? []).map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </select>
        {needs === "month" && <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />}
        {needs === "year" && (
          <select className="select" style={{ width: "auto" }} value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} aria-label="Year">
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 4 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
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
