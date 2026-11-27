"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate } from "@/components/hr/HrKit";
import { IconCheck, IconClose, IconPlus, IconRefresh } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Row {
  id: string;
  leaveNumber: string;
  employeeId: string;
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
  decidedAs?: string;
  /** The server says this user may decide it (reporting manager or HR, not their own). */
  decidable?: boolean;
  createdAt: string;
}

type Pending = { row: Row; action: "approve" | "reject" | "cancel" } | null;

export default function LeaveRequestsPage() {
  return (
    <Suspense fallback={null}>
      <LeaveRequests />
    </Suspense>
  );
}

function LeaveRequests() {
  const router = useRouter();
  const params = useSearchParams();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const employeeId = params.get("employeeId") ?? "";
  const focus = params.get("focus");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<{ items: Row[]; total: number; pending: number } | null>(null);
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
      if (employeeId) p.set("employeeId", employeeId);
      setResult(await apiFetch(`/api/hr/leaves?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, applied, employeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canCreate = hasPermission("hr-leaves.create");
  const canDecide = hasPermission("hr-leaves.approve");
  // Only the employee's reporting manager or HR decides, and never their own leave (the server works it out per row).
  const decidable = (r: Row) => canDecide && Boolean(r.decidable);
  useShortcutScope({ onNew: canCreate ? () => router.push("/hr/leaves/new") : undefined, onSearch: () => searchRef.current?.focus(), onRefresh: load });

  async function act(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ approvalMessage?: string }>(`/api/hr/leaves/${pending.row.id}`, { method: "POST", body: JSON.stringify({ action: pending.action, note: reason ?? "" }) });
      if (res?.approvalMessage) toast.success(`${pending.row.leaveNumber}: ${res.approvalMessage}`);
      else toast.success(pending.action === "approve" ? `${pending.row.leaveNumber} approved` : pending.action === "reject" ? `${pending.row.leaveNumber} rejected` : `${pending.row.leaveNumber} cancelled`);
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
      <PageHeader
        title="Leave requests"
        count={result?.total ?? null}
        description={result ? `${result.pending} waiting for a decision. Approving marks the days as leave on the attendance sheet.` : "Approve or reject leave; approved days flow into attendance and payroll."}
        actions={
          <>
            <Link href="/hr/leaves/balances" className="button buttonSecondary">
              Balances
            </Link>
            {canCreate && (
              <Link href="/hr/leaves/new" className="button buttonPrimary" title="New leave request (Ctrl + N)">
                <IconPlus /> File leave
              </Link>
            )}
          </>
        }
      />

      <div className="toolbar">
        <SearchBox inputRef={searchRef} value={query} onChange={setQuery} placeholder="Search employee or request no…" width="18rem" />
        <Select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="">Status: All</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        {employeeId && (
          <Link href="/hr/leaves" className="button buttonGhost">
            Clear employee filter
          </Link>
        )}
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
            {!result && !error && <SkeletonRows columns={8} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={8}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load leave requests."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState variant={applied || status ? "search" : undefined} title={status === "PENDING" ? "No requests waiting" : "No leave requests"} />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id} style={focus === r.id ? { background: "var(--accent-soft)" } : undefined}>
                <td className="cellMono">{r.leaveNumber}</td>
                <td>
                  <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                    {r.employeeName}
                  </Link>
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
                  {r.decidedAs === "MANAGER" && <div className="hrMuted">by manager</div>}
                </td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  {decidable(r) && r.status === "PENDING" && (
                    <>
                      <button type="button" className="button buttonSecondary buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "approve" }))}>
                        <IconCheck /> Approve
                      </button>{" "}
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "reject" }))}>
                        <IconClose /> Reject
                      </button>
                    </>
                  )}
                  {decidable(r) && r.status === "APPROVED" && (
                    <button type="button" className="button buttonGhost buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "cancel" }))}>
                      Cancel
                    </button>
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
          title={pending.action === "approve" ? `Approve ${pending.row.leaveNumber}?` : pending.action === "reject" ? `Reject ${pending.row.leaveNumber}?` : `Cancel approved leave ${pending.row.leaveNumber}?`}
          message={
            pending.action === "approve"
              ? `${pending.row.employeeName}: ${pending.row.days} day(s) of ${pending.row.leaveType}. The days are marked as leave on the attendance sheet.`
              : pending.action === "reject"
                ? `Tell ${pending.row.employeeName} why the request is rejected.`
                : `The leave days are removed from the attendance sheet and the balance is restored.`
          }
          confirmLabel={pending.action === "approve" ? "Approve" : pending.action === "reject" ? "Reject" : "Cancel leave"}
          cancelLabel="Back"
          tone={pending.action === "approve" ? "primary" : "danger"}
          requireReason={pending.action !== "approve"}
          busy={busy}
          error={actionError}
          onConfirm={act}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
