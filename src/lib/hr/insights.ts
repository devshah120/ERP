import Decimal from "decimal.js";
import { AppError } from "@/lib/errors/AppError";
import { applyDueChanges } from "./history";
import {
  Employee,
  Attendance,
  LeaveApplication,
  ExpenseClaim,
  AttendanceRequest,
  PayrollRun,
  Payslip,
  Holiday,
  HrDepartment,
  EmployeeLoan,
  LeaveType,
  WORKING_STATUSES,
} from "@/models/hr";
import { Business } from "@/models/Business";
import type { AuthContext } from "@/lib/auth/context";
import type { ExportPayload } from "@/lib/export/exporter";
import { toDay, dayKey, addDays, monthRange, todayIn } from "./calendar";
import { monthlyRegister } from "./attendance";
import { activeAnnouncements } from "./people";
import { monthLabel } from "./payroll";
import { employeeLabels, businessTimeZone, type AnyDoc } from "./common";

const d = (v: unknown) => new Decimal(v ? String(v) : "0");

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/** Next occurrence (within `days`) of a yearly date such as a birthday. */
function upcoming(date: Date | null | undefined, today: Date, days: number): { on: Date; years: number } | null {
  if (!date) return null;
  const src = toDay(date);
  for (const y of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const on = new Date(Date.UTC(y, src.getUTCMonth(), src.getUTCDate()));
    if (on >= today && on <= addDays(today, days)) return { on, years: y - src.getUTCFullYear() };
  }
  return null;
}

