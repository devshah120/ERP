"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { ErrorState, SkeletonBlock, EmptyState } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Kpi, Card, fmtDate } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconRefresh, IconPlus } from "@/components/icons";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/resources/ui/hrRegistry";

interface Dashboard {
  today: string;
  headcount: number;
  maxEmployees: number | null;
  plan: string | null;
  subscriptionEndsAt: string | null;
  joinersThisMonth: number;
  exitsThisMonth: number;
  attendanceToday: { marked: number; present: number; halfDay: number; absent: number; onLeave: number; unmarked: number };
  pendingLeaves: { count: number; items: { id: string; leaveNumber: string; employeeName: string; leaveType: string; fromDate: string; toDate: string; days: number }[] };
  onLeaveToday: string[];
  pendingClaims: { count: number; amount: string };
  latestPayroll: { id: string; runNumber: string; period: string; status: string; totalNet: string; totalGross: string; employeeCount: number } | null;
  payrollTrend: { period: string; gross: string; net: string }[];
  departments: { name: string; count: number }[];
  employmentTypes: { type: string; count: number }[];
  celebrations: { kind: "BIRTHDAY" | "ANNIVERSARY"; name: string; date: string; years: number; employeeId: string }[];
  holidays: { name: string; date: string }[];
  announcements: { id: string; title: string; message: string; publishDate: string; pinned: boolean }[];
}

