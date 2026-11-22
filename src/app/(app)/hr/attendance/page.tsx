"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate, todayKey, minutesLabel } from "@/components/hr/HrKit";
import { IconChevronLeft, IconChevronRight, IconCheck, IconSave } from "@/components/icons";

interface SheetRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  shift: { name: string; startTime: string; endTime: string };
  dayKind: "WORKING" | "WEEKLY_OFF" | "HOLIDAY";
  suggested: string;
  record: { status: string; checkIn: string; checkOut: string; workedMinutes: number; lateMinutes: number; notes: string; source: string; fromLeave: boolean } | null;
}

interface Sheet {
  date: string;
  holiday: string | null;
  locked: boolean;
  rows: SheetRow[];
  counts: Record<string, number>;
  unmarked: number;
}

interface Draft {
  status: string;
  checkIn: string;
  checkOut: string;
  notes: string;
}

const STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "ABSENT", label: "Absent" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "ON_DUTY", label: "On duty / field" },
  { value: "WEEKLY_OFF", label: "Weekly off" },
  { value: "HOLIDAY", label: "Holiday" },
];

function shiftDay(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function DailyAttendancePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setError(null);
    setSheet(null);
    try {
      const data = await apiFetch<Sheet>(`/api/hr/attendance?date=${date}`);
      setSheet(data);
      const next: Record<string, Draft> = {};
      for (const r of data.rows) {
        next[r.employeeId] = r.record
          ? { status: r.record.status, checkIn: r.record.checkIn, checkOut: r.record.checkOut, notes: r.record.notes }
          : { status: r.suggested, checkIn: "", checkOut: "", notes: "" };
      }
      setDrafts(next);
      setDirty(new Set());
    } catch (err) {
      setError(err);
    }
  }, [date]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canEdit = hasPermission("hr-attendance.edit") && !sheet?.locked;
  useUnsavedChangesWarning(dirty.size > 0 && !saving);

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    setDirty((s) => new Set(s).add(id));
  }

  /** Marks everyone not yet recorded with the day's suggested status (present on working days). */
  function markUnmarked() {
    if (!sheet) return;
    const next = new Set(dirty);
    const d = { ...drafts };
    for (const r of sheet.rows) {
      if (!r.record) {
        d[r.employeeId] = { ...d[r.employeeId], status: r.suggested };
        next.add(r.employeeId);
      }
    }
    setDrafts(d);
    setDirty(next);
  }

  async function save() {
    if (!sheet || dirty.size === 0) return;
    setSaving(true);
    try {
      const rows = sheet.rows
        .filter((r) => dirty.has(r.employeeId) && !r.record?.fromLeave)
        .map((r) => ({ employeeId: r.employeeId, ...drafts[r.employeeId] }));
      const res = await apiFetch<{ saved: number; skipped: number }>("/api/hr/attendance", { method: "PUT", body: JSON.stringify({ date: sheet.date, rows }) });
      toast.success(`Saved attendance for ${res.saved} employee${res.saved === 1 ? "" : "s"}`, res.skipped ? `${res.skipped} on approved leave were left as they are.` : undefined);
      await load();
    } catch (err) {
      toast.error("Could not save attendance", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: canEdit ? () => void save() : undefined, onRefresh: load });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (sheet?.rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q) || r.department.toLowerCase().includes(q));
  }, [sheet, query]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const counts = sheet?.counts ?? {};

  return (
    <>
      <PageHeader
        title="Daily attendance"
        description={
          sheet
            ? `${fmtDate(sheet.date)}${sheet.holiday ? ` · ${sheet.holiday}` : ""} · ${counts.PRESENT ?? 0} present, ${counts.ABSENT ?? 0} absent, ${counts.LEAVE ?? 0} on leave, ${sheet.unmarked} not marked`
            : "Mark who came in. Days nobody marks are paid as present."
        }
        actions={
          <>
            <Link href="/hr/attendance/register" className="button buttonSecondary">
              Monthly register
            </Link>
            {canEdit && (
              <button type="button" className="button buttonPrimary" onClick={save} disabled={saving || dirty.size === 0} title="Save (Ctrl + S)">
                {saving ? <span className="spinner" /> : <IconSave />} Save {dirty.size > 0 ? `(${dirty.size})` : ""}
              </button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <button type="button" className="button buttonSecondary buttonIcon" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day">
          <IconChevronLeft />
        </button>
        <input type="date" className="input" style={{ width: "auto" }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
        <button type="button" className="button buttonSecondary buttonIcon" onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day">
          <IconChevronRight />
        </button>
        <button type="button" className="button buttonGhost" onClick={() => setDate(todayKey())}>
          Today
        </button>
        <SearchBox value={query} onChange={setQuery} placeholder="Filter by name, code, department…" width="16rem" />
        <div className="toolbarRight">
          {canEdit && sheet && sheet.unmarked > 0 && (
            <button type="button" className="button buttonSecondary" onClick={markUnmarked}>
              <IconCheck /> Mark the rest present
            </button>
          )}
        </div>
      </div>

      {sheet?.locked && (
        <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
          <span>Payroll for this month is approved, so attendance is locked. Cancel the payroll run to make changes.</span>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Shift</th>
              <th>Status</th>
              <th>In</th>
              <th>Out</th>
              <th>Worked</th>
              <th>Late</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {!sheet && !error && <SkeletonRows columns={8} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={8}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load attendance."} onRetry={load} />
                </td>
              </tr>
            )}
            {sheet && rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState title={query ? "Nobody matches" : "Nobody was on the rolls on this date"} />
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const d = drafts[r.employeeId];
              if (!d) return null;
              const leave = r.record?.fromLeave;
              const working = d.status === "PRESENT" || d.status === "HALF_DAY" || d.status === "ON_DUTY";
              const locked = !canEdit || leave;
              return (
                <tr key={r.employeeId} style={dirty.has(r.employeeId) ? { background: "var(--accent-soft)" } : undefined}>
                  <td>
                    <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                      {r.name}
                    </Link>
                    <div className="hrMuted">
                      {r.employeeCode}
                      {r.department ? ` · ${r.department}` : ""}
                    </div>
                  </td>
                  <td className="hrMuted">
                    {r.shift.startTime}–{r.shift.endTime}
                    {r.dayKind !== "WORKING" && <div>{r.dayKind === "HOLIDAY" ? "Holiday" : "Weekly off"}</div>}
                  </td>
                  <td>
                    {leave ? (
                      <span className="badge badgeInfo" title={r.record?.notes}>
                        {r.record?.status === "HALF_DAY" ? "Half-day leave" : "On leave"}
                      </span>
                    ) : (
                      <select className="select attStatusSelect" value={d.status} disabled={locked} onChange={(e) => setDraft(r.employeeId, { status: e.target.value })} aria-label={`Status for ${r.name}`}>
                        {STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {!r.record && !leave && <div className="hrMuted">not saved yet</div>}
                  </td>
                  <td>
                    <input type="time" className="input attTime" value={d.checkIn} disabled={locked || !working} onChange={(e) => setDraft(r.employeeId, { checkIn: e.target.value })} aria-label="Check in" />
                  </td>
                  <td>
                    <input type="time" className="input attTime" value={d.checkOut} disabled={locked || !working} onChange={(e) => setDraft(r.employeeId, { checkOut: e.target.value })} aria-label="Check out" />
                  </td>
                  <td className="numCell">{minutesLabel(r.record?.workedMinutes ?? 0)}</td>
                  <td className="numCell">{r.record?.lateMinutes ? <span style={{ color: "var(--warning)" }}>{minutesLabel(r.record.lateMinutes)}</span> : "—"}</td>
                  <td>
                    <input className="input" style={{ minWidth: "8rem" }} value={d.notes} disabled={locked} onChange={(e) => setDraft(r.employeeId, { notes: e.target.value })} placeholder={r.record?.source === "SELF" ? "Self check-in" : ""} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
