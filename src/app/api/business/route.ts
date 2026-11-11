import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { businessProfileSchema, getBusinessProfile, updateBusinessProfile } from "@/lib/business/profile";
import "@/models";

/** The workspace's business profile (Settings → Workspace). */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  return ok(await getBusinessProfile(ctx));
});

export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "settings.edit");
  const input = businessProfileSchema.parse(await req.json());
  return ok(await updateBusinessProfile(input, ctx, getRequestMeta(req).ip), "Business details saved");
});
