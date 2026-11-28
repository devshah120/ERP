"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import { Card, fmtDate } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } from "@/lib/resources/ui/hrRegistry";
import { IconPlus } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Change {
  id: string;
  effectiveDate: string;
  changeType: string;
  source: string;
  reason: string;
  scheduled: boolean;
  changes: { field: string; label: string; from: string; to: string; money: boolean }[];
}

interface History {
  items: Change[];
  current: Record<string, string | boolean>;
  options: Record<"departments" | "designations" | "branches" | "managers", { id: string; name: string }[]>;
}

const TYPE_LABELS: Record<string, string> = {
  JOINED: "Joined",
  SALARY_REVISION: "Salary revision",
  PROMOTION: "Promotion",
  TRANSFER: "Transfer",
  STATUS_CHANGE: "Status change",
  CORRECTION: "Correction",
};

type FieldKind = "ref" | "text" | "money" | "flag" | "select";
const FIELDS: { key: string; label: string; kind: FieldKind; options?: "departments" | "designations" | "branches" | "managers"; labels?: Record<string, string> }[] = [
  { key: "designationId", label: "Designation", kind: "ref", options: "designations" },
  { key: "departmentId", label: "Department", kind: "ref", options: "departments" },
  { key: "reportingManagerId", label: "Reporting manager", kind: "ref", options: "managers" },
  { key: "branchId", label: "Branch", kind: "ref", options: "branches" },
  { key: "workLocation", label: "Work location", kind: "text" },
  { key: "employmentStatus", label: "Status", kind: "select", labels: { PROBATION: "On probation", CONFIRMED: "Confirmed", ON_NOTICE: "Serving notice" } },
  { key: "employmentType", label: "Employment type", kind: "select", labels: EMPLOYMENT_TYPE_LABELS },
  { key: "basic", label: "Basic (monthly)", kind: "money" },
  { key: "hra", label: "HRA", kind: "money" },
  { key: "conveyance", label: "Conveyance", kind: "money" },
  { key: "specialAllowance", label: "Special allowance", kind: "money" },
  { key: "otherAllowance", label: "Other allowance", kind: "money" },
  { key: "professionalTax", label: "Professional tax", kind: "money" },
  { key: "monthlyTds", label: "Monthly TDS", kind: "money" },
  { key: "pfApplicable", label: "PF applies", kind: "flag" },
  { key: "esiApplicable", label: "ESI applies", kind: "flag" },
  { key: "ptApplicable", label: "PT applies", kind: "flag" },
];

const SALARY = ["basic", "hra", "conveyance", "specialAllowance", "otherAllowance", "professionalTax", "monthlyTds", "pfApplicable", "esiApplicable", "ptApplicable"];
/** Which fields each kind of change shows; a correction shows everything. */
const FIELDS_FOR: Record<string, string[]> = {
  SALARY_REVISION: SALARY,
  PROMOTION: ["designationId", "departmentId", "reportingManagerId", ...SALARY.slice(0, 5)],
  TRANSFER: ["departmentId", "branchId", "workLocation", "reportingManagerId"],
  STATUS_CHANGE: ["employmentStatus", "employmentType"],
  CORRECTION: FIELDS.map((f) => f.key),
};

