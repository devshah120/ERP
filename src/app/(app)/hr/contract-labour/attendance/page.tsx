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
import { fmtDate, todayKey, minutesLabel, useMasterOptions } from "@/components/hr/HrKit";
import { IconChevronLeft, IconChevronRight, IconCheck, IconSave } from "@/components/icons";

interface SheetRow {
  workerId: string;
  workerCode: string;
  name: string;
  phone: string;
  contractors: { id: string; name: string; code: string }[];
  contractorId: string;
  shift: { name: string; startTime: string; endTime: string; fullDayHours: number };
  dayKind: "WORKING" | "WEEKLY_OFF" | "HOLIDAY";
  suggested: string;
  record: { status: string; checkIn: string; checkOut: string; workedMinutes: number; overtimeMinutes: number; overtimeManual: boolean; notes: string } | null;
}

interface Sheet {
  date: string;
  holiday: string | null;
  rows: SheetRow[];
  counts: Record<string, number>;
  overtimeMinutes: number;
  unmarked: number;
}

interface Draft {
  contractorId: string;
  status: string;
  checkIn: string;
  checkOut: string;
  overtimeHours: string;
  notes: string;
}

const STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "ABSENT", label: "Absent" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "WEEKLY_OFF", label: "Weekly off" },
  { value: "HOLIDAY", label: "Holiday" },
];

