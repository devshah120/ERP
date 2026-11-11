import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { listReports } from "@/lib/reports/service";
import "@/models";

/** Catalogue of available reports, used by the Reports index screen. */
export const GET = withApiHandler(async (req: NextRequest) => {
  getAuthContext(req); // authenticated users only
  return ok({ reports: listReports() });
});
