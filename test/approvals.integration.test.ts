import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789-0123456789-0123456789";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789-0123456789-0123456789";

/*
 * The approval scheme engine against a real replica set: multi-stage order,
 * amount limits, self-approval, outsiders, escalation to the owner, owner
 * override, restarts when the record changes, concurrent decisions, history
 * privacy and product isolation. Driven through the real claim module and
 * the real queue (requestForAction → actOnApproval), as the screens are.
 */

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
  process.env.MONGODB_URI = replSet.getUri("approvals-test");
  await mongoose.connect(process.env.MONGODB_URI);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;

describe("Approval schemes (real replica set)", () => {
  let businessId: Types.ObjectId;
  const ctx: Record<string, Ctx> = {};
  const user: Record<string, Types.ObjectId> = {};
  const emp: Record<string, Types.ObjectId> = {};
  let groupId = "";

  const ctxFor = (userId: Types.ObjectId, permissions: string[]): Ctx => ({ userId, businessId, roleId: new Types.ObjectId(), permissions, branchIds: [], warehouseIds: [], products: ["HRMS"] });

  async function svc() {
    return {
      ...(await import("@/lib/approvals/service")),
      ...(await import("@/lib/approvals/adapters")),
      ...(await import("@/lib/hr/money")),
      ...(await import("@/models/approval")),
      ...(await import("@/models/hr")),
    };
  }

  /** Raises a claim as `who` (self-service) and returns its id. */
  async function claim(who: Ctx, amount: string) {
    const { createClaim, claimCreateSchema } = await svc();
    const r = await createClaim(who, claimCreateSchema.parse({ claimDate: "2026-11-10", amount, description: "Client visit taxi" }), { self: true });
    return r.id;
  }
  async function openRequest(recordId: string) {
    const { ApprovalRequest } = await svc();
    return ApprovalRequest.findOne({ businessId, document: "hr-claim", recordId: new Types.ObjectId(recordId) }).sort({ createdAt: -1 }).lean<Ctx>();
  }
  /** Decides from the approval queue, exactly as the Approve / Reject buttons do. */
  async function decide(who: Ctx, recordId: string, action: "approve" | "reject", note = "ok") {
    const { requestForAction, actOnApproval } = await svc();
    const req = await openRequest(recordId);
    return actOnApproval(who, await requestForAction(who, String(req._id)), action, note);
  }
  async function claimStatus(id: string) {
    const { ExpenseClaim } = await svc();
    return (await ExpenseClaim.findById(id).lean<Ctx>()).status;
  }

  it("sets up a workspace: owner, HR, manager, two approvers, a group and employees", async () => {
    const { provisionWorkspace } = await import("@/lib/services/provisioningService");
    const { User } = await import("@/models/User");
    const { Role } = await import("@/models/Role");
    const { Employee } = await import("@/models/hr");
    const res = await provisionWorkspace({
      legalName: "Approval Test Pvt Ltd",
      ownerName: "Owner One",
      email: "owner@approvals.test",
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
    user.owner = (await User.findOne({ businessId, email: "owner@approvals.test" }).lean<Ctx>())._id;
    ctx.owner = ctxFor(user.owner, ["*"]);

    const plain = await Role.create({ businessId, name: "Approver", permissions: [] });
    const make = async (key: string) => {
      const u = await User.create({ businessId, name: key.toUpperCase(), username: key, email: `${key}@approvals.test`, passwordHash: "x", roleId: plain._id, status: "ACTIVE" });
      user[key] = u._id;
    };
    for (const k of ["hr", "mgr", "a", "b", "c1", "c2", "staff", "orphan"]) await make(k);
    ctx.hr = ctxFor(user.hr, ["hr-claims.view", "hr-claims.create", "hr-claims.approve", "hr-loans.view", "hr-loans.edit", "hr-employees.view"]);
    for (const k of ["mgr", "a", "b", "c1", "c2", "staff", "orphan"]) ctx[k] = ctxFor(user[k], ["hr-self.view"]);

    const e = async (key: string, extra: Record<string, unknown> = {}) => {
      const doc = await Employee.create({ businessId, name: key.toUpperCase(), employeeCode: `E-${key}`, dateOfJoining: new Date("2025-01-01"), userId: user[key], ...extra });
      emp[key] = doc._id;
    };
    await e("mgr");
    await e("staff", { reportingManagerId: emp.mgr });
    await e("orphan"); // no reporting manager
    await e("a", { reportingManagerId: emp.mgr });

    const { createGroup, groupInputSchema } = await svc();
    groupId = (await createGroup(ctx.owner, groupInputSchema.parse({ name: "Finance", userIds: [String(user.c1), String(user.c2)] }))).id;
  });

  it("without a scheme, HR approves directly as before", async () => {
    const { decideClaim } = await svc();
    const id = await claim(ctx.staff, "800");
    expect(await openRequest(id)).toBeNull();
    await decideClaim(ctx.hr, id, "APPROVED", "");
    expect(await claimStatus(id)).toBe("APPROVED");
  });

  it("refuses an invalid scheme", async () => {
    const { saveScheme, schemeInputSchema } = await svc();
    await expect(saveScheme(ctx.owner, "hr-claim", schemeInputSchema.parse({ approvalRequired: true, stages: [] }))).rejects.toMatchObject({ code: "NO_STAGES" });
    await expect(saveScheme(ctx.owner, "hr-claim", schemeInputSchema.parse({ approvalRequired: true, stages: [{ approverType: "SPECIFIC_USER" }] }))).rejects.toMatchObject({ code: "STAGE_USER_REQUIRED" });
    await expect(saveScheme(ctx.owner, "hr-leave", schemeInputSchema.parse({ approvalRequired: true, stages: [{ approverType: "REPORTING_MANAGER", onlyIfAmountExceeds: true, minAmount: "10" }] }))).rejects.toMatchObject({ code: "NO_AMOUNT" });
    await expect(saveScheme(ctx.owner, "hr-claim", schemeInputSchema.parse({ approvalRequired: true, stages: [{ approverType: "USER_GROUP", groupId: String(new Types.ObjectId()) }] }))).rejects.toMatchObject({ code: "STAGE_GROUP_INVALID" });
  });

  it("runs three stages in order; nobody skips ahead, approves their own request or acts out of turn", async () => {
    const { saveScheme, schemeInputSchema, decideClaim, approvalQueue, queueSchema } = await svc();
    await saveScheme(
      ctx.owner,
      "hr-claim",
      schemeInputSchema.parse({
        approvalRequired: true,
        stages: [
          { approverType: "REPORTING_MANAGER" },
          { approverType: "SPECIFIC_USER", userId: String(user.a), onlyIfAmountExceeds: true, minAmount: "1000" },
          { approverType: "USER_GROUP", groupId },
        ],
      })
    );
    const id = await claim(ctx.staff, "5000");
    expect((await openRequest(id)).currentStage).toBe(1);

    // The requester, an outsider, a later stage's approver and HR (who holds the module's own approve permission) are all refused.
    await expect(decide(ctx.staff, id, "approve")).rejects.toMatchObject({ statusCode: 403 });
    await expect(decide(ctx.b, id, "approve")).rejects.toMatchObject({ statusCode: 403 });
    await expect(decide(ctx.a, id, "approve")).rejects.toMatchObject({ statusCode: 403 });
    await expect(decide(ctx.c1, id, "approve")).rejects.toMatchObject({ statusCode: 403 });
    await expect(decideClaim(ctx.hr, id, "APPROVED", "")).rejects.toMatchObject({ code: "APPROVAL_NOT_YOURS" });
    expect(await claimStatus(id)).toBe("PENDING");

    // It is in the manager's queue and nobody else's.
    expect((await approvalQueue(ctx.mgr, queueSchema.parse({}), false)).total).toBe(1);
    expect((await approvalQueue(ctx.a, queueSchema.parse({}), false)).total).toBe(0);
    await expect(approvalQueue(ctx.mgr, queueSchema.parse({ scope: "all" }), false)).rejects.toMatchObject({ statusCode: 403 });

    const r1 = await decide(ctx.mgr, id, "approve", "Fine by me");
    expect(r1.approvalMessage).toMatch(/Stage-1 approved/);
    expect(await claimStatus(id)).toBe("PENDING");
    await expect(decide(ctx.mgr, id, "approve")).rejects.toMatchObject({ statusCode: 403 }); // can't approve stage 2 too

    await decide(ctx.a, id, "approve");
    expect(await claimStatus(id)).toBe("PENDING");
    await decide(ctx.c2, id, "approve");
    expect(await claimStatus(id)).toBe("APPROVED");

    const req = await openRequest(id);
    expect(req.status).toBe("APPROVED");
    expect(req.stages.map((s: Ctx) => [s.status, s.override])).toEqual([
      ["APPROVED", false],
      ["APPROVED", false],
      ["APPROVED", false],
    ]);
    expect(req.stages[0].note).toBe("Fine by me");
  });

  it("skips a stage only when the amount is within its limit", async () => {
    const id = await claim(ctx.staff, "600");
    await decide(ctx.mgr, id, "approve");
    const req = await openRequest(id);
    expect(req.stages[1].status).toBe("SKIPPED");
    expect(req.currentStage).toBe(3);
    await decide(ctx.c1, id, "approve");
    expect(await claimStatus(id)).toBe("APPROVED");
  });

  it("a rejection at any stage rejects the record, with the reason kept", async () => {
    const id = await claim(ctx.staff, "4000");
    await decide(ctx.mgr, id, "approve");
    await decide(ctx.a, id, "reject", "No bill attached");
    expect(await claimStatus(id)).toBe("REJECTED");
    const req = await openRequest(id);
    expect(req.status).toBe("REJECTED");
    expect(req.stages[1]).toMatchObject({ status: "REJECTED", note: "No bill attached" });
    expect(req.stages[2].status).toBe("WAITING");
  });

  it("never skips a stage nobody can act on: it goes to the owner", async () => {
    // No reporting manager: the manager stage goes to the owner, not straight through.
    const id = await claim(ctx.orphan, "300");
    let req = await openRequest(id);
    expect(req.status).toBe("PENDING");
    expect(req.stages[0].escalatedReason).toMatch(/No reporting manager/);
    expect(req.currentApproverUserIds.map(String)).toEqual([String(user.owner)]);
    await expect(decide(ctx.mgr, id, "approve")).rejects.toMatchObject({ statusCode: 403 });
    await decide(ctx.owner, id, "approve");
    req = await openRequest(id);
    expect(req.stages[0]).toMatchObject({ status: "APPROVED", override: false });

    // The named approver raising the request themselves: their stage goes to the owner too.
    const own = await claim(ctx.a, "2000");
    await decide(ctx.mgr, own, "approve");
    req = await openRequest(own);
    expect(req.currentStage).toBe(2);
    expect(req.stages[1].escalatedReason).toMatch(/raised this request/);
    await expect(decide(ctx.a, own, "approve")).rejects.toMatchObject({ statusCode: 403 });

    // An emptied group: the stage goes to the owner.
    const { ApprovalUserGroup, User } = await svc().then(async (m) => ({ ...m, User: (await import("@/models/User")).User }));
    await User.updateMany({ _id: { $in: [user.c1, user.c2] } }, { status: "DISABLED" });
    const g = await claim(ctx.staff, "500");
    await decide(ctx.mgr, g, "approve");
    req = await openRequest(g);
    expect(req.stages[2].escalatedReason).toMatch(/No one else in the user group/);
    expect(req.currentGroupId).toBeNull();
    await User.updateMany({ _id: { $in: [user.c1, user.c2] } }, { status: "ACTIVE" });
    expect(await ApprovalUserGroup.countDocuments({ businessId })).toBe(1);
  });

  it("records the owner deciding someone else's stage as an override", async () => {
    const id = await claim(ctx.staff, "700");
    await decide(ctx.owner, id, "approve");
    const req = await openRequest(id);
    expect(req.stages[0]).toMatchObject({ status: "APPROVED", override: true });
  });

  it("restarts from stage 1 when what was approved changes, and never reuses an approval for different content", async () => {
    const { openApproval, approvalGate, approvalFingerprint, ApprovalRequest } = await svc();
    const recordId = new Types.ObjectId();
    const rec = (amount: string) => ({ id: recordId, number: "TEST-1", amount, employeeId: emp.staff, requestedByUserId: user.staff, fingerprint: approvalFingerprint({ amount }) });

    await openApproval(ctx.staff, "hr-claim", rec("5000"));
    expect((await approvalGate(ctx.mgr, "hr-claim", rec("5000"), "approve")).proceed).toBe(false); // stage 1 done

    // Amount raised after stage 1 approved: the stage-2 approver's click restarts it instead of counting.
    const changed = await approvalGate(ctx.a, "hr-claim", rec("50000"), "approve");
    expect(changed).toMatchObject({ proceed: false });
    expect((changed as { message: string }).message).toMatch(/changed after it was sent/);
    const rounds = await ApprovalRequest.find({ businessId, recordId }).sort({ createdAt: 1 }).lean<Ctx[]>();
    expect(rounds.map((r) => r.status)).toEqual(["CANCELLED", "PENDING"]);
    expect(rounds[0].closedReason).toMatch(/approval started again/);
    expect(rounds[1].currentStage).toBe(1);

    // Fully approved, then changed before the module step ran: the old approval is not reused.
    await approvalGate(ctx.mgr, "hr-claim", rec("50000"), "approve");
    await approvalGate(ctx.a, "hr-claim", rec("50000"), "approve");
    expect((await approvalGate(ctx.c1, "hr-claim", rec("50000"), "approve")).proceed).toBe(true);
    expect((await approvalGate(ctx.hr, "hr-claim", rec("50000"), "approve")).proceed).toBe(true); // same content: retry allowed
    expect((await approvalGate(ctx.hr, "hr-claim", rec("99999"), "approve")).proceed).toBe(false); // different content: starts again
  });

  it("refuses the second of two approvers deciding the same stage at once", async () => {
    const { ApprovalRequest } = await svc();
    const id = await claim(ctx.staff, "900");
    await decide(ctx.mgr, id, "approve");
    const r = await openRequest(id);
    const first = await ApprovalRequest.findById(r._id);
    const second = await ApprovalRequest.findById(r._id);
    first.stages[2].status = "APPROVED";
    await first.save();
    second.stages[2].status = "REJECTED";
    await expect(second.save()).rejects.toThrow(mongoose.Error.VersionError);
  });

  it("keeps scheme history in words and keeps request history private", async () => {
    const { saveScheme, schemeInputSchema, schemeHistory, requestHistory } = await svc();
    await saveScheme(ctx.owner, "hr-claim", schemeInputSchema.parse({ approvalRequired: true, stages: [{ approverType: "SPECIFIC_USER", userId: String(user.b) }] }));
    const h = await schemeHistory(ctx.owner, "hr-claim");
    expect(h[0]).toMatchObject({ action: "Changed", by: "Owner One" });
    expect(h[0].before!.stages).toEqual(["1. Reporting Manager", "2. Specific User (A) if > ₹1000.00", "3. User Group (Finance)"]);
    expect(h[0].after.stages).toEqual(["1. Specific User (B)"]);
    expect(h.at(-1)!.action).toBe("Created");

    const id = await claim(ctx.staff, "1500");
    const req = await openRequest(id);
    const own = await requestHistory(ctx.staff, String(req._id));
    expect(own.rounds[0].stages[0].approver).toBe("Specific User (B)");
    expect((await requestHistory(ctx.b, String(req._id))).rounds).toHaveLength(1);
    await expect(requestHistory(ctx.c1, String(req._id))).rejects.toMatchObject({ code: "APPROVAL_PRIVATE" });
    await expect(requestHistory(ctx.mgr, String(req._id))).rejects.toMatchObject({ code: "APPROVAL_PRIVATE" });
  });

  it("withdrawing closes the approval; a disabled scheme lets HR decide directly again", async () => {
    const { withdrawClaim, saveScheme, schemeInputSchema, decideClaim } = await svc();
    const id = await claim(ctx.staff, "1200");
    await withdrawClaim(ctx.staff, id).catch(async () => withdrawClaim(ctx.hr, id));
    expect((await openRequest(id)).status).toBe("CANCELLED");

    await saveScheme(ctx.owner, "hr-claim", schemeInputSchema.parse({ approvalRequired: false, stages: [] }));
    const next = await claim(ctx.staff, "1300");
    await decideClaim(ctx.hr, next, "APPROVED", "");
    expect(await claimStatus(next)).toBe("APPROVED");
  });

  it("keeps workspaces and products apart", async () => {
    const { ApprovalRequest, requestForAction, requestHistory } = await svc();
    // An ERP document's request can't be acted on or read from an HRMS-only workspace.
    const erp = await ApprovalRequest.create({ businessId, document: "sales-orders", recordId: new Types.ObjectId(), status: "PENDING", currentStage: 1, currentApproverUserIds: [user.b], stages: [{ stage: 1, approverType: "SPECIFIC_USER", userId: user.b, status: "PENDING" }] });
    await expect(requestForAction(ctx.b, String(erp._id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(requestHistory(ctx.owner, String(erp._id))).rejects.toMatchObject({ statusCode: 404 });
    // Another workspace's owner sees nothing of this one.
    const stranger = { ...ctx.owner, businessId: new Types.ObjectId(), userId: new Types.ObjectId() };
    const any = await ApprovalRequest.findOne({ businessId, document: "hr-claim" }).lean<Ctx>();
    await expect(requestForAction(stranger, String(any._id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(requestHistory(stranger, String(any._id))).rejects.toMatchObject({ statusCode: 404 });
  });
});
