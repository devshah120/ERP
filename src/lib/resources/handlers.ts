import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { ok, created } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission, type AuthContext } from "@/lib/auth/context";
import { TenantRepository } from "@/lib/repositories/TenantRepository";
import { getNextMasterCode } from "@/lib/services/masterNumberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import type { ResourceDefinition } from "@/lib/resources/types";
import type { HeldResult } from "@/lib/approvals/catalog";
import { holdResourceWrite } from "@/lib/approvals/resourceApprovals";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shape produced by the dynamically-built list schema. The schema is
 * assembled at runtime from the resource's filterFields, so its inferred
 * type is too loose to use directly — this narrows it back. */
interface ListQuery {
  query?: string;
  status?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  [param: string]: unknown;
}

function buildListSchema(def: ResourceDefinition) {
  const shape: Record<string, z.ZodTypeAny> = {
    query: z.string().trim().max(200).optional(),
    status: z.string().trim().max(50).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(15),
    sortBy: z.string().trim().max(60).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  };
  for (const param of [...Object.keys(def.filterFields), ...Object.keys(def.refFilters ?? {})]) {
    shape[param] = z.string().trim().max(200).optional();
  }
  return z.object(shape);
}

/** Soft-deleted rows are excluded everywhere. `deletedAt: null` also matches
 * documents written before the field existed, so no backfill is needed. */
const NOT_DELETED = { deletedAt: null };

/**
 * Core list query for a master resource, independent of HTTP. Shared by the
 * list endpoint and the export endpoint so both apply identical filtering,
 * search and sorting — an export that filtered differently from the screen
 * would be worse than no export at all.
 */
export async function queryResource(
  def: ResourceDefinition,
  businessId: AuthContext["businessId"],
  searchParams: Record<string, string>,
  /** Export path only: raise the page size above the interactive cap. */
  options?: { pageSizeOverride?: number }
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const repo = new TenantRepository(def.model);
  const validated = buildListSchema(def).parse(searchParams) as unknown as ListQuery;
  const parsed: ListQuery = options?.pageSizeOverride
    ? { ...validated, page: 1, pageSize: options.pageSizeOverride }
    : validated;

  const filter: Record<string, unknown> = { ...NOT_DELETED, ...def.baseFilter };
  if (parsed.status) filter.status = parsed.status;

  for (const [param, path] of Object.entries(def.filterFields)) {
    const value = parsed[param];
    if (typeof value === "string" && value.length > 0) {
      filter[path] = { $regex: escapeRegex(value), $options: "i" };
    }
  }

  // Filters typed against a referenced record's name match the ids of those records.
  for (const [param, ref] of Object.entries(def.refFilters ?? {})) {
    const value = parsed[param];
    if (typeof value === "string" && value.length > 0) {
      const ids = await ref.model.find({ businessId, [ref.field]: { $regex: escapeRegex(value), $options: "i" } }, { _id: 1 }).lean<{ _id: unknown }[]>();
      filter[ref.path] = { $in: ids.map((d) => d._id) };
    }
  }

  if (parsed.query) {
    const search = parsed.query;
    filter.$or = def.searchFields.map((field) => ({
      [field]: { $regex: escapeRegex(search), $options: "i" },
    }));
  }

  const sortBy =
    parsed.sortBy && def.sortableFields.includes(parsed.sortBy) ? parsed.sortBy : def.defaultSort;
  const sortDir = parsed.sortDir ?? def.defaultSortDir;
  const sort = { [sortBy]: sortDir === "asc" ? 1 : -1 } as Record<string, 1 | -1>;

  const skip = (parsed.page - 1) * parsed.pageSize;

  const [docs, total] = await Promise.all([
    repo.find(businessId, filter, { sort, skip, limit: parsed.pageSize }),
    repo.count(businessId, filter),
  ]);

  return {
    items: docs.map((d) => serializeDoc(d) as Record<string, unknown>),
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

export function listHandler(def: ResourceDefinition) {
  return async (req: NextRequest) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.view);
    if (def.beforeList) await def.beforeList(ctx.businessId);

    const result = await queryResource(
      def,
      ctx.businessId,
      Object.fromEntries(req.nextUrl.searchParams)
    );

    return ok(result);
  };
}

export function getHandler(def: ResourceDefinition) {
  return async (req: NextRequest, id: string) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.view);

    if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);

    const repo = new TenantRepository(def.model);
    const doc = await repo.findOne(ctx.businessId, { _id: id, ...NOT_DELETED, ...def.baseFilter });
    if (!doc) throw AppError.notFound(`${def.label} not found`);

    return ok(serializeDoc(doc));
  };
}

/** Options for the write cores below: `approved` = the approval engine is running a change its scheme has approved, so it is not held again. */
export interface ResourceWriteOptions {
  approved?: boolean;
  /** Approved update: the record's updatedAt when the change was sent; a later edit makes the held change stale. */
  baseUpdatedAt?: string | null;
}

type WriteResult = { held: HeldResult } | { doc: Record<string, unknown> };

/**
 * Create, shared by the form endpoint and the approval engine. Every check
 * runs first, so a change sent for approval was already valid when sent; an
 * active scheme then holds it (nothing is written) until it is approved.
 */
