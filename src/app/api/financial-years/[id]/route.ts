import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { setCurrentFinancialYear, setFinancialYearStatus } from "@/lib/services/financialYearAdmin";
import "@/models";

const actionSchema = z.object({ action: z.enum(["set-current", "close", "reopen"]) });

export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "financial-years.manage");
  const { action } = actionSchema.parse(await req.json());

  if (action === "set-current") return ok(await setCurrentFinancialYear(id, ctx), "Current financial year changed");
  const fy = await setFinancialYearStatus(id, action === "close" ? "CLOSED" : "OPEN", ctx);
  return ok(fy, action === "close" ? `${fy.label} closed` : `${fy.label} reopened`);
});
