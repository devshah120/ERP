"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ErrorState, SkeletonBlock, EmptyState } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Kpi, todayKey, downloadHref } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconArrowLeft, IconCheck, IconDownload, IconRefresh } from "@/components/icons";

interface Line {
  code: string;
  label: string;
  amount: string;
}

interface Slip {
  id: string;
  employeeId: string;
  employee: { code: string; name: string; department: string; designation: string; paymentMode: string };
  daysInMonth: number;
  payableDays: number;
  lopDays: number;
  earnings: Line[];
  deductions: Line[];
  grossEarnings: string;
  reimbursements: string;
  totalDeductions: string;
  netPay: string;
}

interface RunView {
  run: {
    id: string;
    runNumber: string;
    month: number;
    year: number;
    period: string;
    status: string;
    employeeCount: number;
    totalGross: string;
    totalReimbursements: string;
    totalDeductions: string;
    totalNet: string;
    totalEmployerContribution: string;
    approvedAt: string | null;
    paidAt: string | null;
    paymentReference: string;
    cancelReason: string;
  };
  payslips: Slip[];
}

const amount = (lines: Line[], code: string) => lines.find((l) => l.code === code)?.amount ?? "0";

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [data, setData] = useState<RunView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"approve" | "cancel" | "pay" | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pay, setPay] = useState({ paidOn: todayKey(), reference: "" });
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<RunView>(`/api/hr/payroll/${id}`));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(action: "recompute" | "approve" | "pay" | "cancel", extra: Record<string, unknown> = {}) {
    setBusy(true);
    setDialogError(null);
    try {
      const res = await apiFetch<{ status?: string }>(`/api/hr/payroll/${id}`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
      setDialog(null);
      if (res.status === "DELETED") {
        toast.success("Draft payroll deleted");
        router.push("/hr/payroll");
        return;
      }
      toast.success(action === "recompute" ? "Payroll recalculated" : action === "approve" ? "Payroll approved" : action === "pay" ? "Payroll marked paid" : "Payroll cancelled");
      load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong";
      if (dialog) setDialogError(msg);
      else toast.error("Could not update payroll", msg);
    } finally {
      setBusy(false);
    }
  }

  const slips = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.payslips ?? []).filter((s) => !q || s.employee.name.toLowerCase().includes(q) || s.employee.code.toLowerCase().includes(q));
  }, [data, query]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  if (error) return <ErrorState message={error instanceof ApiError ? error.message : "Could not load this payroll."} onRetry={load} />;
  if (!data) return <SkeletonBlock lines={8} />;

  const { run } = data;
  const canProcess = hasPermission("hr-payroll.process");
  const canApprove = hasPermission("hr-payroll.approve");
  const reportParams = { year: run.year, month: run.month };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/payroll" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Payroll
          </Link>
        }
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.625rem" }}>
            {run.period} <StatusBadge status={run.status} />
          </span>
        }
        description={`${run.runNumber}${run.paymentReference ? ` · paid, ref ${run.paymentReference}` : ""}${run.cancelReason ? ` · cancelled: ${run.cancelReason}` : ""}`}
        actions={
          <>
            {run.status !== "CANCELLED" && (
              <>
                <a href={downloadHref("/api/hr/reports/salary-register", reportParams, "xlsx")} className="button buttonSecondary">
                  <IconDownload /> Salary register
                </a>
                <a href={downloadHref("/api/hr/reports/bank-transfer", reportParams, "xlsx")} className="button buttonSecondary">
                  <IconDownload /> Bank sheet
                </a>
              </>
            )}
            {run.status === "DRAFT" && canProcess && (
              <button type="button" className="button buttonSecondary" onClick={() => act("recompute")} disabled={busy} title="Recompute from current salaries, attendance, loans and claims">
                {busy ? <span className="spinner" /> : <IconRefresh />} Recalculate
              </button>
            )}
            {run.status === "DRAFT" && canApprove && (
              <button type="button" className="button buttonPrimary" onClick={() => (setDialogError(null), setDialog("approve"))} disabled={busy}>
                <IconCheck /> Approve
              </button>
            )}
            {run.status === "APPROVED" && canApprove && (
              <button type="button" className="button buttonPrimary" onClick={() => (setDialogError(null), setDialog("pay"))} disabled={busy}>
                Mark paid
              </button>
            )}
            {(run.status === "DRAFT" || run.status === "APPROVED") && canApprove && (
              <button type="button" className="button buttonGhost" onClick={() => (setDialogError(null), setDialog("cancel"))} disabled={busy}>
                {run.status === "DRAFT" ? "Delete draft" : "Cancel"}
              </button>
            )}
          </>
        }
      />

      <div className="hrKpis">
        <Kpi label="Employees" value={run.employeeCount} />
        <Kpi label="Gross earnings" value={formatMoney(run.totalGross)} sub={Number(run.totalReimbursements) > 0 ? `+ ${formatMoney(run.totalReimbursements)} reimbursements` : undefined} />
        <Kpi label="Deductions" value={formatMoney(run.totalDeductions)} sub="PF, ESI, PT, TDS, loans" />
        <Kpi label="Net pay" value={formatMoney(run.totalNet)} sub="To be paid to employees" />
        <Kpi label="Employer contribution" value={formatMoney(run.totalEmployerContribution)} sub="Employer PF + ESI" />
      </div>

      {run.status === "DRAFT" && (
        <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
          <span>This is a draft. Changed attendance, leave or salaries? Recalculate. Approving locks the month and records loan recoveries and claim reimbursements.</span>
        </div>
      )}

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Find employee…" width="16rem" />
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="numCell">Paid days</th>
              <th className="numCell">LOP</th>
              <th className="numCell">Basic</th>
              <th className="numCell">Gross</th>
              <th className="numCell">PF</th>
              <th className="numCell">ESI</th>
              <th className="numCell">PT</th>
              <th className="numCell">TDS</th>
              <th className="numCell">Loan</th>
              <th className="numCell">Reimb.</th>
              <th className="numCell">Net pay</th>
            </tr>
          </thead>
          <tbody>
            {slips.length === 0 && (
              <tr>
                <td colSpan={12}>
                  <EmptyState title="No payslips" />
                </td>
              </tr>
            )}
            {slips.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/hr/payslips/${s.id}`} className="cellLink">
                    {s.employee.name}
                  </Link>
                  <div className="hrMuted">
                    {s.employee.code}
                    {s.employee.department ? ` · ${s.employee.department}` : ""}
                  </div>
                </td>
                <td className="numCell">
                  {s.payableDays}/{s.daysInMonth}
                </td>
                <td className="numCell" style={s.lopDays ? { color: "var(--danger)" } : undefined}>
                  {s.lopDays || "—"}
                </td>
                <td className="numCell">{formatMoney(amount(s.earnings, "BASIC"))}</td>
                <td className="numCell">{formatMoney(s.grossEarnings)}</td>
                <td className="numCell">{formatMoney(amount(s.deductions, "PF"))}</td>
                <td className="numCell">{formatMoney(amount(s.deductions, "ESI"))}</td>
                <td className="numCell">{formatMoney(amount(s.deductions, "PT"))}</td>
                <td className="numCell">{formatMoney(amount(s.deductions, "TDS"))}</td>
                <td className="numCell">{formatMoney(amount(s.deductions, "LOAN"))}</td>
                <td className="numCell">{formatMoney(s.reimbursements)}</td>
                <td className="numCell">
                  <strong style={Number(s.netPay) < 0 ? { color: "var(--danger)" } : undefined}>{formatMoney(s.netPay)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog === "approve" && (
        <ConfirmDialog
          title={`Approve payroll for ${run.period}?`}
          message={`Net pay ${formatMoney(run.totalNet)} for ${run.employeeCount} employee(s). Attendance and leave for the month are locked, loan instalments are recorded and approved claims are marked reimbursed. Employees can then see their payslips.`}
          confirmLabel="Approve payroll"
          tone="primary"
          busy={busy}
          error={dialogError}
          onConfirm={() => act("approve")}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "cancel" && (
        <ConfirmDialog
          title={run.status === "DRAFT" ? "Delete this draft?" : `Cancel approved payroll for ${run.period}?`}
          message={
            run.status === "DRAFT"
              ? "The draft and its payslips are removed. You can run payroll for this month again."
              : "Loan recoveries and claim reimbursements are reversed and the month is unlocked. Give a reason for the audit trail."
          }
          confirmLabel={run.status === "DRAFT" ? "Delete draft" : "Cancel payroll"}
          cancelLabel="Back"
          requireReason
          busy={busy}
          error={dialogError}
          onConfirm={(reason) => act("cancel", { reason: reason ?? "" })}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "pay" && (
        <Modal
          title="Mark payroll paid"
          subtitle={`Net pay ${formatMoney(run.totalNet)}. Record when and how the salaries were paid.`}
          onClose={() => setDialog(null)}
          busy={busy}
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={() => act("pay", pay)} disabled={busy}>
                {busy && <span className="spinner" />} Mark paid
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
              <label htmlFor="pay-date">Paid on</label>
              <input id="pay-date" type="date" className="input" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pay-ref">Reference</label>
              <input id="pay-ref" className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Bank batch / UTR" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
