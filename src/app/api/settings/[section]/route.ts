import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getSettings, updateSettings, documentDefaults } from "@/lib/settings/service";
import { SETTINGS_SECTIONS } from "@/lib/settings/definitions";
import "@/models";

/**
 * Reading settings needs only a signed-in user: the billing counter, the
 * product form and every document form read them to pre-fill values.
 * Changing them needs settings.edit, or the section's own permission (an HR
 * policy is changed by HR).
 *
 * "document-defaults" is a derived view (?docType=sales-invoices), not a
 * stored section.
 */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { section } = await params;
  const ctx = getAuthContext(req);
  if (section === "document-defaults") {
    return ok(await documentDefaults(ctx.businessId, req.nextUrl.searchParams.get("docType") ?? ""));
  }
  return ok(await getSettings(ctx.businessId, section));
});

export const PUT = withApiHandler(async (req: NextRequest, { params }) => {
  const { section } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, SETTINGS_SECTIONS[section]?.editPermission ?? "settings.edit");
  const value = await updateSettings(ctx.businessId, ctx.userId, section, await req.json());
  return ok(value, "Settings saved");
});
