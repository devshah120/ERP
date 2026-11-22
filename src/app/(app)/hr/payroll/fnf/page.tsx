"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate, todayKey, useEmployeeOptions } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconPlus } from "@/components/icons";

interface Row {
  id: string;
  settlementNumber: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  separationType: string;
  lastWorkingDay: string;
  netPayable: string;
  status: string;
}

const SEPARATION_LABELS: Record<string, string> = { RESIGNED: "Resigned", TERMINATED: "Terminated", RETIRED: "Retired" };

/** Full & final settlements of leaving employees. */
export default function FnfListPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const employees = useEmployeeOptions();
  const [status, setStatus] = useState("");
  const [data, setData] = useState<{ items: Row[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ employeeId: "", separationType: "RESIGNED", resignationDate: "", lastWorkingDay: todayKey(), noticeDays: "30", exitReason: "" });
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch(`/api/hr/payroll/fnf${status ? `?status=${status}` : ""}`));
    } catch (err) {
      setError(err);
    }
  }, [status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      const r = await apiFetch<{ id: string }>("/api/hr/payroll/fnf", { method: "POST", body: JSON.stringify({ ...form, noticeDays: Number(form.noticeDays) || 0 }) });
      router.push(`/hr/payroll/fnf/${r.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  const canCreate = hasPermission("hr-payroll.process");

  return (
    <>
      <PageHeader
        title="Full & final settlement"
        count={data?.items.length ?? null}
        description="Settle a leaving employee: salary up to the last working day, leave encashment, gratuity and arrears, less notice recovery and loans. Approving records the exit and recovers the loans."
        actions={
          <>
            <Link href="/hr/payroll/gratuity" className="button buttonSecondary">
              Gratuity
            </Link>
            {canCreate && (
              <button type="button" className="button buttonPrimary" onClick={() => (setCreateError(null), setCreating(true))}>
                <IconPlus /> New settlement
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <select className="select" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Status: All</option>
          <option value="DRAFT">Draft</option>
          <option value="APPROVED">Approved</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Settlement</th>
              <th>Employee</th>
              <th>Separation</th>
              <th>Last working day</th>
              <th className="numCell">Net payable</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={6} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={6}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load settlements."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState title="No settlements yet" description="Start one when an employee resigns, retires or is let go." />
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/payroll/fnf/${r.id}`} className="cellLink cellMono">
                    {r.settlementNumber}
                  </Link>
                </td>
                <td>
                  {r.employeeName}
                  <div className="hrMuted">
                    {r.employeeCode}
                    {r.department ? ` · ${r.department}` : ""}
                  </div>
                </td>
                <td>{SEPARATION_LABELS[r.separationType] ?? r.separationType}</td>
                <td>{fmtDate(r.lastWorkingDay)}</td>
                <td className="numCell">
                  <strong style={Number(r.netPayable) < 0 ? { color: "var(--danger)" } : undefined}>{formatMoney(r.netPayable)}</strong>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <Modal
          title="New full & final settlement"
          subtitle="It is calculated as a draft you can review, adjust and recalculate before approving."
          onClose={() => setCreating(false)}
          busy={busy}
          width="40rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={create} disabled={busy || !form.employeeId || !form.lastWorkingDay}>
                {busy && <span className="spinner" />} Calculate settlement
              </button>
            </>
          }
        >
          {createError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{createError}</span>
            </div>
          )}
          <div className="formGrid">
            <div className="field fieldSpanFull">
              <label htmlFor="fnf-emp">Employee</label>
              <select id="fnf-emp" className="select" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">— Choose —</option>
                {employees?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fnf-type">Separation</label>
              <select id="fnf-type" className="select" value={form.separationType} onChange={(e) => setForm({ ...form, separationType: e.target.value })}>
                {Object.entries(SEPARATION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fnf-notice">Notice period (days)</label>
              <input id="fnf-notice" className="input" inputMode="numeric" value={form.noticeDays} onChange={(e) => setForm({ ...form, noticeDays: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div className="field">
              <label htmlFor="fnf-res">Resignation / notice date</label>
              <input id="fnf-res" type="date" className="input" value={form.resignationDate} onChange={(e) => setForm({ ...form, resignationDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="fnf-lwd">Last working day</label>
              <input id="fnf-lwd" type="date" className="input" value={form.lastWorkingDay} onChange={(e) => setForm({ ...form, lastWorkingDay: e.target.value })} />
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="fnf-reason">Reason for leaving</label>
              <input id="fnf-reason" className="input" value={form.exitReason} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} placeholder="e.g. Better opportunity" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
