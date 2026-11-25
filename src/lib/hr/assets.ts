import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { moneyStringSchema } from "@/lib/validation/money";
import { AssetAllocation, Employee, HrAsset, ASSET_CONDITIONS, ASSET_RETURN_OUTCOMES, WORKING_STATUSES } from "@/models/hr";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, todayIn } from "./calendar";
import { nextHrNumber, employeeLabels, escapeRegex, objectId, pageQuery, businessTimeZone, type AnyDoc } from "./common";

/*
 * Asset management: the register (HrAsset master), allocations of an asset
 * to an employee and their returns (AssetAllocation). The asset's
 * assetStatus, employeeId and assignedDate always mirror its open allocation,
 * so the employee profile and full & final settlement keep reading the asset.
 */

const d = (v: unknown) => new Decimal(v === null || v === undefined || v === "" ? "0" : String(v));
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Assets issued before allocations existed (an employee set on the asset
 * itself) get an open allocation, and assets without a status get one.
 * Cheap when there is nothing to do; run before lists are read.
 */
export async function syncLegacyAssets(businessId: Types.ObjectId): Promise<void> {
  await HrAsset.updateMany({ businessId, assetStatus: { $exists: false }, $or: [{ employeeId: null }, { returnedDate: { $ne: null } }] }, { assetStatus: "AVAILABLE" });
  const legacy = await HrAsset.find({ businessId, deletedAt: null, employeeId: { $ne: null }, returnedDate: null, assetStatus: { $ne: "ALLOCATED" } }).lean<AnyDoc[]>();
  for (const a of legacy) {
    if (await AssetAllocation.exists({ businessId, assetId: a._id, status: "ALLOCATED" })) {
      await HrAsset.updateOne({ _id: a._id, businessId }, { assetStatus: "ALLOCATED" });
      continue;
    }
    const allocationNumber = await nextHrNumber(businessId, "HR_ASSET_ALLOCATION", "AAL");
    await AssetAllocation.create({
      businessId,
      allocationNumber,
      assetId: a._id,
      employeeId: a.employeeId,
      allocatedOn: toDay(a.assignedDate ?? a.createdAt ?? new Date()),
      conditionAtIssue: a.condition ?? "GOOD",
      issueNotes: "Issued before asset allocation was recorded",
    });
    await HrAsset.updateOne({ _id: a._id, businessId }, { assetStatus: "ALLOCATED" });
  }
}

/** The form may move an asset between free, repair, lost and retired, but allocation goes through Asset Allocation / Return Assets. */
export function assertStatusChange(before: AnyDoc, next: unknown): void {
  if (next === undefined || next === before?.assetStatus) return;
  if (before?.assetStatus === "ALLOCATED") throw AppError.badRequest("This asset is with an employee. Take it back on Return Assets first.", "ASSET_ALLOCATED");
  if (next === "ALLOCATED") throw AppError.badRequest("Give an asset to an employee on Asset Allocation.", "USE_ALLOCATION");
}

/* ------------------------------------------------------------------ */
/* Allocate and return                                                 */
/* ------------------------------------------------------------------ */

export const allocateSchema = z
  .object({
    assetId: objectId,
    employeeId: objectId,
    allocatedOn: z.string().trim().min(1, "Choose the date"),
    expectedReturnDate: z.string().trim().optional().default(""),
    condition: z.enum(ASSET_CONDITIONS).default("GOOD"),
    notes: z.string().trim().max(500).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.expectedReturnDate && v.expectedReturnDate < v.allocatedOn) ctx.addIssue({ code: "custom", path: ["expectedReturnDate"], message: "Return is before the allocation date" });
  });

