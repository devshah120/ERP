"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { formatMoney } from "@/lib/format/number";
import { Kpi, MonthPicker, MONTH_NAMES, downloadHref, useMasterOptions } from "@/components/hr/HrKit";
import { IconDownload } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Row {
  workerId: string;
  workerCode: string;
  name: string;
  contractorId: string;
  contractor: string;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  payableDays: string;
  dailyWage: string;
  wages: string;
  overtimeDays: number;
  overtimeMinutes: number;
  overtimeHours: string;
  overtimeRate: string;
  overtimeAmount: string;
  total: string;
}

interface Report {
  year: number;
  month: number;
  rows: Row[];
  contractorTotals: { contractorId: string; contractor: string; workers: number; overtimeHours: string; wages: string; overtimeAmount: string; total: string }[];
  totals: { overtimeHours: string; wages: string; overtimeAmount: string; total: string };
}

/** Overtime Calculation: a month's days, wages and overtime per worker, by contractor. */
export default function OvertimePage() {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [contractorId, setContractorId] = useState("");
  const [onlyOvertime, setOnlyOvertime] = useState(false);
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const contractorOptions = useMasterOptions("hr-contractors", (r) => `${String(r.contractorCode ?? "")} · ${String(r.name ?? "")}`);

  const params = useMemo(() => ({ year: period.year, month: period.month, contractorId: contractorId || undefined }), [period, contractorId]);

  const load = useCallback(async () => {
    setError(null);
    setReport(null);
    try {
      const qs = new URLSearchParams({ year: String(params.year), month: String(params.month) });
      if (params.contractorId) qs.set("contractorId", params.contractorId);
      setReport(await apiFetch<Report>(`/api/hr/contract-labour/overtime?${qs.toString()}`));
    } catch (err) {
      setError(err);
    }
  }, [params]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.rows ?? []).filter(
      (r) => (!onlyOvertime || r.overtimeMinutes > 0) && (!q || r.name.toLowerCase().includes(q) || r.workerCode.toLowerCase().includes(q) || r.contractor.toLowerCase().includes(q))
    );
  }, [report, query, onlyOvertime]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const period_label = `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  return (
    <>
      <PageHeader
        title="Overtime calculation"
        description="Hours beyond the shift's full day, paid at the worker's own rate, else the contractor's fixed rate, else day wage ÷ shift hours × the contractor's multiple."
        actions={
          <>
            <Link href="/hr/contract-labour/attendance" className="button buttonSecondary">
              Labour attendance
            </Link>
            <a className="button buttonSecondary" href={downloadHref("/api/hr/contract-labour/overtime", params, "xlsx")}>
              <IconDownload /> Excel
            </a>
            <a className="button buttonSecondary" href={downloadHref("/api/hr/contract-labour/overtime", params, "csv")}>
              <IconDownload /> CSV
            </a>
          </>
        }
      />

      <div className="toolbar">
        <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />
        <Select className="select" style={{ width: "auto", maxWidth: "16rem" }} value={contractorId} onChange={(e) => setContractorId(e.target.value)} aria-label="Contractor">
          <option value="">All contractors</option>
          {(contractorOptions ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <SearchBox value={query} onChange={setQuery} placeholder="Filter by worker or contractor…" width="14rem" />
        <label className="checkboxRow">
          <input type="checkbox" checked={onlyOvertime} onChange={(e) => setOnlyOvertime(e.target.checked)} />
          Only workers with overtime
        </label>
      </div>

      {report && (
        <div className="hrKpis" style={{ marginBottom: "1rem" }}>
          <Kpi label="Overtime hours" value={report.totals.overtimeHours} sub={period_label} />
          <Kpi label="Overtime amount" value={formatMoney(report.totals.overtimeAmount)} />
          <Kpi label="Wages" value={formatMoney(report.totals.wages)} sub={`${report.rows.length} worker row${report.rows.length === 1 ? "" : "s"}`} />
          <Kpi label="Wages + overtime" value={formatMoney(report.totals.total)} />
        </div>
      )}

      {report && report.contractorTotals.length > 1 && (
        <div className="tableWrap" style={{ marginBottom: "1rem" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Contractor</th>
                <th className="numCell">Workers</th>
                <th className="numCell">OT hours</th>
                <th className="numCell">Wages</th>
                <th className="numCell">OT amount</th>
                <th className="numCell">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.contractorTotals.map((c) => (
                <tr key={c.contractorId}>
                  <td>
                    <button type="button" className="textLink" onClick={() => setContractorId(c.contractorId)}>
                      {c.contractor}
                    </button>
                  </td>
                  <td className="numCell">{c.workers}</td>
                  <td className="numCell">{c.overtimeHours}</td>
                  <td className="numCell">{formatMoney(c.wages)}</td>
                  <td className="numCell">{formatMoney(c.overtimeAmount)}</td>
                  <td className="numCell">{formatMoney(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Contractor</th>
              <th className="numCell" title="Present + half days ÷ 2">Payable days</th>
              <th className="numCell">Day wage</th>
              <th className="numCell">Wages</th>
              <th className="numCell">OT days</th>
              <th className="numCell">OT hours</th>
              <th className="numCell">OT rate / hr</th>
              <th className="numCell">OT amount</th>
              <th className="numCell">Total</th>
            </tr>
          </thead>
          <tbody>
            {!report && !error && <SkeletonRows columns={10} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={10}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not work out overtime."} onRetry={load} />
                </td>
              </tr>
            )}
            {report && rows.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <EmptyState
                    title={report.rows.length === 0 ? `No labour attendance in ${period_label}` : "Nobody matches"}
                    description={report.rows.length === 0 ? "Mark days on Labour Attendance; overtime is worked out from them." : undefined}
                  />
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.workerId}:${r.contractorId}`}>
                <td>
                  <Link href={`/hr-contract-workers/${r.workerId}`} className="cellLink">
                    {r.name}
                  </Link>
                  <div className="hrMuted">{r.workerCode}</div>
                </td>
                <td>{r.contractor}</td>
                <td className="numCell" title={`${r.presentDays} present, ${r.halfDays} half, ${r.absentDays} absent`}>
                  {r.payableDays}
                </td>
                <td className="numCell">{formatMoney(r.dailyWage)}</td>
                <td className="numCell">{formatMoney(r.wages)}</td>
                <td className="numCell">{r.overtimeDays}</td>
                <td className="numCell">{r.overtimeHours}</td>
                <td className="numCell">{formatMoney(r.overtimeRate)}</td>
                <td className="numCell">{formatMoney(r.overtimeAmount)}</td>
                <td className="numCell">
                  <strong>{formatMoney(r.total)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
