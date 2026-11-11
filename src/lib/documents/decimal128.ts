import { Types } from "mongoose";
import type Decimal from "decimal.js";
import { TWO_DP } from "./totals";

/** Server-only bridge from decimal.js to Mongo's Decimal128. Kept out of
 * totals.ts so the calculation logic itself stays importable by client
 * components (which must not pull mongoose into the browser bundle). */
export function toDecimal128(value: Decimal): Types.Decimal128 {
  return Types.Decimal128.fromString(value.toFixed(TWO_DP));
}
