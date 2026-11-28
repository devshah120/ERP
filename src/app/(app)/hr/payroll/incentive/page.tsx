"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Kpi, downloadHref, useMasterOptions } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconDownload, IconPlus, IconRefresh } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Row {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  dateOfJoining: string;
  dateOfExit: string | null;
  daysEmployed: number;
  weeklyOffs: number;
  holidays: number;
  workingDays: number;
  present: number;
  halfDays: number;
  onDuty: number;
  unmarked: number;
  paidLeave: number;
  unpaidLeave: number;
  absent: number;
  eligibleDays: number;
  percent: string;
  slab: number | null;
  incentiveDays: number;
  dayRate: string;
  amount: string;
  status: "PAYABLE" | "BELOW_SLAB" | "LEFT";
  posted: string | null;
}

interface Result {
  matrix: { id: string; code: string; name: string; basis: string; salaryBasis: string; dayDivisor: number; slabs: { minValue: number; incentiveDays: number }[] };
  period: { label: string; start: string; end: string };
  payout: { year: number; month: number; label: string; payroll: { runNumber: string; status: string } | null };
  rows: Row[];
  totals: { employees: number; payable: number; amount: string; posted: string };
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Attendance Incentive: a year of attendance per employee, the slab reached and the incentive added to the payout month's payroll. */
export default function AttendanceIncentivePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const matrices = useMasterOptions("hr-incentive-matrices", (r) => String(r.name));
  const departments = useMasterOptions("hr-departments", (r) => String(r.name));
  const [matrixId, setMatrixId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [departmentId, setDepartmentId] = useState("");
  const [query, setQuery] = useState("");
  const [onlyPayable, setOnlyPayable] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const canPost = hasPermission("hr-payroll.process");
  const activeMatrix = matrixId || matrices?.[0]?.id || "";

  const params = useMemo(() => ({ matrixId: activeMatrix, year, departmentId: departmentId || undefined }), [activeMatrix, year, departmentId]);

  const load = useCallback(async () => {
    if (!params.matrixId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ matrixId: params.matrixId, year: String(params.year) });
      if (params.departmentId) qs.set("departmentId", params.departmentId);
      setResult(await apiFetch<Result>(`/api/hr/payroll/incentive?${qs.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (result?.rows ?? []).filter((r) => (!onlyPayable || r.status === "PAYABLE") && (!q || r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q) || r.department.toLowerCase().includes(q)));
  }, [result, query, onlyPayable]);

  async function post() {
    setBusy(true);
    setPostError(null);
    try {
      const res = await apiFetch<{ added: number; removed: number; amount: string; payout: string; draftPayroll: string | null }>("/api/hr/payroll/incentive", { method: "POST", body: JSON.stringify(params) });
      if (notifyHeld(toast, res)) {
        setConfirming(false);
        return void load();
      }
      toast.success(
        `Incentive added to ${res.payout} payroll for ${res.added} employee${res.added === 1 ? "" : "s"}`,
        res.draftPayroll ? `Regenerate draft ${res.draftPayroll} so it includes the incentive.` : "It is paid when that month's payroll is generated."
      );
      setConfirming(false);
      load();
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear - 4 + i);
  const locked = result?.payout.payroll && result.payout.payroll.status !== "DRAFT";
  const exportParams = { matrixId: params.matrixId, year: params.year, departmentId: params.departmentId };

  return (
    <>
      <PageHeader
        title="Attendance incentive"
        description={
          result
            ? `${result.matrix.name} · ${result.period.label} attendance, paid in ${result.payout.label} payroll. One day = monthly ${result.matrix.salaryBasis.toLowerCase()} ÷ ${result.matrix.dayDivisor}.`
            : "Working days, holidays, weekly offs and attendance for the year, and the incentive each employee earns from the incentive matrix."
        }
        actions={
          <>
            <Link href="/hr-incentive-matrices" className="button buttonSecondary">
              Incentive matrix
            </Link>
            {result && (
              <>
                <a className="button buttonSecondary" href={downloadHref("/api/hr/payroll/incentive", exportParams, "xlsx")}>
                  <IconDownload /> Excel
                </a>
                <a className="button buttonSecondary" href={downloadHref("/api/hr/payroll/incentive", exportParams, "csv")}>
                  <IconDownload /> CSV
                </a>
              </>
            )}
            {canPost && result && (
              <button type="button" className="button buttonPrimary" onClick={() => (setPostError(null), setConfirming(true))} disabled={Boolean(locked) || result.totals.payable === 0}>
                <IconPlus /> Add to {result.payout.label} payroll
              </button>
            )}
          </>
        }
      />

      {matrices && matrices.length === 0 && (
        <div className="banner bannerInfo" style={{ marginBottom: "1rem" }}>
          <span>
            No incentive matrix yet. <Link href="/hr-incentive-matrices/new" className="textLink">Create one</Link> with slabs such as “250 days present → 5 days&apos; salary”.
          </span>
        </div>
      )}

      <div className="toolbar">
        <Select className="select" style={{ width: "auto", minWidth: "12rem" }} value={activeMatrix} onChange={(e) => setMatrixId(e.target.value)} aria-label="Incentive matrix">
          {(matrices ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        <Select className="select" style={{ width: "auto" }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Attendance year">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Select className="select" style={{ width: "auto" }} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {(departments ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
        <SearchBox value={query} onChange={setQuery} placeholder="Filter by name, code…" width="14rem" />
        <label className="checkboxRow">
          <input type="checkbox" checked={onlyPayable} onChange={(e) => setOnlyPayable(e.target.checked)} />
          Only those getting an incentive
        </label>
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="hrKpis" style={{ marginBottom: "0.75rem" }}>
            <Kpi label="Employees" value={result.totals.employees} sub={`${result.period.label} attendance`} />
            <Kpi label="Getting an incentive" value={result.totals.payable} sub={result.matrix.slabs.map((s) => `${s.minValue}${result.matrix.basis === "PERCENT" ? "%" : "d"} → ${s.incentiveDays}d`).join(" · ")} />
            <Kpi label="Total incentive" value={formatMoney(result.totals.amount)} />
            <Kpi
              label={`In ${result.payout.label} payroll`}
              value={formatMoney(result.totals.posted)}
              sub={result.payout.payroll ? `Payroll ${result.payout.payroll.runNumber} · ${result.payout.payroll.status.toLowerCase()}` : "Payroll not generated yet"}
            />
          </div>
          {locked && (
            <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
              <span>
                {result.payout.label} payroll is {result.payout.payroll!.status.toLowerCase()}, so the incentive can no longer be changed there.
              </span>
            </div>
          )}
          {result.totals.posted !== "0.00" && result.totals.posted !== result.totals.amount && !locked && (
            <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
              <span>The amounts in {result.payout.label} payroll differ from today&apos;s calculation (attendance or salary changed). Add it to payroll again to update them.</span>
            </div>
          )}
        </>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="numCell" title="Days on the rolls in the year">Employed</th>
              <th className="numCell">Week offs</th>
              <th className="numCell">Holidays</th>
              <th className="numCell" title="Employed − weekly offs − holidays">Working days</th>
              <th className="numCell" title="Half days count half">Present</th>
              <th className="numCell">On duty</th>
              <th className="numCell" title="Working days with nothing marked">Unmarked</th>
              <th className="numCell">Paid leave</th>
              <th className="numCell">Unpaid leave</th>
              <th className="numCell">Absent</th>
              <th className="numCell" title="Days that count towards the slab">Counted</th>
              <th className="numCell">Incentive days</th>
              <th className="numCell">Day&apos;s salary</th>
              <th className="numCell">Incentive</th>
            </tr>
          </thead>
          <tbody>
            {!result && !error && activeMatrix && <SkeletonRows columns={15} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={15}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not work out the incentive."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && rows.length === 0 && (
              <tr>
                <td colSpan={15}>
                  <EmptyState title={result.rows.length === 0 ? `Nobody was employed in ${result.period.label}` : "Nobody matches"} />
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
                <td className="numCell">{r.daysEmployed}</td>
                <td className="numCell">{r.weeklyOffs}</td>
                <td className="numCell">{r.holidays}</td>
                <td className="numCell">
                  <strong>{r.workingDays}</strong>
                </td>
                <td className="numCell" title={r.halfDays ? `${r.halfDays} half day(s) included as half` : undefined}>
                  {n(r.present)}
                </td>
                <td className="numCell">{r.onDuty || "—"}</td>
                <td className="numCell">{r.unmarked || "—"}</td>
                <td className="numCell">{r.paidLeave ? n(r.paidLeave) : "—"}</td>
                <td className="numCell">{r.unpaidLeave ? n(r.unpaidLeave) : "—"}</td>
                <td className="numCell">{r.absent || "—"}</td>
                <td className="numCell" title={`${r.percent}% of days employed`}>
                  <strong>{n(r.eligibleDays)}</strong>
                </td>
                <td className="numCell">{r.incentiveDays ? n(r.incentiveDays) : "—"}</td>
                <td className="numCell">{formatMoney(r.dayRate)}</td>
                <td className="numCell">
                  {r.status === "PAYABLE" ? <strong>{formatMoney(r.amount)}</strong> : <span className="cellMuted">{r.status === "LEFT" ? "Left" : "—"}</span>}
                  {r.posted && <div className="hrMuted">In payroll: {formatMoney(r.posted)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming && result && (
        <ConfirmDialog
          title={`Add the incentive to ${result.payout.label} payroll?`}
          message={`${formatMoney(result.totals.amount)} for ${result.totals.payable} employee(s), as “Attendance incentive” variable pay. Amounts added before are replaced.${result.payout.payroll ? ` Draft ${result.payout.payroll.runNumber} must be regenerated to include it.` : ""}`}
          confirmLabel="Add to payroll"
          cancelLabel="Back"
          tone="primary"
          busy={busy}
          error={postError}
          onConfirm={post}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
