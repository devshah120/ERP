"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Kpi, fmtDate, todayKey } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";

interface Report {
  asOf: string;
  rules: { minYears: number; formula: string; ceiling: string };
  rows: { employeeId: string; employeeCode: string; name: string; department: string; dateOfJoining: string; service: string; completedYears: number; basic: string; eligible: boolean; accrued: string; payable: string; capped: boolean }[];
  totals: { accrued: string; payable: string };
}

/** Gratuity calculation: what each employee has accrued and would be paid on leaving, as of a date. */
export default function GratuityPage() {
  const [asOf, setAsOf] = useState(todayKey());
  const [query, setQuery] = useState("");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<Report>(`/api/hr/payroll/gratuity?asOf=${asOf}`));
    } catch (err) {
      setError(err);
    }
  }, [asOf]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => (!eligibleOnly || r.eligible) && (!q || r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)));
  }, [data, query, eligibleOnly]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Gratuity calculation"
        description={
          data
            ? `${data.rules.formula}; a final part-year over six months counts as a year. Payable after ${data.rules.minYears} years of service (not needed on death), up to ₹${Number(data.rules.ceiling).toLocaleString("en-IN")}. Check these rules with your payroll advisor.`
            : "Gratuity accrued and payable for everyone on the rolls."
        }
        actions={
          <Link href="/hr/payroll/fnf" className="button buttonSecondary">
            Full & final settlements
          </Link>
        }
      />

      {data && (
        <div className="hrKpis">
          <Kpi label="Employees" value={data.rows.length} sub={`on the rolls on ${fmtDate(data.asOf)}`} />
          <Kpi label="Eligible now" value={data.rows.filter((r) => r.eligible).length} sub={`${data.rules.minYears}+ years of service`} />
          <Kpi label="Payable if all left today" value={formatMoney(data.totals.payable)} />
          <Kpi label="Accrued liability" value={formatMoney(data.totals.accrued)} sub="For the gratuity provision" />
        </div>
      )}

      <div className="toolbar">
        <label className="hrMuted" htmlFor="gr-asof">
          As of
        </label>
        <input id="gr-asof" type="date" className="input" style={{ width: "auto" }} value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        <SearchBox value={query} onChange={setQuery} placeholder="Employee name or code…" width="14rem" />
        <label className="checkboxRow">
          <input type="checkbox" checked={eligibleOnly} onChange={(e) => setEligibleOnly(e.target.checked)} />
          Eligible only
        </label>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Joined</th>
              <th>Service</th>
              <th className="numCell">Years counted</th>
              <th className="numCell">Basic</th>
              <th className="numCell">Accrued</th>
              <th className="numCell">Payable</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={7} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={7}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not calculate gratuity."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState variant={query || eligibleOnly ? "search" : undefined} title="No employees" />
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <td>
                  <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                    {r.name}
                  </Link>
                  <div className="hrMuted">
                    {r.employeeCode}
                    {r.department ? ` · ${r.department}` : ""}
                  </div>
                </td>
                <td>{fmtDate(r.dateOfJoining)}</td>
                <td>{r.service}</td>
                <td className="numCell">{r.completedYears}</td>
                <td className="numCell">{formatMoney(r.basic)}</td>
                <td className="numCell">
                  {formatMoney(r.accrued)}
                  {r.capped && <div className="hrMuted">capped</div>}
                </td>
                <td className="numCell">{r.eligible ? <strong>{formatMoney(r.payable)}</strong> : <span className="cellMuted">Not yet eligible</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
