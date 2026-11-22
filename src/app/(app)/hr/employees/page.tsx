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
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate, useMasterOptions } from "@/components/hr/HrKit";
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } from "@/lib/resources/ui/hrRegistry";
import { IconPlus, IconRefresh, IconUpload } from "@/components/icons";

interface Row {
  id: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  manager: string;
  phone: string;
  workEmail: string;
  dateOfJoining: string;
  employmentType: string;
  employmentStatus: string;
  hasPortal: boolean;
}

export default function EmployeeDirectoryPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const departments = useMasterOptions("hr-departments", (r) => String(r.name));
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [scope, setScope] = useState<"current" | "former" | "all">("current");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<{ items: Row[]; total: number } | null>(null);
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
      if (departmentId) p.set("departmentId", departmentId);
      setResult(await apiFetch(`/api/hr/employees?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, applied, departmentId, scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canCreate = hasPermission("hr-employees.create");
  useShortcutScope({
    onNew: canCreate ? () => router.push("/hr-employees/new") : undefined,
    onSearch: () => searchRef.current?.focus(),
    onRefresh: load,
  });

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Employees"
        count={result?.total ?? null}
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

      <div className="toolbar">
        <SearchBox inputRef={searchRef} value={query} onChange={setQuery} placeholder="Search name, code, email, phone…" width="18rem" />
        <select className="select" style={{ width: "auto" }} value={departmentId} onChange={(e) => (setDepartmentId(e.target.value), setPage(1))} aria-label="Department">
          <option value="">All departments</option>
          {departments?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: "auto" }} value={scope} onChange={(e) => (setScope(e.target.value as typeof scope), setPage(1))} aria-label="Who">
          <option value="current">Current employees</option>
          <option value="former">Former employees</option>
          <option value="all">Everyone</option>
        </select>
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Department</th>
              <th>Designation</th>
              <th>Reports to</th>
              <th>Phone</th>
              <th>Joined</th>
              <th>Type</th>
              <th>Status</th>
              <th>Portal</th>
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={10} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={10}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load employees."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <EmptyState
                    variant={applied || departmentId ? "search" : undefined}
                    title={applied || departmentId ? "Nobody matches these filters" : "No employees yet"}
                    actions={
                      canCreate && !applied ? (
                        <Link href="/hr-employees/new" className="button buttonPrimary">
                          <IconPlus /> Add employee
                        </Link>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td className="cellMono">
                  <Link href={`/hr/employees/${r.id}`} className="cellLink cellMono">
                    {r.employeeCode}
                  </Link>
                </td>
                <td>
                  <Link href={`/hr/employees/${r.id}`} className="cellLink">
                    {r.name}
                  </Link>
                  {r.workEmail && <div className="hrMuted">{r.workEmail}</div>}
                </td>
                <td>{r.department || <span className="cellMuted">—</span>}</td>
                <td>{r.designation || <span className="cellMuted">—</span>}</td>
                <td>{r.manager || <span className="cellMuted">—</span>}</td>
                <td>{r.phone || <span className="cellMuted">—</span>}</td>
                <td>{fmtDate(r.dateOfJoining)}</td>
                <td>{EMPLOYMENT_TYPE_LABELS[r.employmentType] ?? r.employmentType}</td>
                <td>
                  <span className={`badge ${["PROBATION", "CONFIRMED"].includes(r.employmentStatus) ? "badgeSuccess" : r.employmentStatus === "ON_NOTICE" ? "badgeWarning" : "badgeNeutral"}`}>
                    {EMPLOYMENT_STATUS_LABELS[r.employmentStatus] ?? r.employmentStatus}
                  </span>
                </td>
                <td>{r.hasPortal ? <span className="badge badgeSuccess">Yes</span> : <span className="cellMuted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />}
      </div>
    </>
  );
}
