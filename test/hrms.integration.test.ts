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
    // October's payroll is approved: other changes and salary cuts can't reach back into it.
    await expect(recordChange(ctx, String(emp.asha), { changeType: "TRANSFER", effectiveDate: "2026-10-20", reason: "", changes: { workLocation: "Pune" } })).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
    await expect(recordChange(ctx, String(emp.asha), { changeType: "SALARY_REVISION", effectiveDate: "2026-10-20", reason: "", changes: { basic: "14000" } })).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });

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

  it("adds variable pay to payroll, leaves held salaries out and imports amounts from a sheet", async () => {
    const { variableSheet, saveVariables, importVariables, variableTemplate } = await import("@/lib/hr/variables");
    const { blockPayroll, unblockPayroll, listHolds } = await import("@/lib/hr/holds");
    const { createRun, getRun, approveRun, recomputeRun, cancelRun, payrollReadiness } = await import("@/lib/hr/payroll");
    const period = { year: 2026, month: 12 };

    // The grid seeds the usual components on first use.
    const sheet = await variableSheet(ctx, { ...period });
    const comp = (code: string) => sheet.allComponents.find((c) => c.code === code)!.id;
    expect(sheet.allComponents.map((c) => c.code).sort()).toEqual(["ARREAR", "BONUS", "CANTEEN", "INCENTIVE", "OT", "OTHER_DED"]);
    expect(sheet.rows.map((r) => r.name)).toEqual(["Asha Rao", "Ravi Kumar"]);

    await saveVariables(ctx, {
      ...period,
      rows: [
        { employeeId: String(emp.asha), amounts: { [comp("BONUS")]: "2000", [comp("CANTEEN")]: "300" } },
        { employeeId: String(emp.ravi), amounts: { [comp("INCENTIVE")]: "1000" } },
      ],
    });
    expect((await variableSheet(ctx, { ...period })).rows.find((r) => r.name === "Asha Rao")!.amounts[comp("BONUS")]).toBe("2000.00");

    // Ravi's December salary is held: he is left out of the run.
    const hold = await blockPayroll(ctx, { ...period, employeeId: String(emp.ravi), reason: "Documents awaited" });
    await expect(blockPayroll(ctx, { ...period, employeeId: String(emp.ravi), reason: "Again" })).rejects.toMatchObject({ code: "ALREADY_HELD" });
    expect((await payrollReadiness(ctx, 2026, 12)).blocked.map((b) => b.name)).toEqual(["Ravi Kumar"]);

    const run = await createRun(ctx, { ...period, notes: "" });
    expect(run.payslips).toBe(1);
    const view = await getRun(ctx, run.id);
    expect(view.onHold.map((h) => h.name)).toEqual(["Ravi Kumar"]);
    const asha = view.payslips[0];
    expect(asha.earnings.find((l) => l.code === "BONUS")?.amount).toBe("2000.00");
    expect(asha.deductions.find((l) => l.code === "CANTEEN")?.amount).toBe("300.00");

    // Changing variable pay after the draft makes it stale until recalculated.
    await saveVariables(ctx, { ...period, rows: [{ employeeId: String(emp.asha), amounts: { [comp("BONUS")]: "2500" } }] });
    await expect(approveRun(ctx, run.id, { payUnmarkedAsPresent: true })).rejects.toMatchObject({ code: "PAYROLL_STALE" });
    await recomputeRun(ctx, run.id);
    await approveRun(ctx, run.id, { payUnmarkedAsPresent: true });
    expect((await getRun(ctx, run.id)).payslips[0].earnings.find((l) => l.code === "BONUS")?.amount).toBe("2500.00");

    // Once approved, holds and variable pay are locked until the payroll is rolled back.
    await expect(unblockPayroll(ctx, hold.id)).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
    await expect(saveVariables(ctx, { ...period, rows: [{ employeeId: String(emp.asha), amounts: { [comp("BONUS")]: "1" } }] })).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
    await cancelRun(ctx, run.id, "Roll back for test");
    await unblockPayroll(ctx, hold.id);
    expect((await listHolds(ctx, 2026, 12)).items).toHaveLength(0);

    // Import: unknown columns and employees are reported and nothing is saved; a clean sheet saves.
    const bad = await importVariables(ctx, { headers: ["Employee Code", "BONUS", "XYZ"], rows: [{ rowNumber: 2, cells: { "Employee Code": "EMP-999999", BONUS: "10", XYZ: "1" } }] }, 2026, 12, true);
    expect(bad.committed).toBe(false);
    expect(bad.errors.map((e) => e.message)).toEqual([expect.stringContaining("XYZ"), expect.stringContaining("EMP-999999")]);
    const good = await importVariables(
      ctx,
      { headers: ["Employee Code", "Employee Name", "OT"], rows: [{ rowNumber: 2, cells: { "Employee Code": "emp-000002", "Employee Name": "Ravi", OT: "1,250.50" } }] },
      2026,
      12,
      true
    );
    expect(good).toMatchObject({ committed: true, employees: 1, amounts: 1, errors: [] });
    expect((await variableSheet(ctx, { ...period })).rows.find((r) => r.name === "Ravi Kumar")!.amounts[comp("OT")]).toBe("1250.50");
    expect((await variableTemplate(ctx, 2026, 12)).length).toBeGreaterThan(1000);
  });

  it("posts payroll to the ERP ledger on approval, records the payment and reverses on rollback", async () => {
    const { createRun, approveRun, markRunPaid, cancelRun } = await import("@/lib/hr/payroll");
    const { payrollVouchers, postMissingPayrollVouchers } = await import("@/lib/hr/payrollPosting");
    const { ensureChartOfAccounts } = await import("@/lib/accounting/chartOfAccounts");
    const { Voucher } = await import("@/models/Voucher");
    const { Account } = await import("@/models/Account");
    const bId = new Types.ObjectId(businessId);
    // Collections and indexes exist before the first transactional write (as they do in a running database).
    await Promise.all([Voucher.init(), Account.init()]);

    // HRMS-only: nothing is posted, and the screen says why.
    expect((await payrollVouchers(ctx)).enabled).toBe(false);

    // The same workspace with ERP and a chart of accounts (an older chart: 5110 without its payroll role).
    const erp = { ...ctx, products: ["ERP", "HRMS"] as typeof ctx.products };
    await ensureChartOfAccounts(bId);
    await Account.updateOne({ businessId: bId, code: "5110" }, { systemRole: null });
    await ensureChartOfAccounts(bId);
    expect((await Account.findOne({ businessId: bId, code: "5110" }).lean<{ systemRole: string }>())!.systemRole).toBe("SALARY_EXPENSE");

    const jan = await createRun(erp, { month: 1, year: 2027, notes: "" });
    await approveRun(erp, jan.id, { payUnmarkedAsPresent: true });
    const accrual = await Voucher.findOne({ businessId: bId, sourceType: "PAYROLL_RUN", sourceId: jan.id }).lean<{ totalDebit: unknown; totalCredit: unknown; voucherDate: Date; status: string }>();
    expect(accrual).toBeTruthy();
    expect(String(accrual!.totalDebit)).toBe(String(accrual!.totalCredit));
    expect(accrual!.voucherDate.toISOString().slice(0, 10)).toBe("2027-01-31");

    await markRunPaid(erp, jan.id, { paidOn: "2027-02-01", reference: "UTR123" });
    const payment = await Voucher.findOne({ businessId: bId, sourceType: "PAYROLL_PAYMENT", sourceId: jan.id }).lean<{ voucherType: string }>();
    expect(payment?.voucherType).toBe("PAYMENT");
    const listed = (await payrollVouchers(erp)).items.find((i) => i.id === jan.id)!;
    expect(listed).toMatchObject({ missing: false });
    expect(listed.accrual?.number).toBeTruthy();
    expect(listed.payment?.number).toBeTruthy();

    // An approved run that is rolled back gets a reversing entry.
    const feb = await createRun(erp, { month: 2, year: 2027, notes: "" });
    await approveRun(erp, feb.id, { payUnmarkedAsPresent: true });
    await cancelRun(erp, feb.id, "Wrong salaries");
    expect((await Voucher.findOne({ businessId: bId, sourceType: "PAYROLL_RUN", sourceId: feb.id }).lean<{ status: string }>())!.status).toBe("CANCELLED");
    expect(await Voucher.exists({ businessId: bId, sourceType: "PAYROLL_RUN_REVERSAL", sourceId: feb.id })).toBeTruthy();

    // A run approved while posting was off can be posted afterwards, once.
    const mar = await createRun(ctx, { month: 3, year: 2027, notes: "" });
    await approveRun(ctx, mar.id, { payUnmarkedAsPresent: true });
    expect((await payrollVouchers(erp)).items.find((i) => i.id === mar.id)!.missing).toBe(true);
    expect((await postMissingPayrollVouchers(erp, mar.id)).posted).toHaveLength(1);
    expect((await postMissingPayrollVouchers(erp, mar.id)).posted).toHaveLength(0);
    await expect(postMissingPayrollVouchers(ctx, mar.id)).rejects.toMatchObject({ code: "ACCOUNTING_OFF" });
  });

  it("pays increment, day and DA arrears for approved months with the next payroll", async () => {
    const { recordChange, deleteChange } = await import("@/lib/hr/history");
    const { createDayArrear, createDaArrears, listArrears, cancelArrear } = await import("@/lib/hr/arrears");
    const { createRun, getRun, approveRun, cancelRun } = await import("@/lib/hr/payroll");
    const { PayrollArrear } = await import("@/models/hr");

    // Increment: Ravi's raise backdated to 1 October (October is approved at 12,000).
    // His later correction (13,000 from 22 November) still applies afterwards, so only October is owed.
    const raise = await recordChange(ctx, String(emp.ravi), { changeType: "SALARY_REVISION", effectiveDate: "2026-10-01", reason: "Appraisal", changes: { basic: "14000" } });
    expect(raise.arrears).toBe(1);
    let inc = await listArrears(ctx, { kind: "INCREMENT" });
    expect(inc.items.map((a) => [a.employeeName, `${a.from.month}/${a.from.year}`, a.amount])).toEqual([["Ravi Kumar", "10/2026", "2000.00"]]);

    // Day: Asha lost 2 days in October; pay one back at October's daily rate (20,000 / 31).
    expect((await createDayArrear(ctx, { employeeId: String(emp.asha), year: 2026, month: 10, days: 1, reason: "Leave approved late" })).amount).toBe("645.16");
    await expect(createDayArrear(ctx, { employeeId: String(emp.asha), year: 2026, month: 10, days: 2, reason: "Again" })).rejects.toMatchObject({ code: "TOO_MANY_DAYS" });
    await expect(createDayArrear(ctx, { employeeId: String(emp.asha), year: 2026, month: 9, days: 1, reason: "No payroll" })).rejects.toMatchObject({ code: "NO_LOCKED_PAYSLIP" });

    // DA: 10% of the basic paid in October, previewed then created; a second run skips them.
    const daInput = { percent: 10, fromYear: 2026, fromMonth: 10, toYear: 2026, toMonth: 10, reason: "DA revised", commit: false };
    const preview = await createDaArrears(ctx, daInput);
    expect(preview.rows.map((r) => [r.name, r.basic, r.amount])).toEqual([
      ["Asha Rao", "14032.26", "1403.23"],
      ["Ravi Kumar", "12000.00", "1200.00"],
    ]);
    expect(await PayrollArrear.countDocuments({ businessId, kind: "DA" })).toBe(0);
    expect((await createDaArrears(ctx, { ...daInput, commit: true })).committed).toBe(true);
    expect((await createDaArrears(ctx, daInput)).rows.every((r) => r.skipped)).toBe(true);

    // The next payroll (April 2027) pays them; approval marks them paid, rollback makes them pending again.
    const apr = await createRun(ctx, { month: 4, year: 2027, notes: "" });
    const slips = (await getRun(ctx, apr.id)).payslips;
    const line = (name: string, code: string) => slips.find((s) => s.employee.name === name)!.earnings.find((l) => l.code === code)?.amount;
    expect(line("Ravi Kumar", "ARR_INC")).toBe("2000.00");
    expect(line("Ravi Kumar", "ARR_DA")).toBe("1200.00");
    expect(line("Asha Rao", "ARR_DAY")).toBe("645.16");
    expect(line("Asha Rao", "ARR_DA")).toBe("1403.23");
    await approveRun(ctx, apr.id, { payUnmarkedAsPresent: true });
    expect((await listArrears(ctx, { status: "PENDING" })).pendingCount).toBe(0);
    expect(await PayrollArrear.countDocuments({ businessId, status: "INCLUDED", payrollRunId: apr.id })).toBe(4);
    await cancelRun(ctx, apr.id, "Recheck arrears");
    expect((await listArrears(ctx, { status: "PENDING" })).pendingCount).toBe(4);

    // Day and DA arrears can be cancelled while pending; increment arrears go with their revision.
    const day = (await listArrears(ctx, { kind: "DAY" })).items[0];
    await cancelArrear(ctx, day.id);
    inc = await listArrears(ctx, { kind: "INCREMENT" });
    await expect(cancelArrear(ctx, inc.items[0].id)).rejects.toMatchObject({ code: "USE_HISTORY" });
    await deleteChange(ctx, String(emp.ravi), raise.id);
    expect((await listArrears(ctx, { kind: "INCREMENT" })).items[0].status).toBe("CANCELLED");
  });

  it("settles a leaving employee in full and final and keeps them out of later payroll", async () => {
    const { createFnf, updateFnf, approveFnf, markFnfPaid, cancelFnf, getFnf, gratuityReport } = await import("@/lib/hr/fnf");
    const { createLoan } = await import("@/lib/hr/money");
    const { payrollEmployees } = await import("@/lib/hr/holds");
    const { Employee, EmployeeLoan, PayrollArrear } = await import("@/models/hr");
    const bId = new Types.ObjectId(businessId);

    // Ravi resigned on 20 March 2027 and leaves on 15 April (30 days' notice, 27 served). March is already paid.
    const draft = await createFnf(ctx, { employeeId: String(emp.ravi), separationType: "RESIGNED", resignationDate: "2027-03-20", lastWorkingDay: "2027-04-15", noticeDays: 30, exitReason: "Higher studies", notes: "" });
    await expect(createFnf(ctx, { employeeId: String(emp.ravi), separationType: "RESIGNED", resignationDate: "", lastWorkingDay: "2027-04-15", noticeDays: 30, exitReason: "", notes: "" })).rejects.toMatchObject({ code: "FNF_EXISTS" });
    let f = await getFnf(ctx, draft.id);
    const amt = (lines: { code: string; amount: string }[], code: string) => lines.find((l) => l.code === code)?.amount;
    expect(f.salaryFrom).toEqual({ year: 2027, month: 4 });
    expect(amt(f.earnings, "BASIC")).toBe("6500.00"); // 13,000 × 15/30
    expect(amt(f.earnings, "LEAVE_ENC")).toBe("5633.29"); // EL 13 days × 13,000 / 30
    expect(amt(f.earnings, "ARR_DA")).toBe("1200.00"); // the DA arrear still pending
    expect(amt(f.earnings, "GRATUITY")).toBeUndefined(); // under five years
    expect(amt(f.deductions, "PF")).toBe("780.00");
    expect(amt(f.deductions, "PT")).toBe("200.00");
    expect(amt(f.deductions, "NOTICE_RECOVERY")).toBe("1300.00"); // 3 days × 13,000 / 30
    expect(f).toMatchObject({ noticeServedDays: 27, noticeShortfallDays: 3, netPayable: "11053.29" });

    // A loan given after the draft: approval refuses the stale figures until recalculated (with an asset recovery added).
    await createLoan(ctx, { employeeId: String(emp.ravi), loanType: "ADVANCE", issueDate: "2027-03-25", amount: "5000", emiAmount: "1000", startMonth: 5, startYear: 2027, reason: "" });
    await expect(approveFnf(ctx, draft.id)).rejects.toMatchObject({ code: "FNF_STALE" });
    await updateFnf(ctx, draft.id, { manualLines: [{ kind: "DEDUCTION", label: "Laptop not returned", amount: "2000" }] });
    f = await getFnf(ctx, draft.id);
    expect(amt(f.deductions, "LOAN")).toBe("5000.00");
    expect(f.netPayable).toBe("4053.29");

    await approveFnf(ctx, draft.id);
    const ravi = await Employee.findById(emp.ravi).lean<{ employmentStatus: string; dateOfExit: Date }>();
    expect(ravi!.employmentStatus).toBe("RESIGNED");
    expect(ravi!.dateOfExit.toISOString().slice(0, 10)).toBe("2027-04-15");
    const loan = await EmployeeLoan.findOne({ businessId, employeeId: emp.ravi }).lean<{ status: string; repaidAmount: unknown }>();
    expect(loan).toMatchObject({ status: "CLOSED" });
    expect(await PayrollArrear.countDocuments({ businessId, employeeId: emp.ravi, status: "INCLUDED", fnfSettlementId: draft.id })).toBe(1);
    // April's payroll would pay him twice: he is left out.
    expect((await payrollEmployees(bId, 2027, 4)).map((e) => e.name)).toEqual(["Asha Rao"]);

    // Cancelling an approved settlement reverses the loan recovery and the arrear.
    await cancelFnf(ctx, draft.id, "Rejoined");
    expect((await EmployeeLoan.findOne({ businessId, employeeId: emp.ravi }).lean<{ status: string }>())!.status).toBe("ACTIVE");
    expect(await PayrollArrear.countDocuments({ businessId, employeeId: emp.ravi, status: "PENDING" })).toBe(1);

    // A fresh settlement can then be approved and paid.
    const again = await createFnf(ctx, { employeeId: String(emp.ravi), separationType: "RESIGNED", resignationDate: "2027-03-20", lastWorkingDay: "2027-04-15", noticeDays: 30, exitReason: "", notes: "" });
    await approveFnf(ctx, again.id);
    await markFnfPaid(ctx, again.id, { paidOn: "2027-04-30", reference: "UTR999" });
    expect((await getFnf(ctx, again.id)).status).toBe("PAID");
    await expect(cancelFnf(ctx, again.id, "Too late")).rejects.toMatchObject({ code: "FNF_PAID" });

    // Gratuity report: nobody has five years yet, but the provision accrues.
    const report = await gratuityReport(ctx, "2027-04-15");
    expect(report.rows.every((r) => !r.eligible)).toBe(true);
  });

  it("links an existing team member from the employee form", async () => {
    const { NextRequest } = await import("next/server");
    const { createHandler, updateHandler } = await import("@/lib/resources/handlers");
    const { HR_RESOURCES } = await import("@/lib/resources/hrRegistry");
    const { signAccessToken } = await import("@/lib/auth/tokens");
    const { ACCESS_TOKEN_COOKIE } = await import("@/lib/auth/cookies");
    const { Employee } = await import("@/models/hr");
    const { User } = await import("@/models/User");
    const { Role } = await import("@/models/Role");
    const { Business } = await import("@/models/Business");
    await Business.updateOne({ _id: businessId }, { maxEmployees: 50 });

    const hrManager = await Role.findOne({ businessId, name: "HR Manager" }).lean<{ _id: Types.ObjectId }>();
    const member = await User.create({
      businessId,
      name: "Kiran Mehta",
      username: "kiran.member",
      email: "kiran@peoplefirst.test",
      passwordHash: "x",
      roleId: hrManager!._id,
      status: "ACTIVE",
    });
    const tokenFor = (permissions: string[]) =>
      signAccessToken({ sub: String(ctx.userId), businessId, roleId: String(ctx.roleId), permissions, branchIds: [], warehouseIds: [], products: ["HRMS"] });
    const request = (url: string, method: string, body: Record<string, unknown>, permissions: string[]) =>
      new NextRequest(url, {
        method,
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${tokenFor(permissions)}` },
      });
    const create = (body: Record<string, unknown>, permissions = ["*"]) =>
      createHandler(HR_RESOURCES["hr-employees"])(request("http://localhost/api/masters/hr-employees", "POST", body, permissions));
    const update = (id: Types.ObjectId, body: Record<string, unknown>, permissions = ["*"]) =>
      updateHandler(HR_RESOURCES["hr-employees"])(request(`http://localhost/api/masters/hr-employees/${id}`, "PATCH", body, permissions), String(id));
    const base = { name: "Kiran Mehta", employeeCode: "EMP-000101", dateOfJoining: "2027-01-10", basic: "10000" };
    const count = () => Employee.countDocuments({ businessId, name: "Kiran Mehta" });

    // Without permission to edit team members, or with an unknown user, nothing is saved.
    await expect(create({ ...base, userId: String(member._id) }, ["hr-employees.create"])).rejects.toMatchObject({ statusCode: 403 });
    await expect(create({ ...base, userId: String(new Types.ObjectId()) })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(await count()).toBe(0);

    const res = await create({ ...base, userId: String(member._id) });
    expect(res.status).toBe(201);
    const kiran = await Employee.findOne({ businessId, name: "Kiran Mehta" }).lean<{ _id: Types.ObjectId; userId: Types.ObjectId; workEmail: string }>();
    expect(String(kiran!.userId)).toBe(String(member._id));
    expect(kiran!.workEmail).toBe("kiran@peoplefirst.test");
    // The login keeps its own role.
    expect(String((await User.findById(member._id).lean<{ roleId: Types.ObjectId }>())!.roleId)).toBe(String(hrManager!._id));

    // The same team member can't be a second employee; a blank picker links no one.
    await expect(create({ ...base, name: "Kiran Two", employeeCode: "EMP-000102", userId: String(member._id) })).rejects.toMatchObject({ code: "LOGIN_ALREADY_LINKED" });
    await create({ ...base, name: "Meera Iyer", employeeCode: "EMP-000103", userId: "" });
    const meera = await Employee.findOne({ businessId, name: "Meera Iyer" }).lean<{ _id: Types.ObjectId; userId: unknown }>();
    expect(meera!.userId).toBeNull();

    // Editing: clearing unlinks, choosing links; leaving the field out changes nothing.
    await update(kiran!._id, { ...base, userId: "" });
    expect((await Employee.findById(kiran!._id).lean<{ userId: unknown }>())!.userId).toBeNull();
    await update(meera!._id, { ...base, name: "Meera Iyer", employeeCode: "EMP-000103", userId: String(member._id) });
    await update(meera!._id, { ...base, name: "Meera Iyer", employeeCode: "EMP-000103" }, ["hr-employees.edit"]);
    expect(String((await Employee.findById(meera!._id).lean<{ userId: Types.ObjectId }>())!.userId)).toBe(String(member._id));
    await expect(update(kiran!._id, { ...base, userId: String(member._id) })).rejects.toMatchObject({ code: "LOGIN_ALREADY_LINKED" });

    // Moved back: later tests rely on Kiran's login being Kiran.
    await update(meera!._id, { ...base, name: "Meera Iyer", employeeCode: "EMP-000103", userId: "" });
    await update(kiran!._id, { ...base, userId: String(member._id) });
    expect(String((await Employee.findById(kiran!._id).lean<{ userId: Types.ObjectId }>())!.userId)).toBe(String(member._id));
  });

  it("lets people file and decide only leave that is not their own (except the Owner)", async () => {
    const { applyLeave, approveLeave, rejectLeave, cancelLeave } = await import("@/lib/hr/leave");
    const { LeaveType } = await import("@/models/hr");
    const { User } = await import("@/models/User");
    const lop = await LeaveType.findOne({ businessId, code: "LOP" }).lean<{ _id: Types.ObjectId }>();
    const ashaUser = await User.findOne({ businessId, email: "asha@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    // A manager-style login (file + approve rights, not the Owner) linked to Asha.
    const asha = { ...ctx, userId: ashaUser!._id, roleId: ashaUser!.roleId, permissions: ["hr-leaves.view", "hr-leaves.create", "hr-leaves.approve"] };
    const leave = (employeeId: Types.ObjectId, date: string) => ({ employeeId: String(employeeId), leaveTypeId: String(lop!._id), fromDate: date, toDate: date, halfDay: false, reason: "" });

    // Mon 3 May 2027: someone else's leave is refused, her own goes through.
    await expect(applyLeave(asha, leave(emp.ravi, "2027-05-03"), { self: false })).rejects.toMatchObject({ code: "OWN_LEAVE_ONLY", statusCode: 403 });
    const own = await applyLeave(asha, leave(emp.asha, "2027-05-03"), { self: false });

    // She can't decide her own request; the Owner can.
    await expect(approveLeave(asha, own.id, "")).rejects.toMatchObject({ code: "OWN_LEAVE_DECISION" });
    await expect(rejectLeave(asha, own.id, "No")).rejects.toMatchObject({ code: "OWN_LEAVE_DECISION" });
    await approveLeave(ctx, own.id, "");
    await expect(cancelLeave(asha, own.id, { self: false, note: "Changed plans" })).rejects.toMatchObject({ code: "OWN_LEAVE_DECISION" });

    // A login with no employee record has nothing to file; the Owner may still file for anyone.
    const unlinked = { ...asha, userId: new Types.ObjectId() };
    await expect(applyLeave(unlinked, leave(emp.asha, "2027-05-04"), { self: false })).rejects.toMatchObject({ code: "NO_EMPLOYEE_PROFILE" });
    expect((await applyLeave(ctx, leave(emp.asha, "2027-05-04"), { self: false })).days).toBe(1);
  });

  it("lets only the reporting manager or HR decide a leave request", async () => {
    const { applyLeave, approveLeave, rejectLeave, listLeaves } = await import("@/lib/hr/leave");
    const { upgradeHrRoles } = await import("@/lib/hr/setup");
    const { Employee, LeaveType } = await import("@/models/hr");
    const { User } = await import("@/models/User");
    const { Role } = await import("@/models/Role");
    const lop = await LeaveType.findOne({ businessId, code: "LOP" }).lean<{ _id: Types.ObjectId }>();
    const meera = await Employee.findOne({ businessId, name: "Meera Iyer" }).lean<{ _id: Types.ObjectId }>();
    const ashaUser = await User.findOne({ businessId, email: "asha@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    const kiranUser = await User.findOne({ businessId, email: "kiran@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    // Asha: a manager role (approve, not approve-all). Kiran: HR (approve-all).
    const manager = { ...ctx, userId: ashaUser!._id, roleId: ashaUser!.roleId, permissions: ["hr-leaves.view", "hr-leaves.approve"] };
    const hr = { ...ctx, userId: kiranUser!._id, roleId: kiranUser!.roleId, permissions: ["hr-leaves.view", "hr-leaves.approve", "hr-leaves.approve-all"] };
    const file = (date: string) => applyLeave(ctx, { employeeId: String(meera!._id), leaveTypeId: String(lop!._id), fromDate: date, toDate: date, halfDay: false, reason: "" }, { self: false });

    // Meera reports to nobody yet: the manager can't decide her leave, and the list says so.
    const first = await file("2027-05-10");
    await expect(approveLeave(manager, first.id, "")).rejects.toMatchObject({ code: "NOT_REPORTING_MANAGER", statusCode: 403 });
    await expect(rejectLeave(manager, first.id, "No")).rejects.toMatchObject({ code: "NOT_REPORTING_MANAGER" });
    const row = async (who: typeof manager, id: string) => (await listLeaves(who, { page: 1, pageSize: 50 } as never)).items.find((i) => i.id === id)!;
    expect((await row(manager, first.id)).decidable).toBe(false);
    expect((await row(hr, first.id)).decidable).toBe(true);

    // Once Meera reports to Asha, Asha decides; HR can decide anyone's.
    await Employee.updateOne({ _id: meera!._id }, { reportingManagerId: emp.asha });
    expect((await row(manager, first.id)).decidable).toBe(true);
    await approveLeave(manager, first.id, "");
    const second = await file("2027-05-11");
    await Employee.updateOne({ _id: meera!._id }, { reportingManagerId: null });
    await rejectLeave(hr, second.id, "Peak season");

    // HR Manager roles from before get the new permission once.
    const hrRole = await Role.findOne({ businessId, name: "HR Manager" });
    hrRole!.permissions = hrRole!.permissions.filter((p: string) => p !== "hr-leaves.approve-all");
    await hrRole!.save();
    await upgradeHrRoles(new Types.ObjectId(businessId));
    await upgradeHrRoles(new Types.ObjectId(businessId));
    const upgraded = (await Role.findById(hrRole!._id).lean<{ permissions: string[] }>())!.permissions;
    expect(upgraded.filter((p) => p === "hr-leaves.approve-all")).toHaveLength(1);
  });

  it("grants leave by the leave group of the employee's grade", async () => {
    const { balancesFor } = await import("@/lib/hr/leave");
    const { NextRequest } = await import("next/server");
    const { createHandler, listHandler, deleteHandler } = await import("@/lib/resources/handlers");
    const { HR_RESOURCES } = await import("@/lib/resources/hrRegistry");
    const { signAccessToken } = await import("@/lib/auth/tokens");
    const { ACCESS_TOKEN_COOKIE } = await import("@/lib/auth/cookies");
    const { Employee, LeaveType, LeaveGroup, HrGrade, GradeLeaveGroup, Designation } = await import("@/models/hr");
    const def = HR_RESOURCES["hr-grade-leave-groups"];
    const token = signAccessToken({ sub: String(ctx.userId), businessId, roleId: String(ctx.roleId), permissions: ["*"], branchIds: [], warehouseIds: [], products: ["HRMS"] });
    const call = (method: string, path: string, body?: unknown) =>
      new NextRequest(`http://localhost/api/masters/hr-grade-leave-groups${path}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers: { "content-type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${token}` },
      });
    const assign = async (gradeId: unknown, leaveGroupId: unknown) => (await (await createHandler(def)(call("POST", "", { gradeId: String(gradeId), leaveGroupId: String(leaveGroupId) }))).json()).data;
    const list = async (q: string) => (await (await listHandler(def)(call("GET", `?${q}`))).json()).data as { items: { id: string; gradeId: string }[]; total: number };
    const types = new Map((await LeaveType.find({ businessId }).lean<{ _id: Types.ObjectId; code: string }[]>()).map((t) => [t.code, t._id]));
    const l4 = await HrGrade.findOne({ businessId, code: "L4" }).lean<{ _id: Types.ObjectId }>();
    // The starter setup seeds grades; designations no longer carry one.
    expect(await HrGrade.countDocuments({ businessId })).toBe(6);
    expect(Designation.schema.path("grade")).toBeUndefined();

    // A leave type can't be listed twice in a group, on create or on edit.
    const dupe = { name: "Dupes", leaveTypes: [{ leaveTypeId: String(types.get("CL")), annualQuota: 1 }, { leaveTypeId: String(types.get("CL")), annualQuota: 2 }] };
    expect(HR_RESOURCES["hr-leave-groups"].createSchema.safeParse(dupe).success).toBe(false);
    expect(HR_RESOURCES["hr-leave-groups"].updateSchema.safeParse(dupe).success).toBe(false);

    const staff = await LeaveGroup.create({ businessId, code: "LG-STAFF", name: "Staff", leaveTypes: [{ leaveTypeId: types.get("CL"), annualQuota: 20 }, { leaveTypeId: types.get("SL"), annualQuota: 5 }] });
    const paused = await LeaveGroup.create({ businessId, code: "LG-OLD", name: "Old policy", status: "INACTIVE", leaveTypes: [] });
    await Employee.updateOne({ _id: emp.asha }, { gradeId: l4!._id });
    const days = async () => Object.fromEntries((await balancesFor(new Types.ObjectId(businessId), [emp.asha], 2031)).get(String(emp.asha))!.map((b) => [b.code, b.allocated]));

    // No group on the grade yet: each leave type's own days.
    expect(await days()).toMatchObject({ CL: 12, SL: 7, EL: 15 });

    const row = await assign(l4!._id, staff._id);
    // The group's days; a type left out of the group grants none.
    expect(await days()).toMatchObject({ CL: 20, SL: 5, EL: 0, LOP: 0 });

    // A grade follows one group; an inactive group can't be chosen.
    await expect(assign(l4!._id, staff._id)).rejects.toMatchObject({ code: "GRADE_ALREADY_ASSIGNED" });
    const l3 = await HrGrade.findOne({ businessId, code: "L3" }).lean<{ _id: Types.ObjectId }>();
    await expect(assign(l3!._id, paused._id)).rejects.toMatchObject({ code: "LEAVE_GROUP_INACTIVE" });

    // The list filters by the leave group's and the grade's names.
    expect((await list("grade=execut")).items.map((r) => r.id)).toEqual([row.id]);
    expect((await list("leaveGroup=staff")).total).toBe(1);
    expect((await list("leaveGroup=nothing-like-this")).total).toBe(0);

    // Assignments kept on the grade by the earlier screen move into the list the first time it is opened.
    const l5 = await HrGrade.findOne({ businessId, code: "L5" }).lean<{ _id: Types.ObjectId }>();
    await HrGrade.updateOne({ _id: l5!._id }, { leaveGroupId: staff._id });
    expect((await list("")).items.map((r) => r.gradeId)).toContain(String(l5!._id));
    expect((await HrGrade.findById(l5!._id).lean<{ leaveGroupId: unknown }>())!.leaveGroupId).toBeNull();

    // Deleting the assignment goes back to the leave types' days.
    await deleteHandler(def)(call("DELETE", `/${row.id}`), row.id);
    expect(await days()).toMatchObject({ CL: 12, SL: 7, EL: 15 });

    await GradeLeaveGroup.deleteMany({ businessId });
    await Employee.updateOne({ _id: emp.asha }, { gradeId: null });
  });

  it("applies the attendance regularization policy and reasons", async () => {
    const { assertRegularizationAllowed, regularizationPolicy } = await import("@/lib/hr/regularization");
    const { requestCorrection, approveCorrection, listAllCorrections } = await import("@/lib/hr/corrections");
    const { applyLeave, approveLeave } = await import("@/lib/hr/leave");
    const { updateSettings } = await import("@/lib/settings/service");
    const { findEmployee } = await import("@/lib/hr/common");
    const { AttendanceReason, Attendance, Holiday, LeaveType } = await import("@/models/hr");
    const { User } = await import("@/models/User");
    const bid = new Types.ObjectId(businessId);
    const setPolicy = (v: Record<string, unknown>) => updateSettings(bid, ctx.userId, "attendance-regularization", v);
    const asha = await findEmployee(bid, emp.asha);
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const marked = { status: "ABSENT" };
    const check = async (policy: Record<string, unknown>, ask: Partial<{ date: string; status: string; checkIn: string; checkOut: string }>, current: Record<string, unknown> | null = marked) => {
      await setPolicy(policy);
      return assertRegularizationAllowed(bid, await regularizationPolicy(bid), asha, { status: "PRESENT", checkIn: "", checkOut: "", ...ask, date: d(ask.date ?? "2027-01-06") }, { today: d("2027-01-08"), current });
    };

    // The starter setup seeds the system reasons.
    expect((await AttendanceReason.find({ businessId }).lean<{ name: string; reasonType: string }[]>()).filter((r) => r.reasonType === "SYSTEM").map((r) => r.name)).toContain("Forgot to Punch");

    // Defaults keep the old rules: past, blank, weekly-off days and times are fine; future days are not.
    await expect(check({}, { date: "2027-01-03" }, null)).resolves.toBeUndefined();
    await expect(check({}, { date: "2027-01-09" })).rejects.toMatchObject({ code: "FUTURE_DATE" });

    await expect(check({ applicable: false }, {})).rejects.toMatchObject({ code: "REGULARIZATION_OFF" });
    await expect(check({ pastDaysLimit: 3 }, { date: "2027-01-04" })).rejects.toMatchObject({ code: "PAST_LIMIT" });
    await expect(check({ pastDaysLimit: 3 }, { date: "2027-01-05" })).resolves.toBeUndefined();
    await expect(check({ futureApplicable: true, futureBlankAttendance: true, futureDaysLimit: 2 }, { date: "2027-01-11" }, null)).rejects.toMatchObject({ code: "FUTURE_LIMIT" });
    await expect(check({ futureApplicable: true, futureBlankAttendance: true, futureDaysLimit: 2 }, { date: "2027-01-10" }, null)).resolves.toBeUndefined();
    await expect(check({ futureApplicable: true }, { date: "2027-01-10" }, null)).rejects.toMatchObject({ code: "BLANK_ATTENDANCE" });
    await expect(check({ pastBlankAttendance: false }, {}, null)).rejects.toMatchObject({ code: "BLANK_ATTENDANCE" });
    // Sunday 3 January is the general shift's weekly off; 7 January is made a holiday.
    await expect(check({ allowOnWeeklyOffs: false }, { date: "2027-01-03" })).rejects.toMatchObject({ code: "WEEKLY_OFF" });
    await Holiday.create({ businessId, name: "Founders Day", date: d("2027-01-07") });
    await expect(check({ allowOnHolidays: false }, { date: "2027-01-07" })).rejects.toMatchObject({ code: "HOLIDAY" });
    await expect(check({ punchApplicable: false }, { checkIn: "09:30" })).rejects.toMatchObject({ code: "PUNCH_OFF" });
    await expect(check({ punchPastDaysLimit: 1 }, { checkIn: "09:30" })).rejects.toMatchObject({ code: "PUNCH_LIMIT" });
    await expect(check({ punchPastDaysLimit: 1 }, {})).resolves.toBeUndefined();
    // Half-day leave: only with the switch on, and only for the worked half.
    const halfLeave = { status: "HALF_DAY", leaveApplicationId: new Types.ObjectId() };
    await expect(check({}, { status: "HALF_DAY" }, halfLeave)).rejects.toMatchObject({ code: "ON_LEAVE" });
    await expect(check({ applyOnHalfDayLeave: true }, { status: "PRESENT" }, halfLeave)).rejects.toMatchObject({ code: "HALF_DAY_LEAVE" });
    await expect(check({ applyOnHalfDayLeave: true }, { status: "HALF_DAY" }, halfLeave)).resolves.toBeUndefined();
    await expect(check({ applyOnHalfDayLeave: true }, { status: "HALF_DAY" }, { status: "LEAVE", leaveApplicationId: new Types.ObjectId() })).rejects.toMatchObject({ code: "ON_LEAVE" });
    // Asha has one approved request in November 2026 (rejected and withdrawn ones do not count).
    await expect(check({ maxDaysPerMonth: 1 }, { date: "2026-11-25" })).rejects.toMatchObject({ code: "MONTH_LIMIT" });
    await expect(check({ maxDaysPerMonth: 2 }, { date: "2026-11-25" })).resolves.toBeUndefined();

    // End to end: a reason is stored with its name; approval re-checks the policy unless told not to.
    const ashaUser = await User.findOne({ businessId, email: "asha@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    const self = { ...ctx, userId: ashaUser!._id, roleId: ashaUser!.roleId, permissions: ["hr-self.view"] };
    const forgot = await AttendanceReason.findOne({ businessId, name: "Forgot to Punch" }).lean<{ _id: Types.ObjectId }>();
    await setPolicy({});
    await expect(requestCorrection(self, { date: "2026-11-20", status: "PRESENT", checkIn: "", checkOut: "", reasonId: String(new Types.ObjectId()) })).rejects.toMatchObject({ code: "REASON_NOT_FOUND" });
    const req = await requestCorrection(self, { date: "2026-11-20", status: "PRESENT", checkIn: "", checkOut: "", reasonId: String(forgot!._id) });
    const listed = (await listAllCorrections(ctx, { page: 1, pageSize: 50 })).items.find((r) => r.id === req.id)!;
    expect(listed).toMatchObject({ reasonName: "Forgot to Punch", reason: "" });
    await setPolicy({ pastBlankAttendance: false });
    await expect(approveCorrection(ctx, req.id, "")).rejects.toMatchObject({ code: "BLANK_ATTENDANCE" });
    await setPolicy({ pastBlankAttendance: false, skipPolicyOnApproval: true });
    await approveCorrection(ctx, req.id, "");

    // The worked half of a half-day leave: the times change, the leave stays on the day.
    await setPolicy({ applyOnHalfDayLeave: true });
    const lop = await LeaveType.findOne({ businessId, code: "LOP" }).lean<{ _id: Types.ObjectId }>();
    const half = await applyLeave(ctx, { employeeId: String(emp.asha), leaveTypeId: String(lop!._id), fromDate: "2026-11-12", toDate: "2026-11-12", halfDay: true, reason: "" }, { self: false });
    await approveLeave(ctx, half.id, "");
    const halfReq = await requestCorrection(self, { date: "2026-11-12", status: "HALF_DAY", checkIn: "09:30", checkOut: "13:30", reasonId: String(forgot!._id) });
    await approveCorrection(ctx, halfReq.id, "");
    const day = await Attendance.findOne({ businessId, employeeId: emp.asha, date: d("2026-11-12") }).lean<{ status: string; checkIn: string; leaveApplicationId: Types.ObjectId }>();
    expect(day).toMatchObject({ status: "HALF_DAY", checkIn: "09:30" });
    expect(String(day!.leaveApplicationId)).toBe(half.id);

    await setPolicy({});
  });

  it("draws the organization tree from reporting managers", async () => {
    const { orgTree } = await import("@/lib/hr/orgTree");
    const { Employee } = await import("@/models/hr");
    const working = { businessId, deletedAt: null, employmentStatus: { $in: ["PROBATION", "CONFIRMED", "ON_NOTICE"] } };
    const [boss, report] = await Employee.find(working).sort({ employeeCode: 1 }).limit(2).lean<{ _id: Types.ObjectId }[]>();
    const before = await Employee.find({ _id: { $in: [boss._id, report._id] } }, { reportingManagerId: 1 }).lean<{ _id: Types.ObjectId; reportingManagerId: Types.ObjectId | null }[]>();
    await Employee.updateOne({ _id: boss._id }, { reportingManagerId: null });
    await Employee.updateOne({ _id: report._id }, { reportingManagerId: boss._id });
    // Someone who has left is not drawn, and anyone reporting to them goes to the top.
    const left = await Employee.findOne({ businessId, deletedAt: null, employmentStatus: { $nin: ["PROBATION", "CONFIRMED", "ON_NOTICE"] } }).lean<{ _id: Types.ObjectId }>();

    const tree = await orgTree(ctx);
    expect(tree.items.find((x) => x.id === String(report._id))!.managerId).toBe(String(boss._id));
    expect(tree.items.find((x) => x.id === String(boss._id))!.managerId).toBeNull();
    expect(tree.items).toHaveLength(await Employee.countDocuments(working));
    if (left) expect(tree.items.some((x) => x.id === String(left._id) || x.managerId === String(left._id))).toBe(false);

    for (const b of before) await Employee.updateOne({ _id: b._id }, { reportingManagerId: b.reportingManagerId ?? null });
  });

  it("keeps employee photos and filters the directory", async () => {
    const { savePhoto, removePhoto, readPhoto } = await import("@/lib/hr/photos");
    const { directory, directorySchema } = await import("@/lib/hr/people");
    const { Employee, HrDepartment } = await import("@/models/hr");
    const { User } = await import("@/models/User");
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], "me.png", { type: "image/png" });
    const fake = new File(["not really a picture"], "me.png", { type: "image/png" });
    const pdf = new File(["%PDF-1.7 ..."], "me.jpg", { type: "image/jpeg" });

    // Only real JPG/PNG bytes are kept, whatever the name or type claims.
    await expect(savePhoto(ctx, String(emp.asha), fake)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(savePhoto(ctx, String(emp.asha), pdf)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    const saved = await savePhoto(ctx, String(emp.asha), png);
    expect(saved.photoUrl).toMatch(new RegExp(`^/api/hr/employees/${emp.asha}/photo\\?v=\\d+$`));
    expect((await Employee.findById(emp.asha).lean<{ photoUpdatedAt: Date | null }>())!.photoUpdatedAt).toBeInstanceOf(Date);
    expect(await readPhoto(ctx, String(emp.asha))).toMatchObject({ mimeType: "image/png" });

    // With self-service only, Asha sees her own photo and nobody else's; adding employees doesn't let you change others' photos.
    const ashaUser = await User.findOne({ businessId, email: "asha@peoplefirst.test" }).lean<{ _id: Types.ObjectId; roleId: Types.ObjectId }>();
    const self = { ...ctx, userId: ashaUser!._id, roleId: ashaUser!.roleId, permissions: ["hr-self.view"] };
    expect((await readPhoto(self, String(emp.asha))).data.length).toBe(12);
    const other = await Employee.findOne({ businessId, _id: { $ne: emp.asha } }).lean<{ _id: Types.ObjectId }>();
    await expect(readPhoto(self, String(other!._id))).rejects.toMatchObject({ statusCode: 403 });
    await expect(savePhoto({ ...ctx, permissions: ["hr-employees.view", "hr-employees.create"] }, String(emp.asha), png)).rejects.toMatchObject({ statusCode: 403 });

    // The directory carries the photo and offers filters from the employees themselves.
    const dept = await HrDepartment.findOne({ businessId }).lean<{ _id: Types.ObjectId; name: string }>();
    await HrDepartment.updateOne({ _id: dept!._id }, { costCenter: "CC-HR" });
    await Employee.updateOne({ _id: emp.asha }, { workLocation: "Ahmedabad-Gujarat", departmentId: dept!._id });
    const list = (q: Record<string, string>) => directory(ctx, directorySchema.parse({ scope: "all", pageSize: "100", ...q }));
    const everyone = await list({});
    expect(everyone.items.find((r) => r.id === String(emp.asha))).toMatchObject({ location: "Ahmedabad-Gujarat", photoUrl: saved.photoUrl });
    expect(everyone.facets.locations).toContain("Ahmedabad-Gujarat");
    expect(everyone.facets.costCenters).toContain("CC-HR");
    expect(everyone.all).toBe(everyone.total);
    const atLocation = await list({ location: "ahmedabad-gujarat" });
    expect(atLocation.items.map((r) => r.id)).toContain(String(emp.asha));
    expect(atLocation.all).toBe(everyone.all);
    expect((await list({ costCenter: "CC-HR" })).items.every((r) => r.department === dept!.name)).toBe(true);
    expect((await list({ costCenter: "NO-SUCH" })).total).toBe(0);

    await removePhoto(ctx, String(emp.asha));
    expect((await Employee.findById(emp.asha).lean<{ photoUpdatedAt: Date | null }>())!.photoUpdatedAt).toBeNull();
    await expect(readPhoto(ctx, String(emp.asha))).rejects.toMatchObject({ statusCode: 404 });
  });

  it("gives each employee the holidays of their holiday calendar", async () => {
    const { previewLeave } = await import("@/lib/hr/leave");
    const { assignCalendar, calendarAssignments, keepSingleDefault, upcomingHolidaysFor } = await import("@/lib/hr/holidayCalendars");
    const { Employee, Holiday, HolidayCalendar } = await import("@/models/hr");
    const bid = new Types.ObjectId(businessId);
    const working = { businessId, deletedAt: null, employmentStatus: { $in: ["PROBATION", "CONFIRMED", "ON_NOTICE"] } };
    const [a, b] = await Employee.find(working).sort({ employeeCode: 1 }).limit(2).lean<{ _id: Types.ObjectId; holidayCalendarId: Types.ObjectId | null }[]>();

    const gujarat = await HolidayCalendar.create({ businessId, code: "HC-GJ", name: "Gujarat", isDefault: true });
    const maharashtra = await HolidayCalendar.create({ businessId, code: "HC-MH", name: "Maharashtra" });
    const paused = await HolidayCalendar.create({ businessId, code: "HC-OLD", name: "Old", status: "INACTIVE" });
    // Tuesday 12 and Wednesday 13 January 2027.
    await Holiday.create({ businessId, name: "Gujarat day off", date: new Date("2027-01-12T00:00:00Z"), calendarId: gujarat._id });
    await Holiday.create({ businessId, name: "Maharashtra day off", date: new Date("2027-01-13T00:00:00Z"), calendarId: maharashtra._id });
    const days = async (id: Types.ObjectId) => (await previewLeave(ctx, { employeeId: String(id), fromDate: "2027-01-12", toDate: "2027-01-13", halfDay: false })).days;

    // Neither has a calendar yet: both follow the default (Gujarat), so only the 13th is a working day.
    expect(await days(a._id)).toBe(1);
    expect(await days(b._id)).toBe(1);

    await expect(assignCalendar(ctx, { employeeIds: [String(b._id)], calendarId: String(paused._id) })).rejects.toMatchObject({ code: "CALENDAR_INACTIVE" });
    await assignCalendar(ctx, { employeeIds: [String(b._id)], calendarId: String(maharashtra._id) });
    expect(await days(a._id)).toBe(1);
    expect(await days(b._id)).toBe(1);
    // B is now off on the 13th, not the 12th.
    expect((await previewLeave(ctx, { employeeId: String(b._id), fromDate: "2027-01-12", toDate: "2027-01-12", halfDay: false })).days).toBe(1);
    expect((await previewLeave(ctx, { employeeId: String(b._id), fromDate: "2027-01-13", toDate: "2027-01-13", halfDay: false })).days).toBe(0);
    const bDoc = await Employee.findById(b._id).lean();
    expect((await upcomingHolidaysFor(bid, bDoc, new Date("2027-01-01T00:00:00Z"), 10)).map((h: { name: string }) => h.name)).toContain("Maharashtra day off");
    expect((await upcomingHolidaysFor(bid, bDoc, new Date("2027-01-01T00:00:00Z"), 10)).map((h: { name: string }) => h.name)).not.toContain("Gujarat day off");

    const screen = await calendarAssignments(ctx, { page: 1, pageSize: 200, calendar: String(maharashtra._id) });
    expect(screen.items.map((r) => r.id)).toEqual([String(b._id)]);
    expect(screen.defaultCalendar?.name).toBe("Gujarat");

    // Only one default: making Maharashtra the default clears Gujarat's flag.
    await HolidayCalendar.updateOne({ _id: maharashtra._id }, { isDefault: true });
    await keepSingleDefault(bid, { _id: maharashtra._id, isDefault: true });
    expect((await HolidayCalendar.findById(gujarat._id).lean<{ isDefault: boolean }>())!.isDefault).toBe(false);

    // Back to the default for both, and tidy up.
    await assignCalendar(ctx, { employeeIds: [String(a._id), String(b._id)], calendarId: null });
    await Holiday.deleteMany({ businessId, calendarId: { $in: [gujarat._id, maharashtra._id] } });
    await HolidayCalendar.deleteMany({ _id: { $in: [gujarat._id, maharashtra._id, paused._id] } });
    for (const e of [a, b]) await Employee.updateOne({ _id: e._id }, { holidayCalendarId: e.holidayCalendarId ?? null });
  });

  it("marks one employee's whole month at once", async () => {
    const { employeeMonthSheet, saveEmployeeMonth, saveMonthSchema } = await import("@/lib/hr/attendance");
    const { applyLeave, approveLeave } = await import("@/lib/hr/leave");
    const { Attendance, LeaveType } = await import("@/models/hr");
    const at = (date: string) => Attendance.findOne({ businessId, employeeId: emp.asha, date: new Date(`${date}T00:00:00Z`) }).lean<{ status: string; workedMinutes: number; checkIn: string; source: string }>();

    const empty = await employeeMonthSheet(ctx, { year: 2027, month: 2 });
    expect(empty.employee).toBeNull();
    expect(empty.employees.map((e) => e.id)).toContain(String(emp.asha));

    // A paid leave day in the month stays as it is.
    const lop = await LeaveType.findOne({ businessId, code: "LOP" }).lean<{ _id: Types.ObjectId }>();
    const leave = await applyLeave(ctx, { employeeId: String(emp.asha), leaveTypeId: String(lop!._id), fromDate: "2027-02-10", toDate: "2027-02-10", halfDay: false, reason: "" }, { self: false });
    await approveLeave(ctx, leave.id, "");

    const sheet = await employeeMonthSheet(ctx, { employeeId: String(emp.asha), year: 2027, month: 2 });
    expect(sheet.days).toHaveLength(28);
    expect(sheet.days.find((d) => d.date === "2027-02-07")).toMatchObject({ dayKind: "WEEKLY_OFF", suggested: "WEEKLY_OFF" });
    expect(sheet.days.find((d) => d.date === "2027-02-10")!.record).toMatchObject({ fromLeave: true });

    const row = (date: string, status: string, checkIn = "", checkOut = "") => ({ date, status, checkIn, checkOut, notes: "" });
    const res = await saveEmployeeMonth(
      ctx,
      saveMonthSchema.parse({
        employeeId: String(emp.asha),
        year: 2027,
        month: 2,
        rows: [row("2027-02-01", "PRESENT", "09:30", "18:30"), row("2027-02-02", "ABSENT"), row("2027-02-07", "WEEKLY_OFF"), row("2027-02-10", "PRESENT")],
      })
    );
    expect(res).toEqual({ saved: 3, skipped: 1 });
    expect(await at("2027-02-01")).toMatchObject({ status: "PRESENT", workedMinutes: 540, checkIn: "09:30", source: "MANUAL" });
    expect(await at("2027-02-02")).toMatchObject({ status: "ABSENT", workedMinutes: 0 });
    expect((await at("2027-02-10"))!.status).toBe("LEAVE");
    const after = await employeeMonthSheet(ctx, { employeeId: String(emp.asha), year: 2027, month: 2 });
    expect(after.summary).toMatchObject({ absent: 1 });

    // Refused: a day outside the month, leave set by hand, and a payroll-locked month.
    const base = { employeeId: String(emp.asha), year: 2027, month: 2 };
    await expect(saveEmployeeMonth(ctx, saveMonthSchema.parse({ ...base, rows: [row("2027-03-01", "PRESENT")] }))).rejects.toMatchObject({ code: "OUTSIDE_MONTH" });
    expect(saveMonthSchema.safeParse({ ...base, rows: [row("2027-02-03", "LEAVE")] }).success).toBe(false);
    await expect(saveEmployeeMonth(ctx, saveMonthSchema.parse({ ...base, year: 2026, month: 10, rows: [row("2026-10-05", "PRESENT")] }))).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
  });

  it("runs contract labour: contractors, sub-contractors, workers under several contractors, bulk upload, attendance and overtime", async () => {
    const { NextRequest } = await import("next/server");
    const { createHandler, updateHandler } = await import("@/lib/resources/handlers");
    const { HR_RESOURCES } = await import("@/lib/resources/hrRegistry");
    const { signAccessToken } = await import("@/lib/auth/tokens");
    const { ACCESS_TOKEN_COOKIE } = await import("@/lib/auth/cookies");
    const { Contractor, ContractWorker, ContractAttendance } = await import("@/models/contractLabour");
    const { previewImport, commitImport } = await import("@/lib/import/service");
    const { contractorTree, contractorWorkers, labourSheet, saveLabourSheet, saveLabourSheetSchema, overtimeReport } = await import("@/lib/hr/contractLabour");

    const token = signAccessToken({ sub: String(ctx.userId), businessId, roleId: String(ctx.roleId), permissions: ["*"], branchIds: [], warehouseIds: [], products: ["HRMS"] });
    const request = (url: string, method: string, body: Record<string, unknown>) =>
      new NextRequest(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${token}` } });
    const create = (key: string, body: Record<string, unknown>) => createHandler(HR_RESOURCES[key])(request(`http://localhost/api/masters/${key}`, "POST", body));
    const update = (key: string, id: unknown, body: Record<string, unknown>) =>
      updateHandler(HR_RESOURCES[key])(request(`http://localhost/api/masters/${key}/${id}`, "PATCH", body), String(id));

    // Contractors: a main contractor and a sub-contractor under it.
    await create("hr-contractors", { name: "Ramesh Patel", firmName: "Patel Labour Services", defaultDailyWage: "600", overtimeMultiplier: 2 });
    const main = await Contractor.findOne({ businessId, name: "Ramesh Patel" }).lean<{ _id: Types.ObjectId; contractorCode: string }>();
    expect(main!.contractorCode).toMatch(/^CON-/);
    await create("hr-contractors", { name: "Kiran Builders", parentContractorId: String(main!._id), defaultDailyWage: "500", overtimeRateType: "FIXED", overtimeRatePerHour: "120", minOvertimeMinutes: 30 });
    const sub = await Contractor.findOne({ businessId, name: "Kiran Builders" }).lean<{ _id: Types.ObjectId; contractorCode: string }>();
    // A contractor can't sit under its own sub-contractor (or itself).
    await expect(update("hr-contractors", main!._id, { parentContractorId: String(sub!._id) })).rejects.toMatchObject({ code: "CONTRACTOR_LOOP" });
    await expect(update("hr-contractors", main!._id, { parentContractorId: String(main!._id) })).rejects.toMatchObject({ code: "CONTRACTOR_LOOP" });

    // A worker under both contractors; one needs at least one contractor.
    await create("hr-contract-workers", { name: "Suresh Kumar", phone: "9898012345", emergencyPhone: "9898054321", contractorIds: [String(main!._id), String(sub!._id)] });
    await expect(create("hr-contract-workers", { name: "Nobody's Worker", phone: "9898000000", contractorIds: [] })).rejects.toThrow();
    await expect(create("hr-contract-workers", { name: "Ghost Worker", phone: "9898000001", contractorIds: [String(new Types.ObjectId())] })).rejects.toMatchObject({ code: "BAD_CONTRACTOR" });
    const suresh = await ContractWorker.findOne({ businessId, name: "Suresh Kumar" }).lean<{ _id: Types.ObjectId; contractorIds: Types.ObjectId[]; workerCode: string }>();
    expect(suresh!.contractorIds.map(String).sort()).toEqual([String(main!._id), String(sub!._id)].sort());
    expect(suresh!.workerCode).toMatch(/^WRK-/);

    // Bulk upload: contractors by code or name, several per cell; unknown ones and duplicates are caught first.
    const sheet = (rows: Record<string, string>[]) => ({
      headers: ["Name", "Mobile Number", "Emergency Number", "Contractors", "Day Wage"],
      rows: rows.map((cells, i) => ({ rowNumber: i + 2, cells })),
    });
    const bad = await previewImport(
      "hr-contract-workers",
      sheet([
        { Name: "Anil Yadav", "Mobile Number": "9800000001", "Emergency Number": "", Contractors: "Nobody Ltd", "Day Wage": "" },
        { Name: "Suresh Again", "Mobile Number": "9898012345", "Emergency Number": "", Contractors: main!.contractorCode, "Day Wage": "" },
      ]),
      ctx
    );
    expect(bad.errorRows).toBe(1);
    expect(bad.rows[0].errors[0].message).toMatch(/Nobody Ltd/);
    expect(bad.rows[1].duplicate).toBe(true);
    const good = sheet([
      { Name: "Anil Yadav", "Mobile Number": "9800000001", "Emergency Number": "9800000009", Contractors: `${main!.contractorCode}, kiran builders`, "Day Wage": "700" },
      { Name: "Ravi Das", "Mobile Number": "9800000002", "Emergency Number": "", Contractors: "Kiran Builders", "Day Wage": "" },
    ]);
    expect(await commitImport("hr-contract-workers", good, ctx, { skipDuplicates: true })).toMatchObject({ imported: 2 });
    const anil = await ContractWorker.findOne({ businessId, name: "Anil Yadav" }).lean<{ _id: Types.ObjectId; contractorIds: Types.ObjectId[]; dailyWage: unknown }>();
    expect(anil!.contractorIds).toHaveLength(2);
    expect(String(anil!.dailyWage)).toBe("700");
    const ravi = await ContractWorker.findOne({ businessId, name: "Ravi Das" }).lean<{ _id: Types.ObjectId }>();

    // Tree: the sub-contractor hangs under the main one; workers count under each contractor they work for.
    const tree = await contractorTree(ctx);
    expect(tree.items.find((n) => n.id === String(sub!._id))).toMatchObject({ managerId: String(main!._id), workerCount: 3 });
    expect(tree.items.find((n) => n.id === String(main!._id))).toMatchObject({ managerId: null, workerCount: 2 });
    expect((await contractorWorkers(ctx, String(main!._id))).workers.map((w) => w.name).sort()).toEqual(["Anil Yadav", "Suresh Kumar"]);

    // Attendance on Tuesday 2 March 2027 (General Shift 09:30-18:30: overtime is time beyond those 9 hours).
    const day = "2027-03-02";
    const listed = await labourSheet(ctx, day, String(sub!._id));
    expect(listed.rows.map((r) => r.name).sort()).toEqual(["Anil Yadav", "Ravi Das", "Suresh Kumar"]);
    expect(listed.rows.find((r) => r.name === "Ravi Das")!.contractorId).toBe(String(sub!._id));
    const row = (workerId: unknown, contractorId: unknown, status: string, checkIn = "", checkOut = "") => ({ workerId: String(workerId), contractorId: String(contractorId), status, checkIn, checkOut, notes: "" });
    await saveLabourSheet(
      ctx,
      saveLabourSheetSchema.parse({
        date: day,
        rows: [
          row(suresh!._id, main!._id, "PRESENT", "09:30", "20:30"), // 11h in a 9h shift → 2h OT
          row(anil!._id, sub!._id, "PRESENT", "09:30", "18:50"), // 20 min over: below Kiran's 30-minute minimum
          row(ravi!._id, sub!._id, "PRESENT", "09:30", "21:00"), // 2h 30m over
        ],
      })
    );
    await saveLabourSheet(ctx, saveLabourSheetSchema.parse({ date: "2027-03-03", rows: [row(suresh!._id, sub!._id, "HALF_DAY", "09:30", "13:30"), row(anil!._id, main!._id, "ABSENT")] }));
    expect(await ContractAttendance.findOne({ businessId, workerId: suresh!._id, date: new Date(`${day}T00:00:00Z`) }).lean()).toMatchObject({ overtimeMinutes: 120, workedMinutes: 660, overtimeManual: false });
    expect(await ContractAttendance.findOne({ businessId, workerId: anil!._id, date: new Date(`${day}T00:00:00Z`) }).lean()).toMatchObject({ overtimeMinutes: 0 });
    expect(await ContractAttendance.findOne({ businessId, workerId: ravi!._id, date: new Date(`${day}T00:00:00Z`) }).lean()).toMatchObject({ overtimeMinutes: 150, overtimeManual: false });
    // Booking a worker to a contractor they don't work for is refused.
    await expect(saveLabourSheet(ctx, saveLabourSheetSchema.parse({ date: day, rows: [row(ravi!._id, main!._id, "PRESENT")] }))).rejects.toMatchObject({ code: "WORKER_NOT_UNDER_CONTRACTOR" });

    // Overtime: Suresh under Ramesh 2h × (600 ÷ 8 × 2 = 150) = 300; Ravi under Kiran 2.5h × fixed 120 = 300.
    const report = await overtimeReport(ctx, 2027, 3);
    const line = (name: string, contractor: string) => report.rows.find((r) => r.name === name && r.contractor === contractor)!;
    expect(line("Suresh Kumar", "Ramesh Patel")).toMatchObject({ presentDays: 1, wages: "600.00", overtimeHours: "2.00", overtimeRate: "150.00", overtimeAmount: "300.00", total: "900.00" });
    expect(line("Suresh Kumar", "Kiran Builders")).toMatchObject({ halfDays: 1, payableDays: "0.5", dailyWage: "500.00", wages: "250.00", overtimeAmount: "0.00" });
    expect(line("Ravi Das", "Kiran Builders")).toMatchObject({ overtimeHours: "2.50", overtimeRate: "120.00", overtimeAmount: "300.00", wages: "500.00" });
    expect(line("Anil Yadav", "Kiran Builders")).toMatchObject({ dailyWage: "700.00", wages: "700.00", overtimeAmount: "0.00" });
    expect(line("Anil Yadav", "Ramesh Patel")).toMatchObject({ absentDays: 1, wages: "0.00" });
    expect(report.totals).toMatchObject({ overtimeHours: "4.50", overtimeAmount: "600.00", wages: "2050.00", total: "2650.00" });
    expect((await overtimeReport(ctx, 2027, 3, String(main!._id))).totals.overtimeAmount).toBe("300.00");
  });

  it("runs advance requests and claim settlement: approve, set off claims against an advance, pay claims directly", async () => {
    const { requestAdvance, advanceRequestSchema, decideAdvance, advanceDecisionSchema, createClaim, claimCreateSchema, decideClaim, adjustClaimsAgainstAdvance, settleClaims, claimSettlementSchema, listLoans, loanListSchema } = await import("@/lib/hr/money");
    const { EmployeeLoan, ExpenseClaim } = await import("@/models/hr");

    // A request issues nothing until approved, and only one may wait at a time.
    const req = await requestAdvance(ctx, advanceRequestSchema.parse({ employeeId: String(emp.ravi), amount: "10000", emiAmount: "2000", reason: "Medical bills" }), { self: false });
    expect(await EmployeeLoan.findById(req.id).lean()).toMatchObject({ status: "REQUESTED", requestedBy: "HR" });
    await expect(requestAdvance(ctx, advanceRequestSchema.parse({ employeeId: String(emp.ravi), amount: "500", emiAmount: "500", reason: "Again" }), { self: false })).rejects.toMatchObject({ code: "REQUEST_PENDING" });
    expect((await listLoans(ctx, loanListSchema.parse({ status: "REQUESTED" }))).requestedCount).toBe(1);

    // HR approves less than asked.
    expect(advanceDecisionSchema.safeParse({ action: "approve", amount: "1000", emiAmount: "2000", issueDate: "2027-04-01", startMonth: 5, startYear: 2027 }).success).toBe(false);
    await decideAdvance(ctx, req.id, advanceDecisionSchema.parse({ action: "approve", amount: "8000", emiAmount: "2000", issueDate: "2027-04-01", startMonth: 5, startYear: 2027, note: "Approved 8k" }));
    expect(await EmployeeLoan.findById(req.id).lean()).toMatchObject({ status: "ACTIVE", startMonth: 5, decisionNote: "Approved 8k" });
    expect(String((await EmployeeLoan.findById(req.id).lean<{ amount: unknown }>())!.amount)).toBe("8000.00");
    await expect(decideAdvance(ctx, req.id, advanceDecisionSchema.parse({ action: "reject", note: "Too late" }))).rejects.toMatchObject({ code: "REQUEST_DECIDED" });

    // Claims: two of Ravi's, one of Asha's, all approved.
    const claim = async (employeeId: Types.ObjectId, amount: string) => {
      const c = await createClaim(ctx, claimCreateSchema.parse({ employeeId: String(employeeId), claimDate: "2027-04-05", category: "TRAVEL", amount, description: "Site visit" }), { self: false });
      await decideClaim(ctx, c.id, "APPROVED", "");
      return c.id;
    };
    const r1 = await claim(emp.ravi, "1200.50");
    const r2 = await claim(emp.ravi, "1799.50");
    const a1 = await claim(emp.asha, "650");

    // Set Ravi's claims off against his advance: one transaction, both sides settled.
    await expect(adjustClaimsAgainstAdvance(ctx, req.id, { claimIds: [a1] })).rejects.toMatchObject({ code: "CLAIM_OTHER_EMPLOYEE" });
    expect(await adjustClaimsAgainstAdvance(ctx, req.id, { claimIds: [r1, r2] })).toMatchObject({ adjusted: "3000.00", status: "ACTIVE" });
    const loan = await EmployeeLoan.findById(req.id).lean<{ repaidAmount: unknown; repayments: { claimIds: unknown[] }[] }>();
    expect(String(loan!.repaidAmount)).toBe("3000.00");
    expect(loan!.repayments[0].claimIds).toHaveLength(2);
    expect(await ExpenseClaim.findById(r1).lean()).toMatchObject({ status: "REIMBURSED", settlementMode: "ADVANCE", settlementReference: (await EmployeeLoan.findById(req.id).lean<{ loanNumber: string }>())!.loanNumber });

    // Asha's claim is paid by bank transfer, once.
    expect(await settleClaims(ctx, claimSettlementSchema.parse({ claimIds: [a1], mode: "BANK", paidOn: "2027-04-10", reference: "UTR123" }))).toMatchObject({ settled: 1, amount: "650.00" });
    expect(await ExpenseClaim.findById(a1).lean()).toMatchObject({ status: "REIMBURSED", settlementMode: "BANK", settlementReference: "UTR123", payrollRunId: null });
    await expect(settleClaims(ctx, claimSettlementSchema.parse({ claimIds: [a1], mode: "CASH", paidOn: "2027-04-11" }))).rejects.toMatchObject({ code: "CLAIM_NOT_APPROVED" });

    // A rejected request stays out of payroll.
    const second = await requestAdvance(ctx, advanceRequestSchema.parse({ employeeId: String(emp.ravi), amount: "500", emiAmount: "500", reason: "Festival" }), { self: false });
    await decideAdvance(ctx, second.id, advanceDecisionSchema.parse({ action: "reject", note: "One advance at a time" }));
    expect(await EmployeeLoan.findById(second.id).lean()).toMatchObject({ status: "REJECTED", decisionNote: "One advance at a time" });
  });

  it("assigns shifts to employees and contractors; a contractor's shift sets its workers' overtime", async () => {
    const { assignShift, shiftAssignments, shiftAssignSchema, shiftAssignmentListSchema } = await import("@/lib/hr/shiftAssign");
    const { saveLabourSheet, saveLabourSheetSchema } = await import("@/lib/hr/contractLabour");
    const { Shift, Employee } = await import("@/models/hr");
    const { Contractor, ContractWorker, ContractAttendance } = await import("@/models/contractLabour");

    const early = await Shift.create({ businessId, name: "Early", startTime: "08:00", endTime: "16:00", fullDayHours: 8, halfDayHours: 4 });
    const closed = await Shift.create({ businessId, name: "Old Night", startTime: "22:00", endTime: "06:00", status: "INACTIVE" });

    await assignShift(ctx, "employees", shiftAssignSchema.parse({ ids: [String(emp.asha)], shiftId: String(early._id) }));
    expect(String((await Employee.findById(emp.asha).lean<{ shiftId: unknown }>())!.shiftId)).toBe(String(early._id));
    await expect(assignShift(ctx, "employees", shiftAssignSchema.parse({ ids: [String(emp.asha)], shiftId: String(closed._id) }))).rejects.toMatchObject({ code: "SHIFT_INACTIVE" });
    await assignShift(ctx, "employees", shiftAssignSchema.parse({ ids: [String(emp.asha)], shiftId: null }));
    expect((await Employee.findById(emp.asha).lean<{ shiftId: unknown }>())!.shiftId).toBeNull();

    const main = await Contractor.findOne({ businessId, name: "Ramesh Patel" }).lean<{ _id: Types.ObjectId }>();
    await assignShift(ctx, "contractors", shiftAssignSchema.parse({ ids: [String(main!._id)], shiftId: String(early._id) }));
    const list = await shiftAssignments(ctx, "contractors", shiftAssignmentListSchema.parse({ shift: String(early._id) }));
    expect(list.items.map((c) => c.name)).toEqual(["Ramesh Patel"]);
    expect(list.shifts.find((s) => s.name === "Early")!.count).toBe(1);

    // Suresh has no shift of his own, so a day under Ramesh follows Early (8 hours): 08:00-17:00 is 1 hour over.
    const suresh = await ContractWorker.findOne({ businessId, name: "Suresh Kumar" }).lean<{ _id: Types.ObjectId }>();
    await saveLabourSheet(ctx, saveLabourSheetSchema.parse({ date: "2027-03-04", rows: [{ workerId: String(suresh!._id), contractorId: String(main!._id), status: "PRESENT", checkIn: "08:00", checkOut: "17:00" }] }));
    expect(await ContractAttendance.findOne({ businessId, workerId: suresh!._id, date: new Date("2027-03-04T00:00:00Z") }).lean()).toMatchObject({ workedMinutes: 540, overtimeMinutes: 60 });
  });
});