export async function createResourceRecord(def: ResourceDefinition, ctx: AuthContext, body: unknown, opts: ResourceWriteOptions = {}): Promise<WriteResult> {
  const input = def.createSchema.parse(body) as Record<string, unknown>;
  const side = takeSideFields(def, input);
  if (def.prepareWrite) await def.prepareWrite(ctx, input);
  const payload = { ...(def.toDocument ? def.toDocument(input) : input), ...def.baseFilter };
  if (def.beforeCreate) await def.beforeCreate(ctx.businessId, 1);
  if (def.validateCreate) await def.validateCreate(ctx, side, input);

  if (!opts.approved) {
    const held = await holdResourceWrite(ctx, def, { op: "create", body, input });
    if (held) return { held };
  }

  if (def.autoCode) {
    const existing = payload[def.autoCode.field];
    if (!existing) {
      payload[def.autoCode.field] = await getNextMasterCode({
        businessId: ctx.businessId,
        entityType: def.autoCode.entityType,
        prefix: def.autoCode.prefix,
      });
    }
  }

  payload.createdBy = ctx.userId;
  payload.updatedBy = ctx.userId;

  const repo = new TenantRepository(def.model);
  const doc = await repo.create(ctx.businessId, payload);

  await auditWrite(ctx, def, "CREATE", doc._id, undefined, payload);
  if (def.afterWrite) await def.afterWrite(ctx, "CREATE", doc, undefined, side);
  return { doc: serializeDoc(doc) as Record<string, unknown> };
}

export async function updateResourceRecord(def: ResourceDefinition, ctx: AuthContext, id: string, body: unknown, opts: ResourceWriteOptions = {}): Promise<WriteResult> {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);
  const input = def.updateSchema.parse(body) as Record<string, unknown>;
  const side = takeSideFields(def, input);

  const repo = new TenantRepository(def.model);
  const before = await repo.findOne(ctx.businessId, { _id: id, ...NOT_DELETED, ...def.baseFilter });
  if (!before) throw AppError.notFound(`${def.label} not found`);
  if (opts.approved && opts.baseUpdatedAt && before.updatedAt && new Date(before.updatedAt).toISOString() !== opts.baseUpdatedAt) {
    throw AppError.conflict(`This ${def.label.toLowerCase()} was changed by someone else after the change was sent, so the approved change was not applied. Send it again from the current record.`, "APPROVAL_STALE");
  }
  if (def.prepareWrite) await def.prepareWrite(ctx, input, before);
  const update = { ...(def.toDocument ? def.toDocument(input) : input), ...def.baseFilter };
  update.updatedBy = ctx.userId;
  if (def.validateUpdate) await def.validateUpdate(ctx, side, before, input);

  if (!opts.approved) {
    const held = await holdResourceWrite(ctx, def, { op: "update", id, body, input, before });
    if (held) return { held };
  }

  const doc = await repo.findByIdAndUpdate(ctx.businessId, id, update);
  if (!doc) throw AppError.notFound(`${def.label} not found`);

  await auditWrite(ctx, def, "UPDATE", doc._id, serializeDoc(before), update);
  if (def.afterWrite) await def.afterWrite(ctx, "UPDATE", doc, before, side);
  return { doc: serializeDoc(doc) as Record<string, unknown> };
}

/**
 * Soft delete only — master data is referenced by historical transactions, so
 * rows are flagged rather than removed (Section 38). Hard deletes would orphan
 * documents that legally must stay reproducible.
 */
export async function deleteResourceRecord(def: ResourceDefinition, ctx: AuthContext, id: string, opts: ResourceWriteOptions = {}): Promise<{ held: HeldResult } | { deleted: true }> {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);

  const repo = new TenantRepository(def.model);
  const current = await repo.findOne(ctx.businessId, { _id: id, ...NOT_DELETED, ...def.baseFilter });
  if (!current) throw AppError.notFound(`${def.label} not found`);
  if (!opts.approved) {
    const held = await holdResourceWrite(ctx, def, { op: "delete", id, before: current });
    if (held) return { held };
  }
  const doc = await repo.findByIdAndUpdate(ctx.businessId, id, {
    deletedAt: new Date(),
    status: "INACTIVE",
    updatedBy: ctx.userId,
  });
  if (!doc) throw AppError.notFound(`${def.label} not found`);

  await auditWrite(ctx, def, "DELETE", doc._id, undefined, undefined);
  return { deleted: true };
}

export function createHandler(def: ResourceDefinition) {
  return async (req: NextRequest) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.create);
    const res = await createResourceRecord(def, ctx, await req.json());
    if ("held" in res) return ok(res.held, res.held.approvalMessage, 202);
    return created(res.doc, `${def.label} created successfully`);
  };
}

export function updateHandler(def: ResourceDefinition) {
  return async (req: NextRequest, id: string) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.edit);
    const res = await updateResourceRecord(def, ctx, id, await req.json());
    if ("held" in res) return ok(res.held, res.held.approvalMessage, 202);
    return ok(res.doc, `${def.label} updated successfully`);
  };
}

export function deleteHandler(def: ResourceDefinition) {
  return async (req: NextRequest, id: string) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.delete);
    const res = await deleteResourceRecord(def, ctx, id);
    if ("held" in res) return ok(res.held, res.held.approvalMessage, 202);
    return ok(null, `${def.label} deleted successfully`);
  };
}

/** Removes the definition's side fields from the parsed input and returns them. */
function takeSideFields(def: ResourceDefinition, input: Record<string, unknown>): Record<string, unknown> {
  const side: Record<string, unknown> = {};
  for (const f of def.sideFields ?? []) {
    if (f in input) {
      side[f] = input[f];
      delete input[f];
    }
  }
  return side;
}

async function auditWrite(
  ctx: AuthContext,
  def: ResourceDefinition,
  action: "CREATE" | "UPDATE" | "DELETE",
  documentId: Types.ObjectId,
  oldValue?: unknown,
  newValue?: unknown
) {
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action,
    module: `masters.${def.key}`,
    documentType: def.label,
    documentId,
    oldValue,
    newValue,
  });
}
