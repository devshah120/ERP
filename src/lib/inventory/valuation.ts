import Decimal from "decimal.js";

/**
 * The single rule for what a unit of stock is worth.
 *
 * Preference order:
 *   1. The moving-average cost on the balance, built from actual receipts.
 *   2. The item master's cost price, for stock that predates any costed
 *      receipt (opening balances, or data loaded before averaging existed).
 *
 * Selling price is deliberately never used: valuing stock at what you hope to
 * sell it for books unrealised profit as an asset.
 *
 * Both the dashboard tile and the Stock Summary report call this, so the two
 * screens can never quote different valuations for the same shelf.
 */
export function unitValuation(averageCost: unknown, itemCostPrice: unknown): Decimal {
  const average = new Decimal(String(averageCost ?? 0));
  if (average.gt(0)) return average;
  return new Decimal(String(itemCostPrice ?? 0));
}

/** Convenience wrapper: quantity × unit valuation, to 2dp. */
export function stockValue(
  quantity: number,
  averageCost: unknown,
  itemCostPrice: unknown
): string {
  return unitValuation(averageCost, itemCostPrice).times(quantity).toFixed(2);
}

/** Human-readable note about the basis, for tooltips and report headers. */
export const VALUATION_BASIS =
  "Valued at moving-average cost from goods receipts, falling back to the item's cost price where no costed receipt exists.";