function display(field: string, value: string, money: boolean): string {
  if (money) return formatMoney(value);
  if (field === "employmentStatus") return EMPLOYMENT_STATUS_LABELS[value] ?? value;
  if (field === "employmentType") return EMPLOYMENT_TYPE_LABELS[value] ?? value;
  return value;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** An employee's dated job and salary changes, and the form to record one. */
export default function EmploymentHistory({ employeeId, canEdit, onChanged }: { employeeId: string; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<History>(`/api/hr/employees/${employeeId}/history`));
    } catch (err) {
      setError(err);
    }
  }, [employeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      const res = await apiFetch<unknown>(`/api/hr/employees/${employeeId}/history/${removing.id}`, { method: "DELETE" });
      if (!notifyHeld(toast, res)) toast.success("Change removed");
      setRemoving(null);
      load();
      onChanged();
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error instanceof ApiError ? error.message : "Could not load the history."} onRetry={load} />;
  if (!data) return <SkeletonBlock lines={5} />;

  return (
    <>
      <Card
        title="Employment history"
        action={
          canEdit ? (
            <button type="button" className="button buttonSecondary buttonSm" onClick={() => setAdding(true)}>
              <IconPlus /> Record change
            </button>
          ) : undefined
        }
      >
        <p className="hrMuted" style={{ marginTop: 0 }}>
          Salary, job and status changes with the date each took effect. Payroll uses the salary in effect during the month; a mid-month revision is paid day by day.
        </p>
        {data.items.length === 0 ? (
          <EmptyState compact title="No changes recorded yet" description="The history starts with the first change you record." />
        ) : (
          <ol className="hrTimeline">
            {data.items.map((c) => (
              <li key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <div>
                    <strong>{TYPE_LABELS[c.changeType] ?? c.changeType}</strong>
                    <span className="hrMuted"> · from {fmtDate(c.effectiveDate)}</span>
                    {c.scheduled && (
                      <span className="badge badgeInfo" style={{ marginLeft: "0.5rem" }}>
                        Scheduled
                      </span>
                    )}
                    {c.source === "FORM" && <span className="hrMuted"> · edited on the employee record</span>}
                  </div>
                  {canEdit && c.source !== "BASELINE" && (
                    <button type="button" className="button buttonGhost buttonSm" onClick={() => (setRemoveError(null), setRemoving(c))}>
                      Remove
                    </button>
                  )}
                </div>
                {c.changes.length > 0 && (
                  <ul className="hrMuted" style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
                    {c.changes.map((x) => (
                      <li key={x.field}>
                        {x.label}: {display(x.field, x.from, x.money)} → <strong style={{ color: "var(--text)" }}>{display(x.field, x.to, x.money)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                {c.reason && c.source !== "BASELINE" && c.source !== "FORM" && <div className="hrMuted">{c.reason}</div>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {adding && (
        <ChangeForm
          employeeId={employeeId}
          data={data}
          onClose={() => setAdding(false)}
          onDone={(msg) => {
            toast.success(msg);
            setAdding(false);
            load();
            onChanged();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove this ${(TYPE_LABELS[removing.changeType] ?? "change").toLowerCase()}?`}
          message={`From ${fmtDate(removing.effectiveDate)}. Later changes that carried its values go back to the earlier ones, and the employee record is updated.`}
          confirmLabel="Remove"
          busy={busy}
          error={removeError}
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}

function ChangeForm({ employeeId, data, onClose, onDone }: { employeeId: string; data: History; onClose: () => void; onDone: (message: string) => void }) {
  const [changeType, setChangeType] = useState("SALARY_REVISION");
  const [effectiveDate, setEffectiveDate] = useState(todayKey());
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string | boolean>>(() => ({ ...data.current }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => FIELDS.filter((f) => FIELDS_FOR[changeType].includes(f.key)), [changeType]);
  const changed = shown.filter((f) => String(values[f.key] ?? "") !== String(data.current[f.key] ?? ""));

  async function submit() {
    setBusy(true);
    setError(null);
    const changes: Record<string, unknown> = {};
    for (const f of changed) {
      const v = values[f.key];
      changes[f.key] = f.kind === "ref" ? (v ? v : null) : v;
    }
    try {
      const r = await apiFetch<{ scheduled: boolean; effectiveDate: string; arrears: number; pendingApproval?: boolean; approvalMessage?: string }>(`/api/hr/employees/${employeeId}/history`, {
        method: "POST",
        body: JSON.stringify({ changeType, effectiveDate, reason, changes }),
      });
      if (r.pendingApproval && r.approvalMessage) return onDone(r.approvalMessage);
      onDone(r.scheduled ? `Scheduled from ${fmtDate(r.effectiveDate)}` : r.arrears > 0 ? `Change recorded; arrears for ${r.arrears} paid month(s) go into the next payroll` : "Change recorded");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Record a change"
      subtitle="Only the fields you change are recorded. A future date is applied automatically when it arrives. A salary increase dated into months already paid creates arrears for the next payroll."
      onClose={onClose}
      busy={busy}
      width="44rem"
      footer={
        <>
          <button type="button" className="button buttonSecondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button buttonPrimary" onClick={submit} disabled={busy || changed.length === 0 || !effectiveDate}>
            {busy && <span className="spinner" />} Save change
          </button>
        </>
      }
    >
      {error && (
        <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
          <span>{error}</span>
        </div>
      )}
      <div className="formGrid">
        <div className="field">
          <label htmlFor="hc-type">What changed</label>
          <Select id="hc-type" className="select" value={changeType} onChange={(e) => setChangeType(e.target.value)}>
            {Object.entries(TYPE_LABELS)
              .filter(([k]) => k !== "JOINED")
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor="hc-date">Takes effect from</label>
          <input id="hc-date" type="date" className="input" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
        {shown.map((f) => (
          <div key={f.key} className="field">
            <label htmlFor={`hc-${f.key}`}>
              {f.label}
              {changed.includes(f) && <span className="hint"> · changed</span>}
            </label>
            {f.kind === "flag" ? (
              <label className="checkboxRow">
                <input id={`hc-${f.key}`} type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} />
                Yes
              </label>
            ) : f.kind === "ref" ? (
              <Select id={`hc-${f.key}`} className="select" value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                <option value="">— None —</option>
                {data.options[f.options!].map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            ) : f.kind === "select" ? (
              <Select id={`hc-${f.key}`} className="select" value={String(values[f.key] ?? "")} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                {Object.entries(f.labels!).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            ) : (
              <input
                id={`hc-${f.key}`}
                className="input"
                inputMode={f.kind === "money" ? "decimal" : undefined}
                value={String(values[f.key] ?? "")}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </div>
        ))}
        <div className="field fieldSpanFull">
          <label htmlFor="hc-reason">Reason or reference</label>
          <input id="hc-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Annual appraisal 2026, letter HR/2026/114" />
        </div>
      </div>
    </Modal>
  );
}
