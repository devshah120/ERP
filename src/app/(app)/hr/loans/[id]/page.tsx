"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ErrorState, SkeletonBlock, EmptyState } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Card, Kpi, fmtDate, MONTH_NAMES } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconArrowLeft } from "@/components/icons";

interface Loan {
  id: string;
  loanNumber: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  loanType: string;
  issueDate: string;
  amount: string;
  emiAmount: string;
  repaidAmount: string;
  outstanding: string;
  instalmentsLeft: number;
  startMonth: number;
  startYear: number;
  status: string;
  reason: string;
  repayments: { month: number; year: number; amount: string; note: string; at: string }[];
}

export default function LoanPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [repayOpen, setRepayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [repay, setRepay] = useState({ amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLoan(await apiFetch<Loan>(`/api/hr/loans/${id}`));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(action: "repay" | "cancel") {
    setBusy(true);
    setDialogError(null);
    try {
      await apiFetch(`/api/hr/loans/${id}`, { method: "POST", body: JSON.stringify(action === "repay" ? { action, ...repay } : { action }) });
      toast.success(action === "repay" ? "Repayment recorded" : "Loan cancelled");
      setRepayOpen(false);
      setCancelOpen(false);
      setRepay({ amount: "", note: "" });
      load();
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  if (error) return <ErrorState message={error instanceof ApiError ? error.message : "Could not load this loan."} onRetry={load} />;
  if (!loan) return <SkeletonBlock lines={6} />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/loans" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Loans & advances
          </Link>
        }
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.625rem" }}>
            {loan.loanNumber} <StatusBadge status={loan.status} />
          </span>
        }
        description={
          <>
            <Link href={`/hr/employees/${loan.employeeId}`} className="textLink">
              {loan.employeeName}
            </Link>{" "}
            · {loan.loanType === "ADVANCE" ? "Salary advance" : "Loan"} issued {fmtDate(loan.issueDate)}
          </>
        }
        actions={
          loan.status === "ACTIVE" ? (
            <>
              {hasPermission("hr-loans.create") && (
                <button type="button" className="button buttonSecondary" onClick={() => (setDialogError(null), setRepayOpen(true))}>
                  Record repayment
                </button>
              )}
              {hasPermission("hr-loans.cancel") && loan.repayments.length === 0 && (
                <button type="button" className="button buttonGhost" onClick={() => (setDialogError(null), setCancelOpen(true))}>
                  Cancel loan
                </button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="hrKpis">
        <Kpi label="Amount" value={formatMoney(loan.amount)} />
        <Kpi label="Instalment" value={formatMoney(loan.emiAmount)} sub={`From ${MONTH_NAMES[loan.startMonth - 1]} ${loan.startYear}`} />
        <Kpi label="Recovered" value={formatMoney(loan.repaidAmount)} />
        <Kpi label="Outstanding" value={formatMoney(loan.outstanding)} sub={loan.status === "ACTIVE" ? `${loan.instalmentsLeft} instalment(s) left` : undefined} />
      </div>

      <Card title="Repayments">
        {loan.repayments.length === 0 ? (
          <EmptyState compact title="Nothing recovered yet" description="Instalments are recorded when a payroll run is approved." />
        ) : (
          <ul className="hrList">
            {loan.repayments.map((r, i) => (
              <li key={i}>
                <span>
                  {MONTH_NAMES[(r.month ?? 1) - 1]} {r.year}
                  <div className="hrMuted">{r.note}</div>
                </span>
                <span className="numCell">{formatMoney(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {loan.reason && <p className="hrMuted">Reason: {loan.reason}</p>}
      </Card>

      {repayOpen && (
        <Modal
          title="Record repayment"
          subtitle={`Paid back outside payroll (cash or transfer). ${formatMoney(loan.outstanding)} outstanding.`}
          onClose={() => setRepayOpen(false)}
          busy={busy}
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setRepayOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={() => act("repay")} disabled={busy || !repay.amount}>
                {busy && <span className="spinner" />} Record
              </button>
            </>
          }
        >
          {dialogError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{dialogError}</span>
            </div>
          )}
          <div className="formGrid">
            <div className="field">
              <label htmlFor="rp-amt">Amount</label>
              <input id="rp-amt" className="input" inputMode="decimal" value={repay.amount} onChange={(e) => setRepay({ ...repay, amount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="rp-note">Note</label>
              <input id="rp-note" className="input" value={repay.note} onChange={(e) => setRepay({ ...repay, note: e.target.value })} placeholder="Cash / UTR" />
            </div>
          </div>
        </Modal>
      )}
      {cancelOpen && (
        <ConfirmDialog
          title={`Cancel ${loan.loanNumber}?`}
          message="Nothing has been recovered yet, so the loan is simply voided."
          confirmLabel="Cancel loan"
          cancelLabel="Back"
          busy={busy}
          error={dialogError}
          onConfirm={() => act("cancel")}
          onCancel={() => setCancelOpen(false)}
        />
      )}
    </>
  );
}
