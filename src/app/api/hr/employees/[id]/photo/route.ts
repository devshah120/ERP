import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { readPhoto, savePhoto, removePhoto } from "@/lib/hr/photos";

/**
 * The employee's photo. HR sees anyone's, an employee their own. The URL
 * carries ?v=<photoUpdatedAt>, so a browser may keep it for a day.
 */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  const { id } = await params;
  const photo = await readPhoto(ctx, id);
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Length": String(photo.data.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
});

/**
 * multipart/form-data: file (JPG or PNG, up to 2 MB). Replaces any photo there
 * was. Needs hr-employees.edit, or hr-employees.create for a record the caller
 * just added (checked in savePhoto).
 */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-employees.view");
  const { id } = await params;
  const form = await req.formData();
  return ok(await savePhoto(ctx, id, form.get("file")), "Photo saved");
});

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-employees.edit");
  const { id } = await params;
  return ok(await removePhoto(ctx, id), "Photo removed");
});
