import mongoose, { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { Employee, EmployeePhoto } from "@/models/hr";
import { detectFileType } from "@/lib/storage/service";
import { recordAudit } from "@/lib/services/auditService";
import { hasPermission, type AuthContext } from "@/lib/auth/context";
import { findEmployee, type AnyDoc } from "./common";

/*
 * Employee photos: JPG or PNG up to 2 MB, recognised by the file's own bytes
 * (never its name). Saving or removing one stamps Employee.photoUpdatedAt in
 * the same transaction; that stamp tells screens a photo exists and versions
 * its URL so a new photo is never served from a stale cache.
 */

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** The URL screens use for an employee's photo, or null when there is none. */
export function photoUrl(employeeId: string, photoUpdatedAt: Date | string | null | undefined): string | null {
  if (!photoUpdatedAt) return null;
  return `/api/hr/employees/${employeeId}/photo?v=${new Date(photoUpdatedAt).getTime()}`;
}

/**
 * hr-employees.edit may set anyone's photo. Someone who may only add
 * employees can still give the first photo to an employee they just added
 * (the New employee form uploads it right after saving).
 */
function assertCanSetPhoto(ctx: AuthContext, emp: AnyDoc) {
  if (hasPermission(ctx, "hr-employees.edit")) return;
  const ownNewRecord = hasPermission(ctx, "hr-employees.create") && String(emp.createdBy ?? "") === String(ctx.userId) && !emp.photoUpdatedAt;
  if (!ownNewRecord) throw AppError.forbidden("Changing a photo needs permission to edit employees (hr-employees.edit).");
}

export async function savePhoto(ctx: AuthContext, employeeId: string, file: unknown) {
  const emp = await findEmployee(ctx.businessId, employeeId);
  assertCanSetPhoto(ctx, emp);
  if (!(file instanceof File) || file.size === 0) throw AppError.badRequest("Choose a photo to upload", "NO_FILE");
  if (file.size > MAX_PHOTO_BYTES) throw AppError.badRequest("The photo is larger than 2 MB", "FILE_TOO_LARGE");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type || !type.mime.startsWith("image/")) throw AppError.badRequest("Only JPG and PNG photos can be uploaded", "UNSUPPORTED_FILE");

  const now = new Date();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await EmployeePhoto.updateOne(
        { businessId: ctx.businessId, employeeId: emp._id },
        { $set: { mimeType: type.mime, size: bytes.length, data: bytes, updatedBy: ctx.userId } },
        { upsert: true, session }
      );
      await Employee.updateOne({ _id: emp._id, businessId: ctx.businessId }, { photoUpdatedAt: now, updatedBy: ctx.userId }, { session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.employees", documentType: "Employee", documentId: emp._id, newValue: { photo: `${type.ext}, ${bytes.length} bytes` }, reason: "Photo changed" });
  return { photoUrl: photoUrl(String(emp._id), now) };
}

export async function removePhoto(ctx: AuthContext, employeeId: string) {
  const emp = await findEmployee(ctx.businessId, employeeId);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await EmployeePhoto.deleteOne({ businessId: ctx.businessId, employeeId: emp._id }, { session });
      await Employee.updateOne({ _id: emp._id, businessId: ctx.businessId }, { photoUpdatedAt: null, updatedBy: ctx.userId }, { session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.employees", documentType: "Employee", documentId: emp._id, reason: "Photo removed" });
  return { photoUrl: null };
}

/**
 * The photo bytes. HR (hr-employees.view) sees anyone's; with only
 * self-service a person sees their own.
 */
export async function readPhoto(ctx: AuthContext, employeeId: string) {
  if (!Types.ObjectId.isValid(employeeId)) throw AppError.notFound("Photo not found");
  if (!hasPermission(ctx, "hr-employees.view")) {
    const own = await Employee.exists({ _id: employeeId, businessId: ctx.businessId, userId: ctx.userId, deletedAt: null });
    if (!own) throw AppError.forbidden("You can only see your own photo");
  }
  const doc = await EmployeePhoto.findOne({ businessId: ctx.businessId, employeeId }).select("+data").lean<AnyDoc>();
  if (!doc) throw AppError.notFound("Photo not found");
  const raw = doc.data as Buffer | { buffer: Buffer };
  const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer);
  return { data, mimeType: doc.mimeType as string };
}