export async function hrDashboard(ctx: AuthContext) {
  // Bring future-dated promotions and revisions that are now due onto the employee records.
  await applyDueChanges(ctx.businessId);
  const tz = await businessTimeZone(ctx.businessId);
  const today = todayIn(tz);
  const { start: monthStart, end: monthEnd } = monthRange(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const working = { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: WORKING_STATUSES } };

  const [emps, todayRows, pendingLeaves, pendingClaims, runs, holidays, departments, joiners, exits, business, announcements, onLeaveRows] = await Promise.all([
    Employee.find(working, { name: 1, employeeCode: 1, departmentId: 1, employmentType: 1, dateOfBirth: 1, dateOfJoining: 1, gender: 1 }).lean<AnyDoc[]>(),
    Attendance.find({ businessId: ctx.businessId, date: today }, { status: 1 }).lean<AnyDoc[]>(),
    LeaveApplication.find({ businessId: ctx.businessId, status: "PENDING" }).sort({ createdAt: -1 }).limit(6).lean<AnyDoc[]>(),
    ExpenseClaim.find({ businessId: ctx.businessId, status: "PENDING" }, { amount: 1 }).lean<AnyDoc[]>(),
    PayrollRun.find({ businessId: ctx.businessId, status: { $ne: "CANCELLED" } }).sort({ year: -1, month: -1 }).limit(6).lean<AnyDoc[]>(),
    Holiday.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", date: { $gte: today } }).sort({ date: 1 }).limit(5).lean<AnyDoc[]>(),
    HrDepartment.find({ businessId: ctx.businessId, deletedAt: null }, { name: 1 }).lean<AnyDoc[]>(),
    Employee.countDocuments({ businessId: ctx.businessId, deletedAt: null, dateOfJoining: { $gte: monthStart, $lte: monthEnd } }),
    Employee.countDocuments({ businessId: ctx.businessId, deletedAt: null, dateOfExit: { $gte: monthStart, $lte: monthEnd } }),
    Business.findById(ctx.businessId, { maxEmployees: 1, plan: 1, subscriptionEndsAt: 1 }).lean<AnyDoc>(),
    activeAnnouncements(ctx.businessId, today),
    LeaveApplication.find({ businessId: ctx.businessId, status: "APPROVED", fromDate: { $lte: today }, toDate: { $gte: today } }, { employeeId: 1 }).lean<AnyDoc[]>(),
  ]);

  const deptName = new Map(departments.map((x) => [String(x._id), x.name as string]));
  const byDept = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const e of emps) {
    const k = e.departmentId ? deptName.get(String(e.departmentId)) ?? "Unassigned" : "Unassigned";
    byDept.set(k, (byDept.get(k) ?? 0) + 1);
    byType.set(e.employmentType ?? "FULL_TIME", (byType.get(e.employmentType ?? "FULL_TIME") ?? 0) + 1);
  }

  const statusCount = (s: string) => todayRows.filter((r) => r.status === s).length;
  const leaveLabels = await employeeLabels(ctx.businessId, [...pendingLeaves.map((l) => l.employeeId), ...onLeaveRows.map((l) => l.employeeId)]);
  const leaveTypes = await LeaveType.find({ businessId: ctx.businessId }, { code: 1 }).lean<AnyDoc[]>();
  const typeCode = new Map(leaveTypes.map((t) => [String(t._id), t.code as string]));

  const celebrations = emps
    .flatMap((e) => {
      const out: { kind: "BIRTHDAY" | "ANNIVERSARY"; name: string; date: string; years: number; employeeId: string }[] = [];
      const b = upcoming(e.dateOfBirth, today, 30);
      if (b) out.push({ kind: "BIRTHDAY", name: e.name, date: dayKey(b.on), years: b.years, employeeId: String(e._id) });
      const a = upcoming(e.dateOfJoining, today, 30);
      if (a && a.years > 0) out.push({ kind: "ANNIVERSARY", name: e.name, date: dayKey(a.on), years: a.years, employeeId: String(e._id) });
      return out;
    })
    .sort((x, y) => x.date.localeCompare(y.date))
    .slice(0, 8);

  const latest = runs[0];
  return {
    today: dayKey(today),
    headcount: emps.length,
    maxEmployees: business?.maxEmployees ?? null,
    plan: business?.plan ?? null,
    subscriptionEndsAt: business?.subscriptionEndsAt ?? null,
    joinersThisMonth: joiners,
    exitsThisMonth: exits,
    attendanceToday: {
      marked: todayRows.length,
      present: statusCount("PRESENT") + statusCount("ON_DUTY"),
      halfDay: statusCount("HALF_DAY"),
      absent: statusCount("ABSENT"),
      onLeave: onLeaveRows.length,
      unmarked: Math.max(0, emps.length - todayRows.length),
    },
    pendingLeaves: {
      count: await LeaveApplication.countDocuments({ businessId: ctx.businessId, status: "PENDING" }),
      items: pendingLeaves.map((l) => ({
        id: String(l._id),
        leaveNumber: l.leaveNumber,
        employeeName: leaveLabels.get(String(l.employeeId))?.name ?? "—",
        leaveType: typeCode.get(String(l.leaveTypeId)) ?? "",
        fromDate: dayKey(toDay(l.fromDate)),
        toDate: dayKey(toDay(l.toDate)),
        days: l.days,
      })),
    },
    onLeaveToday: onLeaveRows.map((l) => leaveLabels.get(String(l.employeeId))?.name ?? "—"),
    pendingClaims: { count: pendingClaims.length, amount: pendingClaims.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0)).toFixed(2) },
    pendingCorrections: await AttendanceRequest.countDocuments({ businessId: ctx.businessId, status: "PENDING" }),
    latestPayroll: latest
      ? { id: String(latest._id), runNumber: latest.runNumber, period: monthLabel(latest.month, latest.year), status: latest.status, totalNet: d(latest.totalNet).toFixed(2), totalGross: d(latest.totalGross).toFixed(2), employeeCount: latest.employeeCount }
      : null,
    payrollTrend: [...runs].reverse().map((r) => ({ period: monthLabel(r.month, r.year).slice(0, 3) + " " + String(r.year).slice(2), gross: d(r.totalGross).toFixed(2), net: d(r.totalNet).toFixed(2) })),
    departments: [...byDept.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    employmentTypes: [...byType.entries()].map(([type, count]) => ({ type, count })),
    celebrations,
    holidays: holidays.map((h) => ({ name: h.name, date: dayKey(toDay(h.date)) })),
    announcements,
  };
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export { HR_REPORTS, type HrReportKey } from "./reportCatalog";
import type { HrReportKey } from "./reportCatalog";

