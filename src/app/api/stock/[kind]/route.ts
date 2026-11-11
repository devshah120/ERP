import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import {
  createAdjustment,
  createTransfer,
  listStockDocuments,
  adjustmentCreateSchema,
  transferCreateSchema,
} from "@/lib/inventory/stockDocumentService";
import "@/models";

const KINDS = ["stock-adjustments", "stock-transfers"] as const;
type Kind = (typeof KINDS)[number];

function resolveKind(value: string): Kind {
  if (!KINDS.includes(value as Kind)) throw AppError.notFound("Unknown stock document type");
  return value as Kind;
}

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind } = await params;
  const resolved = resolveKind(kind);

  const ctx = getAuthContext(req);
  requirePermission(ctx, `${resolved}.view`);

  return ok(await listStockDocuments(resolved, req.nextUrl.searchParams, ctx));
});

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind } = await params;
  const resolved = resolveKind(kind);

  const ctx = getAuthContext(req);
  requirePermission(ctx, `${resolved}.create`);

  const body = await req.json();
  if (resolved === "stock-adjustments") {
    const doc = await createAdjustment(adjustmentCreateSchema.parse(body), ctx);
    return created(doc, "Stock adjustment posted");
  }
  const doc = await createTransfer(transferCreateSchema.parse(body), ctx);
  return created(doc, "Stock transfer completed");
});
