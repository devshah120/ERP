import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { requestAdvance, advanceRequestSchema } from "@/lib/hr/money";

/** HR raises an advance / loan request on an employee's behalf; it then goes through approval. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-loans.create");
  const result = await requestAdvance(ctx, advanceRequestSchema.parse(await req.json()), { self: false });
  return created(result, `Request ${result.loanNumber} raised`);
});
