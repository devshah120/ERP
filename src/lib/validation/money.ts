import { z } from "zod";

/** Decimal amounts travel the API as strings (e.g. "1250.50"), never JS
 * numbers, to avoid float precision loss — see src/lib/money/decimal.ts. */
export const moneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, "Must be a valid decimal amount (up to 4 decimal places)");
