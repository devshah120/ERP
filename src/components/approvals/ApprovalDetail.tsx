"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import Modal from "@/components/ui/Modal";
import StatusBadge from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import { formatMoney } from "@/lib/format/number";
import { APPROVAL_STATUS_LABELS, type ApprovalDisplayStatus } from "@/lib/approvals/catalog";
import { IconCheck, IconClose, IconArrowLeft, IconRefresh, IconArrowRight } from "@/components/icons";

interface StageDetail {
  stage: number;
  approver: string;
  limit: string | null;
  status: string;
  decidedByName: string;
  decidedAt: string | null;
  note: string;
  skippedReason: string;
  escalatedReason: string;
  override: boolean;
}

interface Round {
  id: string;
  requestNo: string;
  status: string;
  displayStatus: ApprovalDisplayStatus;
  closedReason: string;
  requestedByName: string;
  requestedAt: string;
  stages: StageDetail[];
}

export interface ApprovalDetailData {
  id: string;
  requestNo: string;
  document: string;
  documentLabel: string;
  group: string;
  module: string;
  kind: "record" | "action";
  href: string;
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
  canWithdraw: boolean;
  canResubmit: boolean;
  closedReason: string;
  resultSummary: string;
  trigger: string;
  details: { label: string; value: string }[];
  stagesDetail: StageDetail[];
  commentsList: { name: string; text: string; stage: number; kind: string; at: string }[];
  rounds: Round[];
}

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const STAGE_WORDS: Record<string, string> = { APPROVED: "Approved", REJECTED: "Rejected", SENT_BACK: "Sent back", SKIPPED: "Skipped", PENDING: "Waiting", WAITING: "Not yet" };
const COMMENT_WORDS: Record<string, string> = { COMMENT: "commented", APPROVE: "approved", REJECT: "rejected", SEND_BACK: "sent back", RESUBMIT: "sent it again", WITHDRAW: "withdrew it" };

type Act = "approve" | "reject" | "send-back" | "withdraw" | "resubmit";

/**
 * One approval request: what is being approved, every stage, the comments
 * and earlier rounds, and the actions this user may take. Used by Approval
 * Management and opened from notifications.
 */
