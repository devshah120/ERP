"use client";

import { useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { CLAIM_CATEGORY_LABELS, todayKey, type Option } from "./HrKit";
import Select from "@/components/ui/Select";

/** Expense claim form; with `employees` HR records it for someone, without it is the employee's own claim. */
export default function ClaimForm({
  employees,
  submitUrl,
  onDone,
  onCancel,
}: {
  employees?: Option[] | null;
  submitUrl: string;
  onDone: (r: { claimNumber: string }) => void;
  onCancel?: () => void;
}) {
  const isHr = Boolean(employees);
  const [form, setForm] = useState({ employeeId: "", claimDate: todayKey(), category: "TRAVEL", amount: "", description: "", billReference: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { employeeId, ...rest } = form;
      const res = await apiFetch<{ claimNumber: string }>(submitUrl, { method: "POST", body: JSON.stringify(isHr ? { employeeId, ...rest } : rest) });
      onDone(res);
    } catch (err) {
      const detail = err instanceof ApiError && Array.isArray(err.errors) ? (err.errors as { message: string }[]).map((x) => x.message).join(", ") : "";
      setError(err instanceof ApiError ? `${err.message}${detail ? `: ${detail}` : ""}` : "Could not save the claim");
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
            <label htmlFor="cl-emp">
              Employee<span className="req">*</span>
            </label>
            <Select id="cl-emp" className="select" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required>
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
          <label htmlFor="cl-date">Date of expense</label>
          <input id="cl-date" type="date" className="input" value={form.claimDate} onChange={(e) => setForm({ ...form, claimDate: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cl-cat">Category</label>
          <Select id="cl-cat" className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CLAIM_CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="cl-amt">
            Amount<span className="req">*</span>
          </label>
          <input id="cl-amt" className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" required />
        </div>
        <div className="field">
          <label htmlFor="cl-bill">Bill / receipt no.</label>
          <input id="cl-bill" className="input" value={form.billReference} onChange={(e) => setForm({ ...form, billReference: e.target.value })} />
        </div>
        <div className="field fieldSpanFull">
          <label htmlFor="cl-desc">
            What was it for?<span className="req">*</span>
          </label>
          <textarea id="cl-desc" className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        </div>
      </div>
      <div className="formActionsBar">
        <span className="formActionsNote">Approved claims are paid with the next payroll.</span>
        {onCancel && (
          <button type="button" className="button buttonSecondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="button buttonPrimary" disabled={saving || (isHr && !form.employeeId)}>
          {saving && <span className="spinner" />} {isHr ? "Save claim" : "Submit claim"}
        </button>
      </div>
    </form>
  );
}
