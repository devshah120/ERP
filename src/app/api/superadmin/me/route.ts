import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getSAContext } from "@/lib/auth/superAdminContext";
import { getEnv } from "@/lib/config/env";

export const GET = withApiHandler(async (req: NextRequest) => {
  getSAContext(req);
  const { SUPERADMIN_EMAIL } = getEnv();
  return ok({ email: SUPERADMIN_EMAIL ?? "" });
});

