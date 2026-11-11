import Decimal from "decimal.js";

/**
 * Authoritative document arithmetic. The frontend may preview numbers, but
 * these are the values that get stored — the client's figures are never
 * trusted (Section 23). All maths runs through decimal.js and is persisted
 * as Decimal128, never floating point.
 */

export interface LineInput {
  quantity: number;
  rate: string;
  discountPercent?: number;
  discountAmount?: string;
  taxRatePercent?: number;
}

export interface ComputedLine {
  taxableAmount: Decimal;
  discountAmount: Decimal;
  grossAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  taxAmount: Decimal;
  lineTotal: Decimal;
}

export const TWO_DP = 2;

function d(value: string | number | Decimal): Decimal {
  return new Decimal(value ?? 0);
}

function round(value: Decimal): Decimal {
  return value.toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP);
}

/**
 * Intra-state supply splits GST into CGST + SGST (half each); inter-state
 * charges IGST at the full rate. Determined by comparing the place of supply
 * with the seller's own state.
 */
export function isIntraState(sellerState?: string, buyerState?: string): boolean {
  if (!sellerState || !buyerState) return true; // default to local supply
  return sellerState.trim().toLowerCase() === buyerState.trim().toLowerCase();
}

export function computeLine(line: LineInput, intraState: boolean): ComputedLine {
  const quantity = d(line.quantity);
  const rate = d(line.rate);
  const grossAmount = round(quantity.times(rate));

  // An explicit discount amount wins over a percentage, so a user can key an
  // exact rupee discount without it being recomputed from a stale percent.
  const discountAmount =
    line.discountAmount !== undefined && line.discountAmount !== ""
      ? round(d(line.discountAmount))
      : round(grossAmount.times(d(line.discountPercent ?? 0)).dividedBy(100));

  const taxableAmount = round(grossAmount.minus(discountAmount));
  const taxRate = d(line.taxRatePercent ?? 0);
  const taxAmount = round(taxableAmount.times(taxRate).dividedBy(100));

  const cgstAmount = intraState ? round(taxAmount.dividedBy(2)) : d(0);
  const sgstAmount = intraState ? round(taxAmount.minus(cgstAmount)) : d(0);
  const igstAmount = intraState ? d(0) : taxAmount;

  return {
    grossAmount,
    discountAmount,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxAmount,
    lineTotal: round(taxableAmount.plus(taxAmount)),
  };
}

export interface ComputedTotals {
  subTotal: Decimal;
  totalDiscount: Decimal;
  taxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  totalTax: Decimal;
  shippingCharge: Decimal;
  roundOff: Decimal;
  grandTotal: Decimal;
}

export function computeTotals(lines: ComputedLine[], shippingCharge: string | number = 0): ComputedTotals {
  const zero = d(0);

  const subTotal = lines.reduce((acc, l) => acc.plus(l.grossAmount), zero);
  const totalDiscount = lines.reduce((acc, l) => acc.plus(l.discountAmount), zero);
  const taxableAmount = lines.reduce((acc, l) => acc.plus(l.taxableAmount), zero);
  const cgstAmount = lines.reduce((acc, l) => acc.plus(l.cgstAmount), zero);
  const sgstAmount = lines.reduce((acc, l) => acc.plus(l.sgstAmount), zero);
  const igstAmount = lines.reduce((acc, l) => acc.plus(l.igstAmount), zero);
  const totalTax = cgstAmount.plus(sgstAmount).plus(igstAmount);
  const shipping = round(d(shippingCharge));

  const beforeRounding = taxableAmount.plus(totalTax).plus(shipping);
  const grandTotal = beforeRounding.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const roundOff = round(grandTotal.minus(beforeRounding));

  return {
    subTotal: round(subTotal),
    totalDiscount: round(totalDiscount),
    taxableAmount: round(taxableAmount),
    cgstAmount: round(cgstAmount),
    sgstAmount: round(sgstAmount),
    igstAmount: round(igstAmount),
    totalTax: round(totalTax),
    shippingCharge: shipping,
    roundOff,
    grandTotal,
  };
}
