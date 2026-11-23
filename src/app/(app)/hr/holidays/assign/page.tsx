"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import FilterDropdown from "@/components/ui/FilterDropdown";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { useMasterOptions } from "@/components/hr/HrKit";

interface Calendar {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  employees: number;
}

interface Data {
  items: { id: string; employeeCode: string; name: string; department: string; location: string; calendarId: string | null }[];
  total: number;
  calendars: Calendar[];
  defaultCalendar: { id: string; name: string } | null;
  withoutCalendar: number;
}

/** Assign Holiday Calendar: put employees on the calendar whose holidays they get. */
export default function AssignHolidayCalendarPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const departments = useMasterOptions("hr-departments", (r) => String(r.name));
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [calendarFilter, setCalendarFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const canAssign = hasPermission("hr-holidays.edit") && hasPermission("hr-employees.edit");

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (applied) p.set("query", applied);
      if (departmentId) p.set("departmentId", departmentId);
      if (calendarFilter) p.set("calendar", calendarFilter);
      setData(await apiFetch<Data>(`/api/hr/holidays/assign?${p.toString()}`));
    } catch (err) {
      setError(err);
    }
  }, [page, pageSize, applied, departmentId, calendarFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const calendarName = useMemo(() => new Map((data?.calendars ?? []).map((c) => [c.id, c.name])), [data]);
  const pageIds = data?.items.map((r) => r.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const defaultLabel = data?.defaultCalendar ? `Default (${data.defaultCalendar.name})` : "Default (company holidays only)";

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ updated: number; calendar: string | null }>("/api/hr/holidays/assign", {
        method: "PUT",
        body: JSON.stringify({ employeeIds: [...selected], calendarId: target === "default" ? null : target }),
      });
      toast.success(`${selected.size} employee${selected.size === 1 ? "" : "s"} now follow ${res.calendar ?? "the default calendar"}`, "Their attendance, leave days and payroll use these holidays from now on.");
      setSelected(new Set());
      setTarget("");
      await load();
    } catch (err) {
      toast.error("Could not assign", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const calendarOptions = (data?.calendars ?? []).map((c) => ({ value: c.id, label: `${c.name}${c.active ? "" : " (inactive)"}` }));

  return (
    <>
      <PageHeader
        title="Assign holiday calendar"
        description="Choose whose holidays each employee gets. Holidays on no calendar apply to everyone; employees without a calendar follow the default one."
        actions={
          <>
            <Link href="/hr-holiday-calendars" className="button buttonSecondary">
              Holiday calendars
            </Link>
            <Link href="/hr-holidays" className="button buttonSecondary">
              Holidays
            </Link>
          </>
        }
      />

      {data && data.calendars.length === 0 && (
        <div className="banner bannerInfo" style={{ marginBottom: "1rem" }}>
          <span>
            No holiday calendars yet. <Link href="/hr-holiday-calendars/new" className="textLink">Create one</Link> (e.g. “Gujarat 2026”), add its holidays, then assign employees here.
          </span>
        </div>
      )}

      {data && data.calendars.length > 0 && (
        <div className="hcSummary">
          {data.calendars.map((c) => (
            <button key={c.id} type="button" className="hcChip" data-active={calendarFilter === c.id || undefined} onClick={() => (setCalendarFilter(calendarFilter === c.id ? "" : c.id), setPage(1))}>
              <strong>{c.name}</strong>
              {c.isDefault && <span className="badge badgeInfo">Default</span>}
              <span className="hrMuted">{c.employees} employee{c.employees === 1 ? "" : "s"}</span>
            </button>
          ))}
          <button type="button" className="hcChip" data-active={calendarFilter === "none" || undefined} onClick={() => (setCalendarFilter(calendarFilter === "none" ? "" : "none"), setPage(1))}>
            <strong>No calendar</strong>
            <span className="hrMuted">{data.withoutCalendar} on the default</span>
          </button>
        </div>
      )}

      <section className="dirFilters">
        <div className="dirFilterRow">
          <FilterDropdown label="Department" value={departmentId} onChange={(v) => (setDepartmentId(v), setPage(1))} options={(departments ?? []).map((d) => ({ value: d.id, label: d.label }))} />
          <FilterDropdown
            label="Holiday calendar"
            value={calendarFilter}
            onChange={(v) => (setCalendarFilter(v), setPage(1))}
            options={[...calendarOptions, { value: "none", label: "No calendar (default)" }]}
          />
          <div className="dirSearch">
            <SearchBox value={query} onChange={setQuery} placeholder="Search name, code, location…" width="100%" />
          </div>
        </div>
        {canAssign && (
          <div className="dirFilterFoot">
            <span className="hrMuted">{selected.size > 0 ? `${selected.size} selected` : "Select employees to assign"}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <select className="select" style={{ width: "auto", minWidth: "14rem" }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Assign to" disabled={selected.size === 0 || saving}>
                <option value="">Assign to…</option>
                {(data?.calendars ?? [])
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                <option value="default">{defaultLabel}</option>
              </select>
              <button type="button" className="button buttonPrimary" onClick={assign} disabled={saving || selected.size === 0 || !target}>
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
              <th>Employee</th>
              <th>Department</th>
              <th>Location</th>
              <th>Holiday calendar</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={canAssign ? 5 : 4} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={5}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load employees."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState variant="search" title="Nobody matches these filters" />
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id} data-selected={selected.has(r.id) || undefined}>
                {canAssign && (
                  <td>
                    <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <td>
                  <Link href={`/hr/employees/${r.id}`} className="cellLink">
                    {r.name}
                  </Link>
                  <div className="hrMuted cellMono">{r.employeeCode}</div>
                </td>
                <td>{r.department || <span className="cellMuted">—</span>}</td>
                <td>{r.location || <span className="cellMuted">—</span>}</td>
                <td>{r.calendarId ? calendarName.get(r.calendarId) ?? "(removed)" : <span className="cellMuted">{defaultLabel}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.total > pageSize && <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={(n) => (setPageSize(n), setPage(1))} />}
      </div>
    </>
  );
}