/** Hands an available asset to an employee on the rolls. */
export async function allocateAsset(ctx: AuthContext, input: z.infer<typeof allocateSchema>) {
  const emp = await Employee.findOne({ _id: input.employeeId, businessId: ctx.businessId, deletedAt: null }, { name: 1, employmentStatus: 1 }).lean<AnyDoc>();
  if (!emp) throw AppError.notFound("Employee not found");
  if (!(WORKING_STATUSES as readonly string[]).includes(emp.employmentStatus)) throw AppError.badRequest(`${emp.name} is no longer on the rolls`, "EMPLOYEE_NOT_WORKING");

  const session = await mongoose.startSession();
  let out: { id: string; allocationNumber: string } | null = null;
  try {
    await session.withTransaction(async () => {
      const asset = await HrAsset.findOne({ _id: input.assetId, businessId: ctx.businessId, deletedAt: null }).session(session);
      if (!asset) throw AppError.notFound("Asset not found");
      if (asset.status !== "ACTIVE") throw AppError.badRequest(`${asset.assetTag} is inactive`, "ASSET_INACTIVE");
      if ((asset.assetStatus ?? "AVAILABLE") !== "AVAILABLE") {
        throw AppError.badRequest(`${asset.assetTag} is not available (${String(asset.assetStatus).toLowerCase().replace("_", " ")})`, "ASSET_NOT_AVAILABLE");
      }
      const allocationNumber = await nextHrNumber(ctx.businessId, "HR_ASSET_ALLOCATION", "AAL", session);
      const [row] = await AssetAllocation.create(
        [
          {
            businessId: ctx.businessId,
            allocationNumber,
            assetId: asset._id,
            employeeId: emp._id,
            allocatedOn: toDay(input.allocatedOn),
            expectedReturnDate: input.expectedReturnDate ? toDay(input.expectedReturnDate) : null,
            conditionAtIssue: input.condition,
            issueNotes: input.notes,
            allocatedBy: ctx.userId,
          },
        ],
        { session }
      );
      // The status in the filter stops two people allocating the same asset at once.
      const res = await HrAsset.updateOne(
        { _id: asset._id, businessId: ctx.businessId, assetStatus: asset.assetStatus ?? "AVAILABLE" },
        { assetStatus: "ALLOCATED", employeeId: emp._id, assignedDate: toDay(input.allocatedOn), returnedDate: null, condition: input.condition, updatedBy: ctx.userId },
        { session }
      );
      if (res.modifiedCount !== 1) throw AppError.conflict(`${asset.assetTag} was just allocated by someone else`, "ASSET_NOT_AVAILABLE");
      out = { id: String(row._id), allocationNumber };
    });
  } finally {
    await session.endSession();
  }
  const done = out as unknown as { id: string; allocationNumber: string };
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.assets", documentType: "AssetAllocation", documentId: new Types.ObjectId(done.id), newValue: { allocationNumber: done.allocationNumber, assetId: input.assetId, employee: emp.name } });
  return done;
}

export const returnSchema = z
  .object({
    returnedOn: z.string().trim().min(1, "Choose the date"),
    outcome: z.enum(ASSET_RETURN_OUTCOMES).default("RETURNED"),
    condition: z.enum(ASSET_CONDITIONS).optional(),
    recoveryAmount: moneyStringSchema.optional().default("0"),
    notes: z.string().trim().max(500).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.outcome !== "LOST" && !v.condition) ctx.addIssue({ code: "custom", path: ["condition"], message: "Choose the condition it came back in" });
    if (v.outcome === "LOST" && v.notes.length < 3) ctx.addIssue({ code: "custom", path: ["notes"], message: "Say what happened" });
  });

const STATUS_AFTER: Record<(typeof ASSET_RETURN_OUTCOMES)[number], string> = { RETURNED: "AVAILABLE", DAMAGED: "UNDER_REPAIR", LOST: "LOST" };

