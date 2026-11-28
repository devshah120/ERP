"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { MonthPicker, MONTH_NAMES, fmtDate } from "@/components/hr/HrKit";
import { IconPlus } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Holds {
  locked: boolean;
  draftRunId: string | null;
  items: { id: string; employeeId: string; employeeName: string; employeeCode: string; department: string; reason: string; createdAt: string }[];
  candidates: { id: string; name: string; code: string }[];
}

function thisMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Block / unblock payroll: salary holds that keep an employee out of a month's payroll. */
export default function PayrollHoldsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(thisMonth());
  const [data, setData] = useState<Holds | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [blocking, setBlocking] = useState(false);
  const [form, setForm] = useState({ employeeId: "", reason: "" });
  const [releasing, setReleasing] = useState<Holds["items"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<Holds>(`/api/hr/payroll/holds?year=${period.year}&month=${period.month}`));
    } catch (err) {
      setError(err);
    }
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canManage = hasPermission("hr-payroll.approve") && !data?.locked;
  const label = `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  async function block() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await apiFetch<{ draftRunId: string | null }>("/api/hr/payroll/holds", { method: "POST", body: JSON.stringify({ ...form, ...period }) });
      if (!notifyHeld(toast, r)) toast.success("Salary put on hold", r.draftRunId ? "Recalculate the draft payroll to leave them out." : undefined);
      setBlocking(false);
      setForm({ employeeId: "", reason: "" });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!releasing) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await apiFetch<{ draftRunId: string | null }>(`/api/hr/payroll/holds/${releasing.id}`, { method: "DELETE" });
      if (!notifyHeld(toast, r)) toast.success(`${releasing.employeeName}'s salary released`, r.draftRunId ? "Recalculate the draft payroll to include them." : undefined);
      setReleasing(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Block / unblock payroll"
        count={data?.items.length ?? null}
        description={`Salaries on hold for ${label}. A held employee gets no payslip and is left out of the bank sheet until unblocked.`}
        actions={
          canManage && (
            <button type="button" className="button buttonPrimary" onClick={() => (setActionError(null), setBlocking(true))}>
              <IconPlus /> Block salary
            </button>
          )
        }
      />
      <div className="toolbar">
        <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />
      </div>

      {data?.locked && (
        <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
          <span>{label} payroll is approved, so its holds can&apos;t change. Roll it back first.</span>
        </div>
      )}
      {data?.draftRunId && !data.locked && (
        <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
          <span>
            A draft payroll exists for {label}. After blocking or unblocking,{" "}
            <Link href={`/hr/payroll/${data.draftRunId}`} className="textLink">
              recalculate it
            </Link>
            .
          </span>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Reason</th>
              <th>Blocked on</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={4} rows={3} />}
            {error !== null && (
              <tr>
                <td colSpan={4}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load holds."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState title="No salaries on hold" description={`Everyone on the rolls is paid with the ${label} payroll.`} />
                </td>
              </tr>
            )}
            {data?.items.map((h) => (
              <tr key={h.id}>
                <td>
                  <Link href={`/hr/employees/${h.employeeId}`} className="cellLink">
                    {h.employeeName}
                  </Link>
                  <div className="hrMuted">
                    {h.employeeCode}
                    {h.department ? ` · ${h.department}` : ""}
                  </div>
                </td>
                <td>{h.reason}</td>
                <td>{fmtDate(h.createdAt)}</td>
                <td style={{ textAlign: "right" }}>
                  {canManage && (
                    <button type="button" className="button buttonSecondary buttonSm" onClick={() => (setActionError(null), setReleasing(h))}>
                      Unblock
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {blocking && data && (
        <Modal
          title={`Block a salary for ${label}`}
          subtitle="They are left out of the month's payroll until unblocked."
          onClose={() => setBlocking(false)}
          busy={busy}
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setBlocking(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={block} disabled={busy || !form.employeeId || form.reason.trim().length < 3}>
                {busy && <span className="spinner" />} Block salary
              </button>
            </>
          }
        >
          {actionError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{actionError}</span>
            </div>
          )}
          <div className="field" style={{ marginBottom: "0.75rem" }}>
            <label htmlFor="hold-emp">Employee</label>
            <Select id="hold-emp" className="select" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">— Choose —</option>
              {data.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label htmlFor="hold-reason">Reason</label>
            <input id="hold-reason" className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Absconding; pending full and final; documents awaited" />
          </div>
        </Modal>
      )}
      {releasing && (
        <ConfirmDialog
          title={`Unblock ${releasing.employeeName}'s salary?`}
          message={`They will be paid with the ${label} payroll again.`}
          confirmLabel="Unblock"
          tone="primary"
          busy={busy}
          error={actionError}
          onConfirm={release}
          onCancel={() => setReleasing(null)}
        />
      )}
    </>
  );
}
