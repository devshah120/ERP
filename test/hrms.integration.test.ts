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
    expect(balance.find((x) => x.code === "CL")).toMatchObject({ allocated: 12, used: 2, available: 10 });
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
});
