import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { listReports } from "@/lib/reports/service";
import "@/models";

/** Catalogue of the reports the caller may open, used by the Reports index screen. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  return ok({ reports: listReports(ctx) });
});
