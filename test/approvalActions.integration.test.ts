import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789-0123456789-0123456789";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789-0123456789-0123456789";

/*
 * The enterprise approval layer against a real replica set: held actions
 * (nothing is written until the last stage approves), Department Head and
 * Designated Role approvers, send back → resubmit, withdraw, duplicate
 * prevention, a held change run exactly once under concurrent approvals,
 * held master writes, claim schemes by category, comments, notifications
 * and the approval management scopes. Driven through the real modules and
 * the real approval screens' calls (requestForAction → actOnApproval).
 */

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
  process.env.MONGODB_URI = replSet.getUri("approval-actions-test");
  await mongoose.connect(process.env.MONGODB_URI);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;

describe("Held actions and enterprise approvers (real replica set)", () => {
  let businessId: Types.ObjectId;
  const ctx: Record<string, Ctx> = {};
  const user: Record<string, Types.ObjectId> = {};
  const emp: Record<string, Types.ObjectId> = {};
  let financeRole: Types.ObjectId;
  let groupId = "";
  let leaveTypeId = "";

  const ctxFor = (userId: Types.ObjectId, permissions: string[], roleId = new Types.ObjectId()): Ctx => ({ userId, businessId, roleId, permissions, branchIds: [], warehouseIds: [], products: ["HRMS"] });

  async function svc() {
    return {
      ...(await import("@/lib/approvals/service")),
      ...(await import("@/lib/approvals/adapters")),
      ...(await import("@/models/approval")),
      ...(await import("@/models/hr")),
    };
  }
  async function scheme(document: string, stages: Record<string, unknown>[]) {
    const { saveScheme, schemeInputSchema } = await svc();
    await saveScheme(ctx.owner, document, schemeInputSchema.parse({ approvalRequired: stages.length > 0, stages }));
  }
  async function decide(who: Ctx, requestId: string, action: "approve" | "reject" | "send-back", note = "ok") {
    const { requestForAction, actOnApproval } = await svc();
    return actOnApproval(who, await requestForAction(who, requestId), action, note);
  }
  async function request(id: string) {
    const { ApprovalRequest } = await svc();
    return ApprovalRequest.findById(id).lean<Ctx>();
  }

  it("sets up a workspace with a department head, a finance role and a group", async () => {
    const { provisionWorkspace } = await import("@/lib/services/provisioningService");
    const { User } = await import("@/models/User");
    const { Role } = await import("@/models/Role");
    const { Employee, HrDepartment, LeaveType } = await svc();
    const res = await provisionWorkspace({
      legalName: "Held Actions Pvt Ltd",
      ownerName: "Owner One",
      email: "owner@held.test",
      password: "Str0ng!Passw0rd",
      country: "India",
      currency: "INR",
      timeZone: "Asia/Kolkata",
      financialYearStartMonth: 4,
      products: ["HRMS"],
      plan: "STARTER",
      maxEmployees: 50,
      subscriptionEndsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    });
    businessId = new Types.ObjectId(res.businessId);
    user.owner = (await User.findOne({ businessId, email: "owner@held.test" }).lean<Ctx>())._id;
    ctx.owner = ctxFor(user.owner, ["*"]);

    const plain = await Role.create({ businessId, name: "Staff", permissions: [] });
    financeRole = (await Role.create({ businessId, name: "Finance Approver", permissions: [] }))._id;
    const make = async (key: string, roleId: Types.ObjectId) => {
      user[key] = (await User.create({ businessId, name: key.toUpperCase(), username: key, email: `${key}@held.test`, passwordHash: "x", roleId, status: "ACTIVE" }))._id;
    };
    for (const k of ["hr", "head", "a", "c1", "c2", "outsider"]) await make(k, plain._id);
    await make("fin", financeRole);

    const HR_PERMS = ["hr-attendance.view", "hr-attendance.edit", "hr-leaves.allocate", "hr-loans.create", "hr-payroll-settings.edit", "hr-claims.approve"];
    ctx.hr = ctxFor(user.hr, HR_PERMS);
    for (const k of ["head", "a", "c1", "c2", "outsider"]) ctx[k] = ctxFor(user[k], ["hr-self.view"]);
    ctx.fin = ctxFor(user.fin, ["hr-self.view"], financeRole);

    const e = async (key: string, extra: Record<string, unknown> = {}) => {
      emp[key] = (await Employee.create({ businessId, name: key.toUpperCase(), employeeCode: `E-${key}`, dateOfJoining: new Date("2025-01-01"), userId: user[key] ?? null, ...extra }))._id;
    };
    await e("head");
    const dept = await HrDepartment.create({ businessId, code: "FLOORX", name: "Shop Floor", headEmployeeId: emp.head });
    await e("staff", { departmentId: dept._id });
    await e("hr", { departmentId: dept._id });
    leaveTypeId = String((await LeaveType.create({ businessId, code: "TCL", name: "Test Casual Leave", annualQuota: 12 }))._id);

    const { createGroup, groupInputSchema } = await svc();
    groupId = (await createGroup(ctx.owner, groupInputSchema.parse({ name: "Payroll Desk", userIds: [String(user.c1), String(user.c2)] }))).id;
  });

  it("validates the new approver types", async () => {
    const { saveScheme, schemeInputSchema } = await svc();
    await expect(saveScheme(ctx.owner, "hr-leave-balance", schemeInputSchema.parse({ approvalRequired: true, stages: [{ approverType: "DESIGNATED_ROLE" }] }))).rejects.toMatchObject({ code: "STAGE_ROLE_REQUIRED" });
    await expect(
      saveScheme(ctx.owner, "hr-leave-balance", schemeInputSchema.parse({ approvalRequired: true, stages: [{ approverType: "SPECIFIC_USER", userId: String(user.a) }, { approverType: "SPECIFIC_USER", userId: String(user.a) }] }))
    ).rejects.toMatchObject({ code: "STAGE_DUPLICATE" });
  });

  it("holds a leave balance change: department head, then anyone in the role; written only after the last stage", async () => {
    const { setAllocation, allocationSchema } = await import("@/lib/hr/leave");
    const { LeaveAllocation, Notification } = await svc();
    await scheme("hr-leave-balance", [{ approverType: "DEPARTMENT_HEAD" }, { approverType: "DESIGNATED_ROLE", roleId: String(financeRole) }]);

    const held = await setAllocation(ctx.hr, allocationSchema.parse({ employeeId: String(emp.staff), leaveTypeId, year: 2026, allocated: 20, carriedForward: 2 }));
    expect(held).toMatchObject({ pendingApproval: true });
    const id = (held as Ctx).approvalId;
    expect(await LeaveAllocation.countDocuments({ businessId })).toBe(0);
    const r0 = await request(id);
    expect(r0.requestNo).toMatch(/^APR-\d{6}$/);
    expect(r0.departmentName).toBe("Shop Floor");
    expect(String(r0.currentApproverUserIds[0])).toBe(String(user.head));
    expect(await Notification.countDocuments({ businessId, userId: user.head, kind: "APPROVAL_PENDING" })).toBe(1);

    // Nobody skips ahead: the role holder can't act on stage 1, the requester never.
    await expect(decide(ctx.fin, id, "approve")).rejects.toMatchObject({ code: "APPROVAL_NOT_YOURS" });
    await expect(decide(ctx.hr, id, "approve")).rejects.toMatchObject({ code: "APPROVAL_NOT_YOURS" });

    const step = await decide(ctx.head, id, "approve");
    expect(step.approvalMessage).toMatch(/Stage-1 approved/);
    expect(await LeaveAllocation.countDocuments({ businessId })).toBe(0);
    const r1 = await request(id);
    expect(String(r1.currentRoleId)).toBe(String(financeRole));

    const final = await decide(ctx.fin, id, "approve", "Agreed");
    expect(final).toMatchObject({ applied: true });
    const alloc = await LeaveAllocation.findOne({ businessId, employeeId: emp.staff }).lean<Ctx>();
    expect(alloc.allocated).toBe(20);
    const r2 = await request(id);
    expect(r2.status).toBe("APPROVED");
    expect(r2.resultSummary).toBe("Leave allocation saved");
    expect(await Notification.countDocuments({ businessId, userId: user.hr, kind: "APPROVAL_DECIDED" })).toBe(1);
  });

  it("sends back, resubmits with the conversation, and refuses a second change to the same thing meanwhile", async () => {
    const { saveDailySheet, saveSheetSchema } = await import("@/lib/hr/attendance");
    const { resubmit } = await svc();
    const { Attendance } = await svc();
    await scheme("hr-attendance-daily", [{ approverType: "SPECIFIC_USER", userId: String(user.a) }]);
    const sheet = saveSheetSchema.parse({ date: "2026-11-10", rows: [{ employeeId: String(emp.staff), status: "ABSENT" }] });

    const held = (await saveDailySheet(ctx.hr, sheet)) as Ctx;
    expect(held.pendingApproval).toBe(true);
    await expect(saveDailySheet(ctx.hr, sheet)).rejects.toMatchObject({ code: "APPROVAL_ALREADY_PENDING" });

    await decide(ctx.a, held.approvalId, "send-back", "Two people were on leave that day");
    const sent = await request(held.approvalId);
    expect(sent.status).toBe("SENT_BACK");
    expect(await Attendance.countDocuments({ businessId })).toBe(0);

    await expect(resubmit(ctx.outsider, held.approvalId, "hr-attendance-daily", "")).rejects.toMatchObject({ code: "NOT_REQUESTER" });
    const again = (await resubmit(ctx.hr, held.approvalId, "hr-attendance-daily", "Checked with the supervisor")) as Ctx;
    const next = await request(again.id);
    expect(next.status).toBe("PENDING");
    expect(next.comments.map((c: Ctx) => c.kind)).toContain("RESUBMIT");
    expect((await request(held.approvalId)).closedReason).toMatch(/Sent again as APR-/);

    await decide(ctx.a, again.id, "approve");
    expect(await Attendance.countDocuments({ businessId, employeeId: emp.staff })).toBe(1);
  });

  it("rejecting or withdrawing writes nothing", async () => {
    const { saveDailySheet, saveSheetSchema } = await import("@/lib/hr/attendance");
    const { withdrawHeldAction, Attendance } = await svc();
    const a = (await saveDailySheet(ctx.hr, saveSheetSchema.parse({ date: "2026-11-11", rows: [{ employeeId: String(emp.staff), status: "ABSENT" }] }))) as Ctx;
    await decide(ctx.a, a.approvalId, "reject", "Wrong date");
    const b = (await saveDailySheet(ctx.hr, saveSheetSchema.parse({ date: "2026-11-12", rows: [{ employeeId: String(emp.staff), status: "ABSENT" }] }))) as Ctx;
    await expect(withdrawHeldAction(ctx.a, b.approvalId, "")).rejects.toMatchObject({ code: "NOT_REQUESTER" });
    await withdrawHeldAction(ctx.hr, b.approvalId, "Entered twice");
    expect((await request(b.approvalId)).status).toBe("CANCELLED");
    expect(await Attendance.countDocuments({ businessId, date: { $in: [new Date("2026-11-11T00:00:00Z"), new Date("2026-11-12T00:00:00Z")] } })).toBe(0);
  });

  it("runs an approved change exactly once when two group members approve at the same moment", async () => {
    const { createLoan, loanCreateSchema } = await import("@/lib/hr/money");
    const { EmployeeLoan } = await svc();
    await scheme("hr-advance-issue", [{ approverType: "USER_GROUP", groupId }]);
    const held = (await createLoan(ctx.hr, loanCreateSchema.parse({ employeeId: String(emp.staff), issueDate: "2026-11-20", amount: "10000", emiAmount: "2000", startMonth: 12, startYear: 2026 }))) as Ctx;
    expect(held.pendingApproval).toBe(true);
    expect(await EmployeeLoan.countDocuments({ businessId })).toBe(0);
    const results = await Promise.allSettled([decide(ctx.c1, held.approvalId, "approve"), decide(ctx.c2, held.approvalId, "approve")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await EmployeeLoan.countDocuments({ businessId })).toBe(1);
    expect((await request(held.approvalId)).status).toBe("APPROVED");
  });

  it("holds a master write (payroll setup) and applies it through the same form handler", async () => {
    const { getResource } = await import("@/lib/resources/registry");
    const { createResourceRecord } = await import("@/lib/resources/handlers");
    const { PayComponent } = await svc();
    await scheme("hr-payroll-setup", [{ approverType: "SPECIFIC_USER", userId: String(user.a) }]);
    const def = getResource("hr-pay-components")!;
    const res = await createResourceRecord(def, ctxFor(user.hr, ["hr-payroll.create", "hr-payroll.edit"]), { code: "BONUS2", name: "Festival bonus", kind: "EARNING" });
    expect("held" in res).toBe(true);
    expect(await PayComponent.countDocuments({ businessId, code: "BONUS2" })).toBe(0);
    await decide(ctx.a, (res as Ctx).held.approvalId, "approve");
    expect(await PayComponent.countDocuments({ businessId, code: "BONUS2" })).toBe(1);
  });

  it("routes a claim to its category's scheme, falling back to the general claim scheme", async () => {
    const { createClaim, claimCreateSchema } = await import("@/lib/hr/money");
    const { ApprovalRequest } = await svc();
    await scheme("hr-claim-medical", [{ approverType: "SPECIFIC_USER", userId: String(user.a) }]);
    const staff = ctxFor(user.hr, ["hr-claims.create"]);
    const med = await createClaim(staff, claimCreateSchema.parse({ employeeId: String(emp.staff), claimDate: "2026-11-10", amount: "900", category: "MEDICAL", description: "Pharmacy" }), { self: false });
    const other = await createClaim(staff, claimCreateSchema.parse({ employeeId: String(emp.staff), claimDate: "2026-11-10", amount: "300", category: "OTHER", description: "Stationery" }), { self: false });
    expect(await ApprovalRequest.countDocuments({ businessId, recordId: new Types.ObjectId(med.id), document: "hr-claim-medical" })).toBe(1);
    expect(await ApprovalRequest.countDocuments({ businessId, recordId: new Types.ObjectId(other.id) })).toBe(0);
  });

  it("keeps comments private and lists requests by scope", async () => {
    const { addComment, approvalQueue, queueSchema, approvalCounts, requestDetail, ApprovalRequest } = await svc();
    const anyReq = await ApprovalRequest.findOne({ businessId, document: "hr-leave-balance" }).lean<Ctx>();
    await addComment(ctx.hr, String(anyReq._id), "Thanks both");
    await expect(addComment(ctx.outsider, String(anyReq._id), "Hello")).rejects.toMatchObject({ code: "APPROVAL_PRIVATE" });
    const detail = await requestDetail(ctx.head, String(anyReq._id));
    expect(detail.commentsList.at(-1)?.text).toBe("Thanks both");
    expect(detail.stagesDetail).toHaveLength(2);

    const approvedByHead = await approvalQueue(ctx.head, queueSchema.parse({ scope: "approved" }), false);
    expect(approvedByHead.items.some((r: Ctx) => r.id === String(anyReq._id))).toBe(true);
    const raised = await approvalQueue(ctx.hr, queueSchema.parse({ scope: "raised", status: "APPROVED" }), false);
    expect(raised.items.length).toBeGreaterThan(0);
    await expect(approvalQueue(ctx.hr, queueSchema.parse({ scope: "all" }), false)).rejects.toThrow(/approvals.view/);
    const counts = await approvalCounts(ctx.a);
    expect(counts).toMatchObject({ mine: 1 }); // the medical claim
  });

  it("a stage nobody can act on goes to the owner instead of being skipped", async () => {
    const { setAllocation, allocationSchema } = await import("@/lib/hr/leave");
    await scheme("hr-leave-balance", [{ approverType: "DEPARTMENT_HEAD" }]);
    // The change is for "head", who is in no department, so there is no department head to approve it.
    const held = (await setAllocation(ctx.hr, allocationSchema.parse({ employeeId: String(emp.head), leaveTypeId, year: 2026, allocated: 15 }))) as Ctx;
    const r = await request(held.approvalId);
    expect(r.stages[0].escalatedReason).toMatch(/workspace owner/);
    expect(String(r.currentApproverUserIds[0])).toBe(String(user.owner));
  });
});
