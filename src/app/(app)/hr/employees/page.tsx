"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import RowActions from "@/components/table/RowActions";
import FilterDropdown from "@/components/ui/FilterDropdown";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/resources/ui/hrRegistry";
import { IconClose, IconEdit, IconEye, IconPlus, IconRefresh, IconUpload } from "@/components/icons";

interface Row {
  id: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  location: string;
  phone: string;
  workEmail: string;
  photoUrl: string | null;
  employmentStatus: string;
}

interface Facets {
  departments: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  locations: string[];
  costCenters: string[];
}

interface Result {
  items: Row[];
  total: number;
  all: number;
  facets: Facets;
}

const EMPTY_FILTERS = { branchId: "", departmentId: "", location: "", costCenter: "" };
const WORKING = ["PROBATION", "CONFIRMED", "ON_NOTICE"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const SCOPES = [
  { value: "current", label: "Current" },
  { value: "former", label: "Former" },
  { value: "all", label: "Everyone" },
];

export default function EmployeeDirectoryPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [scope, setScope] = useState<"current" | "former" | "all">("current");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize), scope });
      if (applied) p.set("query", applied);
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      setResult(await apiFetch<Result>(`/api/hr/employees?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, applied, filters, scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canCreate = hasPermission("hr-employees.create");
  const canEdit = hasPermission("hr-employees.edit");
  useShortcutScope({
    onNew: canCreate ? () => router.push("/hr-employees/new") : undefined,
    onSearch: () => searchRef.current?.focus(),
    onRefresh: load,
  });

  const setFilter = (key: keyof typeof EMPTY_FILTERS, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const filtered = Boolean(applied) || Object.values(filters).some(Boolean);
  const facets = result?.facets;

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Employee Directory"
        description="Everyone on your rolls. Open a person for their profile, leave, payslips and portal login."
        actions={
          <>
            <Link href="/hr-employees" className="button buttonSecondary" title="Bulk edit, import from Excel, export">
              <IconUpload /> Import / export
            </Link>
            {canCreate && (
              <Link href="/hr-employees/new" className="button buttonPrimary" title="Add employee (Ctrl + N)">
                <IconPlus /> Add employee
              </Link>
            )}
          </>
        }
      />

      <section className="dirFilters">
        <div className="dirFilterRow">
          {(facets?.branches.length ?? 0) > 0 && (
            <FilterDropdown label="Business unit" value={filters.branchId} onChange={(v) => setFilter("branchId", v)} options={facets!.branches.map((b) => ({ value: b.id, label: b.name }))} />
          )}
          <FilterDropdown label="Department" value={filters.departmentId} onChange={(v) => setFilter("departmentId", v)} options={(facets?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
          <FilterDropdown label="Location" value={filters.location} onChange={(v) => setFilter("location", v)} options={(facets?.locations ?? []).map((l) => ({ value: l, label: l }))} />
          {(facets?.costCenters.length ?? 0) > 0 && (
            <FilterDropdown label="Cost centre" value={filters.costCenter} onChange={(v) => setFilter("costCenter", v)} options={facets!.costCenters.map((c) => ({ value: c, label: c }))} />
          )}
          <FilterDropdown label="Employees" value={scope} options={SCOPES} allLabel={null} onChange={(v) => (setScope(v as typeof scope), setPage(1))} />
          <div className="dirSearch">
            <SearchBox inputRef={searchRef} value={query} onChange={setQuery} placeholder="Search name, code, email, phone…" width="100%" />
          </div>
        </div>
        <div className="dirFilterFoot">
          {filtered && (
            <button
              type="button"
              className="button buttonGhost buttonSm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setQuery("");
                setPage(1);
              }}
            >
              <IconClose /> Clear filters
            </button>
          )}
          <span className="hrMuted" style={{ marginLeft: "auto" }}>
            {result ? `Showing ${result.total} of ${result.all}` : " "}
          </span>
          <button type="button" className="button buttonGhost buttonSm buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </section>

      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load employees."} onRetry={load} />}
      {!result && error === null && (
        <div className="dirGrid">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonBlock key={i} height="10rem" />
          ))}
        </div>
      )}
      {result && result.items.length === 0 && (
        <EmptyState
          variant={filtered ? "search" : undefined}
          title={filtered ? "Nobody matches these filters" : "No employees yet"}
          actions={
            canCreate && !filtered ? (
              <Link href="/hr-employees/new" className="button buttonPrimary">
                <IconPlus /> Add employee
              </Link>
            ) : undefined
          }
        />
      )}

      {result && result.items.length > 0 && (
        <>
          <div className="dirGrid">
            {result.items.map((r) => (
              <article key={r.id} className="dirCard">
                <Link href={`/hr/employees/${r.id}`} className="dirPhoto" aria-hidden tabIndex={-1}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
                  {r.photoUrl ? <img src={r.photoUrl} alt="" loading="lazy" /> : <span>{initials(r.name)}</span>}
                </Link>
                <div className="dirBody">
                  <div className="dirNameRow">
                    <Link href={`/hr/employees/${r.id}`} className="dirName">
                      {r.name}
                    </Link>
                    <RowActions
                      actions={[
                        { key: "view", label: "View profile", icon: <IconEye />, href: `/hr/employees/${r.id}` },
                        ...(canEdit ? [{ key: "edit", label: "Edit record", icon: <IconEdit />, href: `/hr-employees/${r.id}` }] : []),
                      ]}
                    />
                  </div>
                  <div className="dirRole">
                    {r.designation || <span className="cellMuted">No designation</span>}
                    {!WORKING.includes(r.employmentStatus) && <span className="badge badgeNeutral" style={{ marginLeft: "0.5rem" }}>{EMPLOYMENT_STATUS_LABELS[r.employmentStatus] ?? r.employmentStatus}</span>}
                  </div>
                  <dl className="dirFacts">
                    {r.department && (
                      <div>
                        <dt>Department</dt>
                        <dd>{r.department}</dd>
                      </div>
                    )}
                    {r.location && (
                      <div>
                        <dt>Location</dt>
                        <dd>{r.location}</dd>
                      </div>
                    )}
                    {r.workEmail && (
                      <div>
                        <dt>Email</dt>
                        <dd>
                          <a href={`mailto:${r.workEmail}`}>{r.workEmail}</a>
                        </dd>
                      </div>
                    )}
                    {r.phone && (
                      <div>
                        <dt>Work</dt>
                        <dd>
                          <a href={`tel:${r.phone}`}>{r.phone}</a>
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Code</dt>
                      <dd className="cellMono">{r.employeeCode}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
          {result.total > pageSize && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={(n) => (setPageSize(n), setPage(1))} />}
        </>
      )}
    </>
  );
}
