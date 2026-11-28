"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Kpi, MONTH_NAMES, fmtDate, todayKey } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconArrowLeft, IconPlus, IconPrint, IconRefresh } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Line {
  code: string;
  label: string;
  amount: string;
  note: string;
  manual: boolean;
}

interface Fnf {
  id: string;
  settlementNumber: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string;
  dateOfJoining: string | null;
  separationType: string;
  resignationDate: string | null;
  lastWorkingDay: string;
  exitReason: string;
  noticeDays: number;
  noticeServedDays: number;
  noticeShortfallDays: number;
  noticeTreatment: "RECOVER" | "PAY" | "WAIVE";
  salaryFrom: { year: number; month: number };
  gratuity: { eligible: boolean; completedYears: number; service: string; basic: string; amount: string };
  leaveEncashment: { days: number; ratePerDay: string };
  earnings: Line[];
  deductions: Line[];
  manualLines: { kind: "EARNING" | "DEDUCTION"; label: string; amount: string }[];
  totalEarnings: string;
  totalDeductions: string;
  netPayable: string;
  assetsPending: { assetTag: string; name: string }[];
  status: string;
  paidAt: string | null;
  paymentReference: string;
  cancelReason: string;
  notes: string;
}

const SEPARATION: Record<string, string> = { RESIGNED: "Resigned", TERMINATED: "Terminated", RETIRED: "Retired" };
const TREATMENT: Record<string, string> = { RECOVER: "Recover the shortfall from the employee", PAY: "Pay the employee in lieu of notice", WAIVE: "Waive" };

