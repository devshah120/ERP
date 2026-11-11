import mongoose, { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { recordAudit } from "@/lib/services/auditService";
import { computeCurrentFinancialYear } from "@/lib/services/financialYearService";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

function view(fy: AnyDoc) {
  return {
    id: fy._id.toString(),
    label: fy.label,
    startDate: fy.startDate.toISOString(),
    endDate: fy.endDate.toISOString(),
    status: fy.status,
    isCurrent: Boolean(fy.isCurrent),
    closedAt: fy.closedAt ? fy.closedAt.toISOString() : null,
  };
}

export async function listFinancialYears(businessId: Types.ObjectId) {
  const rows = await FinancialYear.find({ businessId }).sort({ startDate: -1 }).lean<AnyDoc[]>();
  return { items: rows.map(view) };
}

/**
 * Opens the year after the latest one on file. Years are always contiguous —
 * the next one starts the day after the last one ends — so there is never a
 * gap a document date could fall into, and never an overlap.
 */
export async function openNextFinancialYear(ctx: AuthContext) {
  const [business, latest] = await Promise.all([
    Business.findById(ctx.businessId).lean<AnyDoc>(),
    FinancialYear.findOne({ businessId: ctx.businessId }).sort({ endDate: -1 }).lean<AnyDoc>(),
  ]);
  if (!business) throw AppError.notFound("Business not found");

  const startMonth = business.financialYearStartMonth ?? 4;
  const reference = latest ? new Date(latest.endDate.getTime() + 86_400_000) : new Date();
  const next = computeCurrentFinancialYear(startMonth, reference);

  const exists = await FinancialYear.exists({ businessId: ctx.businessId, label: next.label });
  if (exists) throw AppError.conflict(`Financial year ${next.label} already exists`, "FY_EXISTS");

  const created = await FinancialYear.create({
    businessId: ctx.businessId,
    label: next.label,
    startDate: next.startDate,
    endDate: next.endDate,
    status: "OPEN",
    // The very first year of a workspace becomes current; later ones are
    // opened in advance and switched to deliberately.
    isCurrent: !latest,
    createdBy: ctx.userId,
  });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "financial-years",
    documentType: "Financial year",
    documentId: created._id,
    newValue: { label: next.label },
  });

  return view(created);
}

/**
 * Makes a year the working year for the whole workspace. New documents are
 * numbered and posted in the current year, so only an open year qualifies.
 */
export async function setCurrentFinancialYear(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Financial year not found");
  const target = await FinancialYear.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!target) throw AppError.notFound("Financial year not found");
  if (target.status !== "OPEN") {
    throw AppError.badRequest(`${target.label} is closed. Reopen it before making it current.`, "FY_CLOSED");
  }
  if (target.isCurrent) return view(target);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await FinancialYear.updateMany({ businessId: ctx.businessId, isCurrent: true }, { $set: { isCurrent: false } }, { session });
      await FinancialYear.updateOne({ _id: target._id }, { $set: { isCurrent: true, updatedBy: ctx.userId } }, { session });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "financial-years",
    documentType: "Financial year",
    documentId: target._id,
    newValue: { isCurrent: true, label: target.label },
  });

  return view({ ...target, isCurrent: true });
}

/**
 * Closes or reopens a year. The current year cannot be closed — switch to
 * the next year first — so the workspace always has an open year to post in.
 */
export async function setFinancialYearStatus(id: string, status: "OPEN" | "CLOSED", ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Financial year not found");
  const fy = await FinancialYear.findOne({ _id: id, businessId: ctx.businessId });
  if (!fy) throw AppError.notFound("Financial year not found");
  if (status === "CLOSED" && fy.isCurrent) {
    throw AppError.badRequest(
      `${fy.label} is the current year. Make another year current before closing it.`,
      "FY_CURRENT"
    );
  }
  if (fy.status === status) return view(fy);

  fy.status = status;
  fy.closedAt = status === "CLOSED" ? new Date() : null;
  fy.closedBy = status === "CLOSED" ? ctx.userId : null;
  fy.updatedBy = ctx.userId;
  await fy.save();

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "financial-years",
    documentType: "Financial year",
    documentId: fy._id,
    newValue: { status, label: fy.label },
  });

  return view(fy);
}
