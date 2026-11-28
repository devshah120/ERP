"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld, partlyHeldMessage } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { MonthPicker, MONTH_NAMES } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconDownload } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Component {
  id: string;
  code: string;
  name: string;
  kind: "EARNING" | "DEDUCTION";
}

interface Sheet {
  year: number;
  month: number;
  locked: boolean;
  draftRun: { id: string; runNumber: string } | null;
  components: Component[];
  allComponents: Component[];
  options: Record<"departments" | "designations" | "branches", { id: string; name: string }[]>;
  rows: { employeeId: string; employeeCode: string; name: string; department: string; designation: string; amounts: Record<string, string> }[];
}

function thisMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

const AMOUNT = /^\d*(\.\d{0,2})?$/;

/** Monthly variable pay: bonus, incentive, overtime and one-off deductions per employee. */
export default function VariablePayPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(thisMonth());
  const [filters, setFilters] = useState({ departmentId: "", designationId: "", branchId: "" });
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<unknown>(null);
  /** Edits not yet saved: employeeId → componentId → text. */
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setApplied(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams({ year: String(period.year), month: String(period.month) });
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      if (applied) p.set("query", applied);
      if (picked.length > 0) p.set("components", picked.join(","));
      setSheet(await apiFetch<Sheet>(`/api/hr/payroll/variables?${p.toString()}`));
      setDraft({});
    } catch (err) {
      setError(err);
    }
  }, [period, filters, applied, picked]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canEdit = hasPermission("hr-payroll.process") && !sheet?.locked;
  const dirty = Object.values(draft).reduce((t, r) => t + Object.keys(r).length, 0);
  const valueOf = (empId: string, compId: string) => draft[empId]?.[compId] ?? sheet?.rows.find((r) => r.employeeId === empId)?.amounts[compId] ?? "";

  const totals = useMemo(() => {
    const out: Record<string, Decimal> = {};
    if (!sheet) return out;
    for (const c of sheet.components) {
      out[c.id] = sheet.rows.reduce((t, r) => {
        const v = draft[r.employeeId]?.[c.id] ?? r.amounts[c.id] ?? "";
        return v && AMOUNT.test(v) && v !== "." ? t.plus(v) : t;
      }, new Decimal(0));
    }
    return out;
  }, [sheet, draft]);

  function setCell(empId: string, compId: string, text: string) {
    if (!AMOUNT.test(text)) return;
    setDraft((d) => ({ ...d, [empId]: { ...(d[empId] ?? {}), [compId]: text } }));
  }

  async function save() {
    setSaving(true);
    try {
      const rows = Object.entries(draft).map(([employeeId, amounts]) => ({ employeeId, amounts }));
      const r = await apiFetch<{ saved: number; cleared: number; draftRun: { id: string; runNumber: string } | null; approvalMessage?: string }>("/api/hr/payroll/variables", {
        method: "PUT",
        body: JSON.stringify({ year: period.year, month: period.month, rows }),
      });
      // Earnings and deductions may each be held by their own approval scheme.
      const partly = partlyHeldMessage(r);
      if (notifyHeld(toast, r)) void load();
      else if (partly) toast.info("Saved; some amounts sent for approval", partly);
      else toast.success("Variable pay saved", r.draftRun ? `Recalculate draft ${r.draftRun.runNumber} to include it.` : undefined);
      load();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  function togglePicked(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  const label = `${MONTH_NAMES[period.month - 1]} ${period.year}`;
  const cols = (sheet?.components.length ?? 0) + 1;

  return (
    <>
      <PageHeader
        title="Variable pay"
        description={`One-off earnings and deductions for ${label}: bonus, incentive, overtime, arrears, canteen and so on. They are added to that month's payroll as entered, without loss-of-pay proration.`}
        actions={
          <>
            <Link href="/hr-pay-components" className="button buttonSecondary">
              Pay components
            </Link>
            <Link href="/hr/payroll/variables/import" className="button buttonSecondary">
              <IconDownload /> Import from Excel
            </Link>
            {canEdit && (
              <button type="button" className="button buttonPrimary" onClick={save} disabled={saving || dirty === 0}>
                {saving && <span className="spinner" />} Save{dirty > 0 ? ` (${dirty})` : ""}
              </button>
            )}
          </>
        }
      />

      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />
        <Select className="select" style={{ width: "auto" }} value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })} aria-label="Department">
          <option value="">All departments</option>
          {sheet?.options.departments.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Select className="select" style={{ width: "auto" }} value={filters.designationId} onChange={(e) => setFilters({ ...filters, designationId: e.target.value })} aria-label="Designation">
          <option value="">All designations</option>
          {sheet?.options.designations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        {(sheet?.options.branches.length ?? 0) > 1 && (
          <Select className="select" style={{ width: "auto" }} value={filters.branchId} onChange={(e) => setFilters({ ...filters, branchId: e.target.value })} aria-label="Location">
            <option value="">All locations</option>
            {sheet?.options.branches.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
        <SearchBox value={query} onChange={setQuery} placeholder="Employee name or code…" width="14rem" />
      </div>

      {sheet && sheet.allComponents.length > 0 && (
        <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.375rem" }}>
          <span className="hrMuted">Components:</span>
          {sheet.allComponents.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`button buttonSm ${picked.length === 0 || picked.includes(c.id) ? "buttonSecondary" : "buttonGhost"}`}
              aria-pressed={picked.includes(c.id)}
              onClick={() => togglePicked(c.id)}
              title={`${c.name} (${c.kind === "EARNING" ? "earning" : "deduction"})`}
            >
              {c.code}
            </button>
          ))}
          {picked.length > 0 && (
            <button type="button" className="button buttonGhost buttonSm" onClick={() => setPicked([])}>
              Show all
            </button>
          )}
        </div>
      )}

      {sheet?.locked && (
        <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
          <span>{label} payroll is approved, so its variable pay is locked. Roll the payroll back to change it.</span>
        </div>
      )}
      {sheet?.draftRun && !sheet.locked && (
        <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
          <span>
            A draft payroll ({sheet.draftRun.runNumber}) exists for {label}. After saving changes here,{" "}
            <Link href={`/hr/payroll/${sheet.draftRun.id}`} className="textLink">
              recalculate it
            </Link>{" "}
            — approval refuses a draft that doesn&apos;t match.
          </span>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              {sheet?.components.map((c) => (
                <th key={c.id} className="numCell" title={c.name}>
                  {c.code}
                  <div className="hrMuted" style={{ fontWeight: 400, color: c.kind === "DEDUCTION" ? "var(--danger)" : undefined }}>
                    {c.kind === "EARNING" ? "earning" : "deduction"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!sheet && !error && <SkeletonRows columns={5} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={cols}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load variable pay."} onRetry={load} />
                </td>
              </tr>
            )}
            {sheet && sheet.rows.length === 0 && (
              <tr>
                <td colSpan={cols}>
                  <EmptyState variant={applied ? "search" : undefined} title="No employees" description={`Nobody matching these filters was on the rolls in ${label}.`} />
                </td>
              </tr>
            )}
            {sheet?.rows.map((r) => (
              <tr key={r.employeeId}>
                <td>
                  {r.name}
                  <div className="hrMuted">
                    {r.employeeCode}
                    {r.department ? ` · ${r.department}` : ""}
                  </div>
                </td>
                {sheet.components.map((c) => (
                  <td key={c.id} className="numCell">
                    {canEdit ? (
                      <input
                        className="input"
                        style={{ width: "7rem", textAlign: "right", ...(draft[r.employeeId]?.[c.id] !== undefined ? { borderColor: "var(--accent)" } : {}) }}
                        inputMode="decimal"
                        value={valueOf(r.employeeId, c.id)}
                        onChange={(e) => setCell(r.employeeId, c.id, e.target.value.trim())}
                        aria-label={`${c.name} for ${r.name}`}
                        placeholder="0"
                      />
                    ) : r.amounts[c.id] ? (
                      formatMoney(r.amounts[c.id])
                    ) : (
                      <span className="cellMuted">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {sheet && sheet.rows.length > 0 && (
            <tfoot>
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                {sheet.components.map((c) => (
                  <td key={c.id} className="numCell">
                    <strong>{formatMoney(totals[c.id]?.toFixed(2) ?? "0")}</strong>
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
