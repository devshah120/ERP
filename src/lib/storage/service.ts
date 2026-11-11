import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { StoredFile } from "@/models/StoredFile";
import { User } from "@/models/User";
import { recordAudit } from "@/lib/services/auditService";
import { escapeRegex } from "@/lib/services/businessContext";
import type { AuthContext } from "@/lib/auth/context";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** What Storage accepts, identified by the file's first bytes — never by its name or the browser's claim. */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", test: (b) => b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG" },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/** The real type of an uploaded file, or null if it isn't one Storage accepts. */
export function detectFileType(bytes: Buffer): { mime: string; ext: string } | null {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/** Keeps a downloaded file's name safe for the Content-Disposition header and every OS. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return cleaned || "document";
}

const listSchema = z.object({
  query: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Document name is required").max(150),
  remarks: z.string().trim().min(1, "Remarks are required").max(500),
});

function toRow(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: d.name as string,
    fileName: d.fileName as string,
    mimeType: d.mimeType as string,
    size: d.size as number,
    remarks: (d.remarks as string) ?? "",
    createdByName: (d.createdByName as string) ?? "",
    createdAt: (d.createdAt as Date)?.toISOString(),
  };
}

export async function listStoredFiles(params: URLSearchParams, ctx: AuthContext) {
  const q = listSchema.parse(Object.fromEntries(params.entries()));
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (q.query) {
    const rx = { $regex: escapeRegex(q.query), $options: "i" };
    filter.$or = [{ name: rx }, { fileName: rx }, { remarks: rx }, { createdByName: rx }];
  }
  const [docs, total] = await Promise.all([
    StoredFile.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean<Record<string, unknown>[]>(),
    StoredFile.countDocuments(filter),
  ]);
  return { items: docs.map(toRow), total, page: q.page, pageSize: q.pageSize };
}

/** Saves an uploaded document after checking its size and real type. */
export async function createStoredFile(form: FormData, ctx: AuthContext, ip?: string) {
  const input = createSchema.parse({ name: form.get("name") ?? "", remarks: form.get("remarks") ?? "" });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw AppError.badRequest("Choose a file to upload", "NO_FILE");
  if (file.size > MAX_FILE_BYTES) throw AppError.badRequest("File is larger than 10 MB", "FILE_TOO_LARGE");

  const bytes = Buffer.from(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type) throw AppError.badRequest("Only JPG, JPEG, PNG and PDF files can be uploaded", "UNSUPPORTED_FILE");

  const user = await User.findOne({ _id: ctx.userId, businessId: ctx.businessId }, { name: 1 }).lean<{ name?: string }>();
  const doc = await StoredFile.create({
    businessId: ctx.businessId,
    name: input.name,
    fileName: safeFileName(file.name || `${input.name}.${type.ext}`),
    mimeType: type.mime,
    size: bytes.length,
    data: bytes,
    remarks: input.remarks,
    createdBy: ctx.userId,
    createdByName: user?.name ?? "",
  });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "storage",
    documentType: "StoredFile",
    documentId: doc._id,
    newValue: { name: doc.name, fileName: doc.fileName, size: doc.size },
    ip,
  });

  const plain = doc.toObject() as Record<string, unknown>;
  return toRow(plain);
}

/** The file bytes for viewing or download, scoped to the caller's workspace. */
export async function getStoredFileContent(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Document not found");
  const doc = await StoredFile.findOne({ _id: id, businessId: ctx.businessId })
    .select("+data")
    .lean<{ data: { buffer?: ArrayBufferLike } | Buffer; mimeType: string; fileName: string; size: number }>();
  if (!doc) throw AppError.notFound("Document not found");
  // Lean reads give a BSON Binary; normalise to a Node Buffer.
  const raw = doc.data as unknown as { buffer?: Buffer } | Buffer;
  const data = Buffer.isBuffer(raw) ? raw : Buffer.from((raw as { buffer: Buffer }).buffer);
  return { data, mimeType: doc.mimeType, fileName: doc.fileName };
}

export async function deleteStoredFile(id: string, ctx: AuthContext, ip?: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Document not found");
  const doc = await StoredFile.findOneAndDelete({ _id: id, businessId: ctx.businessId }).lean<{ _id: Types.ObjectId; name: string; fileName: string }>();
  if (!doc) throw AppError.notFound("Document not found");
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "DELETE",
    module: "storage",
    documentType: "StoredFile",
    documentId: doc._id,
    oldValue: { name: doc.name, fileName: doc.fileName },
    ip,
  });
}
