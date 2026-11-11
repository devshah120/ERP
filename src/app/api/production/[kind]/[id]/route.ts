import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getProductionEntry, cancelProductionEntry } from "@/lib/inventory/operationsService";
import "@/models";

const KINDS = { "material-creation": "CREATION", "material-consumption": "CONSUMPTION" } as const;

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind, id } = await params;
  const k = KINDS[kind as keyof typeof KINDS];
  if (!k) throw AppError.notFound("Unknown production entry type");
  const ctx = getAuthContext(req);
  requirePermission(ctx, `${kind}.view`);
  return ok(await getProductionEntry(k, id, ctx));
});

/** Cancel: offsetting stock rows (and journal, for consumption). */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind, id } = await params;
  const k = KINDS[kind as keyof typeof KINDS];
  if (!k) throw AppError.notFound("Unknown production entry type");
  const ctx = getAuthContext(req);
  requirePermission(ctx, `${kind}.cancel`);
  const { reason } = z.object({ reason: z.string().trim().min(1, "A reason is required").max(500) }).parse(await req.json());
  await cancelProductionEntry(k, id, reason, ctx);
  return ok(await getProductionEntry(k, id, ctx), "Entry cancelled");
});
