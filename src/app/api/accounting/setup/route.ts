import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { ensureChartOfAccounts } from "@/lib/accounting/chartOfAccounts";
import { isAccountingEnabled } from "@/lib/accounting/posting";
import { Account } from "@/models/Account";
import "@/models";

/** Whether this tenant has a chart of accounts yet, for the setup prompt. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "chart-of-accounts.view");

  const [enabled, total] = await Promise.all([
    isAccountingEnabled(ctx.businessId),
    Account.countDocuments({ businessId: ctx.businessId }),
  ]);
  return ok({ enabled, accountCount: total });
});

/**
 * Creates the standard chart of accounts. Safe to run again — it tops up
 * what is missing rather than resetting anything the business has added.
 */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "chart-of-accounts.create");

  const result = await ensureChartOfAccounts(ctx.businessId, ctx.userId);
  return ok(
    result,
    result.created === 0
      ? "Chart of accounts is already complete."
      : `Created ${result.created} account(s). The chart now has ${result.total}.`
  );
});
