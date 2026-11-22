import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789-0123456789-0123456789";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789-0123456789-0123456789";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
  process.env.MONGODB_URI = replSet.getUri("hrms-test");
  await mongoose.connect(process.env.MONGODB_URI);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;

describe("HRMS sold from the admin portal (real replica set, real transactions)", () => {
  const owner = { email: "owner@peoplefirst.test", password: "Str0ng!Passw0rd" };
  let businessId: string;
  let ctx: Ctx;
  const emp: Record<string, Types.ObjectId> = {};

  it("provisions an active HRMS workspace with the HR starter setup", async () => {
    const { provisionWorkspace } = await import("@/lib/services/provisioningService");
    const { Business } = await import("@/models/Business");
    const { Role } = await import("@/models/Role");
    const { Shift, LeaveType, HrDepartment, Designation } = await import("@/models/hr");

    const res = await provisionWorkspace({
      legalName: "People First Services LLP",
      ownerName: "Meera Iyer",
      email: owner.email,
      password: owner.password,
      country: "India",
      currency: "INR",
      timeZone: "Asia/Kolkata",
      financialYearStartMonth: 4,
      products: ["HRMS"],
      plan: "STARTER",
      maxEmployees: 3,
      subscriptionEndsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    });
    businessId = res.businessId;

    const b = await Business.findById(businessId).lean<{ status: string; products: string[]; maxEmployees: number; provisionedBy: string }>();
    expect(b?.status).toBe("ACTIVE");
    expect(b?.products).toEqual(["HRMS"]);
    expect(b?.maxEmployees).toBe(3);
    expect(b?.provisionedBy).toBe("SUPERADMIN");

    expect(await Shift.countDocuments({ businessId })).toBe(1);
    expect((await LeaveType.find({ businessId }).lean<{ code: string }[]>()).map((l) => l.code).sort()).toEqual(["CL", "EL", "LOP", "SL"]);
    expect(await HrDepartment.countDocuments({ businessId })).toBeGreaterThan(0);
    expect(await Designation.countDocuments({ businessId })).toBeGreaterThan(0);
    const roles = (await Role.find({ businessId }).lean<{ name: string }[]>()).map((r) => r.name).sort();
    expect(roles).toEqual(["Employee (Self Service)", "HR Manager", "Owner"]);
  });

  it("signs the owner in with an HRMS-only token that cannot reach ERP", async () => {
    const { login } = await import("@/lib/services/authService");
    const { verifyAccessToken } = await import("@/lib/auth/tokens");
    const { requirePermission } = await import("@/lib/auth/context");

    const res = await login({ email: owner.email, password: owner.password } as never, {});
    const payload = verifyAccessToken(res.accessToken);
    expect(payload.products).toEqual(["HRMS"]);

    ctx = {
      userId: new Types.ObjectId(payload.sub),
      businessId: new Types.ObjectId(payload.businessId),
      roleId: new Types.ObjectId(payload.roleId),
      permissions: payload.permissions,
      branchIds: [],
      warehouseIds: [],
      products: payload.products,
    };
    expect(() => requirePermission(ctx, "hr-payroll.approve")).not.toThrow();
    expect(() => requirePermission(ctx, "users.create")).not.toThrow();
    expect(() => requirePermission(ctx, "sales-invoices.view")).toThrow(/does not include ERP/);
  });

  it("refuses sign-in once the subscription lapses or the workspace is suspended", async () => {
    const { login } = await import("@/lib/services/authService");
    const { Business } = await import("@/models/Business");

    await Business.updateOne({ _id: businessId }, { subscriptionEndsAt: new Date(Date.now() - 1000) });
    await expect(login({ email: owner.email, password: owner.password } as never, {})).rejects.toMatchObject({ code: "SUBSCRIPTION_EXPIRED" });

    await Business.updateOne({ _id: businessId }, { subscriptionEndsAt: null, status: "SUSPENDED" });
    await expect(login({ email: owner.email, password: owner.password } as never, {})).rejects.toMatchObject({ statusCode: 401 });

    await Business.updateOne({ _id: businessId }, { status: "ACTIVE" });
  });

  it("enforces the employee limit of the plan", async () => {
    const { Employee } = await import("@/models/hr");
    const { assertEmployeeSeats } = await import("@/lib/resources/hrRegistry");
    const bId = new Types.ObjectId(businessId);
    const base = { businessId: bId, dateOfJoining: new Date("2026-09-01"), employmentStatus: "CONFIRMED", pfApplicable: true, ptApplicable: true };

    emp.asha = (await Employee.create({ ...base, employeeCode: "EMP-000001", name: "Asha Rao", basic: "15000", hra: "5000", professionalTax: "200" }))._id;
    emp.ravi = (await Employee.create({ ...base, employeeCode: "EMP-000002", name: "Ravi Kumar", basic: "12000", bankAccountNumber: "1234567890", ifscCode: "HDFC0001234" }))._id;
    emp.neha = (await Employee.create({ ...base, employeeCode: "EMP-000003", name: "Neha Shah", basic: "10000" }))._id;

    await expect(assertEmployeeSeats(bId, 1)).rejects.toMatchObject({ code: "EMPLOYEE_LIMIT_REACHED" });
    await Employee.updateOne({ _id: emp.neha }, { employmentStatus: "RESIGNED", dateOfExit: new Date("2026-08-31") });
    await expect(assertEmployeeSeats(bId, 1)).resolves.toBeUndefined();
  });

  it("approving leave marks the days on the attendance sheet and uses up the balance", async () => {
    const { applyLeave, approveLeave, balancesFor } = await import("@/lib/hr/leave");
    const { Attendance, LeaveType } = await import("@/models/hr");
    const cl = await LeaveType.findOne({ businessId, code: "CL" }).lean<{ _id: Types.ObjectId }>();
    const lop = await LeaveType.findOne({ businessId, code: "LOP" }).lean<{ _id: Types.ObjectId }>();

    // Tue 6 and Wed 7 October 2026.
    const a = await applyLeave(ctx, { employeeId: String(emp.asha), leaveTypeId: String(cl!._id), fromDate: "2026-10-06", toDate: "2026-10-07", halfDay: false, reason: "Family function" }, { self: false });
    expect(a.days).toBe(2);
    await expect(
      applyLeave(ctx, { employeeId: String(emp.asha), leaveTypeId: String(cl!._id), fromDate: "2026-10-07", toDate: "2026-10-07", halfDay: false, reason: "" }, { self: false })
    ).rejects.toMatchObject({ code: "LEAVE_OVERLAP" });
    await approveLeave(ctx, a.id, "");

    const b = await applyLeave(ctx, { employeeId: String(emp.asha), leaveTypeId: String(lop!._id), fromDate: "2026-10-08", toDate: "2026-10-08", halfDay: false, reason: "" }, { self: false });
    await approveLeave(ctx, b.id, "");

    const rows = await Attendance.find({ businessId, employeeId: emp.asha }).sort({ date: 1 }).lean<{ status: string; leaveIsPaid: boolean }[]>();
    expect(rows.map((r) => [r.status, r.leaveIsPaid])).toEqual([
      ["LEAVE", true],
      ["LEAVE", true],
      ["LEAVE", false],
    ]);

    const balance = (await balancesFor(new Types.ObjectId(businessId), [emp.asha], 2026)).get(String(emp.asha))!;
    // Joined 1 September: 4 of 12 months left, so CL is pro-rated to 4 days.
    expect(balance.find((x) => x.code === "CL")).toMatchObject({ allocated: 4, prorated: true, used: 2, available: 2 });
  });

  it("lets an employee with portal access check in and out", async () => {
    const { grantPortalAccess } = await import("@/lib/hr/people");
    const { punch } = await import("@/lib/hr/attendance");
    const { login } = await import("@/lib/services/authService");
    const { verifyAccessToken } = await import("@/lib/auth/tokens");

    await grantPortalAccess(ctx, String(emp.ravi), { email: "ravi@peoplefirst.test", password: "Welc0me!2026" });
    const res = await login({ email: "ravi@peoplefirst.test", password: "Welc0me!2026" } as never, {});
    const p = verifyAccessToken(res.accessToken);
    expect(p.permissions).toEqual(["hr-self.view"]);
    const self = { ...ctx, userId: new Types.ObjectId(p.sub), roleId: new Types.ObjectId(p.roleId), permissions: p.permissions };

    expect((await punch(self)).action).toBe("CHECK_IN");
    expect((await punch(self)).action).toBe("CHECK_OUT");
    await expect(punch(self)).rejects.toMatchObject({ code: "ALREADY_CHECKED_OUT" });
  });

  let runId: string;

  it("drafts October payroll with loss-of-pay, PF, PT, a loan instalment and a reimbursement", async () => {
    const { saveDailySheet } = await import("@/lib/hr/attendance");
    const { createLoan, createClaim, decideClaim } = await import("@/lib/hr/money");
    const { createRun, getRun } = await import("@/lib/hr/payroll");

    await saveDailySheet(ctx, { date: "2026-10-09", rows: [{ employeeId: String(emp.asha), status: "ABSENT", checkIn: "", checkOut: "", notes: "" }] });
    await createLoan(ctx, { employeeId: String(emp.asha), loanType: "ADVANCE", issueDate: "2026-09-20", amount: "3000", emiAmount: "1000", startMonth: 10, startYear: 2026, reason: "" });
    const claim = await createClaim(ctx, { employeeId: String(emp.asha), claimDate: "2026-10-15", category: "TRAVEL", amount: "500", description: "Client visit cab", billReference: "" }, { self: false });
    await decideClaim(ctx, claim.id, "APPROVED", "");

    const run = await createRun(ctx, { month: 10, year: 2026, notes: "" });
    runId = run.id;
    expect(run.payslips).toBe(2); // Neha left in August

    const view = await getRun(ctx, runId);
    const asha = view.payslips.find((s) => s.employeeId === String(emp.asha))!;
    // 31 days, 2 lost (1 unpaid leave + 1 absent): basic 15000 Ã— 29/31 = 14032.26, HRA 5000 Ã— 29/31 = 4677.42.
    expect(asha.lopDays).toBe(2);
    expect(asha.payableDays).toBe(29);
    expect(asha.grossEarnings).toBe("18709.68");
    expect(asha.deductions.find((d) => d.code === "PF")?.amount).toBe("1684.00");
    expect(asha.deductions.find((d) => d.code === "PT")?.amount).toBe("200.00");
    expect(asha.deductions.find((d) => d.code === "LOAN")?.amount).toBe("1000.00");
    expect(asha.reimbursements).toBe("500.00");
    expect(asha.netPay).toBe("16325.68");

    await expect(createRun(ctx, { month: 10, year: 2026, notes: "" })).rejects.toMatchObject({ code: "PAYROLL_EXISTS" });
  });

  it("approving locks the month and records recoveries; cancelling reverses them", async () => {
    const { approveRun, cancelRun, recomputeRun, payrollReadiness } = await import("@/lib/hr/payroll");
    const { saveDailySheet } = await import("@/lib/hr/attendance");
    const { EmployeeLoan, ExpenseClaim, PayrollRun } = await import("@/models/hr");

    // Most of October has no attendance, so approval waits for an explicit decision.
    await expect(approveRun(ctx, runId)).rejects.toMatchObject({ code: "UNMARKED_ATTENDANCE", statusCode: 400 });

    // Attendance marked after the draft was calculated: the payslips are stale until recalculated.
    await saveDailySheet(ctx, { date: "2026-10-12", rows: [{ employeeId: String(emp.asha), status: "PRESENT", checkIn: "", checkOut: "", notes: "" }] });
    await expect(approveRun(ctx, runId, { payUnmarkedAsPresent: true })).rejects.toMatchObject({ code: "PAYROLL_STALE", statusCode: 409 });
    await recomputeRun(ctx, runId);

    const ready = await payrollReadiness(ctx, 2026, 10);
    expect(ready.unmarked.map((u) => u.name).sort()).toEqual(["Asha Rao", "Ravi Kumar"].sort());
    const approved = await approveRun(ctx, runId, { payUnmarkedAsPresent: true });
    expect(approved.unmarkedDaysPaid).toBe(ready.unmarkedDays);
    expect((await PayrollRun.findById(runId).lean<{ unmarkedDaysPaid: number }>())?.unmarkedDaysPaid).toBe(ready.unmarkedDays);
    const loan = await EmployeeLoan.findOne({ businessId, employeeId: emp.asha }).lean<{ repaidAmount: unknown; status: string }>();
    expect(String(loan?.repaidAmount)).toBe("1000.00");
    expect((await ExpenseClaim.findOne({ businessId, employeeId: emp.asha }).lean<{ status: string }>())?.status).toBe("REIMBURSED");
    await expect(
      saveDailySheet(ctx, { date: "2026-10-20", rows: [{ employeeId: String(emp.asha), status: "ABSENT", checkIn: "", checkOut: "", notes: "" }] })
    ).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });

    await cancelRun(ctx, runId, "Wrong TDS");
    const after = await EmployeeLoan.findOne({ businessId, employeeId: emp.asha }).lean<{ repaidAmount: unknown; status: string; repayments: unknown[] }>();
    expect(String(after?.repaidAmount)).toBe("0.00");
    expect(after?.repayments).toHaveLength(0);
    expect((await ExpenseClaim.findOne({ businessId, employeeId: emp.asha }).lean<{ status: string }>())?.status).toBe("APPROVED");
  });

  it("shows an employee only their own approved payslips", async () => {
    const { createRun, approveRun, getPayslip, myPayslips } = await import("@/lib/hr/payroll");
    const { User } = await import("@/models/User");
    const { Payslip } = await import("@/models/hr");

    const run = await createRun(ctx, { month: 10, year: 2026, notes: "" });
    const ravi = await User.findOne({ businessId, email: "ravi@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    const self = { ...ctx, userId: ravi!._id, roleId: ravi!.roleId, permissions: ["hr-self.view"] };
    const raviSlip = await Payslip.findOne({ businessId, payrollRunId: run.id, employeeId: emp.ravi }).lean<{ _id: Types.ObjectId }>();
    const ashaSlip = await Payslip.findOne({ businessId, payrollRunId: run.id, employeeId: emp.asha }).lean<{ _id: Types.ObjectId }>();

    // Draft payslips are not visible to employees yet.
    await expect(getPayslip(self, String(raviSlip!._id), { self: true })).rejects.toMatchObject({ statusCode: 404 });
    await approveRun(ctx, run.id, { payUnmarkedAsPresent: true });

    const mine = await getPayslip(self, String(raviSlip!._id), { self: true });
    expect(mine.employee).toMatchObject({ name: "Ravi Kumar" });
    expect(mine.netPayInWords).toMatch(/Rupees/i);
    await expect(getPayslip(self, String(ashaSlip!._id), { self: true })).rejects.toMatchObject({ statusCode: 404 });
    expect((await myPayslips(self)).items).toHaveLength(1);

    // The whole run prints as one PDF, a page per employee.
    const { runPayslipsForPrint } = await import("@/lib/hr/payroll");
    const { renderPayslipsPdf } = await import("@/lib/hr/payslipPdf");
    const { PDFDocument } = await import("pdf-lib");
    const printable = await runPayslipsForPrint(ctx, run.id);
    expect(printable.slips.map((s) => s.employee.name)).toEqual(["Asha Rao", "Ravi Kumar"]);
    expect((await PDFDocument.load(await renderPayslipsPdf(printable.slips, printable.period))).getPageCount()).toBe(2);
  });

  it("lets a reporting manager decide only their own team's leave", async () => {
    const { applyLeave, listTeamLeaves, decideTeamLeave, directReports } = await import("@/lib/hr/leave");
    const { Employee, LeaveType, LeaveApplication, Attendance } = await import("@/models/hr");
    const { User } = await import("@/models/User");
    const cl = await LeaveType.findOne({ businessId, code: "CL" }).lean<{ _id: Types.ObjectId }>();
    const ravi = await User.findOne({ businessId, email: "ravi@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    const raviSelf = { ...ctx, userId: ravi!._id, roleId: ravi!.roleId, permissions: ["hr-self.view"] };

    // Nobody reports to Ravi yet.
    await expect(listTeamLeaves(raviSelf, { page: 1, pageSize: 25 } as never)).rejects.toMatchObject({ code: "NOT_A_MANAGER" });

    await Employee.updateOne({ _id: emp.asha }, { reportingManagerId: emp.ravi });
    expect((await directReports(raviSelf)).map((e) => e.name)).toEqual(["Asha Rao"]);

    // Mon 7 and Tue 8 December 2026: Asha's request goes to Ravi.
    const req = await applyLeave(ctx, { employeeId: String(emp.asha), leaveTypeId: String(cl!._id), fromDate: "2026-12-07", toDate: "2026-12-08", halfDay: false, reason: "Wedding" }, { self: false });
    // Ravi's own request is not his to decide.
    const own = await applyLeave(ctx, { employeeId: String(emp.ravi), leaveTypeId: String(cl!._id), fromDate: "2026-12-09", toDate: "2026-12-09", halfDay: false, reason: "" }, { self: false });

    const team = await listTeamLeaves(raviSelf, { status: "PENDING", page: 1, pageSize: 25 } as never);
    expect(team.items.map((r) => r.leaveNumber)).toEqual([req.leaveNumber]);
    expect(team.pending).toBe(1);
    expect(team.teamSize).toBe(1);

    await expect(decideTeamLeave(raviSelf, own.id, "approve", "")).rejects.toMatchObject({ statusCode: 404 });
    await expect(decideTeamLeave(raviSelf, req.id, "reject", "  ")).rejects.toMatchObject({ code: "REASON_REQUIRED" });

    await decideTeamLeave(raviSelf, req.id, "approve", "Enjoy");
    const decided = await LeaveApplication.findById(req.id).lean<{ status: string; decidedAs: string; decidedByUserId: Types.ObjectId }>();
    expect(decided).toMatchObject({ status: "APPROVED", decidedAs: "MANAGER" });
    expect(String(decided!.decidedByUserId)).toBe(String(ravi!._id));
    expect(await Attendance.countDocuments({ businessId, employeeId: emp.asha, leaveApplicationId: new Types.ObjectId(req.id) })).toBe(2);
    await expect(decideTeamLeave(raviSelf, req.id, "reject", "Changed my mind")).rejects.toMatchObject({ code: "LEAVE_NOT_PENDING" });
  });

  it("routes attendance correction requests to the reporting manager or HR", async () => {
    const { grantPortalAccess } = await import("@/lib/hr/people");
    const { applyLeave, approveLeave } = await import("@/lib/hr/leave");
    const { requestCorrection, listTeamCorrections, decideTeamCorrection, rejectCorrection, withdrawCorrection, listMyCorrections } = await import("@/lib/hr/corrections");
    const { Attendance, AttendanceRequest, LeaveType } = await import("@/models/hr");
    const { User } = await import("@/models/User");

    // Asha (who reports to Ravi since the previous test) gets a login of her own.
    await grantPortalAccess(ctx, String(emp.asha), { email: "asha@peoplefirst.test", password: "Welc0me!2026" });
    const ashaUser = await User.findOne({ businessId, email: "asha@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    const raviUser = await User.findOne({ businessId, email: "ravi@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    const asha = { ...ctx, userId: ashaUser!._id, roleId: ashaUser!.roleId, permissions: ["hr-self.view"] };
    const ravi = { ...ctx, userId: raviUser!._id, roleId: raviUser!.roleId, permissions: ["hr-self.view"] };
    const base = { status: "PRESENT" as const, checkIn: "09:30", checkOut: "18:30", reason: "Forgot to punch" };

    await expect(requestCorrection(asha, { ...base, date: "2099-01-05" })).rejects.toMatchObject({ code: "FUTURE_DATE" });
    // October's payroll is approved, so its attendance is locked.
    await expect(requestCorrection(asha, { ...base, date: "2026-10-20" })).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
    // Approved leave is changed by cancelling the leave, not by a correction.
    const lop = await LeaveType.findOne({ businessId, code: "LOP" }).lean<{ _id: Types.ObjectId }>();
    const leave = await applyLeave(ctx, { employeeId: String(emp.asha), leaveTypeId: String(lop!._id), fromDate: "2026-11-16", toDate: "2026-11-16", halfDay: false, reason: "" }, { self: false });
    await approveLeave(ctx, leave.id, "");
    await expect(requestCorrection(asha, { ...base, date: "2026-11-16" })).rejects.toMatchObject({ code: "ON_LEAVE" });

    // Tue 17 November: a forgotten punch, approved by her manager.
    const first = await requestCorrection(asha, { ...base, date: "2026-11-17" });
    await expect(requestCorrection(asha, { ...base, date: "2026-11-17", reason: "Again" })).rejects.toMatchObject({ code: "CORRECTION_PENDING" });

    const team = await listTeamCorrections(ravi, { status: "PENDING", page: 1, pageSize: 25 });
    expect(team.items.map((r) => r.requestNumber)).toEqual([first.requestNumber]);
    expect(team.items[0].previous.status).toBe("");
    await expect(decideTeamCorrection(ravi, first.id, "reject", "")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await decideTeamCorrection(ravi, first.id, "approve", "");

    const day = await Attendance.findOne({ businessId, employeeId: emp.asha, date: new Date("2026-11-17T00:00:00Z") }).lean<{ status: string; source: string; workedMinutes: number; checkIn: string }>();
    expect(day).toMatchObject({ status: "PRESENT", source: "REQUEST", checkIn: "09:30", workedMinutes: 540 });
    expect((await AttendanceRequest.findById(first.id).lean<{ status: string; decidedAs: string }>())).toMatchObject({ status: "APPROVED", decidedAs: "MANAGER" });
    await expect(decideTeamCorrection(ravi, first.id, "approve", "")).rejects.toMatchObject({ code: "CORRECTION_NOT_PENDING" });

    // HR can decide any request; a rejection needs a reason.
    const second = await requestCorrection(asha, { ...base, status: "ON_DUTY", checkIn: "", checkOut: "", date: "2026-11-18", reason: "Client site visit" });
    await rejectCorrection(ctx, second.id, "No visit report");
    expect((await AttendanceRequest.findById(second.id).lean<{ status: string; decidedAs: string }>())).toMatchObject({ status: "REJECTED", decidedAs: "HR" });

    // Only the employee can withdraw their own pending request, and a manager outside the team sees nothing.
    const third = await requestCorrection(asha, { ...base, date: "2026-11-19" });
    await expect(withdrawCorrection(ravi, third.id)).rejects.toMatchObject({ statusCode: 404 });
    await withdrawCorrection(asha, third.id);
    await expect(listTeamCorrections(asha, { page: 1, pageSize: 25 })).rejects.toMatchObject({ code: "NOT_A_MANAGER" });

    const mine = await listMyCorrections(asha, { page: 1, pageSize: 25 });
    expect(mine.items.map((r) => r.status).sort()).toEqual(["APPROVED", "CANCELLED", "REJECTED"]);
  });

  it("carries unused leave into the next year up to the leave type's limit", async () => {
    const { carryForwardLeave, balancesFor, setAllocation } = await import("@/lib/hr/leave");
    const { LeaveType } = await import("@/models/hr");
    const el = await LeaveType.findOne({ businessId, code: "EL" }).lean<{ _id: Types.ObjectId }>();
    const bId = new Types.ObjectId(businessId);
    const elOf = async (empId: Types.ObjectId, year: number) => (await balancesFor(bId, [empId], year)).get(String(empId))!.find((b) => b.code === "EL")!;

    // Joined 1 September 2026: EL 15 a year, pro-rated to 5 for 2026; nothing used.
    expect(await elOf(emp.asha, 2026)).toMatchObject({ allocated: 5, prorated: true, available: 5 });

    const preview = await carryForwardLeave(ctx, { fromYear: 2026, commit: false });
    expect(preview.committed).toBe(false);
    expect(preview.rows.filter((r) => r.code === "EL").map((r) => [r.name, r.unused, r.carried])).toEqual([
      ["Asha Rao", 5, 5],
      ["Ravi Kumar", 5, 5],
    ]);
    expect(preview.rows.some((r) => r.code === "CL")).toBe(false); // CL does not carry forward
    expect((await elOf(emp.asha, 2027)).carriedForward).toBe(0); // a preview writes nothing

    await carryForwardLeave(ctx, { fromYear: 2026, commit: true });
    // 2027 is a full year: 15 granted + 5 carried.
    expect(await elOf(emp.asha, 2027)).toMatchObject({ allocated: 15, prorated: false, carriedForward: 5, available: 20 });

    // A lower limit is applied when it runs again, and a grant set by hand for 2027 is kept.
    await LeaveType.updateOne({ _id: el!._id }, { maxCarryForward: 3 });
    await setAllocation(ctx, { employeeId: String(emp.ravi), leaveTypeId: String(el!._id), year: 2027, allocated: 10, carriedForward: 5, notes: "" });
    const again = await carryForwardLeave(ctx, { fromYear: 2026, commit: true });
    expect(again.totals).toEqual({ carried: 6, lapsed: 4 });
    expect(await elOf(emp.asha, 2027)).toMatchObject({ carriedForward: 3, available: 18 });
    expect(await elOf(emp.ravi, 2027)).toMatchObject({ allocated: 10, carriedForward: 3 });
  });

  it("keeps dated job and salary history and pays a mid-month revision day by day", async () => {
    const { recordChange, deleteChange, employmentHistory, applyDueChanges, recordFormWrite } = await import("@/lib/hr/history");
    const { createRun, getRun, cancelRun } = await import("@/lib/hr/payroll");
    const { Employee, EmploymentChange, Designation, Payslip } = await import("@/models/hr");
    const bId = new Types.ObjectId(businessId);
    const basicOf = async (id: Types.ObjectId) => String((await Employee.findById(id).lean<{ basic: unknown }>())!.basic);

    // A raise from Mon 16 November 2026 (already in effect today): the record updates, history starts at joining.
    const raise = await recordChange(ctx, String(emp.asha), { changeType: "SALARY_REVISION", effectiveDate: "2026-11-16", reason: "Appraisal", changes: { basic: "18000" } });
    expect(raise).toMatchObject({ changedFields: ["basic"], scheduled: false });
    expect(await basicOf(emp.asha)).toBe("18000.00");
    let history = await employmentHistory(ctx, String(emp.asha));
    expect(history.items.map((i) => i.changeType)).toEqual(["SALARY_REVISION", "JOINED"]);
    expect(history.items[0].changes).toEqual([{ field: "basic", label: "Basic", from: "15000.00", to: "18000.00", money: true }]);

    await expect(recordChange(ctx, String(emp.asha), { changeType: "SALARY_REVISION", effectiveDate: "2026-11-20", reason: "", changes: { basic: "18000" } })).rejects.toMatchObject({ code: "NOTHING_TO_CHANGE" });
    // October's payroll is approved: no changes inside it.
    await expect(recordChange(ctx, String(emp.asha), { changeType: "SALARY_REVISION", effectiveDate: "2026-10-20", reason: "", changes: { basic: "16000" } })).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });

    // November payroll: 15 days at 15,000 and 15 at 18,000 → basic 16,500 for the month.
    const nov = await createRun(ctx, { month: 11, year: 2026, notes: "" });
    const slip = (await getRun(ctx, nov.id)).payslips.find((s) => s.employeeId === String(emp.asha))!;
    expect(slip.salaryRevisedOn).toEqual(["2026-11-16"]);
    const stored = await Payslip.findById(slip.id).lean<{ structure: { basic: unknown } }>();
    expect(String(stored!.structure.basic)).toBe("16500.00");
    await cancelRun(ctx, nov.id, "Test run");

    // A promotion scheduled for January waits; a December HRA change made afterwards carries into it.
    const mgr = await Designation.findOne({ businessId, code: "MGR" }).lean<{ _id: Types.ObjectId }>();
    const promo = await recordChange(ctx, String(emp.asha), { changeType: "PROMOTION", effectiveDate: "2027-01-01", reason: "", changes: { designationId: String(mgr!._id), basic: "22000" } });
    expect(promo.scheduled).toBe(true);
    expect(String((await Employee.findById(emp.asha).lean<{ designationId: unknown }>())!.designationId)).not.toBe(String(mgr!._id));
    const hraChange = await recordChange(ctx, String(emp.asha), { changeType: "SALARY_REVISION", effectiveDate: "2026-12-01", reason: "", changes: { hra: "6000" } });
    const promoValues = async () => (await EmploymentChange.findById(promo.id).lean<{ values: { hra: unknown; basic: unknown } }>())!.values;
    expect(String((await promoValues()).hra)).toBe("6000.00");
    expect(String((await promoValues()).basic)).toBe("22000.00"); // its own change is kept

    // Removing the December change gives the promotion the earlier HRA back.
    await deleteChange(ctx, String(emp.asha), hraChange.id);
    expect(String((await promoValues()).hra)).toBe("5000.00");

    // When the promotion's day comes it is applied to the record.
    await EmploymentChange.updateOne({ _id: promo.id }, { effectiveDate: new Date("2026-11-21T00:00:00Z") });
    expect(await applyDueChanges(bId)).toBe(1);
    const promoted = await Employee.findById(emp.asha).lean<{ designationId: unknown; basic: unknown }>();
    expect(String(promoted!.designationId)).toBe(String(mgr!._id));
    expect(String(promoted!.basic)).toBe("22000.00");
    expect(await applyDueChanges(bId)).toBe(0);

    // An edit on the employee form is logged as a correction instead of overwriting silently.
    const before = await Employee.findById(emp.ravi);
    const after = await Employee.findByIdAndUpdate(emp.ravi, { basic: "13000" }, { new: true });
    await recordFormWrite(ctx, "UPDATE", after, before);
    history = await employmentHistory(ctx, String(emp.ravi));
    expect(history.items.map((i) => [i.changeType, i.changes.map((c) => `${c.from}->${c.to}`).join()])).toEqual([
      ["CORRECTION", "12000.00->13000.00"],
      ["JOINED", ""],
    ]);
  });
});
