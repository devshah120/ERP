"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatMoney } from "@/lib/format/number";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { IconAlertCircle, IconArrowLeft } from "@/components/icons";

interface Option {
  id: string;
  label: string;
  role?: string | null;
}

const MODES = [
  { value: "CASH", label: "Cash" },
  { value: "BANK", label: "Bank transfer" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "CHEQUE", label: "Cheque" },
];

/** Record an expense; saving posts it to the ledger in the same step. */
export default function NewExpensePage() {
  const router = useRouter();
  const toast = useToast();
  const [opts, setOpts] = useState<{ expenseAccounts: Option[]; paidFromAccounts: Option[] } | null>(null);
  const [form, setForm] = useState({
    expenseDate: new Date().toISOString().slice(0, 10),
    expenseAccountId: "",
    paidFromAccountId: "",
    payee: "",
    paymentMode: "CASH",
    reference: "",
    amount: "",
    taxRatePercent: "0",
    interState: false,
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    apiFetch<{ expenseAccounts: Option[]; paidFromAccounts: Option[] }>("/api/expenses?options=1")
      .then((o) => {
        setOpts(o);
        const cash = o.paidFromAccounts.find((a) => a.role === "CASH") ?? o.paidFromAccounts[0];
        setForm((f) => ({ ...f, paidFromAccountId: f.paidFromAccountId || cash?.id || "" }));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load accounts"));
  }, []);

  useUnsavedChangesWarning(dirty && !saving);

  const totals = useMemo(() => {
    let amount: Decimal;
    try {
      amount = new Decimal(form.amount || "0");
    } catch {
      amount = new Decimal(0);
    }
    const tax = amount.times(Number(form.taxRatePercent) || 0).div(100).toDecimalPlaces(2);
    return { tax, total: amount.plus(tax) };
  }, [form.amount, form.taxRatePercent]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const created = await apiFetch<{ id: string; expenseNumber: string }>("/api/expenses", {
        method: "POST",
        body: JSON.stringify({ ...form, taxRatePercent: Number(form.taxRatePercent) || 0 }),
      });
      setDirty(false);
      toast.success(`Expense ${created.expenseNumber} recorded`);
      router.push(`/expenses/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the expense");
      if (err instanceof ApiError && Array.isArray(err.errors)) {
        const next: Record<string, string> = {};
        for (const i of err.errors as { path?: (string | number)[]; message: string }[]) if (i.path?.length) next[i.path.join(".")] = i.message;
        setFieldErrors(next);
      }
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: () => void submit() });

  const noAccounts = opts && opts.expenseAccounts.length === 0;

  function err(name: string) {
    return fieldErrors[name] ? <span className="fieldError">{fieldErrors[name]}</span> : null;
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/expenses" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Expenses
          </Link>
        }
        title="Record expense"
        description="The expense head and any input GST are debited; the cash or bank account is credited."
      />
      <form onSubmit={submit} style={{ maxWidth: "62rem" }}>
        {error && (
          <div className="banner bannerError" role="alert" style={{ marginBottom: "1rem" }}>
            <IconAlertCircle />
            <span>{error}</span>
          </div>
        )}
        {noAccounts && (
          <div className="banner bannerWarning" style={{ marginBottom: "1rem" }}>
            <span>
              There are no expense accounts yet. Set up the <Link href="/chart-of-accounts" className="textLink">chart of accounts</Link> first.
            </span>
          </div>
        )}
        <section className="formSection">
          <div className="formSectionHead">
            <h2 className="formSectionTitle">Expense</h2>
          </div>
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="e-date">Date<span className="req">*</span></label>
                <input id="e-date" type="date" className="input" value={form.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} />
                {err("expenseDate")}
              </div>
              <div className="field">
                <label htmlFor="e-head">Expense head<span className="req">*</span></label>
                <select id="e-head" className="select" value={form.expenseAccountId} onChange={(e) => set("expenseAccountId", e.target.value)}>
                  <option value="">— choose —</option>
                  {opts?.expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
                {err("expenseAccountId")}
              </div>
              <div className="field">
                <label htmlFor="e-payee">Paid to<span className="hint"> · Optional</span></label>
                <input id="e-payee" className="input" value={form.payee} onChange={(e) => set("payee", e.target.value)} placeholder="Landlord, electricity board…" />
              </div>
              <div className="field">
                <label htmlFor="e-amount">Amount (before GST)<span className="req">*</span></label>
                <input id="e-amount" className="input" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
                {err("amount")}
              </div>
              <div className="field">
                <label htmlFor="e-tax">GST rate %<span className="hint"> · if a GST bill was received</span></label>
                <select id="e-tax" className="select" value={form.taxRatePercent} onChange={(e) => set("taxRatePercent", e.target.value)}>
                  {[0, 5, 12, 18, 28].map((r) => (
                    <option key={r} value={r}>{r === 0 ? "No GST" : `${r}%`}</option>
                  ))}
                </select>
              </div>
              {Number(form.taxRatePercent) > 0 && (
                <div className="fieldSpanFull">
                  <label className="checkboxRow">
                    <input type="checkbox" checked={form.interState} onChange={(e) => set("interState", e.target.checked)} />
                    Supplier is in another state (IGST instead of CGST + SGST)
                  </label>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="formSection">
          <div className="formSectionHead">
            <h2 className="formSectionTitle">Payment</h2>
          </div>
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="e-from">Paid from<span className="req">*</span></label>
                <select id="e-from" className="select" value={form.paidFromAccountId} onChange={(e) => set("paidFromAccountId", e.target.value)}>
                  <option value="">— choose —</option>
                  {opts?.paidFromAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
                {err("paidFromAccountId")}
              </div>
              <div className="field">
                <label htmlFor="e-mode">Mode</label>
                <select id="e-mode" className="select" value={form.paymentMode} onChange={(e) => set("paymentMode", e.target.value)}>
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="e-ref">Reference<span className="hint"> · bill no., UTR, cheque no.</span></label>
                <input id="e-ref" className="input" value={form.reference} onChange={(e) => set("reference", e.target.value)} />
              </div>
              <div className="field fieldSpanFull">
                <label htmlFor="e-notes">Notes</label>
                <textarea id="e-notes" className="input" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
            </div>
          </div>
        </section>

        <div className="formActionsBar">
          <span className="formActionsNote">
            GST {formatMoney(totals.tax.toFixed(2))} · Total <strong>{formatMoney(totals.total.toFixed(2))}</strong>
            <span className="hideMobile"> · Ctrl + S to save</span>
          </span>
          <Link href="/expenses" className="button buttonSecondary">Cancel</Link>
          <button type="submit" className="button buttonPrimary" disabled={saving || Boolean(noAccounts)}>
            {saving && <span className="spinner" />}
            {saving ? "Recording…" : "Record expense"}
          </button>
        </div>
      </form>
    </>
  );
}
