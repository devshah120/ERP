"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
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
import { fmtDate, CLAIM_CATEGORY_LABELS } from "@/components/hr/HrKit";
import ClaimAttachment, { type ClaimAttachmentInfo } from "@/components/hr/ClaimAttachment";
import { formatMoney } from "@/lib/format/number";
import { IconCheck, IconClose, IconPlus, IconRefresh } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Row {
  id: string;
  claimNumber: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  claimDate: string;
  category: string;
  amount: string;
  description: string;
  billReference: string;
  attachment?: ClaimAttachmentInfo | null;
  status: string;
  decisionNote: string;
}

export default function ClaimsPage() {
  return (
    <Suspense fallback={null}>
      <Claims />
    </Suspense>
  );
}

function Claims() {
  const router = useRouter();
  const params = useSearchParams();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<{ items: Row[]; total: number; pendingCount: number; pendingAmount: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ row: Row; action: "approve" | "reject" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
      setResult(await apiFetch(`/api/hr/claims?${p.toString()}`));
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

  const canCreate = hasPermission("hr-claims.create");
  const canDecide = hasPermission("hr-claims.approve");
  useShortcutScope({ onNew: canCreate ? () => router.push("/hr/claims/new") : undefined, onRefresh: load });

  async function act(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ approvalMessage?: string }>(`/api/hr/claims/${pending.row.id}`, { method: "POST", body: JSON.stringify({ action: pending.action, note: reason ?? "" }) });
      if (res?.approvalMessage) toast.success(`${pending.row.claimNumber}: ${res.approvalMessage}`);
      else toast.success(pending.action === "approve" ? `${pending.row.claimNumber} approved` : `${pending.row.claimNumber} rejected`, pending.action === "approve" ? "It will be paid with the next payroll, or settle it now on Claim Settlement." : undefined);
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
        title="Claim requests"
        count={result?.total ?? null}
        description={result ? `${result.pendingCount} waiting for approval (${formatMoney(result.pendingAmount)}). Approved claims are paid with the next payroll, or earlier from Claim Settlement.` : "Expense claims from employees, waiting for approval."}
        actions={
          canCreate ? (
            <Link href="/hr/claims/new" className="button buttonPrimary">
              <IconPlus /> Record claim
            </Link>
          ) : undefined
        }
      />

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search employee or claim no…" width="18rem" />
        <Select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="">Status: All</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved (not yet paid)</option>
          <option value="REIMBURSED">Reimbursed</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Withdrawn</option>
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
              <th>Claim</th>
              <th>Employee</th>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th className="numCell">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={8} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={8}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load claims."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState variant={applied || status ? "search" : undefined} title="No claims" />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td className="cellMono">{r.claimNumber}</td>
                <td>
                  <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                    {r.employeeName}
                  </Link>
                  <div className="hrMuted">{r.employeeCode}</div>
                </td>
                <td>{fmtDate(r.claimDate)}</td>
                <td>{CLAIM_CATEGORY_LABELS[r.category] ?? r.category}</td>
                <td style={{ maxWidth: "18rem" }}>
                  {r.description}
                  {r.billReference && <div className="hrMuted">Bill {r.billReference}</div>}
                  {r.decisionNote && <div className="hrMuted">Note: {r.decisionNote}</div>}
                  <ClaimAttachment baseUrl={`/api/hr/claims/${r.id}`} attachment={r.attachment} canEdit={canCreate && r.status === "PENDING"} onChange={load} />
                </td>
                <td className="numCell">{formatMoney(r.amount)}</td>
                <td>
                  <StatusBadge status={r.status} />
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
          title={pending.action === "approve" ? `Approve ${pending.row.claimNumber}?` : `Reject ${pending.row.claimNumber}?`}
          message={
            pending.action === "approve"
              ? `${formatMoney(pending.row.amount)} for ${pending.row.employeeName}, added to their next payslip as a reimbursement.`
              : `Tell ${pending.row.employeeName} why the claim is rejected.`
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
