import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import {
  reconcilableAccounts,
  getReconciliation,
  reconQuerySchema,
  saveClearances,
  clearanceSchema,
} from "@/lib/bank/reconciliation";
import "@/models";

/** Without ?accountId this returns the bank accounts that can be reconciled. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "bank-reconciliation.view");
  const params = Object.fromEntries(req.nextUrl.searchParams);
  if (!params.accountId) return ok({ accounts: await reconcilableAccounts(ctx.businessId) });
  return ok(await getReconciliation(ctx.businessId, reconQuerySchema.parse(params)));
});

export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "bank-reconciliation.edit");
  const input = clearanceSchema.parse(await req.json());
  return ok(await saveClearances(input, ctx), "Reconciliation saved");
});