export default function HrDashboardPage() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<Dashboard>("/api/hr/dashboard"));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useShortcutScope({ onRefresh: load });

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const maxDept = Math.max(1, ...(data?.departments.map((d) => d.count) ?? [1]));
  const maxTrend = Math.max(1, ...(data?.payrollTrend.map((t) => Number(t.gross)) ?? [1]));

  return (
    <>
      <PageHeader
        title="People overview"
        description={data ? `Today, ${fmtDate(data.today)}` : "Headcount, attendance, approvals and payroll at a glance."}
        actions={
          <>
            <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh (Ctrl + R)">
              {loading ? <span className="spinner" /> : <IconRefresh />}
            </button>
            {hasPermission("hr-employees.create") && (
              <Link href="/hr-employees/new" className="button buttonPrimary">
                <IconPlus /> Add employee
              </Link>
            )}
          </>
        }
      />

      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load the dashboard."} onRetry={load} />}
      {!data && !error && (
        <div className="hrGrid">
          <SkeletonBlock lines={4} />
          <SkeletonBlock lines={4} />
          <SkeletonBlock lines={4} />
        </div>
      )}

      {data && (
        <>
          {data.headcount === 0 && (
            <div className="banner bannerInfo" style={{ marginBottom: "1rem" }}>
              <span>
                Start by adding your team: <Link href="/hr-employees/new" className="textLink">add an employee</Link> or{" "}
                <Link href="/hr-employees" className="textLink">import them from Excel</Link>. Shifts, leave types and departments are already set up and can be changed under Time & Leave.
              </span>
            </div>
          )}

          <div className="hrKpis">
            <Kpi label="Active employees" value={data.headcount} sub={data.maxEmployees ? `of ${data.maxEmployees} on your plan` : `${data.joinersThisMonth} joined, ${data.exitsThisMonth} left this month`} href="/hr/employees" />
            <Kpi label="Present today" value={data.attendanceToday.present} sub={`${data.attendanceToday.unmarked} not marked · ${data.attendanceToday.absent} absent`} href="/hr/attendance" />
            <Kpi label="On leave today" value={data.attendanceToday.onLeave} sub={data.onLeaveToday.slice(0, 2).join(", ") || "Nobody"} href="/hr/leaves?status=APPROVED" />
            <Kpi label="Leave requests waiting" value={data.pendingLeaves.count} sub="Need approval" href="/hr/leaves?status=PENDING" />
            <Kpi label="Claims waiting" value={data.pendingClaims.count} sub={formatMoney(data.pendingClaims.amount)} href="/hr/claims?status=PENDING" />
            <Kpi
              label="Last payroll"
              value={data.latestPayroll ? formatMoney(data.latestPayroll.totalNet) : "—"}
              sub={data.latestPayroll ? `${data.latestPayroll.period} · ${data.latestPayroll.status.toLowerCase()}` : "No payroll run yet"}
              href={data.latestPayroll ? `/hr/payroll/${data.latestPayroll.id}` : "/hr/payroll"}
            />
          </div>

          <div className="hrGrid">
            <Card title="Leave requests waiting" action={<Link href="/hr/leaves?status=PENDING">All requests</Link>}>
              {data.pendingLeaves.items.length === 0 ? (
                <EmptyState compact title="Nothing waiting" description="New leave requests appear here for approval." />
              ) : (
                <ul className="hrList">
                  {data.pendingLeaves.items.map((l) => (
                    <li key={l.id}>
                      <span>
                        <strong>{l.employeeName}</strong>
                        <div className="hrMuted">
                          {l.leaveType} · {fmtDate(l.fromDate)}
                          {l.toDate !== l.fromDate ? ` – ${fmtDate(l.toDate)}` : ""} · {l.days} day{l.days === 1 ? "" : "s"}
                        </div>
                      </span>
                      <Link href={`/hr/leaves?status=PENDING&focus=${l.id}`} className="button buttonSecondary buttonSm">
                        Review
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Headcount by department" action={<Link href="/hr-departments">Departments</Link>}>
              {data.departments.length === 0 ? (
                <EmptyState compact title="No employees yet" />
              ) : (
                data.departments.map((d) => (
                  <div key={d.name} className="hrBarRow">
                    <span>{d.name}</span>
                    <div className="hrBarTrack">
                      <div className="hrBarFill" style={{ width: `${(d.count / maxDept) * 100}%` }} />
                    </div>
                    <span className="numCell">{d.count}</span>
                  </div>
                ))
              )}
              {data.employmentTypes.length > 0 && (
                <div className="hrMuted" style={{ marginTop: "0.75rem" }}>
                  {data.employmentTypes.map((t) => `${EMPLOYMENT_TYPE_LABELS[t.type] ?? t.type}: ${t.count}`).join(" · ")}
                </div>
              )}
            </Card>

            <Card title="Payroll cost" action={<Link href="/hr/payroll">Payroll runs</Link>}>
              {data.payrollTrend.length === 0 ? (
                <EmptyState compact title="No payroll yet" description="Run your first payroll from Payroll → Payroll Runs." />
              ) : (
                data.payrollTrend.map((t) => (
                  <div key={t.period} className="hrBarRow" style={{ gridTemplateColumns: "4.5rem minmax(0,1fr) 7rem" }}>
                    <span>{t.period}</span>
                    <div className="hrBarTrack">
                      <div className="hrBarFill" style={{ width: `${(Number(t.gross) / maxTrend) * 100}%` }} />
                    </div>
                    <span className="numCell">{formatMoney(t.gross, 0)}</span>
                  </div>
                ))
              )}
            </Card>
          </div>

          <div className="hrGrid">
            <Card title="Birthdays & work anniversaries" action={<span className="hrMuted">Next 30 days</span>}>
              {data.celebrations.length === 0 ? (
                <EmptyState compact title="None coming up" />
              ) : (
                <ul className="hrList">
                  {data.celebrations.map((c) => (
                    <li key={`${c.kind}-${c.employeeId}`}>
                      <span>
                        <Link href={`/hr/employees/${c.employeeId}`} className="textLink">
                          {c.name}
                        </Link>
                        <div className="hrMuted">{c.kind === "BIRTHDAY" ? "Birthday" : `${c.years} year${c.years === 1 ? "" : "s"} with you`}</div>
                      </span>
                      <span className="hrMuted">{fmtDate(c.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Upcoming holidays" action={<Link href="/hr-holidays">Calendar</Link>}>
              {data.holidays.length === 0 ? (
                <EmptyState compact title="No holidays listed" description="Add your holiday list under Time & Leave → Holiday Calendar." />
              ) : (
                <ul className="hrList">
                  {data.holidays.map((h) => (
                    <li key={h.date + h.name}>
                      <span>{h.name}</span>
                      <span className="hrMuted">{fmtDate(h.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Announcements" action={<Link href="/hr-announcements">Manage</Link>}>
              {data.announcements.length === 0 ? (
                <EmptyState compact title="No announcements" />
              ) : (
                data.announcements.map((a) => (
                  <div key={a.id} className="announcement">
                    <h4>
                      {a.title} {a.pinned && <StatusBadge status="PINNED" kind="active" />}
                    </h4>
                    <p>{a.message}</p>
                  </div>
                ))
              )}
            </Card>
          </div>

          {data.subscriptionEndsAt && (
            <p className="hrMuted">
              Plan: {data.plan ?? "—"} · renews {fmtDate(data.subscriptionEndsAt)}
            </p>
          )}
        </>
      )}
    </>
  );
}
