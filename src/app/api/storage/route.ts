import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { listStoredFiles, createStoredFile } from "@/lib/storage/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "storage.view");
  return ok(await listStoredFiles(req.nextUrl.searchParams, ctx));
});

/** multipart/form-data: name, remarks, file. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "storage.upload");
  const form = await req.formData();
  return created(await createStoredFile(form, ctx, getRequestMeta(req).ip), "Document uploaded");
});
