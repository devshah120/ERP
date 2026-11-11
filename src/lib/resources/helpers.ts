import { Types } from "mongoose";
import { z } from "zod";
import { stringToDecimal128 } from "@/lib/money/decimal";

export const STATUS = ["ACTIVE", "INACTIVE"] as const;

/** Permission keys for a master, following "<resource>.<action>". */
export function permissionsFor(key: string) {
  return {
    view: `${key}.view`,
    create: `${key}.create`,
    edit: `${key}.edit`,
    delete: `${key}.delete`,
  };
}

/** Optional reference id: blank clears it. */
export const optionalRef = z.string().trim().optional().or(z.literal(""));

/** Optional yyyy-mm-dd date: blank clears it. */
export const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Enter a valid date")
  .optional();

export const requiredDate = z
  .string()
  .trim()
  .min(1, "Date is required")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date");

/** item + quantity line, as used by BOMs, recipes and combos. */
export const itemLineInput = z.object({
  itemId: z.string().trim().min(1, "Choose an item"),
  variantSku: z.string().trim().toUpperCase().max(60).optional().or(z.literal("")),
  quantity: z.coerce.number().positive("Quantity must be more than zero"),
  note: z.string().trim().max(300).optional(),
});

function toObjectIdOrNull(value: unknown) {
  return value && String(value).length > 0 ? new Types.ObjectId(String(value)) : null;
}

/**
 * Converts validated API input into document values: money strings become
 * Decimal128, id strings become ObjectIds, date strings become Dates, blank
 * optional strings are dropped. `lines` converts the same way inside arrays
 * of sub-rows (component lists).
 */
export function documentConverter(opts: {
  money?: string[];
  refs?: string[];
  dates?: string[];
  lines?: Record<string, { refs?: string[]; money?: string[] }>;
}) {
  return (input: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;

      if (opts.money?.includes(key)) {
        out[key] = stringToDecimal128(String(value));
        continue;
      }

      if (opts.refs?.includes(key)) {
        out[key] = toObjectIdOrNull(value);
        continue;
      }

      if (opts.dates?.includes(key)) {
        out[key] = value ? new Date(String(value)) : null;
        continue;
      }

      const lineRule = opts.lines?.[key];
      if (lineRule && Array.isArray(value)) {
        out[key] = value.map((row: Record<string, unknown>) => {
          const converted: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (v === undefined || v === "") continue;
            if (lineRule.refs?.includes(k)) converted[k] = toObjectIdOrNull(v);
            else if (lineRule.money?.includes(k)) converted[k] = stringToDecimal128(String(v));
            else converted[k] = v;
          }
          return converted;
        });
        continue;
      }

      out[key] = value === "" ? undefined : value;
    }

    return out;
  };
}
