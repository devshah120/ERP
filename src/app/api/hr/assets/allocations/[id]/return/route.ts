import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { returnAsset, returnSchema } from "@/lib/hr/assets";

/** Takes the asset back, or records it damaged or lost. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-assets.edit");
  const { id } = await params;
  const result = await returnAsset(ctx, id, returnSchema.parse(await req.json()));
  return okOrHeld(result, (r) => `${r.allocationNumber} returned`);
});
