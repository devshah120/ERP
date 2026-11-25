"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import LeaveForm, { type LeaveBalance } from "@/components/hr/LeaveForm";
import ClaimForm from "@/components/hr/ClaimForm";
import { dayLabel, type CorrectionRow } from "@/components/hr/CorrectionRequests";
import { AttCode, AttLegend, Card, Kpi, MonthPicker, WEEKDAY_SHORT, fmtDate, minutesLabel, CLAIM_CATEGORY_LABELS, apiErrorText } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconPlus, IconClock, IconDownload } from "@/components/icons";

interface Me {
  employee: {
    id: string;
    employeeCode: string;
    name: string;
    department: string;
    designation: string;
    manager: string;
    dateOfJoining: string;
    workEmail: string;
    phone: string;
    bankAccountNumber: string;
    panNumber: string;
    uanNumber: string;
  };
  company: string;
  leaveBalances: LeaveBalance[];
  announcements: { id: string; title: string; message: string; publishDate: string; pinned: boolean }[];
  holidays: { id: string; name: string; date: string }[];
}

interface MyAttendance {
  today: { date: string; checkIn: string; checkOut: string; status: string | null; shift: { name: string; startTime: string; endTime: string } };
  days: { date: string; day: number; weekday: number; code: string; checkIn: string; checkOut: string; holiday: string | null }[];
  summary: { present: number; absent: number; halfDays: number; paidLeave: number; unpaidLeave: number; holidays: number; weeklyOffs: number; unmarked: number; lateDays: number; lopDays: number };
  pendingLeaves: number;
}

export type MySection = "overview" | "attendance" | "leave" | "payslips" | "claims" | "advances";

const SECTION_TITLES: Record<Exclude<MySection, "overview">, string> = {
  attendance: "My attendance",
  leave: "My leave",
  payslips: "My payslips",
  claims: "My expense claims",
  advances: "My advances & loans",
};

/**
 * Employee self-service. Each section is its own page under /hr/me, reached
 * from the "My Workspace" submenu in the sidebar.
 */
