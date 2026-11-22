"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { AttCode, AttLegend, MonthPicker, MONTH_NAMES, WEEKDAY_SHORT, downloadHref, useMasterOptions } from "@/components/hr/HrKit";
import { IconDownload, IconRefresh } from "@/components/icons";

interface Register {
  year: number;
  month: number;
  days: { date: string; day: number; weekday: number; holiday: string | null }[];
  rows: {
    employeeId: string;
    employeeCode: string;
    name: string;
    department: string;
    codes: string[];
    summary: { present: number; absent: number; halfDays: number; paidLeave: number; unpaidLeave: number; holidays: number; weeklyOffs: number; unmarked: number; lateDays: number; lopDays: number };
    payableDays: number;
  }[];
}

export default function AttendanceRegisterPage() {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [departmentId, setDepartmentId] = useState("");
  const departments = useMasterOptions("hr-departments", (r) => String(r.name));
  const [data, setData] = useState<Register | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const p = new URLSearchParams({ year: String(period.year), month: String(period.month) });
      if (departmentId) p.set("departmentId", departmentId);
      setData(await apiFetch<Register>(`/api/hr/attendance/register?${p.toString()}`));
    } catch (err) {
      setError(err);
    }
  }, [period, departmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useShortcutScope({ onRefresh: load });

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const params = { year: period.year, month: period.month, departmentId: departmentId || undefined };

  return (
    <>
      <PageHeader
        title="Attendance register"
        description={`Muster roll for ${MONTH_NAMES[period.month - 1]} ${period.year}. Loss-of-pay days here are what payroll deducts.`}
        actions={
          <>
            <Link href="/hr/attendance" className="button buttonSecondary">
              Mark attendance
            </Link>
            <a href={downloadHref("/api/hr/attendance/register", params, "xlsx")} className="button buttonSecondary">
              <IconDownload /> Excel
            </a>
          </>
        }
      />

      <div className="toolbar">
        <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />
        <select className="select" style={{ width: "auto" }} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} aria-label="Refresh">
            <IconRefresh />
          </button>
        </div>
      </div>

      <AttLegend />

      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load the register."} onRetry={load} />}
      {!data && !error && <SkeletonBlock height="20rem" />}
      {data && data.rows.length === 0 && <EmptyState title="Nobody was on the rolls this month" />}
      {data && data.rows.length > 0 && (
        <div className="regWrap">
          <table className="regTable">
            <thead>
              <tr>
                <th className="regName">Employee</th>
                {data.days.map((d) => (
                  <th key={d.date} className={d.weekday === 0 || d.holiday ? "regWeekend" : undefined} title={d.holiday ?? WEEKDAY_SHORT[d.weekday]}>
                    {d.day}
                    <div style={{ fontWeight: 400, fontSize: "0.625rem" }}>{WEEKDAY_SHORT[d.weekday].charAt(0)}</div>
                  </th>
                ))}
                <th className="regTotal" title="Present (including unmarked working days)">P</th>
                <th className="regTotal" title="Absent">A</th>
                <th className="regTotal" title="Paid leave">L</th>
                <th className="regTotal" title="Late arrivals">Late</th>
                <th className="regTotal" title="Loss-of-pay days">LOP</th>
                <th className="regTotal" title="Days paid">Paid</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="regName">
                    <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                      {r.name}
                    </Link>
                    <div className="hrMuted">{r.employeeCode}</div>
                  </td>
                  {r.codes.map((c, i) => (
                    <td key={i}>
                      <AttCode code={c} />
                    </td>
                  ))}
                  <td className="regTotal">{r.summary.present + r.summary.unmarked}</td>
                  <td className="regTotal">{r.summary.absent}</td>
                  <td className="regTotal">{r.summary.paidLeave}</td>
                  <td className="regTotal">{r.summary.lateDays}</td>
                  <td className="regTotal" style={r.summary.lopDays ? { color: "var(--danger)" } : undefined}>
                    {r.summary.lopDays}
                  </td>
                  <td className="regTotal">{r.payableDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
