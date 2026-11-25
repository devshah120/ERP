"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import SearchSelect from "@/components/resource/SearchSelect";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate, todayKey, MONTH_NAMES, useEmployeeOptions, apiErrorText } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconCheck, IconClose, IconPlus, IconRefresh } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Row {
  id: string;
  loanNumber: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  loanType: string;
  amount: string;
  emiAmount: string;
  startMonth: number;
  startYear: number;
  status: string;
  reason: string;
  requestedBy: string;
  requestedAt: string | null;
  issueDate: string;
  decisionNote: string;
  createdAt: string;
}

interface Result {
  items: Row[];
  total: number;
  requestedCount: number;
  requestedAmount: string;
}

const TYPE_LABELS: Record<string, string> = { ADVANCE: "Salary advance", LOAN: "Loan" };

/** Loan / Advance Request: requests from employees (or raised by HR) waiting for a decision. */
export default function AdvanceRequestsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("REQUESTED");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Row | null>(null);
  const [approval, setApproval] = useState({ amount: "", emiAmount: "", issueDate: todayKey(), startMonth: 1, startYear: 2026, note: "" });
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [raising, setRaising] = useState(false);
  const [raise, setRaise] = useState({ employeeId: "", loanType: "ADVANCE", amount: "", emiAmount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const employees = useEmployeeOptions();
  const canDecide = hasPermission("hr-loans.create");

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) p.set("status", status);
      if (applied) p.set("query", applied);
      setResult(await apiFetch<Result>(`/api/hr/loans?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, applied]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onNew: canDecide ? () => (setDialogError(null), setRaising(true)) : undefined, onRefresh: load });

  function openApprove(r: Row) {
    setDialogError(null);
    setApproval({ amount: r.amount, emiAmount: r.emiAmount, issueDate: todayKey(), startMonth: r.startMonth, startYear: r.startYear, note: "" });
    setApproving(r);
  }

  async function approve() {
    if (!approving) return;
    setBusy(true);
    setDialogError(null);
    try {
      await apiFetch(`/api/hr/loans/requests/${approving.id}`, { method: "POST", body: JSON.stringify({ action: "approve", ...approval }) });
      toast.success(`${approving.loanNumber} approved`, `Recovered from ${MONTH_NAMES[approval.startMonth - 1]} ${approval.startYear} payroll.`);
      setApproving(null);
      load();
    } catch (err) {
      setDialogError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject(note?: string) {
    if (!rejecting) return;
    setBusy(true);
    setDialogError(null);
    try {
      await apiFetch(`/api/hr/loans/requests/${rejecting.id}`, { method: "POST", body: JSON.stringify({ action: "reject", note: note ?? "" }) });
      toast.success(`${rejecting.loanNumber} rejected`);
      setRejecting(null);
      load();
    } catch (err) {
      setDialogError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRaise() {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await apiFetch<{ loanNumber: string }>("/api/hr/loans/requests", { method: "POST", body: JSON.stringify(raise) });
      toast.success(`${r.loanNumber} raised`, "Approve it here to issue the advance.");
      setRaising(false);
      setRaise({ employeeId: "", loanType: "ADVANCE", amount: "", emiAmount: "", reason: "" });
      setStatus("REQUESTED");
      load();
    } catch (err) {
      setDialogError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const now = new Date().getFullYear();
  const years = [now - 1, now, now + 1, now + 2];

  return (
    <>
      <PageHeader
        title="Loan / advance requests"
        count={result?.total ?? null}
        description={
          result
            ? `${result.requestedCount} waiting for a decision (${formatMoney(result.requestedAmount)}). Approved advances are recovered in instalments through payroll.`
            : "Salary advance and loan requests from employees, waiting for approval."
        }
        actions={
          canDecide ? (
            <button type="button" className="button buttonPrimary" onClick={() => (setDialogError(null), setRaising(true))}>
              <IconPlus /> Raise request
            </button>
          ) : undefined
        }
      />

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search employee or request no…" width="18rem" />
        <Select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="REQUESTED">Waiting for decision</option>
          <option value="ACTIVE">Approved (being recovered)</option>
          <option value="CLOSED">Fully recovered</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Withdrawn / cancelled</option>
          <option value="">All</option>
        </Select>
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Employee</th>
              <th>Type</th>
              <th>Asked on</th>
              <th className="numCell">Amount</th>
              <th className="numCell">Instalment</th>
              <th>Reason</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={9} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={9}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load requests."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    variant={applied ? "search" : undefined}
                    title={status === "REQUESTED" ? "No requests waiting" : "No requests"}
                    description={status === "REQUESTED" ? "Employees ask for advances from My Workspace → My Advances." : undefined}
                  />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/loans/${r.id}`} className="cellLink cellMono">
                    {r.loanNumber}
                  </Link>
                  <div className="hrMuted">{r.requestedBy === "EMPLOYEE" ? "By employee" : "By HR"}</div>
                </td>
                <td>
                  <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                    {r.employeeName}
                  </Link>
                  <div className="hrMuted">{r.employeeCode}</div>
                </td>
                <td>{TYPE_LABELS[r.loanType] ?? r.loanType}</td>
                <td>{fmtDate(r.requestedAt ?? r.createdAt)}</td>
                <td className="numCell">{formatMoney(r.amount)}</td>
                <td className="numCell">{formatMoney(r.emiAmount)}</td>
                <td style={{ maxWidth: "18rem" }}>
                  {r.reason || <span className="cellMuted">—</span>}
                  {r.decisionNote && <div className="hrMuted">Note: {r.decisionNote}</div>}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  {canDecide && r.status === "REQUESTED" && (
                    <>
                      <button type="button" className="button buttonSecondary buttonSm" onClick={() => openApprove(r)}>
                        <IconCheck /> Approve
                      </button>{" "}
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => (setDialogError(null), setRejecting(r))}>
                        <IconClose /> Reject
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />}
      </div>

      {approving && (
        <Modal
          title={`Approve ${approving.loanNumber}`}
          subtitle={`${approving.employeeName} asked for ${formatMoney(approving.amount)}. You can approve a different amount, instalment or start month.`}
          onClose={() => setApproving(null)}
          busy={busy}
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setApproving(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={approve} disabled={busy || !approval.amount || !approval.emiAmount}>
                {busy && <span className="spinner" />} Approve & issue
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
              <label htmlFor="ap-amt">Amount approved</label>
              <input id="ap-amt" className="input" inputMode="decimal" value={approval.amount} onChange={(e) => setApproval({ ...approval, amount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ap-emi">Monthly instalment</label>
              <input id="ap-emi" className="input" inputMode="decimal" value={approval.emiAmount} onChange={(e) => setApproval({ ...approval, emiAmount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ap-date">Issued on</label>
              <input id="ap-date" className="input" type="date" value={approval.issueDate} onChange={(e) => setApproval({ ...approval, issueDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ap-month">Recover from payroll of</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <Select id="ap-month" className="select" value={approval.startMonth} onChange={(e) => setApproval({ ...approval, startMonth: Number(e.target.value) })}>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
                <Select className="select" value={approval.startYear} onChange={(e) => setApproval({ ...approval, startYear: Number(e.target.value) })} aria-label="Year">
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="ap-note">Note</label>
              <input id="ap-note" className="input" value={approval.note} onChange={(e) => setApproval({ ...approval, note: e.target.value })} placeholder="Optional" />
            </div>
          </div>
        </Modal>
      )}

      {rejecting && (
        <ConfirmDialog
          title={`Reject ${rejecting.loanNumber}?`}
          message={`Tell ${rejecting.employeeName} why the request for ${formatMoney(rejecting.amount)} is rejected.`}
          confirmLabel="Reject"
          cancelLabel="Back"
          tone="danger"
          requireReason
          busy={busy}
          error={dialogError}
          onConfirm={reject}
          onCancel={() => setRejecting(null)}
        />
      )}

      {raising && (
        <Modal
          title="Raise an advance request"
          subtitle="For an employee who asked in person. It then waits here for approval."
          onClose={() => setRaising(false)}
          busy={busy}
          width="36rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setRaising(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={submitRaise} disabled={busy || !raise.employeeId || !raise.amount || !raise.emiAmount}>
                {busy && <span className="spinner" />} Raise request
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
            <div className="field fieldSpanFull">
              <label htmlFor="rq-emp">Employee</label>
              <SearchSelect
                id="rq-emp"
                value={raise.employeeId}
                options={(employees ?? []).map((o) => ({ value: o.id, label: o.label }))}
                onChange={(v) => setRaise({ ...raise, employeeId: v })}
                placeholder="Search employee"
              />
            </div>
            <div className="field">
              <label htmlFor="rq-type">Type</label>
              <Select id="rq-type" className="select" value={raise.loanType} onChange={(e) => setRaise({ ...raise, loanType: e.target.value })}>
                <option value="ADVANCE">Salary advance</option>
                <option value="LOAN">Loan</option>
              </Select>
            </div>
            <div className="field">
              <label htmlFor="rq-amt">Amount</label>
              <input id="rq-amt" className="input" inputMode="decimal" value={raise.amount} onChange={(e) => setRaise({ ...raise, amount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="rq-emi">Monthly instalment</label>
              <input id="rq-emi" className="input" inputMode="decimal" value={raise.emiAmount} onChange={(e) => setRaise({ ...raise, emiAmount: e.target.value })} />
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="rq-reason">
                Reason<span className="hint"> · optional</span>
              </label>
              <input id="rq-reason" className="input" value={raise.reason} onChange={(e) => setRaise({ ...raise, reason: e.target.value })} placeholder="Medical emergency, festival advance…" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