/** One full & final settlement: the statement, adjustments and the approve → pay workflow. */
export default function FnfDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [f, setF] = useState<Fnf | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"approve" | "pay" | "cancel" | "adjust" | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pay, setPay] = useState({ paidOn: todayKey(), reference: "" });
  const [adjust, setAdjust] = useState<{ noticeDays: string; noticeTreatment: string; notes: string; lines: { kind: "EARNING" | "DEDUCTION"; label: string; amount: string }[] } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setF(await apiFetch<Fnf>(`/api/hr/payroll/fnf/${id}`));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(action: "approve" | "pay" | "cancel", extra: Record<string, unknown> = {}) {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await apiFetch<{ status: string; approvalMessage?: string }>(`/api/hr/payroll/fnf/${id}`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
      setDialog(null);
      if (r.status === "DELETED") {
        toast.success("Draft deleted");
        router.push("/hr/payroll/fnf");
        return;
      }
      if (r.approvalMessage) toast.success(r.approvalMessage);
      else toast.success(action === "approve" ? "Settlement approved" : action === "pay" ? "Settlement marked paid" : "Settlement cancelled");
      load();
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function recalc(body: Record<string, unknown>) {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await apiFetch<{ netPayable: string }>(`/api/hr/payroll/fnf/${id}`, { method: "PUT", body: JSON.stringify(body) });
      toast.success("Settlement recalculated", `Net ${formatMoney(r.netPayable)}`);
      setDialog(null);
      load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong";
      if (dialog) setDialogError(msg);
      else toast.error("Could not recalculate", msg);
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  if (error) return <ErrorState message={error instanceof ApiError ? error.message : "Could not load the settlement."} onRetry={load} />;
  if (!f) return <SkeletonBlock lines={8} />;

  const canProcess = hasPermission("hr-payroll.process");
  const canApprove = hasPermission("hr-payroll.approve");
  const draft = f.status === "DRAFT";
  const net = Number(f.netPayable);
  const lines = (title: string, rows: Line[], total: string) => (
    <table className="payslipTable">
      <thead>
        <tr>
          <th>{title}</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={2} className="cellMuted">
              None
            </td>
          </tr>
        )}
        {rows.map((l, i) => (
          <tr key={`${l.code}-${i}`}>
            <td>
              {l.label}
              {l.manual && <span className="hrMuted"> · added</span>}
              {l.note && <div className="hrMuted">{l.note}</div>}
            </td>
            <td>{formatMoney(l.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td>{formatMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/payroll/fnf" className="textLink noPrint" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Full & final settlements
          </Link>
        }
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.625rem" }}>
            {f.employeeName} <StatusBadge status={f.status} />
          </span>
        }
        description={`${f.settlementNumber} · ${SEPARATION[f.separationType] ?? f.separationType} · last working day ${fmtDate(f.lastWorkingDay)}${f.paymentReference ? ` · paid, ref ${f.paymentReference}` : ""}${f.cancelReason ? ` · cancelled: ${f.cancelReason}` : ""}`}
        actions={
          <span className="noPrint" style={{ display: "inline-flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="button buttonSecondary" onClick={() => window.print()}>
              <IconPrint /> Print statement
            </button>
            {draft && canProcess && (
              <>
                <button type="button" className="button buttonSecondary" onClick={() => recalc({})} disabled={busy} title="Recalculate from current attendance, salary, leave, loans and arrears">
                  {busy ? <span className="spinner" /> : <IconRefresh />} Recalculate
                </button>
                <button
                  type="button"
                  className="button buttonSecondary"
                  onClick={() => (setDialogError(null), setAdjust({ noticeDays: String(f.noticeDays), noticeTreatment: f.noticeTreatment, notes: f.notes, lines: f.manualLines }), setDialog("adjust"))}
                >
                  Adjust
                </button>
              </>
            )}
            {draft && canApprove && (
              <button type="button" className="button buttonPrimary" onClick={() => (setDialogError(null), setDialog("approve"))}>
                Approve
              </button>
            )}
            {f.status === "APPROVED" && canApprove && (
              <button type="button" className="button buttonPrimary" onClick={() => (setDialogError(null), setDialog("pay"))}>
                Mark paid
              </button>
            )}
            {(draft || f.status === "APPROVED") && canApprove && (
              <button type="button" className="button buttonGhost" onClick={() => (setDialogError(null), setDialog("cancel"))}>
                {draft ? "Delete draft" : "Cancel"}
              </button>
            )}
          </span>
        }
      />

      <div className="hrKpis">
        <Kpi label="Earnings" value={formatMoney(f.totalEarnings)} />
        <Kpi label="Deductions" value={formatMoney(f.totalDeductions)} />
        <Kpi label={net < 0 ? "Recoverable from employee" : "Net payable"} value={formatMoney(Math.abs(net).toFixed(2))} />
        <Kpi label="Gratuity" value={f.gratuity.eligible ? formatMoney(f.gratuity.amount) : "Not eligible"} sub={`${f.gratuity.service} · ${f.gratuity.completedYears} year(s) counted`} />
      </div>

      {f.assetsPending.length > 0 && (
        <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
          <span>
            Assets not yet returned: {f.assetsPending.map((a) => `${a.name} (${a.assetTag})`).join(", ")}. Record the return on the employee profile, or add a recovery with Adjust.
          </span>
        </div>
      )}
      {draft && (
        <div className="banner bannerInfo noPrint" style={{ marginBottom: "0.75rem" }}>
          <span>Draft. Approving recovers the outstanding loans, marks the arrears paid and records {f.employeeName} as {SEPARATION[f.separationType]?.toLowerCase()} from {fmtDate(f.lastWorkingDay)}.</span>
        </div>
      )}

      <article className="payslip">
        <div className="payslipMeta">
          <div>
            <span>Employee</span>
            <strong>
              {f.employeeName} ({f.employeeCode})
            </strong>
          </div>
          <div>
            <span>Designation</span>
            <span>{f.designation || "—"}</span>
          </div>
          <div>
            <span>Department</span>
            <span>{f.department || "—"}</span>
          </div>
          <div>
            <span>Joined</span>
            <span>{fmtDate(f.dateOfJoining)}</span>
          </div>
          <div>
            <span>Resignation / notice</span>
            <span>{f.resignationDate ? fmtDate(f.resignationDate) : "—"}</span>
          </div>
          <div>
            <span>Last working day</span>
            <span>{fmtDate(f.lastWorkingDay)}</span>
          </div>
          <div>
            <span>Notice</span>
            <span>
              {f.noticeServedDays} of {f.noticeDays} day(s) served
              {f.noticeShortfallDays ? ` · ${f.noticeShortfallDays} short (${f.noticeTreatment.toLowerCase()})` : ""}
            </span>
          </div>
          <div>
            <span>Salary paid from</span>
            <span>
              {MONTH_NAMES[f.salaryFrom.month - 1]} {f.salaryFrom.year}
            </span>
          </div>
        </div>
        <div className="payslipCols">
          {lines("Earnings", f.earnings, f.totalEarnings)}
          {lines("Deductions", f.deductions, f.totalDeductions)}
        </div>
        <div className="payslipNet">
          <div>
            <div className="hrMuted">{net < 0 ? "Recoverable from the employee" : "Net payable"}</div>
            <strong>{formatMoney(Math.abs(net).toFixed(2))}</strong>
          </div>
          {f.exitReason && <div className="hrMuted">Reason for leaving: {f.exitReason}</div>}
        </div>
        {f.notes && <p className="hrMuted">{f.notes}</p>}
      </article>

      {dialog === "approve" && (
        <ConfirmDialog
          title={`Approve ${f.settlementNumber}?`}
          message={`${net < 0 ? "Recoverable" : "Net payable"} ${formatMoney(Math.abs(net).toFixed(2))}. Loans are recovered, arrears marked paid and ${f.employeeName} recorded as ${SEPARATION[f.separationType]?.toLowerCase()} on ${fmtDate(f.lastWorkingDay)}; payroll will leave them out from ${MONTH_NAMES[f.salaryFrom.month - 1]} ${f.salaryFrom.year}.`}
          confirmLabel="Approve"
          tone="primary"
          busy={busy}
          error={dialogError}
          onConfirm={() => act("approve")}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "cancel" && (
        <ConfirmDialog
          title={draft ? "Delete this draft?" : `Cancel ${f.settlementNumber}?`}
          message={draft ? "The draft is removed." : "Loan recoveries and arrears are reversed. The employee's exit stays on their record; change it there if they are staying."}
          confirmLabel={draft ? "Delete draft" : "Cancel settlement"}
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
          title="Mark settlement paid"
          subtitle={`${formatMoney(f.netPayable)} to ${f.employeeName}.`}
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
              <label htmlFor="fp-date">Paid on</label>
              <input id="fp-date" type="date" className="input" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="fp-ref">Reference</label>
              <input id="fp-ref" className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="UTR / cheque no." />
            </div>
          </div>
        </Modal>
      )}
      {dialog === "adjust" && adjust && (
        <Modal
          title="Adjust settlement"
          subtitle="Notice terms and lines you add by hand (e.g. bonus, asset recovery, TDS). Saving recalculates everything else."
          onClose={() => setDialog(null)}
          busy={busy}
          width="42rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="button buttonPrimary"
                disabled={busy || adjust.lines.some((l) => l.label.trim().length < 2 || !/^\d+(\.\d{1,2})?$/.test(l.amount))}
                onClick={() => recalc({ noticeDays: Number(adjust.noticeDays) || 0, noticeTreatment: adjust.noticeTreatment, notes: adjust.notes, manualLines: adjust.lines })}
              >
                {busy && <span className="spinner" />} Save and recalculate
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
              <label htmlFor="fa-notice">Notice period (days)</label>
              <input id="fa-notice" className="input" inputMode="numeric" value={adjust.noticeDays} onChange={(e) => setAdjust({ ...adjust, noticeDays: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div className="field">
              <label htmlFor="fa-treat">Notice shortfall</label>
              <Select id="fa-treat" className="select" value={adjust.noticeTreatment} onChange={(e) => setAdjust({ ...adjust, noticeTreatment: e.target.value })}>
                {Object.entries(TREATMENT).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <h4 style={{ margin: "1rem 0 0.5rem" }}>Lines added by hand</h4>
          {adjust.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <Select className="select" style={{ width: "9rem" }} value={l.kind} onChange={(e) => setAdjust({ ...adjust, lines: adjust.lines.map((x, j) => (j === i ? { ...x, kind: e.target.value as "EARNING" | "DEDUCTION" } : x)) })} aria-label="Type">
                <option value="EARNING">Earning</option>
                <option value="DEDUCTION">Deduction</option>
              </Select>
              <input className="input" placeholder="Label, e.g. Asset recovery" value={l.label} onChange={(e) => setAdjust({ ...adjust, lines: adjust.lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="Label" />
              <input className="input" style={{ width: "8rem", textAlign: "right" }} inputMode="decimal" placeholder="0.00" value={l.amount} onChange={(e) => setAdjust({ ...adjust, lines: adjust.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value.trim() } : x)) })} aria-label="Amount" />
              <button type="button" className="button buttonGhost buttonSm" onClick={() => setAdjust({ ...adjust, lines: adjust.lines.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="button buttonSecondary buttonSm" onClick={() => setAdjust({ ...adjust, lines: [...adjust.lines, { kind: "DEDUCTION", label: "", amount: "" }] })}>
            <IconPlus /> Add line
          </button>
          <div className="field" style={{ marginTop: "1rem" }}>
            <label htmlFor="fa-notes">Notes on the statement</label>
            <input id="fa-notes" className="input" value={adjust.notes} onChange={(e) => setAdjust({ ...adjust, notes: e.target.value })} />
          </div>
        </Modal>
      )}
    </>
  );
}
