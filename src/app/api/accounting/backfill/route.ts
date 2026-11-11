import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { backfillLedger } from "@/lib/accounting/voucherService";
import "@/models";

/**
 * Posts journal entries for documents completed before accounting was
 * switched on. Idempotent, so it is safe to run repeatedly.
 */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "vouchers.create");

  const result = await backfillLedger(ctx);
  const failedNote = result.failed > 0 ? ` ${result.failed} document(s) failed — see errors and re-run.` : "";
  return ok(
    result,
    `Posted ${result.posted} voucher(s); ${result.skipped} document(s) already had one.${failedNote}`
  );
});