/** Takes an asset back (or records it lost); the asset becomes available, goes for repair, or is marked lost. */
export async function returnAsset(ctx: AuthContext, id: string, input: z.infer<typeof returnSchema>) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Allocation not found");
  const session = await mongoose.startSession();
  let out: { id: string; assetStatus: string; allocationNumber: string } | null = null;
  try {
    await session.withTransaction(async () => {
      const row = await AssetAllocation.findOne({ _id: id, businessId: ctx.businessId }).session(session);
      if (!row) throw AppError.notFound("Allocation not found");
      if (row.status !== "ALLOCATED") throw AppError.badRequest(`${row.allocationNumber} was already returned`, "ALREADY_RETURNED");
      if (toDay(input.returnedOn) < toDay(row.allocatedOn)) throw AppError.badRequest("The return date is before the asset was allocated", "BAD_RETURN_DATE");
      row.set({
        status: "RETURNED",
        returnedOn: toDay(input.returnedOn),
        outcome: input.outcome,
        conditionAtReturn: input.outcome === "LOST" ? null : input.condition,
        recoveryAmount: toDecimal128(d(input.recoveryAmount)),
        returnNotes: input.notes,
        returnedBy: ctx.userId,
      });
      await row.save({ session });
      const assetStatus = STATUS_AFTER[input.outcome];
      await HrAsset.updateOne(
        { _id: row.assetId, businessId: ctx.businessId },
        { assetStatus, employeeId: null, returnedDate: toDay(input.returnedOn), ...(input.condition ? { condition: input.condition } : {}), updatedBy: ctx.userId },
        { session }
      );
      out = { id, assetStatus, allocationNumber: row.allocationNumber };
    });
  } finally {
    await session.endSession();
  }
  const done = out as unknown as { id: string; assetStatus: string; allocationNumber: string };
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.assets", documentType: "AssetAllocation", documentId: new Types.ObjectId(id), newValue: { returned: done.allocationNumber, outcome: input.outcome, recovery: input.recoveryAmount } });
  return done;
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

export const allocationListSchema = z.object({
  status: z.enum(["ALLOCATED", "RETURNED", ""]).optional().default(""),
  query: z.string().trim().max(100).optional(),
  employeeId: z.string().trim().regex(/^([a-f\d]{24})?$/i).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  ...pageQuery,
});

/** Allocations with the asset and employee, days held and whether they are overdue. */
export async function listAllocations(ctx: AuthContext, params: z.infer<typeof allocationListSchema>, opts: { all?: boolean } = {}) {
  await syncLegacyAssets(ctx.businessId);
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (params.status) filter.status = params.status;
  if (params.employeeId) filter.employeeId = new Types.ObjectId(params.employeeId);
  if (params.from || params.to) {
    const range: Record<string, Date> = {};
    if (params.from) range.$gte = toDay(params.from);
    if (params.to) range.$lte = toDay(params.to);
    filter.$or = [{ allocatedOn: range }, { returnedOn: range }];
  }
  if (params.query) {
    const rx = { $regex: escapeRegex(params.query), $options: "i" };
    const [assets, emps] = await Promise.all([
      HrAsset.find({ businessId: ctx.businessId, $or: [{ assetTag: rx }, { name: rx }, { category: rx }, { serialNumber: rx }] }, { _id: 1 }).lean<AnyDoc[]>(),
      Employee.find({ businessId: ctx.businessId, $or: [{ name: rx }, { employeeCode: rx }] }, { _id: 1 }).lean<AnyDoc[]>(),
    ]);
    const search = [{ allocationNumber: rx }, { assetId: { $in: assets.map((a) => a._id) } }, { employeeId: { $in: emps.map((e) => e._id) } }];
    if (filter.$or) filter.$and = [{ $or: filter.$or }, { $or: search }];
    else filter.$or = search;
    if (filter.$and) delete filter.$or;
  }
  const q = AssetAllocation.find(filter).sort(params.status === "RETURNED" ? { returnedOn: -1 } : { allocatedOn: -1 });
  const [rows, total] = await Promise.all([
    (opts.all ? q : q.skip((params.page - 1) * params.pageSize).limit(params.pageSize)).lean<AnyDoc[]>(),
    AssetAllocation.countDocuments(filter),
  ]);
  return { items: await describeAllocations(ctx, rows), total };
}

