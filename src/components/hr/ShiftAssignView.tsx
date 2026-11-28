"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import FilterDropdown from "@/components/ui/FilterDropdown";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { useMasterOptions } from "@/components/hr/HrKit";
import Select from "@/components/ui/Select";

interface ShiftInfo {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isDefault: boolean;
  active: boolean;
  count: number;
}

interface Data {
  items: { id: string; code: string; name: string; detail: string; location: string; shiftId: string | null }[];
  total: number;
  shifts: ShiftInfo[];
  defaultShift: { id: string; name: string; startTime: string; endTime: string } | null;
  withoutShift: number;
}

const TEXT = {
  employees: {
    title: "Assign shift to employees",
    description: "Choose each employee's shift. It sets their attendance: late marks, half days and weekly offs. Employees without a shift follow the default shift.",
    one: "employee",
    many: "employees",
    detail: "Department",
    module: "hr-employees",
    link: (id: string) => `/hr/employees/${id}`,
    search: "Search name, code, location…",
  },
  contractors: {
    title: "Assign shift to contractors",
    description: "Choose each contractor's shift. Their workers follow it unless a worker has a shift of their own, and overtime is time worked beyond it.",
    one: "contractor",
    many: "contractors",
    detail: "Firm",
    module: "hr-contractors",
    link: (id: string) => `/hr-contractors/${id}`,
    search: "Search name, code, firm, site…",
  },
} as const;

