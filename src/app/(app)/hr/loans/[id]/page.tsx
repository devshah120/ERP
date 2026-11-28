"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ErrorState, SkeletonBlock, EmptyState } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Card, Kpi, fmtDate, MONTH_NAMES, CLAIM_CATEGORY_LABELS } from "@/components/hr/HrKit";
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
  requestedBy: string;
  decisionNote: string;
  repayments: { month: number; year: number; amount: string; note: string; at: string; viaClaims: boolean }[];
}

interface ClaimOption {
  id: string;
  claimNumber: string;
  claimDate: string;
  category: string;
  amount: string;
  description: string;
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
  const [setOffOpen, setSetOffOpen] = useState(false);
  const [claims, setClaims] = useState<ClaimOption[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

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
      const res = await apiFetch<unknown>(`/api/hr/loans/${id}`, { method: "POST", body: JSON.stringify(action === "repay" ? { action, ...repay } : { action }) });
      if (!notifyHeld(toast, res)) toast.success(action === "repay" ? "Repayment recorded" : "Loan cancelled");
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

  async function openSetOff() {
    if (!loan) return;
    setDialogError(null);
    setPicked(new Set());
    setClaims(null);
    setSetOffOpen(true);
    try {
      const r = await apiFetch<{ items: ClaimOption[] }>(`/api/hr/claims?status=APPROVED&employeeId=${loan.employeeId}&pageSize=100`);
      setClaims(r.items);
    } catch (err) {
      setClaims([]);
      setDialogError(err instanceof ApiError ? err.message : "Could not load the employee's claims");
    }
  }

  async function setOff() {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await apiFetch<{ adjusted: string; status: string }>(`/api/hr/loans/${id}`, { method: "POST", body: JSON.stringify({ action: "adjust-claims", claimIds: [...picked] }) });
      if (!notifyHeld(toast, r)) toast.success(`${formatMoney(r.adjusted)} set off against claims`, r.status === "CLOSED" ? "The advance is now fully settled." : undefined);
      setSetOffOpen(false);
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
            <IconArrowLeft /> Advance settlement
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
              {hasPermission("hr-loans.create") && hasPermission("hr-claims.approve") && (
                <button type="button" className="button buttonSecondary" onClick={openSetOff}>
                  Set off against claims
                </button>
              )}
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

      {loan.status === "REQUESTED" && (
        <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
          <span>
            This is a request waiting for a decision. Approve or reject it on{" "}
            <Link href="/hr/loans/requests" className="textLink">
              Loan / Advance Request
            </Link>
            .
          </span>
        </div>
      )}
      {loan.decisionNote && (
        <p className="hrMuted" style={{ marginBottom: "0.75rem" }}>
          {loan.status === "REJECTED" ? "Rejected" : "Decision note"}: {loan.decisionNote}
        </p>
      )}

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
      {setOffOpen && (
        <Modal
          title="Set off against claims"
          subtitle={`Tick ${loan.employeeName}'s approved claims to settle against this advance instead of paying them. ${formatMoney(loan.outstanding)} outstanding.`}
          onClose={() => setSetOffOpen(false)}
          busy={busy}
          width="40rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setSetOffOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={setOff} disabled={busy || picked.size === 0}>
                {busy && <span className="spinner" />} Set off {picked.size > 0 ? `(${picked.size})` : ""}
              </button>
            </>
          }
        >
          {dialogError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{dialogError}</span>
            </div>
          )}
          {!claims && <SkeletonBlock lines={3} />}
          {claims && claims.length === 0 && !dialogError && <EmptyState compact title="No approved, unpaid claims" description="Only approved claims not yet paid can be set off." />}
          {claims && claims.length > 0 && (
            <ul className="hrList">
              {claims.map((c) => (
                <li key={c.id}>
                  <label className="checkboxRow" style={{ alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={picked.has(c.id)}
                      onChange={() =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      {c.claimNumber} · {CLAIM_CATEGORY_LABELS[c.category] ?? c.category} · {fmtDate(c.claimDate)}
                      <div className="hrMuted">{c.description}</div>
                    </span>
                  </label>
                  <span className="numCell">{formatMoney(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
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
