"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import type { LeaveBalance } from "@/components/hr/LeaveForm";

interface Table {
  year: number;
  leaveTypes: { id: string; code: string; name: string; annualQuota: number }[];
  rows: { employeeId: string; employeeCode: string; name: string; balances: LeaveBalance[] }[];
}

interface Editing {
  employeeId: string;
  name: string;
  balance: LeaveBalance;
  allocated: string;
  carriedForward: string;
  notes: string;
}

export default function LeaveBalancesPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [data, setData] = useState<Table | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setApplied(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (applied) p.set("query", applied);
      setData(await apiFetch<Table>(`/api/hr/leaves/balances?${p.toString()}`));
    } catch (err) {
      setError(err);
    }
  }, [year, applied]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canAllocate = hasPermission("hr-leaves.allocate");

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch("/api/hr/leaves/balances", {
        method: "PUT",
        body: JSON.stringify({
          employeeId: editing.employeeId,
          leaveTypeId: editing.balance.leaveTypeId,
          year,
          allocated: Number(editing.allocated) || 0,
          carriedForward: Number(editing.carriedForward) || 0,
          notes: editing.notes,
        }),
      });
      toast.success(`${editing.balance.name} updated for ${editing.name}`);
      setEditing(null);
      load();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  const cols = (data?.leaveTypes.length ?? 0) + 1;

  return (
    <>
      <PageHeader
        title="Leave balances"
        description={`Days available in ${year}: granted (the leave type's yearly quota unless changed here) plus carry-forward, minus approved leave.${canAllocate ? " Click a number to change what an employee is granted." : ""}`}
        actions={
          <Link href="/hr-leave-types" className="button buttonSecondary">
            Leave types
          </Link>
        }
      />
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search employee…" width="16rem" />
        <select className="select" style={{ width: "auto" }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[year - 2, year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              {data?.leaveTypes.map((t) => (
                <th key={t.id} className="numCell" title={`${t.name}: ${t.annualQuota} days a year`}>
                  {t.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={5} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={cols}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load balances."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={cols}>
                  <EmptyState title="No employees" />
                </td>
              </tr>
            )}
            {data?.rows.map((r) => (
              <tr key={r.employeeId}>
                <td>
                  <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                    {r.name}
                  </Link>
                  <div className="hrMuted">{r.employeeCode}</div>
                </td>
                {data.leaveTypes.map((t) => {
                  const b = r.balances.find((x) => x.leaveTypeId === t.id);
                  if (!b) return <td key={t.id} />;
                  const label = (
                    <>
                      <strong style={b.available < 0 ? { color: "var(--danger)" } : undefined}>{b.available}</strong>
                      <span className="hrMuted"> / {b.allocated + b.carriedForward}</span>
                      {b.pending > 0 && <div className="hrMuted">{b.pending} pending</div>}
                    </>
                  );
                  return (
                    <td key={t.id} className="numCell">
                      {canAllocate ? (
                        <button
                          type="button"
                          style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "inherit", textAlign: "right" }}
                          title={`${b.used} used. Click to change the grant.`}
                          onClick={() => setEditing({ employeeId: r.employeeId, name: r.name, balance: b, allocated: String(b.allocated), carriedForward: String(b.carriedForward), notes: "" })}
                        >
                          {label}
                        </button>
                      ) : (
                        label
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          title={`${editing.balance.name} · ${editing.name}`}
          subtitle={`${year}: ${editing.balance.used} day(s) used, ${editing.balance.pending} pending`}
          onClose={() => setEditing(null)}
          busy={saving}
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={save} disabled={saving}>
                {saving && <span className="spinner" />} Save
              </button>
            </>
          }
        >
          <div className="formGrid">
            <div className="field">
              <label htmlFor="al-days">Days granted for {year}</label>
              <input id="al-days" className="input" type="number" min={0} step={0.5} value={editing.allocated} onChange={(e) => setEditing({ ...editing, allocated: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="al-cf">Carried forward from {year - 1}</label>
              <input id="al-cf" className="input" type="number" min={0} step={0.5} value={editing.carriedForward} onChange={(e) => setEditing({ ...editing, carriedForward: e.target.value })} />
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="al-notes">Note</label>
              <input id="al-notes" className="input" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="e.g. prorated for mid-year joining" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
