"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { formatMoney } from "@/lib/format/number";
import { APPROVAL_DOCUMENTS, APPROVER_TYPE_LABELS, type ApproverType } from "@/lib/approvals/catalog";
import { IconCheck, IconClose, IconRefresh } from "@/components/icons";

interface StageRow {
  stage: number;
  approverType: ApproverType;
  status: string;
  decidedByName: string;
  decidedAt: string | null;
  note: string;
  skippedReason: string;
}

interface Row {
  id: string;
  document: string;
  documentLabel: string;
  href: string;
  recordNumber: string;
  summary: string;
  amount: string | null;
  requestedByName: string;
  requestedAt: string;
  status: string;
  waitingFor: string;
  canAct: boolean;
  stages: StageRow[];
}

type Scope = "mine" | "raised" | "all";

const fmtDateTime = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function ApprovalQueuePage() {
  const { hasPermission, hasProduct } = useAuth();
  const toast = useToast();
  const canSeeAll = hasPermission("approvals.view");
  const [scope, setScope] = useState<Scope>("mine");
  const [status, setStatus] = useState("PENDING");
  const [document, setDocument] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<{ items: Row[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ row: Row; action: "approve" | "reject" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ scope, page: String(page), pageSize: String(pageSize) });
      if (scope !== "mine") p.set("status", status);
      if (document) p.set("document", document);
      setResult(await apiFetch(`/api/approvals/queue?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [scope, status, document, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  async function act(note?: string) {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ approvalMessage?: string } | null>(`/api/approvals/${pending.row.id}/decide`, {
        method: "POST",
        body: JSON.stringify({ action: pending.action, note: note ?? "" }),
      });
      const label = `${pending.row.documentLabel} ${pending.row.recordNumber}`.trim();
      toast.success(res?.approvalMessage ?? (pending.action === "approve" ? `${label} approved` : `${label} rejected`));
      setPending(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const documents = APPROVAL_DOCUMENTS.filter((d) => hasProduct(d.product));

  return (
    <>
      <PageHeader
        title="Approval Queue"
        count={result?.total ?? null}
        description="Transactions waiting for approval. Each one moves through the stages of its Approval Scheme; the last stage's approval completes it."
      />

      <div className="toolbar">
        <Select className="select" style={{ width: "auto" }} value={scope} onChange={(e) => (setScope(e.target.value as Scope), setPage(1))} aria-label="Show">
          <option value="mine">Waiting for me</option>
          <option value="raised">Raised by me</option>
          {canSeeAll && <option value="all">All approvals</option>}
        </Select>
        {scope !== "mine" && (
          <Select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Withdrawn / cancelled</option>
          </Select>
        )}
        <Select className="select" style={{ width: "auto" }} value={document} onChange={(e) => (setDocument(e.target.value), setPage(1))} aria-label="Document">
          <option value="">Document: All</option>
          {documents.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
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
              <th>Document</th>
              <th>Details</th>
              <th className="numCell">Amount</th>
              <th>Raised by</th>
              <th>Stages</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={7} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={7}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load approvals."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState title={scope === "mine" ? "Nothing is waiting for you" : "No approvals"} description={scope === "mine" ? "Requests appear here when a scheme names you, your group, or you as someone's reporting manager." : undefined} />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <div>{r.documentLabel}</div>
                  <Link href={r.href} className="cellLink cellMono">
                    {r.recordNumber || "Open"}
                  </Link>
                </td>
                <td style={{ maxWidth: "18rem" }}>{r.summary}</td>
                <td className="numCell">{r.amount != null ? formatMoney(r.amount) : "—"}</td>
                <td>
                  <div>{r.requestedByName || "—"}</div>
                  <div className="hrMuted">{fmtDateTime(r.requestedAt)}</div>
                </td>
                <td style={{ minWidth: "14rem" }}>
                  {r.stages.map((s) => (
                    <div key={s.stage} className="hrMuted" title={s.note || s.skippedReason || undefined}>
                      Stage-{s.stage} · {APPROVER_TYPE_LABELS[s.approverType]}: <b>{stageLabel(s)}</b>
                      {s.decidedByName ? ` by ${s.decidedByName}` : ""}
                    </div>
                  ))}
                  {r.waitingFor && <div style={{ marginTop: "0.25rem" }}>Waiting for {r.waitingFor}</div>}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.canAct && (
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
      </div>

      {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={(s) => (setPageSize(s), setPage(1))} />}

      {pending && (
        <ConfirmDialog
          title={pending.action === "approve" ? "Approve this request?" : "Reject this request?"}
          message={
            pending.action === "approve"
              ? `${pending.row.documentLabel} ${pending.row.recordNumber}: your approval completes your stage. If another stage follows, it moves on to that approver.`
              : `${pending.row.documentLabel} ${pending.row.recordNumber} will be rejected and the person who raised it is told why.`
          }
          confirmLabel={pending.action === "approve" ? "Approve" : "Reject"}
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

function stageLabel(s: StageRow) {
  switch (s.status) {
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "SKIPPED":
      return "Skipped";
    case "PENDING":
      return "Pending";
    default:
      return "Not yet";
  }
}
