"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { MonthPicker, MONTH_NAMES } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconPlus, IconRefresh, IconWarning } from "@/components/icons";

interface Run {
  id: string;
  runNumber: string;
  period: string;
  status: string;
  employeeCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalEmployerContribution: string;
  paidAt: string | null;
}

interface Readiness {
  employees: number;
  noSalary: { id: string; code: string; name: string }[];
  noBank: { id: string; code: string; name: string }[];
  pendingLeaves: number;
  /** Employees with working days that have no attendance; payroll pays those days as present. */
  unmarked: { id: string; code: string; name: string; days: number }[];
  unmarkedDays: number;
}

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function PayrollRunsPage() {
  const router = useRouter();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [result, setResult] = useState<{ items: Run[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [period, setPeriod] = useState(lastMonth());
  // Readiness is kept with the month it was checked for, so a stale answer never shows for a newly picked month.
  const [checked, setChecked] = useState<{ key: string; data: Readiness | null } | null>(null);
  const periodKey = `${period.year}-${period.month}`;
  const readiness = checked?.key === periodKey ? checked.data : null;
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) p.set("status", status);
      setResult(await apiFetch(`/api/hr/payroll?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!creating) return;
    let cancelled = false;
    const key = `${period.year}-${period.month}`;
    apiFetch<Readiness>(`/api/hr/payroll/readiness?year=${period.year}&month=${period.month}`)
      .then((r) => {
        if (!cancelled) setChecked({ key, data: r });
      })
      .catch(() => {
        if (!cancelled) setChecked({ key, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [creating, period]);

  const canProcess = hasPermission("hr-payroll.process");
  useShortcutScope({ onNew: canProcess ? () => setCreating(true) : undefined, onRefresh: load });

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      const res = await apiFetch<{ id: string; runNumber: string; payslips: number }>("/api/hr/payroll", { method: "POST", body: JSON.stringify(period) });
      toast.success(`Payroll ${res.runNumber} drafted`, `${res.payslips} payslip(s). Review them, then approve.`);
      router.push(`/hr/payroll/${res.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not run payroll");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Payroll"
        count={result?.total ?? null}
        description="One run per month. Draft → review payslips → approve (locks attendance, recovers loans, pays claims) → mark paid."
        actions={
          <>
            <Link href="/hr/reports" className="button buttonSecondary">
              Salary reports
            </Link>
            {canProcess && (
              <button type="button" className="button buttonPrimary" onClick={() => setCreating(true)} title="Run payroll (Ctrl + N)">
                <IconPlus /> Run payroll
              </button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="">Status: All</option>
          <option value="DRAFT">Draft</option>
          <option value="APPROVED">Approved</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Month</th>
              <th className="numCell">Employees</th>
              <th className="numCell">Gross</th>
              <th className="numCell">Deductions</th>
              <th className="numCell">Net pay</th>
              <th className="numCell">Employer cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={8} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={8}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load payroll runs."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    title="No payroll yet"
                    description="Make sure every employee has a salary structure, then run payroll for a month."
                    actions={
                      canProcess ? (
                        <button type="button" className="button buttonPrimary" onClick={() => setCreating(true)}>
                          <IconPlus /> Run payroll
                        </button>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/payroll/${r.id}`} className="cellLink cellMono">
                    {r.runNumber}
                  </Link>
                </td>
                <td>{r.period}</td>
                <td className="numCell">{r.employeeCount}</td>
                <td className="numCell">{formatMoney(r.totalGross)}</td>
                <td className="numCell">{formatMoney(r.totalDeductions)}</td>
                <td className="numCell">
                  <strong>{formatMoney(r.totalNet)}</strong>
                </td>
                <td className="numCell">{formatMoney(r.totalEmployerContribution)}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />}
      </div>

      {creating && (
        <Modal
          title="Run payroll"
          subtitle="Computes every payslip from salary structures, attendance (loss-of-pay days), loan instalments and approved claims. It starts as a draft you can recalculate."
          onClose={() => setCreating(false)}
          busy={busy}
          width="38rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={create} disabled={busy}>
                {busy && <span className="spinner" />} Draft payroll for {MONTH_NAMES[period.month - 1]}
              </button>
            </>
          }
        >
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />
          </div>
          {createError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{createError}</span>
            </div>
          )}
          {!readiness ? (
            <p className="hrMuted">Checking employees…</p>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>{readiness.employees}</strong> employee{readiness.employees === 1 ? "" : "s"} on the rolls in {MONTH_NAMES[period.month - 1]} {period.year}.
              </p>
              {readiness.noSalary.length > 0 && (
                <div className="banner bannerWarning" style={{ marginBottom: "0.5rem" }}>
                  <IconWarning />
                  <span>
                    No salary set for {readiness.noSalary.length}: {readiness.noSalary.slice(0, 5).map((e) => e.name).join(", ")}
                    {readiness.noSalary.length > 5 ? "…" : ""}. They will get a zero payslip.
                  </span>
                </div>
              )}
              {readiness.noBank.length > 0 && (
                <div className="banner bannerWarning" style={{ marginBottom: "0.5rem" }}>
                  <IconWarning />
                  <span>
                    Bank details missing for {readiness.noBank.length}: {readiness.noBank.slice(0, 5).map((e) => e.name).join(", ")}
                    {readiness.noBank.length > 5 ? "…" : ""}.
                  </span>
                </div>
              )}
              {readiness.pendingLeaves > 0 && (
                <div className="banner bannerInfo" style={{ marginBottom: "0.5rem" }}>
                  <span>
                    {readiness.pendingLeaves} leave request(s) in this month are still pending. <Link href="/hr/leaves?status=PENDING" className="textLink">Decide them first</Link> so unpaid leave is deducted correctly.
                  </span>
                </div>
              )}
              {readiness.unmarkedDays > 0 && (
                <div className="banner bannerWarning" style={{ marginBottom: "0.5rem" }}>
                  <IconWarning />
                  <span>
                    {readiness.unmarkedDays} working day(s) have no attendance for {readiness.unmarked.length} employee(s):{" "}
                    {readiness.unmarked
                      .slice(0, 5)
                      .map((e) => `${e.name} (${e.days})`)
                      .join(", ")}
                    {readiness.unmarked.length > 5 ? "…" : ""}. Unmarked days are paid as present, and approving needs your confirmation.{" "}
                    <Link href="/hr/attendance/register" className="textLink">
                      Open the attendance register
                    </Link>
                  </span>
                </div>
              )}
              {readiness.noSalary.length === 0 && readiness.noBank.length === 0 && readiness.pendingLeaves === 0 && readiness.unmarkedDays === 0 && readiness.employees > 0 && (
                <div className="banner bannerSuccess">
                  <span>Everything looks ready.</span>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
