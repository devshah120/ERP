"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import AccessDenied from "@/components/ui/AccessDenied";
import { MonthPicker, todayKey, useEmployeeOptions, MONTH_NAMES } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconArrowLeft } from "@/components/icons";
import Select from "@/components/ui/Select";

export default function NewLoanPage() {
  return (
    <Suspense fallback={null}>
      <NewLoan />
    </Suspense>
  );
}

function nextMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function NewLoan() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const employees = useEmployeeOptions();
  const [form, setForm] = useState({
    employeeId: params.get("employeeId") ?? "",
    loanType: "ADVANCE",
    issueDate: todayKey(),
    amount: "",
    emiAmount: "",
    reason: "",
  });
  const [start, setStart] = useState(nextMonth());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instalments = useMemo(() => {
    try {
      const a = new Decimal(form.amount || "0");
      const e = new Decimal(form.emiAmount || "0");
      return a.gt(0) && e.gt(0) ? a.div(e).ceil().toNumber() : null;
    } catch {
      return null;
    }
  }, [form.amount, form.emiAmount]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ id: string; loanNumber: string }>("/api/hr/loans", {
        method: "POST",
        body: JSON.stringify({ ...form, startMonth: start.month, startYear: start.year }),
      });
      if (notifyHeld(toast, res)) return router.push("/hr/loans");
      toast.success(`${res.loanNumber} recorded`);
      router.push(`/hr/loans/${res.id}`);
    } catch (err) {
      const detail = err instanceof ApiError && Array.isArray(err.errors) ? (err.errors as { message: string }[]).map((x) => x.message).join(", ") : "";
      setError(err instanceof ApiError ? `${err.message}${detail ? `: ${detail}` : ""}` : "Could not record the loan");
    } finally {
      setSaving(false);
    }
  }

  if (!hasPermission("hr-loans.create")) return <AccessDenied detail="Missing required permission: hr-loans.create" />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/loans" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Loans & advances
          </Link>
        }
        title="New loan / advance"
        description="Instalments are deducted from salary from the start month until the loan is recovered."
      />
      <form onSubmit={submit} style={{ maxWidth: "52rem" }}>
        {error && (
          <div className="banner bannerError" role="alert" style={{ marginBottom: "1rem" }}>
            <span>{error}</span>
          </div>
        )}
        <section className="formSection">
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="ln-emp">
                  Employee<span className="req">*</span>
                </label>
                <Select id="ln-emp" className="select" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required>
                  <option value="">— choose —</option>
                  {employees?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="field">
                <label htmlFor="ln-type">Type</label>
                <Select id="ln-type" className="select" value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })}>
                  <option value="ADVANCE">Salary advance</option>
                  <option value="LOAN">Loan</option>
                </Select>
              </div>
              <div className="field">
                <label htmlFor="ln-date">Issued on</label>
                <input id="ln-date" type="date" className="input" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ln-amt">
                  Amount<span className="req">*</span>
                </label>
                <input id="ln-amt" className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" required />
              </div>
              <div className="field">
                <label htmlFor="ln-emi">
                  Monthly instalment<span className="req">*</span>
                </label>
                <input id="ln-emi" className="input" inputMode="decimal" value={form.emiAmount} onChange={(e) => setForm({ ...form, emiAmount: e.target.value })} placeholder="0.00" required />
              </div>
              <div className="field">
                <label>First deduction in</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <MonthPicker year={start.year} month={start.month} onChange={setStart} />
                </div>
              </div>
              <div className="field fieldSpanFull">
                <label htmlFor="ln-reason">Reason</label>
                <textarea id="ln-reason" className="input" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
            </div>
          </div>
        </section>
        <div className="formActionsBar">
          <span className="formActionsNote">
            {instalments ? `${instalments} instalment${instalments === 1 ? "" : "s"} of ${formatMoney(form.emiAmount)}, from ${MONTH_NAMES[start.month - 1]} ${start.year}` : "Enter the amount and instalment"}
          </span>
          <Link href="/hr/loans" className="button buttonSecondary">
            Cancel
          </Link>
          <button type="submit" className="button buttonPrimary" disabled={saving}>
            {saving && <span className="spinner" />} Save
          </button>
        </div>
      </form>
    </>
  );
}