function shiftDay(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function minutesOf(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Overtime the server will work out from the times (shown until saved; the server's figure is the one kept). */
function autoOvertime(checkIn: string, checkOut: string, fullDayHours: number): number {
  const a = minutesOf(checkIn);
  const b = minutesOf(checkOut);
  if (a === null || b === null) return 0;
  const worked = b >= a ? b - a : b + 24 * 60 - a;
  return Math.max(0, worked - fullDayHours * 60);
}

export default function LabourAttendancePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [contractorId, setContractorId] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const contractorOptions = useMasterOptions("hr-contractors", (r) => `${String(r.contractorCode ?? "")} · ${String(r.name ?? "")}`);

  const load = useCallback(async () => {
    setError(null);
    setSheet(null);
    try {
      const qs = new URLSearchParams({ date });
      if (contractorId) qs.set("contractorId", contractorId);
      const data = await apiFetch<Sheet>(`/api/hr/contract-labour/attendance?${qs.toString()}`);
      setSheet(data);
      const next: Record<string, Draft> = {};
      for (const r of data.rows) {
        next[r.workerId] = r.record
          ? {
              contractorId: r.contractorId,
              status: r.record.status,
              checkIn: r.record.checkIn,
              checkOut: r.record.checkOut,
              overtimeHours: r.record.overtimeManual ? (r.record.overtimeMinutes / 60).toFixed(2).replace(/\.?0+$/, "") : "",
              notes: r.record.notes,
            }
          : { contractorId: r.contractorId, status: r.suggested, checkIn: "", checkOut: "", overtimeHours: "", notes: "" };
      }
      setDrafts(next);
      setDirty(new Set());
    } catch (err) {
      setError(err);
    }
  }, [date, contractorId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const canEdit = hasPermission("hr-contract-attendance.edit");
  useUnsavedChangesWarning(dirty.size > 0 && !saving);

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    setDirty((s) => new Set(s).add(id));
  }

  function markUnmarked() {
    if (!sheet) return;
    const next = new Set(dirty);
    const d = { ...drafts };
    for (const r of sheet.rows) {
      if (!r.record) {
        d[r.workerId] = { ...d[r.workerId], status: r.suggested };
        next.add(r.workerId);
      }
    }
    setDrafts(d);
    setDirty(next);
  }

  async function save() {
    if (!sheet || dirty.size === 0) return;
    setSaving(true);
    try {
      const rows = sheet.rows.filter((r) => dirty.has(r.workerId)).map((r) => ({ workerId: r.workerId, ...drafts[r.workerId] }));
      const res = await apiFetch<{ saved: number }>("/api/hr/contract-labour/attendance", { method: "PUT", body: JSON.stringify({ date: sheet.date, rows }) });
      toast.success(`Saved attendance for ${res.saved} worker${res.saved === 1 ? "" : "s"}`);
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
    return (sheet?.rows ?? []).filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.workerCode.toLowerCase().includes(q) || r.phone.includes(q) || r.contractors.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [sheet, query]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const counts = sheet?.counts ?? {};

  return (
    <>
      <PageHeader
        title="Labour attendance"
        description={
          sheet
            ? `${fmtDate(sheet.date)}${sheet.holiday ? ` · ${sheet.holiday}` : ""} · ${counts.PRESENT ?? 0} present, ${counts.HALF_DAY ?? 0} half day, ${counts.ABSENT ?? 0} absent, ${sheet.unmarked} not marked · ${minutesLabel(sheet.overtimeMinutes)} overtime`
            : "Mark contract workers' days and in/out times. Overtime is worked out from the times."
        }
        actions={
          <>
            <Link href="/hr/contract-labour/overtime" className="button buttonSecondary">
              Overtime calculation
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
        <select className="select" style={{ width: "auto", maxWidth: "16rem" }} value={contractorId} onChange={(e) => setContractorId(e.target.value)} aria-label="Contractor">
          <option value="">All contractors</option>
          {(contractorOptions ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <SearchBox value={query} onChange={setQuery} placeholder="Filter by name, code, mobile…" width="14rem" />
        <div className="toolbarRight">
          {canEdit && sheet && sheet.unmarked > 0 && (
            <button type="button" className="button buttonSecondary" onClick={markUnmarked}>
              <IconCheck /> Mark the rest present
            </button>
          )}
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Contractor</th>
              <th>Shift</th>
              <th>Status</th>
              <th>In</th>
              <th>Out</th>
              <th>Worked</th>
              <th title="Leave blank to work it out from the times">Overtime (hrs)</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {!sheet && !error && <SkeletonRows columns={9} rows={6} />}
            {error !== null && (
              <tr>
                <td colSpan={9}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load attendance."} onRetry={load} />
                </td>
              </tr>
            )}
            {sheet && rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title={query ? "Nobody matches" : "No contract workers on the rolls on this date"}
                    description={query ? undefined : "Add workers under Contract Labour → Workers, or bulk upload them from Excel."}
                  />
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const d = drafts[r.workerId];
              if (!d) return null;
              const working = d.status === "PRESENT" || d.status === "HALF_DAY";
              const locked = !canEdit;
              const auto = working ? autoOvertime(d.checkIn, d.checkOut, r.shift.fullDayHours) : 0;
              return (
                <tr key={r.workerId} style={dirty.has(r.workerId) ? { background: "var(--accent-soft)" } : undefined}>
                  <td>
                    <Link href={`/hr-contract-workers/${r.workerId}`} className="cellLink">
                      {r.name}
                    </Link>
                    <div className="hrMuted">
                      {r.workerCode}
                      {r.phone ? ` · ${r.phone}` : ""}
                    </div>
                  </td>
                  <td>
                    {r.contractors.length > 1 ? (
                      <select className="select" style={{ minWidth: "9rem" }} value={d.contractorId} disabled={locked} onChange={(e) => setDraft(r.workerId, { contractorId: e.target.value })} aria-label={`Contractor for ${r.name}`}>
                        {r.contractors.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      r.contractors[0]?.name
                    )}
                  </td>
                  <td className="hrMuted">
                    {r.shift.startTime}–{r.shift.endTime}
                    {r.dayKind !== "WORKING" && <div>{r.dayKind === "HOLIDAY" ? "Holiday" : "Weekly off"}</div>}
                  </td>
                  <td>
                    <select className="select attStatusSelect" value={d.status} disabled={locked} onChange={(e) => setDraft(r.workerId, { status: e.target.value })} aria-label={`Status for ${r.name}`}>
                      {STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {!r.record && <div className="hrMuted">not saved yet</div>}
                  </td>
                  <td>
                    <input type="time" className="input attTime" value={d.checkIn} disabled={locked || !working} onChange={(e) => setDraft(r.workerId, { checkIn: e.target.value })} aria-label="Check in" />
                  </td>
                  <td>
                    <input type="time" className="input attTime" value={d.checkOut} disabled={locked || !working} onChange={(e) => setDraft(r.workerId, { checkOut: e.target.value })} aria-label="Check out" />
                  </td>
                  <td className="numCell">{minutesLabel(r.record?.workedMinutes ?? 0)}</td>
                  <td>
                    <input
                      className="input attTime"
                      inputMode="decimal"
                      value={d.overtimeHours}
                      disabled={locked || !working}
                      onChange={(e) => setDraft(r.workerId, { overtimeHours: e.target.value.trim() })}
                      placeholder={dirty.has(r.workerId) ? (auto ? (auto / 60).toFixed(2) : "0") : r.record && !r.record.overtimeManual ? (r.record.overtimeMinutes / 60).toFixed(2) : "auto"}
                      aria-label={`Overtime hours for ${r.name}`}
                      title="Blank = worked beyond the shift's full day"
                    />
                  </td>
                  <td>
                    <input className="input" style={{ minWidth: "8rem" }} value={d.notes} disabled={locked} onChange={(e) => setDraft(r.workerId, { notes: e.target.value })} />
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
