"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import LeaveForm, { type LeaveBalance } from "@/components/hr/LeaveForm";
import ClaimForm from "@/components/hr/ClaimForm";
import { AttCode, AttLegend, Card, Kpi, MonthPicker, WEEKDAY_SHORT, fmtDate, minutesLabel, CLAIM_CATEGORY_LABELS } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconPlus, IconClock } from "@/components/icons";

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

type Tab = "overview" | "attendance" | "leave" | "payslips" | "claims";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["attendance", "Attendance"],
  ["leave", "Leave"],
  ["payslips", "Payslips"],
  ["claims", "Claims"],
];

export default function MyWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <MyWorkspace />
    </Suspense>
  );
}

function MyWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const initial = (params.get("tab") as Tab) || "overview";
  const [tab, setTabState] = useState<Tab>(TABS.some(([k]) => k === initial) ? initial : "overview");
  const [me, setMe] = useState<Me | null>(null);
  const [att, setAtt] = useState<MyAttendance | null>(null);
  const [error, setError] = useState<unknown>(null);
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [punching, setPunching] = useState(false);

  function setTab(t: Tab) {
    setTabState(t);
    router.replace(`/hr/me?tab=${t}`, { scroll: false });
  }

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
        <EmptyState title="No employee profile linked to your login" description="Ask HR to open your employee record and choose “Give portal access” with this email." />
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
        title={`Hello, ${me.employee.name.split(" ")[0]}`}
        description={`${me.employee.designation || "Employee"}${me.employee.department ? ` · ${me.employee.department}` : ""} · ${me.company}`}
      />

      <div className="hrTabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" className="hrTab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

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
            <Card title="Leave balance" action={<button type="button" className="button buttonSecondary buttonSm" onClick={() => setTab("leave")}><IconPlus /> Apply</button>}>
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
        </>
      )}

      {tab === "leave" && <MyLeave balances={me.leaveBalances} onChanged={loadMe} />}
      {tab === "payslips" && <MyPayslips />}
      {tab === "claims" && <MyClaims />}
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
                  {r.decisionNote && <div className="hrMuted">HR: {r.decisionNote}</div>}
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
          </tr>
        </thead>
        <tbody>
          {rows && rows.length === 0 && (
            <tr>
              <td colSpan={5}>
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
