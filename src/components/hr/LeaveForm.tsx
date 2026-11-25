"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { Option } from "./HrKit";
import { todayKey } from "./HrKit";
import Select from "@/components/ui/Select";

export interface LeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  allowNegative: boolean;
  allowHalfDay: boolean;
  allocated: number;
  /** The quota pro-rated for a mid-year joiner. */
  prorated?: boolean;
  carriedForward: number;
  used: number;
  pending: number;
  available: number;
}

/**
 * Leave application form. With `employees` it is HR filing for someone
 * (balances come from the employee's profile); without, it is the signed-in
 * employee applying for themselves.
 */
export default function LeaveForm({
  employees,
  initialEmployeeId,
  employeeLocked,
  selfBalances,
  submitUrl,
  onDone,
  onCancel,
}: {
  employees?: Option[] | null;
  initialEmployeeId?: string;
  /** The employee is fixed (people file only their own leave). */
  employeeLocked?: boolean;
  selfBalances?: LeaveBalance[];
  submitUrl: string;
  onDone: (result: { leaveNumber: string; days: number }) => void;
  onCancel?: () => void;
}) {
  const isHr = Boolean(employees);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? "");
  const [loaded, setLoaded] = useState<{ employeeId: string; balances: LeaveBalance[] } | null>(null);
  const [form, setForm] = useState({ leaveTypeId: "", fromDate: todayKey(), toDate: todayKey(), halfDay: false, reason: "" });
  // The preview is kept with the inputs it was computed for; anything else reads as "not known yet".
  const [preview, setPreview] = useState<{ key: string; days: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // HR: load the chosen employee's balances.
  useEffect(() => {
    if (!isHr || !employeeId) return;
    let cancelled = false;
    apiFetch<{ leaveBalances: LeaveBalance[] }>(`/api/hr/employees/${employeeId}`)
      .then((p) => {
        if (!cancelled) setLoaded({ employeeId, balances: p.leaveBalances });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ employeeId, balances: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isHr, employeeId]);

  const balances: LeaveBalance[] | null = isHr ? (loaded?.employeeId === employeeId ? loaded.balances : null) : selfBalances ?? null;

  const toDate = form.halfDay ? form.fromDate : form.toDate;
  const previewable = !(isHr && !employeeId) && Boolean(form.fromDate) && Boolean(toDate) && toDate >= form.fromDate;
  const previewKey = `${employeeId}|${form.fromDate}|${toDate}|${form.halfDay}`;
  const days = previewable && preview?.key === previewKey ? preview.days : null;

  // Live working-day count for the chosen dates.
  useEffect(() => {
    if (!previewable) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const q = new URLSearchParams({ fromDate: form.fromDate, toDate, halfDay: String(form.halfDay) });
      if (isHr) q.set("employeeId", employeeId);
      apiFetch<{ days: number }>(`/api/hr/leaves/preview?${q.toString()}`)
        .then((r) => {
          if (!cancelled) setPreview({ key: previewKey, days: r.days });
        })
        .catch(() => {
          if (!cancelled) setPreview({ key: previewKey, days: null });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [previewable, previewKey, isHr, employeeId, form.fromDate, toDate, form.halfDay]);

  const type = balances?.find((b) => b.leaveTypeId === form.leaveTypeId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ leaveNumber: string; days: number }>(submitUrl, {
        method: "POST",
        body: JSON.stringify({ ...(isHr ? { employeeId } : {}), ...form, toDate }),
      });
      onDone(res);
    } catch (err) {
      const detail = err instanceof ApiError && Array.isArray(err.errors) ? (err.errors as { message: string }[]).map((x) => x.message).join(", ") : "";
      setError(err instanceof ApiError ? `${err.message}${detail ? `: ${detail}` : ""}` : "Could not file the request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && (
        <div className="banner bannerError" role="alert" style={{ marginBottom: "0.75rem" }}>
          <span>{error}</span>
        </div>
      )}
      <div className="formGrid">
        {isHr && (
          <div className="field">
            <label htmlFor="lv-emp">
              Employee<span className="req">*</span>
            </label>
            <Select id="lv-emp" className="select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required disabled={employeeLocked}>
              <option value="">— choose —</option>
              {employees?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="field">
          <label htmlFor="lv-type">
            Leave type<span className="req">*</span>
          </label>
          <Select id="lv-type" className="select" value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value, halfDay: false })} required disabled={isHr && !employeeId}>
            <option value="">— choose —</option>
            {balances?.map((b) => (
              <option key={b.leaveTypeId} value={b.leaveTypeId}>
                {b.name} ({b.code}) · {b.allowNegative ? "no limit" : `${b.available - b.pending} left`}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="lv-from">
            From<span className="req">*</span>
          </label>
          <input id="lv-from" type="date" className="input" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: form.toDate < e.target.value ? e.target.value : form.toDate })} required />
        </div>
        <div className="field">
          <label htmlFor="lv-to">To</label>
          <input id="lv-to" type="date" className="input" value={form.halfDay ? form.fromDate : form.toDate} min={form.fromDate} disabled={form.halfDay} onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
        </div>
        {type?.allowHalfDay !== false && (
          <div className="fieldSpanFull">
            <label className="checkboxRow">
              <input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} />
              Half day (single date)
            </label>
          </div>
        )}
        <div className="field fieldSpanFull">
          <label htmlFor="lv-reason">Reason</label>
          <textarea id="lv-reason" className="input" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
      </div>
      <div className="formActionsBar">
        <span className="formActionsNote">
          {days === null ? "Weekly offs and holidays are not counted." : days === 0 ? "Those dates are all weekly offs or holidays." : `${days} working day${days === 1 ? "" : "s"}`}
          {type && !type.isPaid && " · unpaid (deducted from salary)"}
        </span>
        {onCancel && (
          <button type="button" className="button buttonSecondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="button buttonPrimary" disabled={saving || !form.leaveTypeId || (isHr && !employeeId) || days === 0}>
          {saving && <span className="spinner" />}
          {isHr ? "File request" : "Apply"}
        </button>
      </div>
    </form>
  );
}
