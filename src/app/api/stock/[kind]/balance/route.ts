import { NextRequest } from "next/server";
import { Types } from "mongoose";
import Decimal from "decimal.js";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { StockBalance } from "@/models/inventory";
import { Item } from "@/models/Item";
import { unitValuation } from "@/lib/inventory/valuation";
import "@/models";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/**
 * On-hand quantity and cost for one warehouse, so the adjustment form can
 * show what the system believes before the user enters what they counted.
 */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { kind } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, `${kind}.view`);

  const warehouseId = req.nextUrl.searchParams.get("warehouseId");
  if (!warehouseId || !Types.ObjectId.isValid(warehouseId)) {
    throw AppError.badRequest("A warehouse is required", "WAREHOUSE_REQUIRED");
  }

  const balances = await StockBalance.find({
    businessId: ctx.businessId,
    warehouseId: new Types.ObjectId(warehouseId),
  }).lean<AnyDoc[]>();

  const items = await Item.find({
    businessId: ctx.businessId,
    _id: { $in: [...new Set(balances.map((b) => b.itemId.toString()))] },
  }).lean<AnyDoc[]>();
  const byId = new Map(items.map((i) => [i._id.toString(), i]));

  return ok({
    items: balances.map((b) => {
      const item = byId.get(b.itemId.toString());
      const unitCost = unitValuation(b.averageCost, item?.costPrice);
      return {
        itemId: b.itemId.toString(),
        itemCode: item?.itemCode ?? "—",
        itemName: item?.name ?? "(deleted item)",
        variantSku: b.variantSku || "",
        quantity: b.quantity,
        unitCost: unitCost.toFixed(2),
        value: new Decimal(unitCost).times(b.quantity).toFixed(2),
      };
    }),
  });
});
