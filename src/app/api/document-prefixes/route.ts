import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listPrefixes, savePrefixes, prefixUpdateSchema } from "@/lib/services/documentPrefixService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "document-prefixes.view");
  return ok(await listPrefixes(ctx.businessId));
});

export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "document-prefixes.edit");
  const input = prefixUpdateSchema.parse(await req.json());
  return ok(await savePrefixes(input, ctx), "Prefixes saved");
});