async function describeAllocations(ctx: AuthContext, rows: AnyDoc[]) {
  const [assets, labels, tz] = await Promise.all([
    HrAsset.find({ businessId: ctx.businessId, _id: { $in: rows.map((r) => r.assetId) } }, { assetTag: 1, name: 1, category: 1, serialNumber: 1, value: 1 }).lean<AnyDoc[]>(),
    employeeLabels(ctx.businessId, rows.map((r) => r.employeeId)),
    businessTimeZone(ctx.businessId),
  ]);
  const assetBy = new Map(assets.map((a) => [String(a._id), a]));
  const today = todayIn(tz);
  return rows.map((r) => {
    const a = assetBy.get(String(r.assetId));
    const e = labels.get(String(r.employeeId));
    const until = r.returnedOn ? toDay(r.returnedOn) : today;
    return {
      id: String(r._id),
      allocationNumber: r.allocationNumber as string,
      assetId: String(r.assetId),
      assetTag: (a?.assetTag as string) ?? "",
      assetName: (a?.name as string) ?? "",
      category: (a?.category as string) ?? "",
      serialNumber: (a?.serialNumber as string) ?? "",
      value: d(a?.value).toFixed(2),
      employeeId: String(r.employeeId),
      employeeCode: e?.code ?? "",
      employeeName: e?.name ?? "—",
      department: e?.department ?? "",
      allocatedOn: dayKey(toDay(r.allocatedOn)),
      expectedReturnDate: r.expectedReturnDate ? dayKey(toDay(r.expectedReturnDate)) : null,
      conditionAtIssue: r.conditionAtIssue as string,
      issueNotes: (r.issueNotes as string) ?? "",
      status: r.status as string,
      returnedOn: r.returnedOn ? dayKey(toDay(r.returnedOn)) : null,
      outcome: (r.outcome as string) ?? null,
      conditionAtReturn: (r.conditionAtReturn as string) ?? null,
      recoveryAmount: d(r.recoveryAmount).toFixed(2),
      returnNotes: (r.returnNotes as string) ?? "",
      daysHeld: Math.max(0, Math.round((until.getTime() - toDay(r.allocatedOn).getTime()) / DAY_MS)),
      overdue: r.status === "ALLOCATED" && r.expectedReturnDate ? toDay(r.expectedReturnDate) < today : false,
    };
  });
}

/** Assets that can be allocated now, for the picker. */
export async function availableAssets(ctx: AuthContext) {
  await syncLegacyAssets(ctx.businessId);
  const rows = await HrAsset.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", assetStatus: "AVAILABLE" }, { assetTag: 1, name: 1, category: 1, serialNumber: 1, condition: 1 })
    .sort({ assetTag: 1 })
    .lean<AnyDoc[]>();
  return {
    items: rows.map((a) => ({ id: String(a._id), assetTag: a.assetTag as string, name: a.name as string, category: (a.category as string) ?? "", serialNumber: (a.serialNumber as string) ?? "", condition: (a.condition as string) ?? "GOOD" })),
  };
}

/** Every asset with where it is now, for the asset register report. */
export async function assetRegister(ctx: AuthContext) {
  await syncLegacyAssets(ctx.businessId);
  const assets = await HrAsset.find({ businessId: ctx.businessId, deletedAt: null }).sort({ assetTag: 1 }).lean<AnyDoc[]>();
  const open = await AssetAllocation.find({ businessId: ctx.businessId, status: "ALLOCATED", assetId: { $in: assets.map((a) => a._id) } }).lean<AnyDoc[]>();
  const openBy = new Map(open.map((o) => [String(o.assetId), o]));
  const labels = await employeeLabels(ctx.businessId, open.map((o) => o.employeeId));
  return assets.map((a) => {
    const o = openBy.get(String(a._id));
    const e = o ? labels.get(String(o.employeeId)) : undefined;
    return {
      assetTag: a.assetTag as string,
      name: a.name as string,
      category: (a.category as string) ?? "",
      serialNumber: (a.serialNumber as string) ?? "",
      purchaseDate: a.purchaseDate ? dayKey(toDay(a.purchaseDate)) : "",
      value: d(a.value).toFixed(2),
      condition: (a.condition as string) ?? "",
      assetStatus: (a.assetStatus as string) ?? "AVAILABLE",
      heldBy: e ? `${e.code} · ${e.name}` : "",
      department: e?.department ?? "",
      since: o ? dayKey(toDay(o.allocatedOn)) : "",
    };
  });
}