const money = (v: unknown) => d(v).toFixed(2);
const fmtDate = (v: unknown) => (v ? dayKey(toDay(v as Date)) : "");

async function liveRun(ctx: AuthContext, year: number, month: number) {
  const run = await PayrollRun.findOne({ businessId: ctx.businessId, year, month, status: { $ne: "CANCELLED" } }).lean<AnyDoc>();
  if (!run) throw AppError.notFound(`There is no payroll for ${monthLabel(month, year)} yet.`, "NO_PAYROLL");
  const slips = await Payslip.find({ businessId: ctx.businessId, payrollRunId: run._id }).sort({ "employee.code": 1 }).lean<AnyDoc[]>();
  return { run, slips };
}

const lineAmount = (lines: AnyDoc[] | undefined, code: string) => d((lines ?? []).find((l) => l.code === code)?.amount);

function sumColumns(rows: Record<string, unknown>[], keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = rows.reduce((t, r) => t.plus(d(r[k])), new Decimal(0)).toFixed(2);
  return out;
}

export async function hrReport(ctx: AuthContext, key: string, params: { year?: number; month?: number }): Promise<ExportPayload> {
  const now = new Date();
  const year = params.year ?? now.getUTCFullYear();
  const month = params.month ?? now.getUTCMonth() + 1;

  switch (key as HrReportKey) {
    case "headcount": {
      const emps = await Employee.find({ businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: WORKING_STATUSES } }).sort({ employeeCode: 1 }).lean<AnyDoc[]>();
      const labels = await employeeLabels(ctx.businessId, emps.map((e) => e._id));
      const rows = emps.map((e) => ({
        employeeCode: e.employeeCode,
        name: e.name,
        department: labels.get(String(e._id))?.department ?? "",
        designation: labels.get(String(e._id))?.designation ?? "",
        dateOfJoining: fmtDate(e.dateOfJoining),
        employmentType: e.employmentType,
        employmentStatus: e.employmentStatus,
        phone: e.phone ?? "",
        workEmail: e.workEmail ?? "",
        monthlyGross: d(e.basic).plus(d(e.hra)).plus(d(e.conveyance)).plus(d(e.specialAllowance)).plus(d(e.otherAllowance)).toFixed(2),
      }));
      return {
        title: "Employee Headcount",
        columns: [
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "department", label: "Department" },
          { key: "designation", label: "Designation" },
          { key: "dateOfJoining", label: "Joined", type: "date" },
          { key: "employmentType", label: "Type" },
          { key: "employmentStatus", label: "Status" },
          { key: "phone", label: "Phone" },
          { key: "workEmail", label: "Email" },
          { key: "monthlyGross", label: "Monthly gross", type: "money" },
        ],
        rows,
        totals: sumColumns(rows, ["monthlyGross"]),
        summary: [{ label: "Active employees", value: String(rows.length) }],
      };
    }

    case "attendance-summary": {
      const reg = await monthlyRegister(ctx, year, month);
      const rows = reg.rows.map((r) => ({
        employeeCode: r.employeeCode,
        name: r.name,
        department: r.department,
        present: r.summary.present,
        unmarked: r.summary.unmarked,
        absent: r.summary.absent,
        halfDays: r.summary.halfDays,
        paidLeave: r.summary.paidLeave,
        unpaidLeave: r.summary.unpaidLeave,
        holidays: r.summary.holidays,
        weeklyOffs: r.summary.weeklyOffs,
        lateDays: r.summary.lateDays,
        lopDays: r.summary.lopDays,
        payableDays: r.payableDays,
      }));
      return {
        title: `Attendance Summary ${monthLabel(month, year)}`,
        filterNote: "Working days with nothing recorded count as present.",
        columns: [
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "department", label: "Department" },
          { key: "present", label: "Present", type: "number" },
          { key: "unmarked", label: "Unmarked", type: "number" },
          { key: "absent", label: "Absent", type: "number" },
          { key: "halfDays", label: "Half days", type: "number" },
          { key: "paidLeave", label: "Paid leave", type: "number" },
          { key: "unpaidLeave", label: "Unpaid leave", type: "number" },
          { key: "holidays", label: "Holidays", type: "number" },
          { key: "weeklyOffs", label: "Weekly offs", type: "number" },
          { key: "lateDays", label: "Late days", type: "number" },
          { key: "lopDays", label: "LOP days", type: "number" },
          { key: "payableDays", label: "Payable days", type: "number" },
        ],
        rows,
      };
    }

    case "leave-register": {
      const apps = await LeaveApplication.find({ businessId: ctx.businessId, fromDate: { $gte: new Date(Date.UTC(year, 0, 1)), $lte: new Date(Date.UTC(year, 11, 31)) } })
        .sort({ fromDate: 1 })
        .lean<AnyDoc[]>();
      const [labels, types] = await Promise.all([employeeLabels(ctx.businessId, apps.map((a) => a.employeeId)), LeaveType.find({ businessId: ctx.businessId }, { code: 1, name: 1 }).lean<AnyDoc[]>()]);
      const tmap = new Map(types.map((t) => [String(t._id), `${t.code} · ${t.name}`]));
      const rows = apps.map((a) => ({
        leaveNumber: a.leaveNumber,
        employeeCode: labels.get(String(a.employeeId))?.code ?? "",
        name: labels.get(String(a.employeeId))?.name ?? "",
        leaveType: tmap.get(String(a.leaveTypeId)) ?? "",
        fromDate: fmtDate(a.fromDate),
        toDate: fmtDate(a.toDate),
        days: a.days,
        status: a.status,
        reason: a.reason ?? "",
      }));
      return {
        title: `Leave Register ${year}`,
        columns: [
          { key: "leaveNumber", label: "Request" },
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "leaveType", label: "Leave type" },
          { key: "fromDate", label: "From", type: "date" },
          { key: "toDate", label: "To", type: "date" },
          { key: "days", label: "Days", type: "number" },
          { key: "status", label: "Status" },
          { key: "reason", label: "Reason" },
        ],
        rows,
      };
    }

    case "salary-register": {
      const { run, slips } = await liveRun(ctx, year, month);
      const rows = slips.map((s) => ({
        employeeCode: s.employee?.code ?? "",
        name: s.employee?.name ?? "",
        department: s.employee?.department ?? "",
        payableDays: s.payableDays,
        lopDays: s.lopDays,
        basic: money(lineAmount(s.earnings, "BASIC")),
        hra: money(lineAmount(s.earnings, "HRA")),
        allowances: money(lineAmount(s.earnings, "CONV").plus(lineAmount(s.earnings, "SPECIAL")).plus(lineAmount(s.earnings, "OTHER"))),
        gross: money(s.grossEarnings),
        reimbursements: money(s.reimbursements),
        pf: money(lineAmount(s.deductions, "PF")),
        esi: money(lineAmount(s.deductions, "ESI")),
        pt: money(lineAmount(s.deductions, "PT")),
        tds: money(lineAmount(s.deductions, "TDS")),
        loan: money(lineAmount(s.deductions, "LOAN")),
        deductions: money(s.totalDeductions),
        net: money(s.netPay),
      }));
      const moneyKeys = ["basic", "hra", "allowances", "gross", "reimbursements", "pf", "esi", "pt", "tds", "loan", "deductions", "net"];
      return {
        title: `Salary Register ${monthLabel(month, year)}`,
        filterNote: `${run.runNumber} · ${String(run.status).toLowerCase()}`,
        columns: [
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "department", label: "Department" },
          { key: "payableDays", label: "Paid days", type: "number" },
          { key: "lopDays", label: "LOP", type: "number" },
          { key: "basic", label: "Basic", type: "money" },
          { key: "hra", label: "HRA", type: "money" },
          { key: "allowances", label: "Allowances", type: "money" },
          { key: "gross", label: "Gross", type: "money" },
          { key: "reimbursements", label: "Reimb.", type: "money" },
          { key: "pf", label: "PF", type: "money" },
          { key: "esi", label: "ESI", type: "money" },
          { key: "pt", label: "PT", type: "money" },
          { key: "tds", label: "TDS", type: "money" },
          { key: "loan", label: "Loan", type: "money" },
          { key: "deductions", label: "Deductions", type: "money" },
          { key: "net", label: "Net pay", type: "money" },
        ],
        rows,
        totals: sumColumns(rows, moneyKeys),
        summary: [
          { label: "Employees", value: String(rows.length) },
          { label: "Net payable", value: money(run.totalNet) },
          { label: "Employer contribution", value: money(run.totalEmployerContribution) },
        ],
      };
    }

    case "pf-statement": {
      const { slips } = await liveRun(ctx, year, month);
      const rows = slips
        .filter((s) => lineAmount(s.deductions, "PF").gt(0))
        .map((s) => {
          const epfWages = d(s.pfWages);
          const epsWages = Decimal.min(epfWages, 15000);
          const ee = lineAmount(s.deductions, "PF");
          const eps = epsWages.times("0.0833").toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
          return {
            uan: s.employee?.uanNumber ?? "",
            name: s.employee?.name ?? "",
            grossWages: money(s.grossEarnings),
            epfWages: money(epfWages),
            epsWages: money(epsWages),
            edliWages: money(epsWages),
            eeShare: money(ee),
            epsShare: money(eps),
            erShare: money(ee.minus(eps)),
            ncpDays: s.lopDays,
          };
        });
      return {
        title: `PF Statement ${monthLabel(month, year)}`,
        filterNote: "Columns follow the EPFO ECR upload: EPS is 8.33% of wages up to ₹15,000, the employer's EPF share is the rest of 12%.",
        columns: [
          { key: "uan", label: "UAN" },
          { key: "name", label: "Member name" },
          { key: "grossWages", label: "Gross wages", type: "money" },
          { key: "epfWages", label: "EPF wages", type: "money" },
          { key: "epsWages", label: "EPS wages", type: "money" },
          { key: "edliWages", label: "EDLI wages", type: "money" },
          { key: "eeShare", label: "EPF contribution (EE)", type: "money" },
          { key: "epsShare", label: "EPS contribution", type: "money" },
          { key: "erShare", label: "EPF diff (ER)", type: "money" },
          { key: "ncpDays", label: "NCP days", type: "number" },
        ],
        rows,
        totals: sumColumns(rows, ["grossWages", "epfWages", "epsWages", "edliWages", "eeShare", "epsShare", "erShare"]),
      };
    }

    case "esi-statement": {
      const { slips } = await liveRun(ctx, year, month);
      const rows = slips
        .filter((s) => lineAmount(s.deductions, "ESI").gt(0))
        .map((s) => ({
          esiNumber: s.employee?.esiNumber ?? "",
          name: s.employee?.name ?? "",
          payableDays: s.payableDays,
          esiWages: money(s.esiWages),
          employee: money(lineAmount(s.deductions, "ESI")),
          employer: money(lineAmount(s.employerContributions, "ESI_ER")),
        }));
      return {
        title: `ESI Statement ${monthLabel(month, year)}`,
        columns: [
          { key: "esiNumber", label: "IP number" },
          { key: "name", label: "IP name" },
          { key: "payableDays", label: "Days paid", type: "number" },
          { key: "esiWages", label: "Total wages", type: "money" },
          { key: "employee", label: "Employee 0.75%", type: "money" },
          { key: "employer", label: "Employer 3.25%", type: "money" },
        ],
        rows,
        totals: sumColumns(rows, ["esiWages", "employee", "employer"]),
      };
    }

    case "bank-transfer": {
      const { run, slips } = await liveRun(ctx, year, month);
      const rows = slips
        .filter((s) => (s.employee?.paymentMode ?? "BANK") === "BANK" && d(s.netPay).gt(0))
        .map((s) => ({
          employeeCode: s.employee?.code ?? "",
          name: s.employee?.name ?? "",
          bankName: s.employee?.bankName ?? "",
          accountNumber: s.employee?.bankAccountNumber ?? "",
          ifsc: s.employee?.ifscCode ?? "",
          amount: money(s.netPay),
          narration: `Salary ${monthLabel(month, year)}`,
        }));
      const other = slips.filter((s) => (s.employee?.paymentMode ?? "BANK") !== "BANK");
      return {
        title: `Bank Transfer ${monthLabel(month, year)}`,
        filterNote: `${run.runNumber}. ${other.length} employee(s) paid by cash or cheque are not listed.`,
        columns: [
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Beneficiary" },
          { key: "bankName", label: "Bank" },
          { key: "accountNumber", label: "Account number" },
          { key: "ifsc", label: "IFSC" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "narration", label: "Narration" },
        ],
        rows,
        totals: sumColumns(rows, ["amount"]),
      };
    }

    case "loans-outstanding": {
      const loans = await EmployeeLoan.find({ businessId: ctx.businessId, status: "ACTIVE" }).sort({ issueDate: 1 }).lean<AnyDoc[]>();
      const labels = await employeeLabels(ctx.businessId, loans.map((l) => l.employeeId));
      const rows = loans.map((l) => ({
        loanNumber: l.loanNumber,
        employeeCode: labels.get(String(l.employeeId))?.code ?? "",
        name: labels.get(String(l.employeeId))?.name ?? "",
        loanType: l.loanType,
        issueDate: fmtDate(l.issueDate),
        amount: money(l.amount),
        emiAmount: money(l.emiAmount),
        repaid: money(l.repaidAmount),
        outstanding: d(l.amount).minus(d(l.repaidAmount)).toFixed(2),
      }));
      return {
        title: "Loans Outstanding",
        columns: [
          { key: "loanNumber", label: "Loan" },
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "loanType", label: "Type" },
          { key: "issueDate", label: "Issued", type: "date" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "emiAmount", label: "Instalment", type: "money" },
          { key: "repaid", label: "Recovered", type: "money" },
          { key: "outstanding", label: "Outstanding", type: "money" },
        ],
        rows,
        totals: sumColumns(rows, ["amount", "repaid", "outstanding"]),
      };
    }

    case "exits": {
      const emps = await Employee.find({ businessId: ctx.businessId, deletedAt: null, dateOfExit: { $gte: new Date(Date.UTC(year, 0, 1)), $lte: new Date(Date.UTC(year, 11, 31)) } })
        .sort({ dateOfExit: 1 })
        .lean<AnyDoc[]>();
      const labels = await employeeLabels(ctx.businessId, emps.map((e) => e._id));
      const headcount = await Employee.countDocuments({ businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: WORKING_STATUSES } });
      const rows = emps.map((e) => ({
        employeeCode: e.employeeCode,
        name: e.name,
        department: labels.get(String(e._id))?.department ?? "",
        dateOfJoining: fmtDate(e.dateOfJoining),
        dateOfExit: fmtDate(e.dateOfExit),
        employmentStatus: e.employmentStatus,
        exitReason: e.exitReason ?? "",
      }));
      const rate = headcount + rows.length > 0 ? ((rows.length / ((headcount + rows.length) || 1)) * 100).toFixed(1) : "0.0";
      return {
        title: `Exits ${year}`,
        columns: [
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "department", label: "Department" },
          { key: "dateOfJoining", label: "Joined", type: "date" },
          { key: "dateOfExit", label: "Last day", type: "date" },
          { key: "employmentStatus", label: "Status" },
          { key: "exitReason", label: "Reason" },
        ],
        rows,
        summary: [
          { label: "Exits", value: String(rows.length) },
          { label: "Attrition (approx.)", value: `${rate}%` },
        ],
      };
    }

    default:
      throw AppError.notFound("Report not found");
  }
}
