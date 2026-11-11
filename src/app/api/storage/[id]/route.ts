import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { deleteStoredFile } from "@/lib/storage/service";
import "@/models";

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "storage.delete");
  await deleteStoredFile(id, ctx, getRequestMeta(req).ip);
  return ok(null, "Document deleted");
});
