import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import {
  listProductionEntries,
  createConsumption,
  createMaterialCreation,
  consumptionSchema,
  creationSchema,
} from "@/lib/inventory/operationsService";
import "@/models";

const KINDS = { "material-creation": "CREATION", "material-consumption": "CONSUMPTION" } as const;

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind } = await params;
  const k = KINDS[kind as keyof typeof KINDS];
  if (!k) throw AppError.notFound("Unknown production entry type");
  const ctx = getAuthContext(req);
  requirePermission(ctx, `${kind}.view`);
  return ok(await listProductionEntries(k, req.nextUrl.searchParams, ctx));
});

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind } = await params;
  const k = KINDS[kind as keyof typeof KINDS];
  if (!k) throw AppError.notFound("Unknown production entry type");
  const ctx = getAuthContext(req);
  requirePermission(ctx, `${kind}.create`);
  const body = await req.json();
  const doc = k === "CREATION" ? await createMaterialCreation(creationSchema.parse(body), ctx) : await createConsumption(consumptionSchema.parse(body), ctx);
  return created(doc, "Entry posted");
});
