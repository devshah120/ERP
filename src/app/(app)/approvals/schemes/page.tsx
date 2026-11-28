"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { APPROVER_TYPES, APPROVER_TYPE_LABELS, APPROVER_TYPE_HINTS, MAX_APPROVAL_STAGES, groupedDocuments, type ApproverType } from "@/lib/approvals/catalog";
import { SchemeHistoryModal } from "@/components/approvals/ApprovalHistory";
import { IconClock, IconPlus, IconTrash, IconSearch, IconInfo, IconChevronRight, IconUsers, IconCheck } from "@/components/icons";

interface StageForm {
  approverType: ApproverType | "";
  userId: string;
  groupId: string;
  roleId: string;
  onlyIfAmountExceeds: boolean;
  minAmount: string;
}

interface SchemeRow {
  document: string;
  label: string;
  group: string;
  module: string;
  kind: "record" | "action";
  amount: boolean;
  sendBack: boolean;
  trigger: string;
  fallback: string | null;
  fallbackLabel: string | null;
  configured: boolean;
  approvalRequired: boolean;
  updatedAt: string | null;
  stages: {
    approverType: ApproverType;
    userId: string | null;
    userName: string;
    groupId: string | null;
    groupName: string;
    roleId: string | null;
    roleName: string;
    onlyIfAmountExceeds: boolean;
    minAmount: string | null;
  }[];
}

type Pick = { id: string; name: string };
const emptyStage = (): StageForm => ({ approverType: "", userId: "", groupId: "", roleId: "", onlyIfAmountExceeds: false, minAmount: "" });
const toForm = (s: SchemeRow | undefined) => ({
  required: Boolean(s?.approvalRequired),
  stages: (s?.stages ?? []).map((st) => ({
    approverType: st.approverType,
    userId: st.userId ?? "",
    groupId: st.groupId ?? "",
    roleId: st.roleId ?? "",
    onlyIfAmountExceeds: st.onlyIfAmountExceeds,
    minAmount: st.minAmount ?? "",
  })),
});
const sameForm = (a: { required: boolean; stages: StageForm[] }, b: { required: boolean; stages: StageForm[] }) => JSON.stringify(a) === JSON.stringify(b);

/** Words for one saved stage, e.g. "Specific User (Asha Rao) if > ₹5000". */
function stageWords(st: SchemeRow["stages"][number]) {
  const who = st.userName || st.groupName || st.roleName;
  return `${APPROVER_TYPE_LABELS[st.approverType]}${who ? ` (${who})` : ""}${st.minAmount ? ` if > ₹${st.minAmount}` : ""}`;
}

/** Problems with one stage being edited, or "" when it is complete. */
function stageProblem(s: StageForm): string {
  if (!s.approverType) return "Choose who approves this stage";
  if (s.approverType === "SPECIFIC_USER" && !s.userId) return "Choose the user";
  if (s.approverType === "USER_GROUP" && !s.groupId) return "Choose the user group";
  if (s.approverType === "DESIGNATED_ROLE" && !s.roleId) return "Choose the role";
  if (s.onlyIfAmountExceeds && !/^\d+(\.\d{1,2})?$/.test(s.minAmount.trim())) return "Enter the amount limit (e.g. 5000 or 5000.50)";
  return "";
}

