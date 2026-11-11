import { z } from "zod";
import { validateGstin } from "@/lib/gst/gstin";

/**
 * Optional GSTIN field, validated for format, state code and check digit.
 *
 * This is worth rejecting at the boundary rather than storing loosely: the
 * GSTIN's first two digits determine the party's GST state, which in turn
 * decides CGST+SGST vs IGST. A malformed GSTIN would silently produce the
 * wrong tax treatment on every invoice raised for that party.
 */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .or(z.literal(""))
  .superRefine((value, ctx) => {
    if (!value) return;
    const result = validateGstin(value);
    if (!result.valid) {
      ctx.addIssue({ code: "custom", message: result.reason ?? "Invalid GSTIN" });
    }
  });
