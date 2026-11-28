import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { withdrawHeldAction } from "@/lib/approvals/service";
import "@/models";

const bodySchema = z.object({ note: z.string().trim().max(500).optional().default("") });

/** The requester withdraws a change that is waiting for approval or was sent back. Nothing is applied. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  const { note } = bodySchema.parse(await req.json().catch(() => ({})));
  const result = await withdrawHeldAction(ctx, id, note);
  return ok(result, result.approvalMessage);
});
