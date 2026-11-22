"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import CorrectionRequests, { type CorrectionSummary } from "@/components/hr/CorrectionRequests";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate } from "@/components/hr/HrKit";
import { IconCheck, IconClose, IconRefresh } from "@/components/icons";

interface Row {
  id: string;
  leaveNumber: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string;
  status: string;
  decisionNote: string;
  decidedAs: string;
}

type Pending = { row: Row; action: "approve" | "reject" } | null;

type Tab = "leave" | "attendance";
const decideCorrection = (id: string) => `/api/hr/self/team/attendance-requests/${id}`;

/** A reporting manager's approvals for their direct reports: leave and attendance corrections. */
export default function TeamApprovalsPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>("leave");
  const [leaveSummary, setLeaveSummary] = useState<CorrectionSummary | null>(null);
  const [correctionSummary, setCorrectionSummary] = useState<CorrectionSummary | null>(null);
  const onLeaveSummary = useCallback((s: CorrectionSummary) => setLeaveSummary(s), []);
  const onCorrectionSummary = useCallback((s: CorrectionSummary) => setCorrectionSummary(s), []);
  const teamSize = leaveSummary?.teamSize ?? correctionSummary?.teamSize;
  const label = (text: string, s: CorrectionSummary | null) => (s && s.pending > 0 ? `${text} (${s.pending})` : text);

  return (
    <>
      <PageHeader
        title="Team approvals"
        description={
          teamSize
            ? `Requests from your ${teamSize} direct report(s). Your decision is final; HR sees every request too.`
            : `Leave and attendance correction requests from people who report to ${me?.name ?? "you"}.`
        }
      />
      <div className="tabBar" role="tablist" aria-label="Request type">
        <button type="button" role="tab" className="tabBarItem" aria-selected={tab === "leave"} onClick={() => setTab("leave")}>
          {label("Leave", leaveSummary)}
        </button>
        <button type="button" role="tab" className="tabBarItem" aria-selected={tab === "attendance"} onClick={() => setTab("attendance")}>
          {label("Attendance corrections", correctionSummary)}
        </button>
      </div>
      {tab === "leave" ? (
        <TeamLeave onSummary={onLeaveSummary} />
      ) : (
        <CorrectionRequests listUrl="/api/hr/self/team/attendance-requests" decideUrl={decideCorrection} canDecide onSummary={onCorrectionSummary} />
      )}
    </>
  );
}

/** Direct reports' leave requests, with approve and reject. */
function TeamLeave({ onSummary }: { onSummary: (s: CorrectionSummary) => void }) {
  const toast = useToast();
  const [status, setStatus] = useState("PENDING");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<{ items: Row[]; total: number; pending: number; teamSize: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
      const r = await apiFetch<{ items: Row[]; total: number; pending: number; teamSize: number }>(`/api/hr/self/team/leaves?${p.toString()}`);
      setResult(r);
      onSummary({ total: r.total, pending: r.pending, teamSize: r.teamSize });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, applied, onSummary]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onSearch: () => searchRef.current?.focus(), onRefresh: load });

  async function act(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/api/hr/self/team/leaves/${pending.row.id}`, { method: "POST", body: JSON.stringify({ action: pending.action, note: reason ?? "" }) });
      toast.success(pending.action === "approve" ? `${pending.row.leaveNumber} approved` : `${pending.row.leaveNumber} rejected`);
      setPending(null);
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
      <div className="toolbar">
        <SearchBox inputRef={searchRef} value={query} onChange={setQuery} placeholder="Search name or request no…" width="18rem" />
        <select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="PENDING">Waiting for me</option>
          <option value="">Status: All</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
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
              <th>Dates</th>
              <th className="numCell">Days</th>
              <th>Reason</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={8} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={8}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load team leave."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState variant={applied ? "search" : undefined} title={status === "PENDING" ? "Nothing waiting for you" : "No leave requests"} />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td className="cellMono">{r.leaveNumber}</td>
                <td>
                  {r.employeeName}
                  <div className="hrMuted">
                    {r.employeeCode}
                    {r.department ? ` · ${r.department}` : ""}
                  </div>
                </td>
                <td>{r.leaveType}</td>
                <td>
                  {fmtDate(r.fromDate)}
                  {r.toDate !== r.fromDate ? ` – ${fmtDate(r.toDate)}` : ""}
                  {r.halfDay && <div className="hrMuted">Half day</div>}
                </td>
                <td className="numCell">{r.days}</td>
                <td style={{ maxWidth: "16rem" }}>
                  {r.reason || <span className="cellMuted">—</span>}
                  {r.decisionNote && <div className="hrMuted">Note: {r.decisionNote}</div>}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.decidedAs && <div className="hrMuted">{r.decidedAs === "MANAGER" ? "by manager" : "by HR"}</div>}
                </td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  {r.status === "PENDING" && (
                    <>
                      <button type="button" className="button buttonSecondary buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "approve" }))}>
                        <IconCheck /> Approve
                      </button>{" "}
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "reject" }))}>
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

      {pending && (
        <ConfirmDialog
          title={pending.action === "approve" ? `Approve ${pending.row.leaveNumber}?` : `Reject ${pending.row.leaveNumber}?`}
          message={
            pending.action === "approve"
              ? `${pending.row.employeeName}: ${pending.row.days} day(s) of ${pending.row.leaveType}. The days are marked as leave on the attendance sheet.`
              : `Tell ${pending.row.employeeName} why the request is rejected.`
          }
          confirmLabel={pending.action === "approve" ? "Approve" : "Reject"}
          cancelLabel="Back"
          tone={pending.action === "approve" ? "primary" : "danger"}
          requireReason={pending.action === "reject"}
          busy={busy}
          error={actionError}
          onConfirm={act}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
