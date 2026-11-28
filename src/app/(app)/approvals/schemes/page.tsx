"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { APPROVER_TYPES, APPROVER_TYPE_LABELS, MAX_APPROVAL_STAGES, type ApproverType } from "@/lib/approvals/catalog";
import { SchemeHistoryModal } from "@/components/approvals/ApprovalHistory";
import { IconClock } from "@/components/icons";

interface StageForm {
  approverType: ApproverType | "";
  userId: string;
  groupId: string;
  onlyIfAmountExceeds: boolean;
  minAmount: string;
}

interface SchemeRow {
  document: string;
  label: string;
  module: string;
  amount: boolean;
  configured: boolean;
  approvalRequired: boolean;
  stages: { approverType: ApproverType; userId: string | null; userName: string; groupId: string | null; groupName: string; onlyIfAmountExceeds: boolean; minAmount: string | null }[];
}

const emptyStage = (): StageForm => ({ approverType: "", userId: "", groupId: "", onlyIfAmountExceeds: false, minAmount: "" });

export default function ApprovalSchemePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canManage = hasPermission("approvals.manage");
  const [schemes, setSchemes] = useState<SchemeRow[] | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; status: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [document, setDocument] = useState("");
  const [required, setRequired] = useState(false);
  const [stages, setStages] = useState<StageForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, u, g] = await Promise.all([
        apiFetch<SchemeRow[]>("/api/approvals/schemes"),
        apiFetch<{ id: string; name: string; email: string }[]>("/api/approvals/users"),
        apiFetch<{ id: string; name: string; status: string }[]>("/api/approvals/groups"),
      ]);
      setSchemes(s);
      setUsers(u);
      setGroups(g.filter((x) => x.status === "ACTIVE"));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function pick(key: string) {
    setDocument(key);
    setFormError(null);
    const s = schemes?.find((x) => x.document === key);
    setRequired(Boolean(s?.approvalRequired));
    setStages(
      (s?.stages ?? []).map((st) => ({
        approverType: st.approverType,
        userId: st.userId ?? "",
        groupId: st.groupId ?? "",
        onlyIfAmountExceeds: st.onlyIfAmountExceeds,
        minAmount: st.minAmount ?? "",
      }))
    );
  }

  function setCount(n: number) {
    setStages((cur) => Array.from({ length: n }, (_, i) => cur[i] ?? emptyStage()));
  }

  function patch(i: number, p: Partial<StageForm>) {
    setStages((cur) => cur.map((s, j) => (j === i ? { ...s, ...p } : s)));
  }

  async function save() {
    setFormError(null);
    if (required) {
      if (stages.length === 0) return setFormError("Choose the number of stages");
      const missing = stages.findIndex((s) => !s.approverType);
      if (missing >= 0) return setFormError(`Stage-${missing + 1}: choose the approver type`);
    }
    setSaving(true);
    try {
      await apiFetch(`/api/approvals/schemes/${document}`, {
        method: "PUT",
        body: JSON.stringify({
          approvalRequired: required,
          stages: required
            ? stages.map((s) => ({
                approverType: s.approverType,
                userId: s.approverType === "SPECIFIC_USER" ? s.userId || null : null,
                groupId: s.approverType === "USER_GROUP" ? s.groupId || null : null,
                onlyIfAmountExceeds: s.onlyIfAmountExceeds,
                minAmount: s.onlyIfAmountExceeds ? s.minAmount || null : null,
              }))
            : [],
        }),
      });
      toast.success("Approval scheme saved", current?.label);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save the scheme");
    } finally {
      setSaving(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const current = schemes?.find((s) => s.document === document);
  const modules = [...new Set((schemes ?? []).map((s) => s.module))];

  return (
    <>
      <PageHeader
        title="Approval Scheme"
        description="Defines the workflow and hierarchy for transaction approvals: up to three stages, each approved by the reporting manager, a specific user or a user group."
        actions={
          <button type="button" className="button buttonSecondary" onClick={() => setShowHistory(true)} disabled={!schemes} title="Who changed which scheme, when, and what it was before">
            <IconClock /> History
          </button>
        }
      />

      {showHistory && schemes && (
        <SchemeHistoryModal documents={schemes.map((s) => ({ document: s.document, label: s.label }))} initialDocument={document} onClose={() => setShowHistory(false)} />
      )}

      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load approval schemes."} onRetry={load} />}
      {!schemes && !error && <SkeletonBlock />}

      {schemes && (
        <section className="formSection" style={{ maxWidth: "64rem" }}>
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="as-doc">
                  Document<span className="req">*</span>
                </label>
                <Select id="as-doc" className="select" value={document} onChange={(e) => pick(e.target.value)}>
                  <option value="">--Select--</option>
                  {modules.map((m) => (
                    <optgroup key={m} label={m}>
                      {schemes
                        .filter((s) => s.module === m)
                        .map((s) => (
                          <option key={s.document} value={s.document}>
                            {s.label}
                            {s.configured && s.approvalRequired ? ` · ${s.stages.length} stage(s)` : ""}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
            </div>

            {current && (
              <>
                <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center", margin: "0.75rem 0" }}>
                  <input type="checkbox" checked={required} disabled={!canManage} onChange={(e) => (setRequired(e.target.checked), e.target.checked && stages.length === 0 && setCount(1))} />
                  Approval Req.
                </label>

                {required && (
                  <>
                    <div className="formGrid">
                      <div className="field">
                        <label htmlFor="as-count">No. of Stages</label>
                        <Select id="as-count" className="select" value={stages.length || ""} disabled={!canManage} onChange={(e) => setCount(Number(e.target.value) || 0)}>
                          <option value="">--Select--</option>
                          {Array.from({ length: MAX_APPROVAL_STAGES }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
                      {stages.map((s, i) => (
                        <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius, 8px)", padding: "0.75rem 1rem", background: "var(--surface)" }}>
                          <div style={{ fontWeight: 600, textAlign: "center", marginBottom: "0.5rem" }}>Stage-{i + 1}</div>
                          <div className="field">
                            <label htmlFor={`as-type-${i}`}>Approver Type</label>
                            <Select id={`as-type-${i}`} className="select" value={s.approverType} disabled={!canManage} onChange={(e) => patch(i, { approverType: e.target.value as ApproverType })}>
                              <option value="">--Select--</option>
                              {APPROVER_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {APPROVER_TYPE_LABELS[t]}
                                </option>
                              ))}
                            </Select>
                          </div>
                          {s.approverType === "SPECIFIC_USER" && (
                            <div className="field">
                              <label htmlFor={`as-user-${i}`}>User</label>
                              <Select id={`as-user-${i}`} className="select" value={s.userId} disabled={!canManage} onChange={(e) => patch(i, { userId: e.target.value })}>
                                <option value="">--Select--</option>
                                {users.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name} ({u.email})
                                  </option>
                                ))}
                              </Select>
                            </div>
                          )}
                          {s.approverType === "USER_GROUP" && (
                            <div className="field">
                              <label htmlFor={`as-group-${i}`}>User Group</label>
                              <Select id={`as-group-${i}`} className="select" value={s.groupId} disabled={!canManage} onChange={(e) => patch(i, { groupId: e.target.value })}>
                                <option value="">--Select--</option>
                                {groups.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </Select>
                              {groups.length === 0 && <span className="fieldHint">No user groups yet. Create one under Approval User Groups.</span>}
                            </div>
                          )}
                          {current.amount && (
                            <div className="field">
                              <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
                                <input type="checkbox" checked={s.onlyIfAmountExceeds} disabled={!canManage} onChange={(e) => patch(i, { onlyIfAmountExceeds: e.target.checked })} />
                                Only if amount limit exceeded
                              </label>
                              {s.onlyIfAmountExceeds && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <input className="input" inputMode="decimal" placeholder="0.00" value={s.minAmount} disabled={!canManage} onChange={(e) => patch(i, { minAmount: e.target.value })} aria-label={`Stage-${i + 1} amount limit`} />
                                  <span className="hrMuted">INR</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {formError && (
                  <div className="banner bannerError" role="alert" style={{ marginTop: "0.75rem" }}>
                    <span>{formError}</span>
                  </div>
                )}
                {canManage && (
                  <div className="formActionsBar">
                    <span className="formActionsNote">
                      Requests already waiting keep the stages they started with. New ones follow the scheme as saved. Nobody approves their own request, and a stage
                      with no one to act on it (no reporting manager, approver disabled, empty group) goes to the workspace owner.
                    </span>
                    <button type="button" className="button buttonPrimary" onClick={save} disabled={saving}>
                      {saving && <span className="spinner" />} Save scheme
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {schemes && (
        <div className="tableWrap" style={{ marginTop: "1rem" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Document</th>
                <th>Approval</th>
                <th>Stages</th>
              </tr>
            </thead>
            <tbody>
              {schemes.map((s) => (
                <tr key={s.document} onClick={() => pick(s.document)} style={{ cursor: "pointer" }}>
                  <td>{s.module}</td>
                  <td className="cellLink">{s.label}</td>
                  <td>{s.approvalRequired ? "Required" : "Not required"}</td>
                  <td className="hrMuted">
                    {s.approvalRequired
                      ? s.stages
                          .map((st, i) => `${i + 1}. ${APPROVER_TYPE_LABELS[st.approverType]}${st.userName ? ` (${st.userName})` : st.groupName ? ` (${st.groupName})` : ""}${st.minAmount ? ` if > ₹${st.minAmount}` : ""}`)
                          .join("  →  ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
