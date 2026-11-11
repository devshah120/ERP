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
  for (const param of Object.keys(def.filterFields)) {
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

export function createHandler(def: ResourceDefinition) {
  return async (req: NextRequest) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.create);

    const body = await req.json();
    const input = def.createSchema.parse(body) as Record<string, unknown>;
    const payload = { ...(def.toDocument ? def.toDocument(input) : input), ...def.baseFilter };

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

    return created(serializeDoc(doc), `${def.label} created successfully`);
  };
}

export function updateHandler(def: ResourceDefinition) {
  return async (req: NextRequest, id: string) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.edit);

    if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);

    const body = await req.json();
    const input = def.updateSchema.parse(body) as Record<string, unknown>;
    const update = { ...(def.toDocument ? def.toDocument(input) : input), ...def.baseFilter };
    update.updatedBy = ctx.userId;

    const repo = new TenantRepository(def.model);
    const before = await repo.findOne(ctx.businessId, { _id: id, ...NOT_DELETED, ...def.baseFilter });
    if (!before) throw AppError.notFound(`${def.label} not found`);

    const doc = await repo.findByIdAndUpdate(ctx.businessId, id, update);
    if (!doc) throw AppError.notFound(`${def.label} not found`);

    await auditWrite(ctx, def, "UPDATE", doc._id, serializeDoc(before), update);

    return ok(serializeDoc(doc), `${def.label} updated successfully`);
  };
}

/**
 * Soft delete only — master data is referenced by historical transactions, so
 * rows are flagged rather than removed (Section 38). Hard deletes would orphan
 * documents that legally must stay reproducible.
 */
export function deleteHandler(def: ResourceDefinition) {
  return async (req: NextRequest, id: string) => {
    const ctx = getAuthContext(req);
    requirePermission(ctx, def.permissions.delete);

    if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);

    const repo = new TenantRepository(def.model);
    if (def.baseFilter) {
      const inSlice = await repo.findOne(ctx.businessId, { _id: id, ...def.baseFilter });
      if (!inSlice) throw AppError.notFound(`${def.label} not found`);
    }
    const doc = await repo.findByIdAndUpdate(ctx.businessId, id, {
      deletedAt: new Date(),
      status: "INACTIVE",
      updatedBy: ctx.userId,
    });
    if (!doc) throw AppError.notFound(`${def.label} not found`);

    await auditWrite(ctx, def, "DELETE", doc._id, undefined, undefined);

    return ok(null, `${def.label} deleted successfully`);
  };
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