/** Assign Shift: put employees or labour contractors on a shift in bulk. */
export default function ShiftAssignView({ target }: { target: "employees" | "contractors" }) {
  const t = TEXT[target];
  const { hasPermission } = useAuth();
  const toast = useToast();
  const departments = useMasterOptions("hr-departments", (r) => String(r.name));
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [saving, setSaving] = useState(false);
  const canAssign = hasPermission("hr-shifts.edit") && hasPermission(`${t.module}.edit`);
  const apiPath = `/api/hr/shifts/assign/${target}`;

  useEffect(() => {
    const h = setTimeout(() => {
      setApplied(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (applied) p.set("query", applied);
      if (departmentId) p.set("departmentId", departmentId);
      if (shiftFilter) p.set("shift", shiftFilter);
      setData(await apiFetch<Data>(`${apiPath}?${p.toString()}`));
    } catch (err) {
      setError(err);
    }
  }, [apiPath, page, pageSize, applied, departmentId, shiftFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const shiftById = useMemo(() => new Map((data?.shifts ?? []).map((s) => [s.id, s])), [data]);
  const pageIds = data?.items.map((r) => r.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const timing = (s: { startTime: string; endTime: string }) => `${s.startTime}–${s.endTime}`;
  const defaultLabel = data?.defaultShift ? `Default (${data.defaultShift.name}, ${timing(data.defaultShift)})` : "Default shift";

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (selected.size === 0 || !assignTo) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ updated: number; shift: string | null }>(apiPath, {
        method: "PUT",
        body: JSON.stringify({ ids: [...selected], shiftId: assignTo === "default" ? null : assignTo }),
      });
      if (notifyHeld(toast, res)) {
        setSelected(new Set());
        setAssignTo("");
        return void (await load());
      }
      toast.success(`${selected.size} ${selected.size === 1 ? t.one : t.many} now on ${res.shift ?? "the default shift"}`, "Attendance marked from now on uses this shift.");
      setSelected(new Set());
      setAssignTo("");
      await load();
    } catch (err) {
      toast.error("Could not assign", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const cols = canAssign ? 5 : 4;

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Link href="/hr-shifts" className="button buttonSecondary">
            Shifts
          </Link>
        }
      />

      {data && data.shifts.length === 0 && (
        <div className="banner bannerInfo" style={{ marginBottom: "1rem" }}>
          <span>
            No shifts yet. <Link href="/hr-shifts/new" className="textLink">Create one</Link> (e.g. “General 09:30–18:30”), then assign {t.many} here.
          </span>
        </div>
      )}

      {data && data.shifts.length > 0 && (
        <div className="hcSummary">
          {data.shifts.map((s) => (
            <button key={s.id} type="button" className="hcChip" data-active={shiftFilter === s.id || undefined} onClick={() => (setShiftFilter(shiftFilter === s.id ? "" : s.id), setPage(1))}>
              <strong>{s.name}</strong>
              {s.isDefault && <span className="badge badgeInfo">Default</span>}
              <span className="hrMuted">
                {timing(s)} · {s.count} {s.count === 1 ? t.one : t.many}
              </span>
            </button>
          ))}
          <button type="button" className="hcChip" data-active={shiftFilter === "none" || undefined} onClick={() => (setShiftFilter(shiftFilter === "none" ? "" : "none"), setPage(1))}>
            <strong>No shift</strong>
            <span className="hrMuted">{data.withoutShift} on the default</span>
          </button>
        </div>
      )}

      <section className="dirFilters">
        <div className="dirFilterRow">
          {target === "employees" && (
            <FilterDropdown label="Department" value={departmentId} onChange={(v) => (setDepartmentId(v), setPage(1))} options={(departments ?? []).map((d) => ({ value: d.id, label: d.label }))} />
          )}
          <FilterDropdown
            label="Shift"
            value={shiftFilter}
            onChange={(v) => (setShiftFilter(v), setPage(1))}
            options={[...(data?.shifts ?? []).map((s) => ({ value: s.id, label: `${s.name} (${timing(s)})${s.active ? "" : " · inactive"}` })), { value: "none", label: "No shift (default)" }]}
          />
          <div className="dirSearch">
            <SearchBox value={query} onChange={setQuery} placeholder={t.search} width="100%" />
          </div>
        </div>
        {canAssign && (
          <div className="dirFilterFoot">
            <span className="hrMuted">{selected.size > 0 ? `${selected.size} selected` : `Select ${t.many} to assign`}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <Select className="select" style={{ width: "auto", minWidth: "14rem" }} value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Assign to" disabled={selected.size === 0 || saving}>
                <option value="">Assign to…</option>
                {(data?.shifts ?? [])
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({timing(s)})
                    </option>
                  ))}
                <option value="default">{defaultLabel}</option>
              </Select>
              <button type="button" className="button buttonPrimary" onClick={assign} disabled={saving || selected.size === 0 || !assignTo}>
                {saving && <span className="spinner" />} Assign
              </button>
              {selected.size > 0 && (
                <button type="button" className="button buttonGhost buttonSm" onClick={() => setSelected(new Set())} disabled={saving}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              {canAssign && (
                <th style={{ width: "2.5rem" }}>
                  <input
                    type="checkbox"
                    aria-label="Select everyone on this page"
                    checked={allOnPage}
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        for (const id of pageIds) {
                          if (allOnPage) next.delete(id);
                          else next.add(id);
                        }
                        return next;
                      })
                    }
                  />
                </th>
              )}
              <th>{target === "employees" ? "Employee" : "Contractor"}</th>
              <th>{t.detail}</th>
              <th>Location</th>
              <th>Shift</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={cols} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={cols}>
                  <ErrorState message={error instanceof ApiError ? error.message : `Could not load ${t.many}.`} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={cols}>
                  <EmptyState variant={applied || shiftFilter || departmentId ? "search" : undefined} title={applied || shiftFilter || departmentId ? "Nobody matches these filters" : `No ${t.many} yet`} />
                </td>
              </tr>
            )}
            {data?.items.map((r) => {
              const s = r.shiftId ? shiftById.get(r.shiftId) : undefined;
              return (
                <tr key={r.id} data-selected={selected.has(r.id) || undefined}>
                  {canAssign && (
                    <td>
                      <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                  )}
                  <td>
                    <Link href={t.link(r.id)} className="cellLink">
                      {r.name}
                    </Link>
                    <div className="hrMuted cellMono">{r.code}</div>
                  </td>
                  <td>{r.detail || <span className="cellMuted">—</span>}</td>
                  <td>{r.location || <span className="cellMuted">—</span>}</td>
                  <td>
                    {r.shiftId ? (
                      s ? (
                        <>
                          {s.name}
                          <div className="hrMuted">{timing(s)}</div>
                        </>
                      ) : (
                        "(removed)"
                      )
                    ) : (
                      <span className="cellMuted">{defaultLabel}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.total > pageSize && <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={(n) => (setPageSize(n), setPage(1))} />}
      </div>
    </>
  );
}
