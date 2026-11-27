import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { selfEmployee } from "@/lib/hr/common";
import { getClaimAttachment, setClaimAttachment, removeClaimAttachment } from "@/lib/hr/money";
import { attachmentResponse } from "@/lib/hr/claimAttachment";

/** The signed-in employee's own claim bill. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const emp = await selfEmployee(ctx);
  return attachmentResponse(await getClaimAttachment(ctx, id, { employeeId: emp._id }), Boolean(req.nextUrl.searchParams.get("download")));
});

/** multipart/form-data: file. Only while the claim is pending. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const emp = await selfEmployee(ctx);
  return ok(await setClaimAttachment(ctx, id, await req.formData(), { employeeId: emp._id }), "Bill attached");
});

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const emp = await selfEmployee(ctx);
  await removeClaimAttachment(ctx, id, { employeeId: emp._id });
  return ok(null, "Bill removed");
});
