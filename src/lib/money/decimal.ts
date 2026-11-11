import { Types } from "mongoose";
import Decimal from "decimal.js";

/** Money is stored as Mongo Decimal128 and crosses the API boundary as a
 * decimal string — never a JS number — to avoid float precision loss
 * (architecture decision J-2). These are the only two conversion points;
 * every service/model should pass Decimal128 through unchanged in between. */

export function stringToDecimal128(value: string): Types.Decimal128 {
  // Throws if not a valid decimal — let the caller's validation layer catch
  // malformed input before it gets here (see moneyStringSchema).
  return Types.Decimal128.fromString(new Decimal(value).toFixed());
}

export function decimal128ToString(value: Types.Decimal128 | undefined | null): string {
  if (!value) return "0";
  return new Decimal(value.toString()).toFixed();
}
