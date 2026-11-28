"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import SearchBox from "@/components/ui/SearchBox";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { formatMoney } from "@/lib/format/number";
import { APPROVAL_DOCUMENTS, APPROVAL_STATUS_LABELS, APPROVAL_DISPLAY_STATUSES, groupedDocuments, type ApprovalDisplayStatus } from "@/lib/approvals/catalog";
import ApprovalDetail from "@/components/approvals/ApprovalDetail";
import { IconCheck, IconClose, IconRefresh, IconEye, IconArrowLeft } from "@/components/icons";

interface StageRow {
  stage: number;
  status: string;
}

interface Row {
  id: string;
  requestNo: string;
  document: string;
  documentLabel: string;
  group: string;
  module: string;
  kind: "record" | "action";
  recordNumber: string;
  summary: string;
  amount: string | null;
  requestedByName: string;
  departmentName: string;
  requestedAt: string;
  decidedAt: string | null;
  status: string;
  displayStatus: ApprovalDisplayStatus;
  currentStage: number;
  stageCount: number;
  waitingFor: string;
  canAct: boolean;
  canSendBack: boolean;
  closedReason: string;
  comments: number;
  stages: StageRow[];
}

type Scope = "mine" | "approved" | "rejected" | "history" | "raised" | "all";
const TABS: { scope: Scope; label: string; empty: string; hint?: string }[] = [
  { scope: "mine", label: "Pending my approval", empty: "Nothing is waiting for you", hint: "Requests appear here when a scheme names you, your group or your role, or you are someone's reporting manager or department head." },
  { scope: "approved", label: "Approved by me", empty: "You haven't approved anything yet" },
  { scope: "rejected", label: "Rejected / sent back by me", empty: "You haven't rejected or sent back anything" },
  { scope: "history", label: "My approval history", empty: "No approvals you took part in yet" },
  { scope: "raised", label: "Submitted by me", empty: "You haven't submitted anything for approval" },
  { scope: "all", label: "All requests", empty: "No approval requests" },
];

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function ApprovalManagementPage() {
  const { hasPermission, hasProduct } = useAuth();
  const toast = useToast();
  const canSeeAll = hasPermission("approvals.view");
  const [scope, setScope] = useState<Scope>("mine");
  const [status, setStatus] = useState("");
  const [group, setGroup] = useState("");
  const [document, setDocument] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<{ items: Row[]; total: number } | null>(null);
  const [counts, setCounts] = useState<{ mine: number; sentBack: number; raisedOpen: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ row: Row; action: "approve" | "reject" | "send-back" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ scope, page: String(page), pageSize: String(pageSize) });
      if (scope !== "mine" && status) p.set("status", status);
      if (group) p.set("group", group);
      if (document) p.set("document", document);
      if (query.trim()) p.set("query", query.trim());
      const [r, c] = await Promise.all([apiFetch<{ items: Row[]; total: number }>(`/api/approvals/queue?${p.toString()}`), apiFetch<{ mine: number; sentBack: number; raisedOpen: number }>("/api/approvals/counts").catch(() => null)]);
      setResult(r);
      if (c) setCounts(c);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [scope, status, group, document, query, page, pageSize]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  // Opened from a notification or a link: /approvals/queue?open=<id>&tab=raised
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const tab = sp.get("tab") as Scope | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tab && TABS.some((t) => t.scope === tab)) setScope(tab);
    const id = sp.get("open");
    if (id && /^[a-f\d]{24}$/i.test(id)) setOpenId(id);
  }, []);

  useShortcutScope({ onRefresh: load });

  function switchTab(s: Scope) {
    setScope(s);
    setPage(1);
    setStatus("");
  }

  async function quickAct(note?: string) {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ approvalMessage?: string } | null>(`/api/approvals/${pending.row.id}/decide`, { method: "POST", body: JSON.stringify({ action: pending.action, note: note ?? "" }) });
      const label = `${pending.row.documentLabel} ${pending.row.requestNo || pending.row.recordNumber}`.trim();
      toast.success(res?.approvalMessage ?? (pending.action === "approve" ? `${label} approved` : pending.action === "reject" ? `${label} rejected` : `${label} sent back`));
      setPending(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const documents = useMemo(() => APPROVAL_DOCUMENTS.filter((d) => hasProduct(d.product)), [hasProduct]);
  const docGroups = useMemo(() => groupedDocuments(group ? documents.filter((d) => d.group === group) : documents), [documents, group]);
  const groups = [...new Set(documents.map((d) => d.group))];
  const tabs = TABS.filter((t) => t.scope !== "all" || canSeeAll);
  const tab = tabs.find((t) => t.scope === scope) ?? tabs[0];

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Approval Management"
        count={result?.total ?? null}
        description="Every transaction waiting for approval across HR and the ERP. Each moves through the stages of its Approval Scheme; only the last stage's approval applies it."
        actions={
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        }
      />

      <div className="apvSummary">
        <button type="button" className="apvStat" aria-pressed={scope === "mine"} onClick={() => switchTab("mine")}>
          <div className="apvStatLabel">Waiting for my approval</div>
          <div className="apvStatValue">{counts?.mine ?? "—"}</div>
        </button>
        <button type="button" className="apvStat" aria-pressed={scope === "raised" && status === "SENT_BACK"} onClick={() => (setScope("raised"), setStatus("SENT_BACK"), setPage(1))}>
          <div className="apvStatLabel">Sent back to me to correct</div>
          <div className="apvStatValue" style={counts?.sentBack ? { color: "var(--warning)" } : undefined}>
            {counts?.sentBack ?? "—"}
          </div>
        </button>
        <button type="button" className="apvStat" aria-pressed={scope === "raised" && status === "PENDING"} onClick={() => (setScope("raised"), setStatus("PENDING"), setPage(1))}>
          <div className="apvStatLabel">My requests still waiting</div>
          <div className="apvStatValue">{counts?.raisedOpen ?? "—"}</div>
        </button>
      </div>

      <div className="tabBar" role="tablist" aria-label="Approvals">
        {tabs.map((t) => (
          <button key={t.scope} type="button" role="tab" className="tabBarItem" aria-selected={scope === t.scope} onClick={() => switchTab(t.scope)}>
            {t.label}
            {t.scope === "mine" && counts && counts.mine > 0 && <span className="apvTabCount">{counts.mine > 99 ? "99+" : counts.mine}</span>}
            {t.scope === "raised" && counts && counts.sentBack > 0 && (
              <span className="apvTabCount apvTabCountWarn" title={`${counts.sentBack} sent back to you`}>
                {counts.sentBack}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <SearchBox value={query} onChange={(v) => (setQuery(v), setPage(1))} placeholder="Search request no., record, person, department" width="20rem" />
        <Select className="select" style={{ width: "auto" }} value={group} onChange={(e) => (setGroup(e.target.value), setDocument(""), setPage(1))} aria-label="Module">
          <option value="">All modules</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <Select className="select" style={{ width: "auto", maxWidth: "16rem" }} value={document} onChange={(e) => (setDocument(e.target.value), setPage(1))} aria-label="Document type">
          <option value="">All document types</option>
          {docGroups.map((g) =>
            g.modules.map((m) => (
              <optgroup key={`${g.group}-${m.module}`} label={`${g.group} · ${m.module}`}>
                {m.docs.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </optgroup>
            ))
          )}
        </Select>
        {scope !== "mine" && (
          <Select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
            <option value="">Any status</option>
            <option value="PENDING">Pending (any stage)</option>
            {APPROVAL_DISPLAY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {APPROVAL_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Requested by</th>
              <th>Submitted</th>
              <th className="numCell">Amount</th>
              <th>Stage</th>
              <th>Pending with</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={8} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={8}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load approvals."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState title={query || group || document || status ? "No requests match these filters" : tab.empty} description={query || group || document || status ? undefined : tab.hint} />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id} className="apvRow" onClick={() => setOpenId(r.id)}>
                <td style={{ maxWidth: "22rem" }}>
                  <div style={{ fontWeight: 600 }}>{r.documentLabel}</div>
                  <div className="apvRowSub">
                    <span className="cellMono">{r.requestNo || r.recordNumber || "—"}</span>
                    {r.requestNo && r.recordNumber ? ` · ${r.recordNumber}` : ""}
                  </div>
                  {r.summary && (
                    <div className="apvRowSub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.summary}>
                      {r.summary}
                    </div>
                  )}
                </td>
                <td>
                  <div>{r.requestedByName || "—"}</div>
                  <div className="apvRowSub">{r.departmentName || r.module}</div>
                </td>
                <td className="apvRowSub" style={{ whiteSpace: "nowrap" }}>
                  {fmtDate(r.requestedAt)}
                </td>
                <td className="numCell">{r.amount != null ? formatMoney(r.amount) : "—"}</td>
                <td>
                  <div className="apvProgress" aria-label={`${r.stages.filter((s) => s.status === "APPROVED").length} of ${r.stageCount} stages approved`}>
                    {r.stages.map((s) => (
                      <span key={s.stage} className="apvDot" data-s={s.status} title={`Stage ${s.stage}: ${s.status.toLowerCase().replace("_", " ")}`} />
                    ))}
                  </div>
                  <div className="apvRowSub">{r.status === "PENDING" ? `Stage ${r.currentStage} of ${r.stageCount}` : `${r.stageCount} stage${r.stageCount === 1 ? "" : "s"}`}</div>
                </td>
                <td className="apvRowSub" style={{ maxWidth: "14rem" }}>
                  {r.waitingFor ? r.waitingFor.replace(/^Stage-\d+ · /, "") : r.closedReason || "—"}
                </td>
                <td>
                  <StatusBadge status={r.displayStatus} />
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  {r.canAct && (
                    <>
                      <button type="button" className="button buttonSecondary buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "approve" }))}>
                        <IconCheck /> Approve
                      </button>{" "}
                      {r.canSendBack && (
                        <>
                          <button type="button" className="button buttonGhost buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "send-back" }))} title="Send back for correction">
                            <IconArrowLeft />
                          </button>{" "}
                        </>
                      )}
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => (setActionError(null), setPending({ row: r, action: "reject" }))} title="Reject">
                        <IconClose />
                      </button>{" "}
                    </>
                  )}
                  <button type="button" className="button buttonGhost buttonSm" onClick={() => setOpenId(r.id)} title="View details, stages and comments">
                    <IconEye /> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={(s) => (setPageSize(s), setPage(1))} />}

      {openId && <ApprovalDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}

      {pending && (
        <ConfirmDialog
          title={pending.action === "approve" ? "Approve this request?" : pending.action === "reject" ? "Reject this request?" : "Send this back for correction?"}
          message={
            pending.action === "approve"
              ? `${pending.row.documentLabel} ${pending.row.requestNo || pending.row.recordNumber}: your approval completes stage ${pending.row.currentStage}. If another stage follows, it moves on to that approver${pending.row.kind === "action" ? "; otherwise the change is applied now" : ""}.`
              : pending.action === "reject"
                ? `${pending.row.documentLabel} ${pending.row.requestNo || pending.row.recordNumber} will be rejected${pending.row.kind === "action" ? " and nothing will change" : ""}. ${pending.row.requestedByName || "The requester"} is told why.`
                : `${pending.row.documentLabel} ${pending.row.requestNo || pending.row.recordNumber} goes back to ${pending.row.requestedByName || "the requester"} to correct and send again. Say what needs changing.`
          }
          confirmLabel={pending.action === "approve" ? "Approve" : pending.action === "reject" ? "Reject" : "Send back"}
          tone={pending.action === "approve" ? "primary" : "danger"}
          requireReason={pending.action !== "approve"}
          busy={busy}
          error={actionError}
          onConfirm={quickAct}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