export default function MyWorkspace({ section }: { section: MySection }) {
  const toast = useToast();
  const { me: account, hasPermission } = useAuth();
  const tab = section;
  const [me, setMe] = useState<Me | null>(null);
  const [att, setAtt] = useState<MyAttendance | null>(null);
  const [error, setError] = useState<unknown>(null);
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [punching, setPunching] = useState(false);
  /** Date the correction form is open for (null = closed). */
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctionsKey, setCorrectionsKey] = useState(0);

  const loadMe = useCallback(async () => {
    setError(null);
    try {
      setMe(await apiFetch<Me>("/api/hr/self"));
    } catch (err) {
      setError(err);
    }
  }, []);

  const loadAtt = useCallback(async () => {
    try {
      setAtt(await apiFetch<MyAttendance>(`/api/hr/self/attendance?year=${period.year}&month=${period.month}`));
    } catch {
      setAtt(null);
    }
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMe();
  }, [loadMe]);
  useEffect(() => {
    if (!me) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAtt();
  }, [me, loadAtt]);

  async function punch() {
    setPunching(true);
    try {
      const r = await apiFetch<{ action: "CHECK_IN" | "CHECK_OUT"; time: string; lateMinutes?: number; workedMinutes?: number }>("/api/hr/self/punch", { method: "POST" });
      if (r.action === "CHECK_IN") toast.success(`Checked in at ${r.time}`, r.lateMinutes ? `${minutesLabel(r.lateMinutes)} late` : "Have a good day!");
      else toast.success(`Checked out at ${r.time}`, `Worked ${minutesLabel(r.workedMinutes ?? 0)}`);
      loadAtt();
    } catch (err) {
      toast.error("Could not record", err instanceof ApiError ? err.message : undefined);
    } finally {
      setPunching(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  if (error instanceof ApiError && error.code === "NO_EMPLOYEE_PROFILE") {
    return (
      <>
        <PageHeader title="My workspace" />
        {hasPermission("hr-employees.edit") ? (
          <EmptyState
            title="Your login isn't linked to an employee record"
            description={`My Workspace is the employee self-service view. To use it yourself, add yourself as an employee, open your profile and choose “Give portal access” with ${account?.email ?? "your sign-in email"}.`}
            actions={
              <>
                <Link href="/hr/dashboard" className="button buttonSecondary">
                  HR dashboard
                </Link>
                <Link href="/hr/employees" className="button buttonPrimary">
                  Employees
                </Link>
              </>
            }
          />
        ) : (
          <EmptyState title="No employee profile linked to your login" description="Ask HR to open your employee record and choose “Give portal access” with this email." />
        )}
      </>
    );
  }
  if (error) return <ErrorState message={error instanceof ApiError ? error.message : "Could not load your workspace."} onRetry={loadMe} />;
  if (!me) return <SkeletonBlock lines={6} />;

  const t = att?.today;
  const punchLabel = !t?.checkIn ? "Check in" : !t.checkOut ? "Check out" : "Done for today";

  return (
    <>
      <PageHeader
        title={tab === "overview" ? `Hello, ${me.employee.name.split(" ")[0]}` : SECTION_TITLES[tab]}
        description={`${me.employee.name} · ${me.employee.designation || "Employee"}${me.employee.department ? ` · ${me.employee.department}` : ""} · ${me.company}`}
      />

      {tab === "overview" && (
        <>
          <section className="card" style={{ marginBottom: "1rem" }}>
            <div className="cardBody punchCard">
              <div>
                <div className="hrMuted">
                  <IconClock style={{ verticalAlign: "middle" }} /> {fmtDate(t?.date ?? null)} · {t ? `${t.shift.name} ${t.shift.startTime}–${t.shift.endTime}` : ""}
                </div>
                <div className="punchTimes" style={{ marginTop: "0.5rem" }}>
                  <div>
                    <span className="hrMuted">In</span>
                    <strong>{t?.checkIn || "--:--"}</strong>
                  </div>
                  <div>
                    <span className="hrMuted">Out</span>
                    <strong>{t?.checkOut || "--:--"}</strong>
                  </div>
                  {t?.status && (
                    <div>
                      <span className="hrMuted">Today</span>
                      <strong style={{ fontSize: "0.9375rem" }}>
                        <StatusBadge status={t.status} />
                      </strong>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" className="button buttonPrimary punchButton" onClick={punch} disabled={punching || !att || Boolean(t?.checkIn && t?.checkOut)}>
                {punching && <span className="spinner" />} {punchLabel}
              </button>
            </div>
          </section>

          <div className="hrKpis">
            <Kpi label="Present this month" value={att ? att.summary.present + att.summary.unmarked : "—"} />
            <Kpi label="Leave taken" value={att ? att.summary.paidLeave + att.summary.unpaidLeave : "—"} sub={att?.pendingLeaves ? `${att.pendingLeaves} request(s) pending` : undefined} />
            <Kpi label="Late arrivals" value={att ? att.summary.lateDays : "—"} />
            <Kpi label="Loss-of-pay days" value={att ? att.summary.lopDays : "—"} />
          </div>

          <div className="hrGrid">
            <Card title="Leave balance" action={<Link href="/hr/me/leave" className="button buttonSecondary buttonSm"><IconPlus /> Apply</Link>}>
              <div className="balanceGrid">
                {me.leaveBalances.map((b) => (
                  <div key={b.leaveTypeId} className="balanceTile">
                    <span className="hrMuted">{b.name}</span>
                    <strong>{b.allowNegative ? "—" : b.available}</strong>
                    <span className="hrMuted">{b.allowNegative ? `${b.used} taken` : `of ${b.allocated + b.carriedForward}`}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Announcements">
              {me.announcements.length === 0 ? (
                <EmptyState compact title="No announcements" />
              ) : (
                me.announcements.map((a) => (
                  <div key={a.id} className="announcement">
                    <h4>{a.title}</h4>
                    <p>{a.message}</p>
                  </div>
                ))
              )}
            </Card>
            <Card title="Upcoming holidays">
              {me.holidays.length === 0 ? (
                <EmptyState compact title="No holidays listed" />
              ) : (
                <ul className="hrList">
                  {me.holidays.map((h) => (
                    <li key={h.id}>
                      <span>{h.name}</span>
                      <span className="hrMuted">{fmtDate(h.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="My details">
            <dl className="hrDl">
              {(
                [
                  ["Employee code", me.employee.employeeCode],
                  ["Reports to", me.employee.manager],
                  ["Joined", fmtDate(me.employee.dateOfJoining)],
                  ["Work email", me.employee.workEmail],
                  ["Phone", me.employee.phone],
                  ["Salary account", me.employee.bankAccountNumber],
                  ["PAN", me.employee.panNumber],
                  ["UAN", me.employee.uanNumber],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || <span className="cellMuted">—</span>}</dd>
                </div>
              ))}
            </dl>
            <p className="hrMuted" style={{ marginBottom: 0 }}>
              Something wrong? Ask HR to update your record.
            </p>
          </Card>
        </>
      )}

      {tab === "attendance" && (
        <>
          <div className="toolbar">
            <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />
            <div className="toolbarRight">
              <button type="button" className="button buttonSecondary" onClick={() => setCorrecting(att?.today.date ?? "")} disabled={!att}>
                <IconPlus /> Request correction
              </button>
            </div>
          </div>
          <AttLegend />
          {!att ? (
            <SkeletonBlock height="18rem" />
          ) : (
            <section className="card">
              <div className="cardBody">
                <div className="calGrid">
                  {WEEKDAY_SHORT.map((d) => (
                    <div key={d} className="calHead">
                      {d}
                    </div>
                  ))}
                  {Array.from({ length: att.days[0]?.weekday ?? 0 }, (_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                  {att.days.map((d) => (
                    <div key={d.date} className="calDay" data-today={d.date === att.today.date} title={d.holiday ?? undefined}>
                      <span className="calDayNum">{d.day}</span>
                      <AttCode code={d.code} />
                      {d.checkIn && (
                        <span className="hrMuted">
                          {d.checkIn}
                          {d.checkOut ? `–${d.checkOut}` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          <MyCorrections
            reloadKey={correctionsKey}
            correcting={correcting}
            maxDate={att?.today.date ?? ""}
            onClose={() => setCorrecting(null)}
            onChanged={() => {
              setCorrectionsKey((k) => k + 1);
              loadAtt();
            }}
          />
        </>
      )}

      {tab === "leave" && <MyLeave balances={me.leaveBalances} onChanged={loadMe} />}
      {tab === "payslips" && <MyPayslips />}
      {tab === "claims" && <MyClaims />}
      {tab === "advances" && <MyAdvances />}
    </>
  );
}

/* ------------------------------------------------------------------ */

interface LeaveRow {
  id: string;
  leaveNumber: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string;
  status: string;
  decisionNote: string;
  decidedAs?: string;
}

function MyLeave({ balances, onChanged }: { balances: LeaveBalance[]; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<LeaveRow[] | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: LeaveRow[] }>("/api/hr/self/leaves?pageSize=50");
      setRows(r.items);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function withdraw(id: string) {
    try {
      await apiFetch(`/api/hr/self/leaves/${id}`, { method: "DELETE" });
      toast.success("Request withdrawn");
      load();
      onChanged();
    } catch (err) {
      toast.error("Could not withdraw", err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="button buttonPrimary" onClick={() => setApplying(true)}>
          <IconPlus /> Apply for leave
        </button>
      </div>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Type</th>
              <th>Dates</th>
              <th className="numCell">Days</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState title="No leave requests yet" />
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="cellMono">{r.leaveNumber}</td>
                <td>{r.leaveType}</td>
                <td>
                  {fmtDate(r.fromDate)}
                  {r.toDate !== r.fromDate ? ` – ${fmtDate(r.toDate)}` : ""}
                  {r.halfDay ? " (half day)" : ""}
                  {r.decisionNote && <div className="hrMuted">{r.decidedAs === "MANAGER" ? "Manager" : "HR"}: {r.decisionNote}</div>}
                </td>
                <td className="numCell">{r.days}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ textAlign: "right" }}>
                  {r.status === "PENDING" && (
                    <button type="button" className="button buttonGhost buttonSm" onClick={() => withdraw(r.id)}>
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {applying && (
        <Modal title="Apply for leave" onClose={() => setApplying(false)} width="40rem">
          <LeaveForm
            selfBalances={balances}
            submitUrl="/api/hr/self/leaves"
            onDone={(r) => {
              toast.success(`${r.leaveNumber} sent for approval`, `${r.days} day(s)`);
              setApplying(false);
              load();
              onChanged();
            }}
            onCancel={() => setApplying(false)}
          />
        </Modal>
      )}
    </>
  );
}

function MyPayslips() {
  const [rows, setRows] = useState<{ id: string; period: string; grossEarnings: string; totalDeductions: string; netPay: string; status: string }[] | null>(null);
  useEffect(() => {
    apiFetch<{ items: { id: string; period: string; grossEarnings: string; totalDeductions: string; netPay: string; status: string }[] }>("/api/hr/self/payslips")
      .then((r) => setRows(r.items))
      .catch(() => setRows([]));
  }, []);
  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="numCell">Gross</th>
            <th className="numCell">Deductions</th>
            <th className="numCell">Net pay</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows && rows.length === 0 && (
            <tr>
              <td colSpan={6}>
                <EmptyState title="No payslips yet" description="Payslips appear here once HR approves the month's payroll." />
              </td>
            </tr>
          )}
          {rows?.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/hr/me/payslips/${r.id}`} className="cellLink">
                  {r.period}
                </Link>
              </td>
              <td className="numCell">{formatMoney(r.grossEarnings)}</td>
              <td className="numCell">{formatMoney(r.totalDeductions)}</td>
              <td className="numCell">
                <strong>{formatMoney(r.netPay)}</strong>
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td style={{ textAlign: "right" }}>
                <a href={`/api/hr/self/payslips/${r.id}/pdf`} className="button buttonGhost buttonSm" download title={`Download ${r.period} payslip as PDF`}>
                  <IconDownload /> PDF
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ClaimRow {
  id: string;
  claimNumber: string;
  claimDate: string;
  category: string;
  amount: string;
  description: string;
  status: string;
  decisionNote: string;
}

function MyClaims() {
  const toast = useToast();
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: ClaimRow[] }>("/api/hr/self/claims?pageSize=50");
      setRows(r.items);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function withdraw(id: string) {
    try {
      await apiFetch(`/api/hr/self/claims/${id}`, { method: "DELETE" });
      toast.success("Claim withdrawn");
      load();
    } catch (err) {
      toast.error("Could not withdraw", err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="button buttonPrimary" onClick={() => setAdding(true)}>
          <IconPlus /> New claim
        </button>
      </div>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Claim</th>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th className="numCell">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No claims yet" />
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="cellMono">{r.claimNumber}</td>
                <td>{fmtDate(r.claimDate)}</td>
                <td>{CLAIM_CATEGORY_LABELS[r.category] ?? r.category}</td>
                <td>
                  {r.description}
                  {r.decisionNote && <div className="hrMuted">HR: {r.decisionNote}</div>}
                </td>
                <td className="numCell">{formatMoney(r.amount)}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ textAlign: "right" }}>
                  {r.status === "PENDING" && (
                    <button type="button" className="button buttonGhost buttonSm" onClick={() => withdraw(r.id)}>
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal title="New expense claim" onClose={() => setAdding(false)} width="40rem">
          <ClaimForm
            submitUrl="/api/hr/self/claims"
            onDone={(r) => {
              toast.success(`${r.claimNumber} submitted`, "HR will review it.");
              setAdding(false);
              load();
            }}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

const CORRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: "PRESENT", label: "Present (I worked, but the punch is missing or wrong)" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "ON_DUTY", label: "On duty (working away from the office)" },
];

/** The employee's correction requests, and the form to raise one. */
function MyCorrections({
  reloadKey,
  correcting,
  maxDate,
  onClose,
  onChanged,
}: {
  reloadKey: number;
  correcting: string | null;
  maxDate: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<CorrectionRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: CorrectionRow[] }>("/api/hr/self/attendance-requests?pageSize=20");
      setRows(r.items);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, reloadKey]);

  async function withdraw(id: string) {
    try {
      await apiFetch(`/api/hr/self/attendance-requests/${id}`, { method: "DELETE" });
      toast.success("Request withdrawn");
      onChanged();
    } catch (err) {
      toast.error("Could not withdraw", err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <>
      <Card title="Correction requests">
        {rows && rows.length === 0 ? (
          <EmptyState compact title="No correction requests" description="Missed a punch or worked on duty? Use “Request correction” and your manager or HR will review it." />
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Day</th>
                  <th>Change</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id}>
                    <td className="cellMono">{r.requestNumber}</td>
                    <td>{fmtDate(r.date)}</td>
                    <td>
                      <span className="cellMuted">{dayLabel(r.previous.status, r.previous.checkIn, r.previous.checkOut)}</span>
                      <div>→ {dayLabel(r.requestedStatus, r.checkIn, r.checkOut)}</div>
                      {r.decisionNote && (
                        <div className="hrMuted">
                          {r.decidedAs === "MANAGER" ? "Manager" : "HR"}: {r.decisionNote}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {r.status === "PENDING" && (
                        <button type="button" className="button buttonGhost buttonSm" onClick={() => withdraw(r.id)}>
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {correcting !== null && (
        <CorrectionForm
          initialDate={correcting}
          maxDate={maxDate}
          onClose={onClose}
          onDone={(number) => {
            toast.success(`${number} sent for approval`);
            onClose();
            onChanged();
          }}
        />
      )}
    </>
  );
}

interface CorrectionOptions {
  applicable: boolean;
  minDate: string | null;
  maxDate: string | null;
  punchApplicable: boolean;
  punchPastDaysLimit: number;
  reasons: { id: string; name: string }[];
}

function CorrectionForm({ initialDate, maxDate, onClose, onDone }: { initialDate: string; maxDate: string; onClose: () => void; onDone: (requestNumber: string) => void }) {
  const [form, setForm] = useState({ date: initialDate, status: "PRESENT", checkIn: "", checkOut: "", reasonId: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<CorrectionOptions | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // The workspace's regularization policy: reasons to pick from and the days allowed.
  useEffect(() => {
    let cancelled = false;
    apiFetch<CorrectionOptions>("/api/hr/self/attendance-requests/options")
      .then((o) => !cancelled && setOptions(o))
      .catch(() => {
        /* the server still checks the policy when the request is sent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasReasons = (options?.reasons.length ?? 0) > 0;
  const allowed = options?.applicable !== false;
  const canSubmit = allowed && Boolean(form.date) && (hasReasons ? Boolean(form.reasonId) : form.reason.trim().length >= 3) && !busy;
  const latest = options ? options.maxDate : maxDate;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ requestNumber: string }>("/api/hr/self/attendance-requests", { method: "POST", body: JSON.stringify(form) });
      onDone(r.requestNumber);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Request an attendance correction"
      subtitle="Your reporting manager or HR reviews it. Approved changes update your attendance and payroll."
      onClose={onClose}
      busy={busy}
      width="36rem"
      footer={
        <>
          <button type="button" className="button buttonSecondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button buttonPrimary" onClick={submit} disabled={!canSubmit}>
            {busy && <span className="spinner" />} Send request
          </button>
        </>
      }
    >
      {!allowed && (
        <div className="banner bannerLocked" style={{ marginBottom: "0.75rem" }}>
          <span>Attendance regularization is turned off. Ask HR to correct the day.</span>
        </div>
      )}
      {error && (
        <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
          <span>{error}</span>
        </div>
      )}
      <div className="formGrid">
        <div className="field">
          <label htmlFor="corr-date">Day</label>
          <input id="corr-date" type="date" className="input" value={form.date} min={options?.minDate || undefined} max={latest || undefined} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="corr-status">Should be</label>
          <select id="corr-status" className="select" value={form.status} onChange={(e) => set({ status: e.target.value })}>
            {CORRECTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {options?.punchApplicable !== false && (
          <>
            <div className="field">
              <label htmlFor="corr-in">
                Check-in (optional)
                {options && options.punchPastDaysLimit > 0 && <span className="hint"> · up to {options.punchPastDaysLimit} day(s) back</span>}
              </label>
              <input id="corr-in" type="time" className="input" value={form.checkIn} onChange={(e) => set({ checkIn: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="corr-out">Check-out (optional)</label>
              <input id="corr-out" type="time" className="input" value={form.checkOut} onChange={(e) => set({ checkOut: e.target.value })} />
            </div>
          </>
        )}
        {hasReasons && (
          <div className="field fieldSpanFull">
            <label htmlFor="corr-reason-id">Reason</label>
            <select id="corr-reason-id" className="select" value={form.reasonId} onChange={(e) => set({ reasonId: e.target.value })}>
              <option value="">— choose —</option>
              {options!.reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="field" style={{ marginTop: "0.75rem" }}>
        <label htmlFor="corr-reason">{hasReasons ? "Remarks (optional)" : "Reason"}</label>
        <textarea id="corr-reason" className="input" rows={3} value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. Forgot to check out; left at 18:30 after the client call" />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

interface AdvanceRow {
  id: string;
  loanNumber: string;
  loanType: string;
  issueDate: string;
  amount: string;
  emiAmount: string;
  repaidAmount: string;
  outstanding: string;
  startMonth: number;
  startYear: number;
  status: string;
  reason: string;
  decisionNote: string;
  createdAt: string;
}

const ADVANCE_TYPE_LABELS: Record<string, string> = { ADVANCE: "Salary advance", LOAN: "Loan" };

/** The employee's own advances and loans, with a request form. */
function MyAdvances() {
  const toast = useToast();
  const [rows, setRows] = useState<AdvanceRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ loanType: "ADVANCE", amount: "", emiAmount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: AdvanceRow[] }>("/api/hr/self/loans?pageSize=50");
      setRows(r.items);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setFormError(null);
    try {
      const r = await apiFetch<{ loanNumber: string }>("/api/hr/self/loans", { method: "POST", body: JSON.stringify(form) });
      toast.success(`${r.loanNumber} sent to HR`, "You'll see their decision here.");
      setAdding(false);
      setForm({ loanType: "ADVANCE", amount: "", emiAmount: "", reason: "" });
      load();
    } catch (err) {
      setFormError(apiErrorText(err, "Could not send the request"));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    try {
      await apiFetch(`/api/hr/self/loans/${id}`, { method: "DELETE" });
      toast.success("Request withdrawn");
      load();
    } catch (err) {
      toast.error("Could not withdraw", err instanceof ApiError ? err.message : undefined);
    }
  }

  const waiting = rows?.some((r) => r.status === "REQUESTED");

  return (
    <>
      <div className="toolbar">
        <button type="button" className="button buttonPrimary" onClick={() => (setFormError(null), setAdding(true))} disabled={waiting} title={waiting ? "You already have a request waiting for HR" : undefined}>
          <IconPlus /> Request advance
        </button>
      </div>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>No.</th>
              <th>Type</th>
              <th>Asked on</th>
              <th className="numCell">Amount</th>
              <th className="numCell">Instalment</th>
              <th className="numCell">Outstanding</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState title="No advances or loans" description="Ask HR for a salary advance; it is recovered from your salary in instalments." />
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="cellMono">{r.loanNumber}</td>
                <td>
                  {ADVANCE_TYPE_LABELS[r.loanType] ?? r.loanType}
                  {r.reason && <div className="hrMuted">{r.reason}</div>}
                  {r.decisionNote && <div className="hrMuted">HR: {r.decisionNote}</div>}
                </td>
                <td>{fmtDate(r.createdAt)}</td>
                <td className="numCell">{formatMoney(r.amount)}</td>
                <td className="numCell">{formatMoney(r.emiAmount)}</td>
                <td className="numCell">{r.status === "ACTIVE" || r.status === "CLOSED" ? formatMoney(r.outstanding) : "—"}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td style={{ textAlign: "right" }}>
                  {r.status === "REQUESTED" && (
                    <button type="button" className="button buttonGhost buttonSm" onClick={() => withdraw(r.id)}>
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal
          title="Request an advance"
          subtitle="HR decides the amount and when recovery from your salary starts."
          onClose={() => setAdding(false)}
          busy={busy}
          width="34rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={submit} disabled={busy || !form.amount || !form.emiAmount}>
                {busy && <span className="spinner" />} Send to HR
              </button>
            </>
          }
        >
          {formError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{formError}</span>
            </div>
          )}
          <div className="formGrid">
            <div className="field">
              <label htmlFor="ma-type">Type</label>
              <select id="ma-type" className="select" value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })}>
                <option value="ADVANCE">Salary advance</option>
                <option value="LOAN">Loan</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ma-amt">Amount</label>
              <input id="ma-amt" className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ma-emi">Repay per month</label>
              <input id="ma-emi" className="input" inputMode="decimal" value={form.emiAmount} onChange={(e) => setForm({ ...form, emiAmount: e.target.value })} />
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="ma-reason">
                What is it for?<span className="hint"> · optional</span>
              </label>
              <input id="ma-reason" className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
