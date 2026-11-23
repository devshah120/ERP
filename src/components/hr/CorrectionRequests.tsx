"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate } from "@/components/hr/HrKit";
import { IconCheck, IconClose, IconRefresh } from "@/components/icons";

export interface CorrectionRow {
  id: string;
  requestNumber: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  date: string;
  requestedStatus: string;
  checkIn: string;
  checkOut: string;
  previous: { status: string; checkIn: string; checkOut: string };
  /** The reason picked from Attendance Reg. Reasons ("" on older requests). */
  reasonName: string;
  /** The employee's remarks. */
  reason: string;
  status: string;
  decidedAs: string;
  decisionNote: string;
}

export interface CorrectionSummary {
  total: number;
  pending: number;
  teamSize?: number;
}

const DAY_LABELS: Record<string, string> = {
  PRESENT: "Present",
  HALF_DAY: "Half day",
  ON_DUTY: "On duty",
  ABSENT: "Absent",
  LEAVE: "Leave",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
};

/** "Present 09:30–18:00", or "Not marked" for a day with no record. */
export function dayLabel(status: string, checkIn: string, checkOut: string): string {
  if (!status) return "Not marked";
  const times = checkIn ? ` ${checkIn}${checkOut ? `–${checkOut}` : ""}` : "";
  return `${DAY_LABELS[status] ?? status}${times}`;
}

type Pending = { row: CorrectionRow; action: "approve" | "reject" } | null;

/**
 * Attendance correction requests with approve/reject — the same table for HR
 * (every request) and for reporting managers (their direct reports).
 */
export default function CorrectionRequests({
  listUrl,
  decideUrl,
  canDecide,
  onSummary,
}: {
  listUrl: string;
  decideUrl: (id: string) => string;
  canDecide: boolean;
  onSummary?: (s: CorrectionSummary) => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState("PENDING");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<({ items: CorrectionRow[] } & CorrectionSummary) | null>(null);
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
      const r = await apiFetch<{ items: CorrectionRow[] } & CorrectionSummary>(`${listUrl}?${p.toString()}`);
      setResult(r);
      onSummary?.({ total: r.total, pending: r.pending, teamSize: r.teamSize });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [listUrl, page, pageSize, status, applied, onSummary]);

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
      await apiFetch(decideUrl(pending.row.id), { method: "POST", body: JSON.stringify({ action: pending.action, note: reason ?? "" }) });
      toast.success(pending.action === "approve" ? `${pending.row.requestNumber} approved` : `${pending.row.requestNumber} rejected`);
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
          <option value="PENDING">Waiting for a decision</option>
          <option value="">Status: All</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Withdrawn</option>
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
              <th>Day</th>
              <th>Change</th>
              <th>Reason</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={7} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={7}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load correction requests."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState variant={applied ? "search" : undefined} title={status === "PENDING" ? "Nothing waiting for a decision" : "No correction requests"} />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td className="cellMono">{r.requestNumber}</td>
                <td>
                  {r.employeeName}
                  <div className="hrMuted">
                    {r.employeeCode}
                    {r.department ? ` · ${r.department}` : ""}
                  </div>
                </td>
                <td>{fmtDate(r.date)}</td>
                <td>
                  <span className="cellMuted">{dayLabel(r.previous.status, r.previous.checkIn, r.previous.checkOut)}</span>
                  <div>→ {dayLabel(r.requestedStatus, r.checkIn, r.checkOut)}</div>
                </td>
                <td style={{ maxWidth: "16rem" }}>
                  {r.reasonName && <strong>{r.reasonName}</strong>}
                  {r.reason && <div className={r.reasonName ? "hrMuted" : undefined}>{r.reason}</div>}
                  {r.decisionNote && <div className="hrMuted">Note: {r.decisionNote}</div>}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.decidedAs && <div className="hrMuted">{r.decidedAs === "MANAGER" ? "by manager" : "by HR"}</div>}
                </td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  {canDecide && r.status === "PENDING" && (
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
          title={pending.action === "approve" ? `Approve ${pending.row.requestNumber}?` : `Reject ${pending.row.requestNumber}?`}
          message={
            pending.action === "approve"
              ? `${pending.row.employeeName}, ${fmtDate(pending.row.date)}: the day becomes ${dayLabel(pending.row.requestedStatus, pending.row.checkIn, pending.row.checkOut)} on the attendance sheet.`
              : `Tell ${pending.row.employeeName} why the correction is rejected.`
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
