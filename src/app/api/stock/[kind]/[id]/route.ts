import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getStockDocument, cancelStockDocument } from "@/lib/inventory/stockDocumentService";
import "@/models";

const KINDS = ["stock-adjustments", "stock-transfers"] as const;
type Kind = (typeof KINDS)[number];

function resolveKind(value: string): Kind {
  if (!KINDS.includes(value as Kind)) throw AppError.notFound("Unknown stock document type");
  return value as Kind;
}

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind, id } = await params;
  const resolved = resolveKind(kind);

  const ctx = getAuthContext(req);
  requirePermission(ctx, `${resolved}.view`);

  return ok(await getStockDocument(resolved, id, ctx));
});

/**
 * Cancels by writing offsetting ledger rows rather than deleting, so the
 * stock ledger still explains how the balance got where it is.
 */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind, id } = await params;
  const resolved = resolveKind(kind);

  const ctx = getAuthContext(req);
  requirePermission(ctx, `${resolved}.cancel`);

  const reason = req.nextUrl.searchParams.get("reason") ?? undefined;
  return ok(await cancelStockDocument(resolved, id, reason, ctx), "Cancelled and reversed");
});
