import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { getClaimAttachment, setClaimAttachment, removeClaimAttachment } from "@/lib/hr/money";
import { attachmentResponse } from "@/lib/hr/claimAttachment";

/** Opens the claim's bill in the browser; ?download=1 saves it instead. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.view");
  return attachmentResponse(await getClaimAttachment(ctx, id), Boolean(req.nextUrl.searchParams.get("download")));
});

/** multipart/form-data: file. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.create");
  return ok(await setClaimAttachment(ctx, id, await req.formData()), "Bill attached");
});

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.create");
  await removeClaimAttachment(ctx, id);
  return ok(null, "Bill removed");
});
