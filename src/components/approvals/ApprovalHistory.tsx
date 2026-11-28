"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import StatusBadge from "@/components/ui/StatusBadge";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatMoney } from "@/lib/format/number";

const fmt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/* ------------------------------------------------------------------ */
/* Scheme history                                                      */
/* ------------------------------------------------------------------ */

interface SchemeChange {
  id: string;
  at: string;
  by: string;
  document: string;
  documentLabel: string;
  action: "Created" | "Changed";
  before: { approvalRequired: boolean; stages: string[] } | null;
  after: { approvalRequired: boolean; stages: string[] };
}

function stagesText(v: { approvalRequired: boolean; stages: string[] } | null) {
  if (!v) return "—";
  if (!v.approvalRequired) return "Approval not required";
  return v.stages.length ? v.stages.join("  →  ") : "Approval required";
}

/** Who changed which approval scheme when, with the stages before and after. */
export function SchemeHistoryModal({
  documents,
  initialDocument,
  onClose,
}: {
  documents: { document: string; label: string }[];
  initialDocument?: string;
  onClose: () => void;
}) {
  const [document, setDocument] = useState(initialDocument ?? "");
  const [rows, setRows] = useState<SchemeChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SchemeChange[]>(`/api/approvals/schemes/history${document ? `?document=${encodeURIComponent(document)}` : ""}`)
      .then((r) => !cancelled && (setRows(r), setError(null)))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load the history"));
    return () => {
      cancelled = true;
    };
  }, [document]);

  return (
    <Modal title="Approval scheme history" subtitle="Every change to a scheme: who made it, when, and the stages before and after." onClose={onClose} width="58rem">
      <div style={{ marginBottom: "0.75rem", maxWidth: "20rem" }}>
        <Select className="select" value={document} onChange={(e) => (setRows(null), setDocument(e.target.value))} aria-label="Document">
          <option value="">All documents</option>
          {documents.map((d) => (
            <option key={d.document} value={d.document}>
              {d.label}
            </option>
          ))}
        </Select>
      </div>
      {error && <ErrorState message={error} />}
      {!rows && !error && <SkeletonBlock lines={4} />}
      {rows && rows.length === 0 && <EmptyState compact title="No changes yet" description="Saving a scheme records it here." />}
      {rows && rows.length > 0 && (
        <div className="tableWrap" style={{ boxShadow: "none", maxHeight: "60vh", overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>By</th>
                <th>Document</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmt(r.at)}</td>
                  <td>{r.by}</td>
                  <td>
                    <div>{r.documentLabel}</div>
                    <div className="hrMuted">{r.action}</div>
                  </td>
                  <td className="hrMuted">{stagesText(r.before)}</td>
                  <td>{stagesText(r.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Request history                                                     */
/* ------------------------------------------------------------------ */

interface RoundStage {
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

interface History {
  documentLabel: string;
  recordNumber: string;
  href: string;
  rounds: {
    id: string;
    status: string;
    closedReason: string;
    requestedByName: string;
    requestedAt: string;
    updatedAt: string;
    amount: string | null;
    summary: string;
    stages: RoundStage[];
  }[];
}

const STAGE_TEXT: Record<string, string> = { APPROVED: "Approved", REJECTED: "Rejected", SKIPPED: "Skipped", PENDING: "Waiting", WAITING: "Not reached" };

/** Every approval round of one record (restarts included) with each stage's decision, note and time. */
export function RequestHistoryModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<History>(`/api/approvals/${id}/history`)
      .then((r) => !cancelled && setData(r))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load the history"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Modal
      title={data ? `${data.documentLabel} ${data.recordNumber}`.trim() : "Approval history"}
      subtitle={
        data ? (
          <Link className="textLink" href={data.href}>
            Open the record
          </Link>
        ) : undefined
      }
      onClose={onClose}
      width="46rem"
    >
      {error && <ErrorState message={error} />}
      {!data && !error && <SkeletonBlock lines={4} />}
      {data && (
        <div style={{ display: "grid", gap: "1rem", maxHeight: "65vh", overflow: "auto" }}>
          {data.rounds.map((r, i) => (
            <section key={r.id} className="formSection" style={{ margin: 0 }}>
              <div className="formSectionHead" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
                <div>
                  <div className="formSectionTitle">
                    {data.rounds.length > 1 ? `Round ${data.rounds.length - i}` : "Approval"}
                    {r.amount != null && <span className="hrMuted"> · {formatMoney(r.amount)}</span>}
                  </div>
                  <div className="formSectionDesc">
                    Raised by {r.requestedByName || "—"} on {fmt(r.requestedAt)}
                    {r.summary ? ` · ${r.summary}` : ""}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="formSectionBody">
                {r.closedReason && (
                  <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
                    <span>{r.closedReason}</span>
                  </div>
                )}
                <ol style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.5rem" }}>
                  {r.stages.map((s) => (
                    <li key={s.stage}>
                      <div>
                        <b>Stage-{s.stage}</b> · {s.approver}
                        {s.limit ? ` (only if more than ${formatMoney(s.limit)})` : ""}: <b>{STAGE_TEXT[s.status] ?? s.status}</b>
                        {s.decidedByName ? ` by ${s.decidedByName}` : ""}
                        {s.decidedAt ? ` on ${fmt(s.decidedAt)}` : ""}
                        {s.override && <span className="hrMuted"> (owner override)</span>}
                      </div>
                      {s.note && <div className="hrMuted">Note: {s.note}</div>}
                      {s.skippedReason && <div className="hrMuted">{s.skippedReason}</div>}
                      {s.escalatedReason && <div className="hrMuted">{s.escalatedReason}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