export default function ApprovalDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<ApprovalDetailData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<Act | "comment" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRounds, setShowRounds] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<ApprovalDetailData>(`/api/approvals/${id}`));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(a: Act) {
    if (!data) return;
    setActionError(null);
    if ((a === "reject" || a === "send-back") && note.trim().length < 3) {
      setActionError(a === "reject" ? "Write the reason for rejecting (at least a few words)." : "Write what needs correcting (at least a few words).");
      return;
    }
    setBusy(a);
    try {
      const path = a === "withdraw" ? "withdraw" : a === "resubmit" ? "resubmit" : "decide";
      const body = path === "decide" ? { action: a, note: note.trim() } : { note: note.trim() };
      const res = await apiFetch<{ approvalMessage?: string } | null>(`/api/approvals/${id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      const label = `${data.documentLabel} ${data.requestNo || data.recordNumber}`.trim();
      const fallback = { approve: `${label} approved`, reject: `${label} rejected`, "send-back": `${label} sent back`, withdraw: `${label} withdrawn`, resubmit: `${label} sent again` }[a];
      toast.success(res?.approvalMessage ?? fallback);
      setNote("");
      onChanged?.();
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    setBusy("comment");
    try {
      await apiFetch(`/api/approvals/${id}/comments`, { method: "POST", body: JSON.stringify({ text: comment.trim() }) });
      setComment("");
      await load();
    } catch (err) {
      toast.error("Comment not added", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  const title = data ? `${data.documentLabel} · ${data.requestNo || data.recordNumber || "Request"}` : "Approval";
  const canDecide = Boolean(data?.canAct);
  const canOwn = Boolean(data?.canWithdraw || data?.canResubmit);

  return (
    <Modal
      title={title}
      subtitle={data ? `${data.group} › ${data.module}` : undefined}
      onClose={onClose}
      busy={busy !== null && busy !== "comment"}
      width="68rem"
      footer={
        data && (canDecide || canOwn) ? (
          <div style={{ width: "100%" }}>
            <textarea
              className="apvTextarea"
              placeholder={canDecide ? "Note for the requester (required to reject or send back)" : "Note (optional)"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              aria-label="Decision note"
              style={{ minHeight: "3rem" }}
            />
            {actionError && (
              <div className="banner bannerError" role="alert" style={{ margin: "0.5rem 0 0" }}>
                <span>{actionError}</span>
              </div>
            )}
            <div className="apvActionBar" style={{ marginTop: "0.5rem" }}>
              {data.canWithdraw && (
                <button type="button" className="button buttonGhost" onClick={() => act("withdraw")} disabled={busy !== null}>
                  {busy === "withdraw" && <span className="spinner" />} Withdraw
                </button>
              )}
              {data.canResubmit && (
                <button type="button" className="button buttonSecondary" onClick={() => act("resubmit")} disabled={busy !== null} title="Send it again as it was, with your note; approval starts again from stage 1">
                  {busy === "resubmit" ? <span className="spinner" /> : <IconRefresh />} Send again
                </button>
              )}
              {canDecide && (
                <>
                  <button type="button" className="button buttonGhost" onClick={() => act("reject")} disabled={busy !== null}>
                    {busy === "reject" ? <span className="spinner" /> : <IconClose />} Reject
                  </button>
                  {data.canSendBack && (
                    <button type="button" className="button buttonSecondary" onClick={() => act("send-back")} disabled={busy !== null} title="Return it to the requester to correct">
                      {busy === "send-back" ? <span className="spinner" /> : <IconArrowLeft />} Send back
                    </button>
                  )}
                  <button type="button" className="button buttonPrimary" onClick={() => act("approve")} disabled={busy !== null}>
                    {busy === "approve" ? <span className="spinner" /> : <IconCheck />} {data.stageCount > 1 ? `Approve stage ${data.currentStage}` : "Approve"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load this approval."} onRetry={load} />}
      {!data && !error && <SkeletonBlock />}
      {data && (
        <div className="apvDetailGrid">
          <div>
            <div className="apvSection">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <StatusBadge status={data.displayStatus} />
                {data.kind === "action" && data.status === "PENDING" && <span className="apvChip apvChipViolet">Not applied until approved</span>}
                {data.waitingFor && <span className="hrMuted" style={{ fontSize: "0.8125rem" }}>Waiting for {data.waitingFor}</span>}
              </div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>{data.summary || data.documentLabel}</div>
              {data.closedReason && <div className="hrMuted" style={{ marginTop: "0.25rem" }}>{data.closedReason}</div>}
              {data.resultSummary && (
                <div className="banner" style={{ marginTop: "0.5rem", background: "var(--success-soft)", borderColor: "var(--success-border)" }}>
                  <span>Applied: {data.resultSummary}</span>
                </div>
              )}
            </div>

            <div className="apvSection">
              <div className="apvSectionTitle">Request</div>
              <div className="apvKv">
                <div>Request no.</div>
                <div className="cellMono">{data.requestNo || "—"}</div>
                <div>Document type</div>
                <div>{data.documentLabel}</div>
                {data.recordNumber && (
                  <>
                    <div>Record</div>
                    <div>
                      <Link href={data.href} className="cellLink">
                        {data.recordNumber} <IconArrowRight />
                      </Link>
                    </div>
                  </>
                )}
                <div>Requested by</div>
                <div>{data.requestedByName || "—"}</div>
                <div>Department</div>
                <div>{data.departmentName || "—"}</div>
                <div>Submitted</div>
                <div>{fmt(data.requestedAt)}</div>
                {data.amount != null && (
                  <>
                    <div>Amount</div>
                    <div className="numCell" style={{ textAlign: "left" }}>
                      ₹{formatMoney(data.amount)}
                    </div>
                  </>
                )}
                {data.decidedAt && (
                  <>
                    <div>Closed</div>
                    <div>{fmt(data.decidedAt)}</div>
                  </>
                )}
              </div>
            </div>

            {data.details.length > 0 && (
              <div className="apvSection">
                <div className="apvSectionTitle">{data.kind === "action" ? "What will change" : "Details"}</div>
                <div className="apvKv">
                  {data.details.map((x, i) => (
                    <div key={i} style={{ display: "contents" }}>
                      <div>{x.label}</div>
                      <div>{x.value || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!data.recordNumber && (
              <div className="apvSection">
                <Link href={data.href} className="cellLink" style={{ fontSize: "0.8125rem" }}>
                  Open the {data.module.toLowerCase()} screen <IconArrowRight />
                </Link>
              </div>
            )}
          </div>

          <div>
            <div className="apvSection">
              <div className="apvSectionTitle">Approval stages</div>
              <div className="apvTimeline">
                <div className="apvTlItem">
                  <div className="apvTlIcon" data-s="APPROVED" aria-hidden>
                    <IconArrowRight />
                  </div>
                  <div>
                    <b>Submitted</b> by {data.requestedByName || "—"}
                    <div className="apvRowSub">{fmt(data.requestedAt)}</div>
                  </div>
                </div>
                {data.stagesDetail.map((s) => (
                  <div className="apvTlItem" key={s.stage}>
                    <div className="apvTlIcon" data-s={s.status} aria-hidden>
                      {s.stage}
                    </div>
                    <div>
                      <b>Stage {s.stage}</b> · {s.approver}
                      {s.limit && <span className="hrMuted"> (if more than ₹{s.limit})</span>}
                      <div>
                        {STAGE_WORDS[s.status] ?? s.status}
                        {s.decidedByName ? ` by ${s.decidedByName}` : ""}
                        {s.override ? " (owner override)" : ""}
                        {s.decidedAt ? <span className="apvRowSub"> · {fmt(s.decidedAt)}</span> : null}
                      </div>
                      {s.note && <div className="apvRowSub">“{s.note}”</div>}
                      {s.skippedReason && <div className="apvRowSub">{s.skippedReason}</div>}
                      {s.escalatedReason && <div className="apvRowSub">{s.escalatedReason}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="apvSection">
              <div className="apvSectionTitle">Comments ({data.commentsList.length})</div>
              {data.commentsList.length === 0 && <div className="hrMuted" style={{ fontSize: "0.8125rem" }}>No comments yet.</div>}
              {data.commentsList.map((c, i) => (
                <div className="apvComment" key={i}>
                  <div className="apvCommentMeta">
                    {c.name || "Someone"} {COMMENT_WORDS[c.kind] ?? "commented"}
                    {c.stage ? ` at stage ${c.stage}` : ""} · {fmt(c.at)}
                  </div>
                  {c.text}
                </div>
              ))}
              <div style={{ marginTop: "0.5rem" }}>
                <textarea className="apvTextarea" placeholder="Add a comment for the requester and approvers" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} aria-label="Comment" />
                <div className="apvActionBar" style={{ marginTop: "0.375rem" }}>
                  <button type="button" className="button buttonSecondary buttonSm" onClick={addComment} disabled={!comment.trim() || busy === "comment"}>
                    {busy === "comment" && <span className="spinner" />} Comment
                  </button>
                </div>
              </div>
            </div>

            {data.rounds.length > 1 && (
              <div className="apvSection">
                <button type="button" className="button buttonGhost buttonSm" onClick={() => setShowRounds((v) => !v)} aria-expanded={showRounds}>
                  {showRounds ? "Hide" : "Show"} earlier rounds ({data.rounds.length - 1})
                </button>
                {showRounds &&
                  data.rounds
                    .filter((r) => r.id !== data.id)
                    .map((r) => (
                      <div key={r.id} className="apvComment" style={{ marginTop: "0.5rem" }}>
                        <div className="apvCommentMeta">
                          {r.requestNo || "Earlier request"} · {fmt(r.requestedAt)} · {APPROVAL_STATUS_LABELS[r.displayStatus] ?? r.status}
                        </div>
                        {r.stages.map((s) => (
                          <div key={s.stage}>
                            Stage {s.stage} · {s.approver}: {STAGE_WORDS[s.status] ?? s.status}
                            {s.decidedByName ? ` by ${s.decidedByName}` : ""}
                            {s.note ? ` — “${s.note}”` : ""}
                          </div>
                        ))}
                        {r.closedReason && <div className="hrMuted">{r.closedReason}</div>}
                      </div>
                    ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