export default function ApprovalSchemePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canManage = hasPermission("approvals.manage");
  const [schemes, setSchemes] = useState<SchemeRow[] | null>(null);
  const [users, setUsers] = useState<(Pick & { email: string })[]>([]);
  const [groups, setGroups] = useState<(Pick & { status: string })[]>([]);
  const [roles, setRoles] = useState<(Pick & { users: number; owner: boolean })[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [document, setDocument] = useState("");
  const [form, setForm] = useState<{ required: boolean; stages: StageForm[] }>({ required: false, stages: [] });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "on" | "off">("all");
  const [switchTo, setSwitchTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, u, g, r] = await Promise.all([
        apiFetch<SchemeRow[]>("/api/approvals/schemes"),
        apiFetch<(Pick & { email: string })[]>("/api/approvals/users"),
        apiFetch<(Pick & { status: string })[]>("/api/approvals/groups"),
        apiFetch<(Pick & { users: number; owner: boolean })[]>("/api/approvals/roles"),
      ]);
      setSchemes(s);
      setUsers(u);
      setGroups(g.filter((x) => x.status === "ACTIVE"));
      setRoles(r);
      return s;
    } catch (err) {
      setError(err);
      return null;
    }
  }, []);

  const current = schemes?.find((s) => s.document === document);
  const saved = useMemo(() => toForm(current), [current]);
  const dirty = Boolean(current) && !sameForm(form, saved);

  function open(key: string, list = schemes) {
    setDocument(key);
    setFormError(null);
    setTouched(false);
    setForm(toForm(list?.find((x) => x.document === key)));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("document", key);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // The address bar is a convenience only.
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then((s) => {
      if (!s) return;
      const wanted = new URLSearchParams(window.location.search).get("document");
      const first = s.find((x) => x.document === wanted) ?? s[0];
      if (first) open(first.document, s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function choose(key: string) {
    if (key === document) return;
    if (dirty) setSwitchTo(key);
    else open(key);
  }

  function patch(i: number, p: Partial<StageForm>) {
    setForm((f) => ({ ...f, stages: f.stages.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  }

  async function save() {
    setTouched(true);
    setFormError(null);
    if (form.required) {
      if (form.stages.length === 0) return setFormError("Add at least one stage, or switch approval off.");
      const bad = form.stages.findIndex((s) => stageProblem(s));
      if (bad >= 0) return setFormError(`Stage ${bad + 1}: ${stageProblem(form.stages[bad])}.`);
    }
    setSaving(true);
    try {
      await apiFetch(`/api/approvals/schemes/${document}`, {
        method: "PUT",
        body: JSON.stringify({
          approvalRequired: form.required,
          stages: form.required
            ? form.stages.map((s) => ({
                approverType: s.approverType,
                userId: s.approverType === "SPECIFIC_USER" ? s.userId || null : null,
                groupId: s.approverType === "USER_GROUP" ? s.groupId || null : null,
                roleId: s.approverType === "DESIGNATED_ROLE" ? s.roleId || null : null,
                onlyIfAmountExceeds: s.onlyIfAmountExceeds,
                minAmount: s.onlyIfAmountExceeds ? s.minAmount.trim() || null : null,
              }))
            : [],
        }),
      });
      toast.success("Approval scheme saved", current?.label);
      const list = await load();
      if (list) open(document, list);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save the scheme");
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (schemes ?? []).filter((s) => {
      if (show === "on" && !s.approvalRequired) return false;
      if (show === "off" && s.approvalRequired) return false;
      return !q || `${s.label} ${s.module} ${s.group} ${s.trigger}`.toLowerCase().includes(q);
    });
  }, [schemes, query, show]);
  const grouped = useMemo(() => groupedDocuments(filtered), [filtered]);
  const onCount = (schemes ?? []).filter((s) => s.approvalRequired).length;

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Approval Scheme"
        description="Choose which transactions need approval and who approves them: up to three stages, each decided by a reporting manager, department head, a named user, a user group or everyone holding a role."
        count={schemes ? onCount : null}
        actions={
          <>
            <Link href="/approvals/groups" className="button buttonSecondary">
              <IconUsers /> User groups
            </Link>
            <button type="button" className="button buttonSecondary" onClick={() => setShowHistory(true)} disabled={!schemes} title="Who changed which scheme, when, and what it was before">
              <IconClock /> History
            </button>
          </>
        }
      />

      {showHistory && schemes && <SchemeHistoryModal documents={schemes.map((s) => ({ document: s.document, label: s.label }))} initialDocument={document} onClose={() => setShowHistory(false)} />}

      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load approval schemes."} onRetry={load} />}
      {!schemes && !error && <SkeletonBlock />}

      {schemes && (
        <div className="apvLayout">
          <aside className="apvPanel apvNav" aria-label="Transactions">
            <div className="apvNavSearch">
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", display: "flex" }} aria-hidden>
                  <IconSearch />
                </span>
                <input className="input" style={{ paddingLeft: "2rem" }} placeholder="Search transactions" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transactions" />
              </div>
              <div className="apvTypeGrid" role="group" aria-label="Show">
                {(["all", "on", "off"] as const).map((v) => (
                  <button key={v} type="button" className="apvTypeBtn" aria-pressed={show === v} onClick={() => setShow(v)}>
                    {v === "all" ? `All (${schemes.length})` : v === "on" ? `Approval on (${onCount})` : `Off (${schemes.length - onCount})`}
                  </button>
                ))}
              </div>
            </div>
            <div className="apvNavList">
              {grouped.length === 0 && <div className="apvNavEmpty">No transaction matches “{query}”.</div>}
              {grouped.map((g) => (
                <div key={g.group}>
                  <div className="apvNavGroup">{g.group}</div>
                  {g.modules.map((m) => (
                    <div key={m.module}>
                      <div className="apvNavModule">{m.module}</div>
                      {m.docs.map((s) => (
                        <button key={s.document} type="button" className="apvNavItem" aria-current={s.document === document} onClick={() => choose(s.document)}>
                          <span>{s.label}</span>
                          {s.approvalRequired ? <span className="apvChip apvChipOn">{s.stages.length} stage{s.stages.length === 1 ? "" : "s"}</span> : <span className="apvChip">Off</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <section className="apvPanel" aria-live="polite">
            {!current && (
              <div className="apvPanelBody">
                <EmptyState title="Choose a transaction" description="Pick a transaction on the left to see or change who approves it." />
              </div>
            )}
            {current && (
              <>
                <div className="apvPanelHead">
                  <div style={{ minWidth: 0 }}>
                    <div className="apvCrumb">
                      {current.group} <IconChevronRight /> {current.module}
                    </div>
                    <h2 className="apvTitle">{current.label}</h2>
                    <div className="apvTrigger">
                      <IconInfo />
                      <span>
                        <b>Starts when:</b> {current.trigger}.{" "}
                        {current.kind === "action"
                          ? "With approval on, the change is held: nothing is written until the last stage approves."
                          : "With approval on, the record waits as pending and its own Approve step follows these stages."}
                      </span>
                    </div>
                    {current.fallbackLabel && (
                      <div className="apvTrigger">
                        <IconInfo />
                        <span>Without a scheme of its own, the {current.fallbackLabel} scheme applies.</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                    {current.kind === "action" ? <span className="apvChip apvChipViolet">Held until approved</span> : <span className="apvChip apvChipAccent">Record approval</span>}
                    {current.sendBack && <span className="apvChip">Can be sent back</span>}
                    {current.amount && <span className="apvChip">Amount limits</span>}
                    {dirty && <span className="apvChip apvChipWarn">Unsaved changes</span>}
                  </div>
                </div>

                <div className="apvPanelBody">
                  <div className="apvToggleRow">
                    <div>
                      <strong>Approval required</strong>
                      <div className="hrMuted" style={{ fontSize: "0.8125rem" }}>
                        {form.required ? "Every new request follows the stages below." : "Off: it goes through without approval, as before."}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      className="apvSwitch"
                      aria-checked={form.required}
                      aria-label="Approval required"
                      disabled={!canManage}
                      onClick={() => setForm((f) => ({ required: !f.required, stages: !f.required && f.stages.length === 0 ? [emptyStage()] : f.stages }))}
                    />
                  </div>

                  {form.required && (
                    <>
                      <div className="apvStages">
                        {form.stages.map((s, i) => {
                          const problem = touched ? stageProblem(s) : "";
                          return (
                            <div className="apvStage" key={i}>
                              <div className="apvStageNo" aria-hidden>
                                {i + 1}
                              </div>
                              <div className="apvStageCard" data-invalid={Boolean(problem)}>
                                <div className="apvStageHead">
                                  <strong>Stage {i + 1}</strong>
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="button buttonGhost buttonSm"
                                      onClick={() => setForm((f) => ({ ...f, stages: f.stages.filter((_, j) => j !== i) }))}
                                      aria-label={`Remove stage ${i + 1}`}
                                      title="Remove this stage"
                                    >
                                      <IconTrash />
                                    </button>
                                  )}
                                </div>
                                <div className="apvTypeGrid" role="radiogroup" aria-label={`Stage ${i + 1} approver type`}>
                                  {APPROVER_TYPES.map((t) => (
                                    <button key={t} type="button" className="apvTypeBtn" aria-pressed={s.approverType === t} disabled={!canManage} onClick={() => patch(i, { approverType: t })} title={APPROVER_TYPE_HINTS[t]}>
                                      {APPROVER_TYPE_LABELS[t]}
                                    </button>
                                  ))}
                                </div>
                                {s.approverType && <div className="fieldHint" style={{ marginTop: "0.375rem" }}>{APPROVER_TYPE_HINTS[s.approverType]}</div>}

                                <div className="apvStageGrid">
                                  {s.approverType === "SPECIFIC_USER" && (
                                    <div className="field">
                                      <label htmlFor={`as-user-${i}`}>User</label>
                                      <Select id={`as-user-${i}`} className="select" value={s.userId} disabled={!canManage} onChange={(e) => patch(i, { userId: e.target.value })}>
                                        <option value="">Choose a user</option>
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
                                      <label htmlFor={`as-group-${i}`}>User group</label>
                                      <Select id={`as-group-${i}`} className="select" value={s.groupId} disabled={!canManage} onChange={(e) => patch(i, { groupId: e.target.value })}>
                                        <option value="">Choose a group</option>
                                        {groups.map((g) => (
                                          <option key={g.id} value={g.id}>
                                            {g.name}
                                          </option>
                                        ))}
                                      </Select>
                                      {groups.length === 0 && (
                                        <span className="fieldHint">
                                          No user groups yet. <Link href="/approvals/groups">Create one</Link>.
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {s.approverType === "DESIGNATED_ROLE" && (
                                    <div className="field">
                                      <label htmlFor={`as-role-${i}`}>Role</label>
                                      <Select id={`as-role-${i}`} className="select" value={s.roleId} disabled={!canManage} onChange={(e) => patch(i, { roleId: e.target.value })}>
                                        <option value="">Choose a role</option>
                                        {roles.map((r) => (
                                          <option key={r.id} value={r.id}>
                                            {r.name} · {r.users} active user{r.users === 1 ? "" : "s"}
                                          </option>
                                        ))}
                                      </Select>
                                    </div>
                                  )}
                                  {current.amount && (
                                    <div className="field">
                                      <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
                                        <input type="checkbox" checked={s.onlyIfAmountExceeds} disabled={!canManage} onChange={(e) => patch(i, { onlyIfAmountExceeds: e.target.checked })} />
                                        Only when the amount is more than
                                      </label>
                                      {s.onlyIfAmountExceeds && (
                                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                          <span className="hrMuted">₹</span>
                                          <input className="input" inputMode="decimal" placeholder="0.00" value={s.minAmount} disabled={!canManage} onChange={(e) => patch(i, { minAmount: e.target.value })} aria-label={`Stage ${i + 1} amount limit`} />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {problem && (
                                  <div className="fieldError" role="alert" style={{ marginTop: "0.5rem", color: "var(--danger)", fontSize: "0.75rem" }}>
                                    {problem}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <div className="apvStageEnd">
                          <div className="apvStageNo" aria-hidden>
                            <IconCheck />
                          </div>
                          <div>{current.kind === "action" ? "Approved: the change is applied." : "Approved: the record moves on."}</div>
                        </div>
                      </div>

                      {canManage && form.stages.length < MAX_APPROVAL_STAGES && (
                        <button type="button" className="button buttonSecondary" style={{ marginTop: "0.75rem" }} onClick={() => setForm((f) => ({ ...f, stages: [...f.stages, emptyStage()] }))}>
                          <IconPlus /> Add stage {form.stages.length + 1}
                        </button>
                      )}
                      {form.stages.length >= MAX_APPROVAL_STAGES && <div className="fieldHint" style={{ marginTop: "0.75rem" }}>Three stages is the most a scheme can have.</div>}
                    </>
                  )}

                  {formError && (
                    <div className="banner bannerError" role="alert" style={{ marginTop: "0.75rem" }}>
                      <span>{formError}</span>
                    </div>
                  )}

                  {canManage ? (
                    <div className="formActionsBar">
                      <span className="formActionsNote">
                        Requests already waiting keep the stages they started with; new ones follow the scheme as saved. Nobody approves their own request, and a stage nobody can act on (no
                        manager or department head, approver disabled, empty group or role) goes to the workspace owner.
                      </span>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        {dirty && (
                          <button type="button" className="button buttonGhost" onClick={() => (setForm(saved), setFormError(null), setTouched(false))} disabled={saving}>
                            Discard
                          </button>
                        )}
                        <button type="button" className="button buttonPrimary" onClick={save} disabled={saving || !dirty}>
                          {saving && <span className="spinner" />} Save scheme
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="fieldHint" style={{ marginTop: "0.75rem" }}>
                      You can view schemes. Changing them needs the “Approval schemes & user groups: manage” permission.
                    </div>
                  )}

                  {current.approvalRequired && current.stages.length > 0 && (
                    <div style={{ marginTop: "1rem" }}>
                      <div className="apvSectionTitle">Saved flow</div>
                      <div className="apvFlow">
                        <span className="apvFlowStep">Requester</span>
                        {current.stages.map((st, i) => (
                          <span key={i} style={{ display: "contents" }}>
                            <IconChevronRight />
                            <span className="apvFlowStep">
                              {i + 1}. {stageWords(st)}
                            </span>
                          </span>
                        ))}
                        <IconChevronRight />
                        <span className="apvFlowStep">{current.kind === "action" ? "Applied" : "Approved"}</span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {switchTo && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message={`Your changes to ${current?.label ?? "this scheme"} are not saved.`}
          confirmLabel="Discard and switch"
          tone="danger"
          onConfirm={() => {
            const k = switchTo;
            setSwitchTo(null);
            open(k);
          }}
          onCancel={() => setSwitchTo(null)}
        />
      )}
    </>
  );
}
