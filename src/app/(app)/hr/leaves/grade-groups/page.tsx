"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";

interface Data {
  grades: { id: string; code: string; name: string; active: boolean; leaveGroupId: string | null; employees: number }[];
  groups: { id: string; code: string; name: string; active: boolean; leaveTypes: number }[];
}

/** "Assign Grade to Group": each grade follows one leave group, which sets its employees' leave days. */
export default function GradeGroupsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  /** gradeId → chosen leave group id ("" = none), only for rows changed on screen. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canEdit = hasPermission("hr-leave-types.edit");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<Data>("/api/hr/leaves/grade-groups"));
      setEdits({});
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const changed = useMemo(
    () => (data?.grades ?? []).filter((g) => g.id in edits && (edits[g.id] || null) !== g.leaveGroupId),
    [data, edits]
  );

  async function save() {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      await apiFetch("/api/hr/leaves/grade-groups", {
        method: "PUT",
        body: JSON.stringify({ assignments: changed.map((g) => ({ gradeId: g.id, leaveGroupId: edits[g.id] || null })) }),
      });
      toast.success(`Saved ${changed.length} grade${changed.length === 1 ? "" : "s"}`, "Leave balances now follow the new groups.");
      await load();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Assign grade to group"
        description="Choose the leave group each grade follows. Employees get the days set in their grade's group; a grade with no group uses each leave type's own days per year."
        actions={
          <>
            <Link href="/hr-grades" className="button buttonSecondary">
              Grades
            </Link>
            <Link href="/hr-leave-groups" className="button buttonSecondary">
              Leave groups
            </Link>
            {canEdit && (
              <button type="button" className="button buttonPrimary" onClick={save} disabled={saving || changed.length === 0}>
                {saving && <span className="spinner" />} Save{changed.length > 0 ? ` (${changed.length})` : ""}
              </button>
            )}
          </>
        }
      />

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Grade</th>
              <th className="numCell">Employees</th>
              <th style={{ width: "22rem" }}>Leave group</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={3} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={3}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load grades."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.grades.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <EmptyState
                    title="No grades yet"
                    description="Add grades (L1, L2…) first, then assign each one a leave group here."
                    actions={
                      <Link href="/hr-grades/new" className="button buttonPrimary">
                        Add a grade
                      </Link>
                    }
                  />
                </td>
              </tr>
            )}
            {data?.grades.map((g) => {
              const value = g.id in edits ? edits[g.id] : g.leaveGroupId ?? "";
              const dirty = changed.some((c) => c.id === g.id);
              return (
                <tr key={g.id}>
                  <td>
                    <strong>{g.code}</strong> {g.name}
                    {!g.active && <span className="hrMuted"> · inactive</span>}
                  </td>
                  <td className="numCell">{g.employees}</td>
                  <td>
                    <select
                      className="select"
                      aria-label={`Leave group for ${g.code}`}
                      value={value}
                      disabled={!canEdit || saving}
                      onChange={(e) => setEdits({ ...edits, [g.id]: e.target.value })}
                      style={dirty ? { borderColor: "var(--accent)" } : undefined}
                    >
                      <option value="">— No group (leave type days) —</option>
                      {data.groups
                        .filter((x) => x.active || x.id === value)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({x.leaveTypes} leave type{x.leaveTypes === 1 ? "" : "s"}){x.active ? "" : " · inactive"}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && data.grades.length > 0 && data.groups.length === 0 && (
        <p className="hrMuted" style={{ marginTop: "0.75rem" }}>
          No leave groups yet. <Link href="/hr-leave-groups/new" className="textLink">Create one</Link> to choose it here.
        </p>
      )}
    </>
  );
}
