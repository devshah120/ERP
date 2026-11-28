"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import SearchSelect from "@/components/resource/SearchSelect";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { MonthPicker, WEEKDAY_SHORT, minutesLabel, MONTH_NAMES } from "@/components/hr/HrKit";
import { IconCheck, IconChevronLeft, IconChevronRight, IconSave } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Day {
  date: string;
  weekday: number;
  dayKind: "WORKING" | "WEEKLY_OFF" | "HOLIDAY";
  holiday: string | null;
  employed: boolean;
  suggested: string;
  record: { status: string; checkIn: string; checkOut: string; workedMinutes: number; lateMinutes: number; notes: string; source: string; fromLeave: boolean } | null;
}

interface Sheet {
  year: number;
  month: number;
  employees: { id: string; name: string; code: string }[];
  employee: { id: string; name: string; code: string; department: string; designation: string; shift: { name: string; startTime: string; endTime: string } } | null;
  locked: boolean;
  days: Day[];
  summary: { present: number; absent: number; halfDays: number; paidLeave: number; unpaidLeave: number; holidays: number; weeklyOffs: number; onDuty: number; unmarked: number; lateDays: number; lopDays: number } | null;
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
const WORKING = new Set(["PRESENT", "HALF_DAY", "ON_DUTY"]);

function thisMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function stepMonth(p: { year: number; month: number }, n: number) {
  const m = p.month - 1 + n;
  return { year: p.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 };
}

/** Monthly attendance: mark one employee's whole month in one go. */
export default function EmployeeMonthAttendancePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState("");
  const [period, setPeriod] = useState(thisMonth());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("PRESENT");
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  /** A switch to another employee or month waiting for "discard changes?". */
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);

  // Opened from elsewhere with ?employee=<id>&year=&month=.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("employee");
    const y = Number(q.get("year"));
    const m = Number(q.get("month"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off read of the URL on arrival
    if (id) setEmployeeId(id);
    if (y && m >= 1 && m <= 12) setPeriod({ year: y, month: m });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams({ year: String(period.year), month: String(period.month) });
      if (employeeId) p.set("employeeId", employeeId);
      const data = await apiFetch<Sheet>(`/api/hr/attendance/employee?${p.toString()}`);
      setSheet(data);
      const next: Record<string, Draft> = {};
      for (const d of data.days) {
        next[d.date] = d.record
          ? { status: d.record.status, checkIn: d.record.checkIn, checkOut: d.record.checkOut, notes: d.record.notes }
          : { status: d.suggested, checkIn: "", checkOut: "", notes: "" };
      }
      setDrafts(next);
      setDirty(new Set());
      setSelected(new Set());
    } catch (err) {
      setError(err);
    }
  }, [employeeId, period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const editable = useCallback((d: Day) => d.employed && !d.record?.fromLeave, []);
  const canEdit = hasPermission("hr-attendance.edit") && Boolean(sheet?.employee) && !sheet?.locked;
  useUnsavedChangesWarning(dirty.size > 0 && !saving);

  /** Leaving unsaved changes behind (another employee or month) is confirmed first. */
  function guard(next: () => void) {
    if (dirty.size === 0) next();
    else setPendingSwitch(() => next);
  }

  function setDraft(date: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [date]: { ...d[date], ...patch } }));
    setDirty((s) => new Set(s).add(date));
  }

  /** Fills every day with nothing recorded: present on working days, weekly off / holiday otherwise. */
  function fillUnmarked() {
    if (!sheet) return;
    const next = { ...drafts };
    const changed = new Set(dirty);
    for (const d of sheet.days) {
      if (!editable(d) || d.record) continue;
      next[d.date] = { ...next[d.date], status: d.suggested };
      changed.add(d.date);
    }
    setDrafts(next);
    setDirty(changed);
  }

  function applyToSelected() {
    const next = { ...drafts };
    const changed = new Set(dirty);
    for (const date of selected) {
      next[date] = { ...next[date], status: bulkStatus, ...(WORKING.has(bulkStatus) ? {} : { checkIn: "", checkOut: "" }) };
      changed.add(date);
    }
    setDrafts(next);
    setDirty(changed);
    setSelected(new Set());
  }

  async function save() {
    if (!sheet?.employee || dirty.size === 0) return;
    setSaving(true);
    try {
      const rows = sheet.days.filter((d) => dirty.has(d.date) && editable(d)).map((d) => ({ date: d.date, ...drafts[d.date] }));
      const res = await apiFetch<{ saved: number; skipped: number }>("/api/hr/attendance/employee", {
        method: "PUT",
        body: JSON.stringify({ employeeId: sheet.employee.id, year: sheet.year, month: sheet.month, rows }),
      });
      if (notifyHeld(toast, res)) return void (await load());
      toast.success(`Saved ${res.saved} day${res.saved === 1 ? "" : "s"} for ${sheet.employee.name}`, res.skipped ? `${res.skipped} day(s) on approved leave were left as they are.` : undefined);
      await load();
    } catch (err) {
      toast.error("Could not save attendance", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: canEdit ? () => void save() : undefined, onRefresh: load });

  const options = useMemo(() => (sheet?.employees ?? []).map((e) => ({ value: e.id, label: e.name, detail: e.code })), [sheet]);
  const selectable = (sheet?.days ?? []).filter(editable).map((d) => d.date);
  const allSelected = selectable.length > 0 && selectable.every((d) => selected.has(d));
  const unmarkedEditable = (sheet?.days ?? []).filter((d) => editable(d) && !d.record).length;
  const s = sheet?.summary;

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Monthly attendance"
        description={
          sheet?.employee
            ? `${sheet.employee.name} · ${sheet.employee.code}${sheet.employee.department ? ` · ${sheet.employee.department}` : ""} · ${sheet.employee.shift.name} ${sheet.employee.shift.startTime}–${sheet.employee.shift.endTime}`
            : "Mark one employee's whole month at once. Days nobody marks are paid as present."
        }
        actions={
          <>
            <Link href="/hr/attendance" className="button buttonSecondary">
              Daily attendance
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
        <div style={{ width: "18rem" }}>
          <SearchSelect id="att-employee" value={employeeId} options={options} placeholder="Choose an employee" onChange={(id) => guard(() => setEmployeeId(id))} />
        </div>
        <button type="button" className="button buttonSecondary buttonIcon" onClick={() => guard(() => setPeriod(stepMonth(period, -1)))} aria-label="Previous month">
          <IconChevronLeft />
        </button>
        <MonthPicker year={period.year} month={period.month} onChange={(v) => guard(() => setPeriod(v))} />
        <button type="button" className="button buttonSecondary buttonIcon" onClick={() => guard(() => setPeriod(stepMonth(period, 1)))} aria-label="Next month">
          <IconChevronRight />
        </button>
        <div className="toolbarRight">
          {canEdit && unmarkedEditable > 0 && (
            <button type="button" className="button buttonSecondary" onClick={fillUnmarked} title="Present on working days, weekly off or holiday on the rest">
              <IconCheck /> Fill {unmarkedEditable} unmarked day{unmarkedEditable === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>

      {sheet?.locked && (
        <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
          <span>
            Payroll for {MONTH_NAMES[period.month - 1]} {period.year} is approved, so attendance is locked. Cancel the payroll run to make changes.
          </span>
        </div>
      )}

      {s && (
        <div className="hrKpis">
          {(
            [
              ["Present", s.present],
              ["Absent", s.absent],
              ["Half days", s.halfDays],
              ["On duty", s.onDuty],
              ["Paid leave", s.paidLeave],
              ["Unpaid leave", s.unpaidLeave],
              ["Holidays", s.holidays],
              ["Weekly offs", s.weeklyOffs],
              ["Not marked", s.unmarked],
              ["Loss of pay", s.lopDays],
            ] as [string, number][]
          ).map(([label, value]) => (
            <div key={label} className="hrKpi">
              <span className="hrKpiLabel">{label}</span>
              <span className="hrKpiValue">{value}</span>
            </div>
          ))}
        </div>
      )}

      {canEdit && selected.size > 0 && (
        <div className="toolbar attBulkBar">
          <span>
            <strong>{selected.size}</strong> day{selected.size === 1 ? "" : "s"} selected
          </span>
          <Select className="select" style={{ width: "auto" }} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} aria-label="Status for the selected days">
            {STATUSES.map((st) => (
              <option key={st.value} value={st.value}>
                {st.label}
              </option>
            ))}
          </Select>
          <button type="button" className="button buttonPrimary buttonSm" onClick={applyToSelected}>
            Apply to selected
          </button>
          <button type="button" className="button buttonGhost buttonSm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              {canEdit && (
                <th style={{ width: "2.5rem" }}>
                  <input
                    type="checkbox"
                    aria-label="Select every day that can be marked"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable))}
                  />
                </th>
              )}
              <th>Date</th>
              <th>Day</th>
              <th>Status</th>
              <th>In</th>
              <th>Out</th>
              <th className="numCell">Worked</th>
              <th className="numCell">Late</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {!sheet && !error && <SkeletonRows columns={9} rows={8} />}
            {error !== null && (
              <tr>
                <td colSpan={9}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load attendance."} onRetry={load} />
                </td>
              </tr>
            )}
            {sheet && !sheet.employee && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title={employeeId ? "That employee was not on the rolls this month" : "Choose an employee"}
                    description="Pick someone above to see and mark every day of the month."
                  />
                </td>
              </tr>
            )}
            {sheet?.employee &&
              sheet.days.map((d) => {
                const dr = drafts[d.date];
                if (!dr) return null;
                const leave = d.record?.fromLeave;
                const locked = !canEdit || !editable(d);
                const working = WORKING.has(dr.status);
                const off = d.dayKind !== "WORKING";
                return (
                  <tr key={d.date} data-off={off || undefined} style={dirty.has(d.date) ? { background: "var(--accent-soft)" } : undefined}>
                    {canEdit && (
                      <td>
                        {editable(d) && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${d.date}`}
                            checked={selected.has(d.date)}
                            onChange={() =>
                              setSelected((cur) => {
                                const next = new Set(cur);
                                if (next.has(d.date)) next.delete(d.date);
                                else next.add(d.date);
                                return next;
                              })
                            }
                          />
                        )}
                      </td>
                    )}
                    <td style={{ whiteSpace: "nowrap" }}>
                      <strong>{Number(d.date.slice(8, 10))}</strong> {MONTH_NAMES[period.month - 1].slice(0, 3)}
                      <span className="hrMuted"> · {WEEKDAY_SHORT[d.weekday]}</span>
                    </td>
                    <td className="hrMuted">{d.holiday ?? (d.dayKind === "WEEKLY_OFF" ? "Weekly off" : "")}</td>
                    <td>
                      {!d.employed ? (
                        <span className="hrMuted">Not employed</span>
                      ) : leave ? (
                        <span className="badge badgeInfo" title={d.record?.notes}>
                          {d.record?.status === "HALF_DAY" ? "Half-day leave" : "On leave"}
                        </span>
                      ) : (
                        <>
                          <Select className="select attStatusSelect" value={dr.status} disabled={locked} onChange={(e) => setDraft(d.date, { status: e.target.value })} aria-label={`Status on ${d.date}`}>
                            {STATUSES.map((st) => (
                              <option key={st.value} value={st.value}>
                                {st.label}
                              </option>
                            ))}
                          </Select>
                          {!d.record && <div className="hrMuted">not saved yet</div>}
                        </>
                      )}
                    </td>
                    <td>
                      <input type="time" className="input attTime" value={dr.checkIn} disabled={locked || !working} onChange={(e) => setDraft(d.date, { checkIn: e.target.value })} aria-label={`Check in on ${d.date}`} />
                    </td>
                    <td>
                      <input type="time" className="input attTime" value={dr.checkOut} disabled={locked || !working} onChange={(e) => setDraft(d.date, { checkOut: e.target.value })} aria-label={`Check out on ${d.date}`} />
                    </td>
                    <td className="numCell">{minutesLabel(d.record?.workedMinutes ?? 0)}</td>
                    <td className="numCell">{d.record?.lateMinutes ? <span style={{ color: "var(--warning)" }}>{minutesLabel(d.record.lateMinutes)}</span> : "—"}</td>
                    <td>
                      <input className="input" style={{ minWidth: "8rem" }} value={dr.notes} disabled={locked} onChange={(e) => setDraft(d.date, { notes: e.target.value })} placeholder={d.record?.source === "SELF" ? "Self check-in" : ""} aria-label={`Note on ${d.date}`} />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {pendingSwitch && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message={`${dirty.size} changed day${dirty.size === 1 ? "" : "s"} for this month have not been saved.`}
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          onConfirm={() => {
            const next = pendingSwitch;
            setPendingSwitch(null);
            setDirty(new Set());
            next();
          }}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </>
  );
}
