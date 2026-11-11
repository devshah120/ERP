import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listCreditNotes, createCreditNote, creditNoteSchema } from "@/lib/pos/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.view");
  return ok(await listCreditNotes(req.nextUrl.searchParams, ctx));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.refund");
  return created(await createCreditNote(creditNoteSchema.parse(await req.json()), ctx), "Credit note issued");
});