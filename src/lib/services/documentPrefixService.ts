import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { DocumentPrefix } from "@/models/DocumentPrefix";
import { DocumentSequence } from "@/models/DocumentSequence";
import { FinancialYear } from "@/models/FinancialYear";
import { recordAudit } from "@/lib/services/auditService";
import { sequenceCatalogue } from "@/lib/numbering/catalogue";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

export const prefixUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        documentType: z.string().trim().min(1),
        prefix: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{1,8}$/, "1–8 letters or digits"),
        padding: z.coerce.number().int().min(3).max(10),
      })
    )
    .max(200),
});

/**
 * Every numbered document with its effective prefix and what its next number
 * will look like in the working year.
 */
export async function listPrefixes(businessId: Types.ObjectId) {
  const [overrides, fy] = await Promise.all([
    DocumentPrefix.find({ businessId }).lean<AnyDoc[]>(),
    FinancialYear.findOne({ businessId, isCurrent: true }).lean<AnyDoc>(),
  ]);
  const sequences = fy
    ? await DocumentSequence.find({ businessId, financialYearId: fy._id }, { documentType: 1, lastNumber: 1 }).lean<AnyDoc[]>()
    : [];
  const byType = new Map(overrides.map((o) => [o.documentType, o]));
  const lastByType = new Map<string, number>();
  for (const s of sequences) lastByType.set(s.documentType, Math.max(lastByType.get(s.documentType) ?? 0, s.lastNumber));

  return {
    financialYear: fy?.label ?? null,
    items: sequenceCatalogue().map((s) => {
      const o = byType.get(s.documentType);
      return {
        ...s,
        prefix: o?.prefix ?? s.defaultPrefix,
        padding: o?.padding ?? 6,
        customised: Boolean(o),
        issued: lastByType.get(s.documentType) ?? 0,
      };
    }),
  };
}

/**
 * Saves prefixes. Two types sharing a prefix could mint the same number
 * (vouchers of every type live in one collection), so effective prefixes must
 * be unique across the whole catalogue.
 */
export async function savePrefixes(input: z.infer<typeof prefixUpdateSchema>, ctx: AuthContext) {
  const catalogue = sequenceCatalogue();
  const known = new Map(catalogue.map((s) => [s.documentType, s]));
  for (const item of input.items) {
    if (!known.has(item.documentType)) throw AppError.badRequest(`Unknown document type ${item.documentType}`, "UNKNOWN_TYPE");
  }

  const existing = await DocumentPrefix.find({ businessId: ctx.businessId }).lean<AnyDoc[]>();
  const effective = new Map<string, string>(catalogue.map((s) => [s.documentType, s.defaultPrefix]));
  for (const o of existing) effective.set(o.documentType, o.prefix);
  for (const item of input.items) effective.set(item.documentType, item.prefix);

  const seen = new Map<string, string>();
  for (const [type, prefix] of effective) {
    const other = seen.get(prefix);
    if (other) {
      throw AppError.badRequest(
        `"${prefix}" is used by both ${known.get(other)?.label} and ${known.get(type)?.label}. Each document type needs its own prefix.`,
        "DUPLICATE_PREFIX"
      );
    }
    seen.set(prefix, type);
  }

  for (const item of input.items) {
    const def = known.get(item.documentType)!;
    if (item.prefix === def.defaultPrefix && item.padding === 6) {
      // Back to the built-in default: drop the override rather than store it.
      await DocumentPrefix.deleteOne({ businessId: ctx.businessId, documentType: item.documentType });
    } else {
      await DocumentPrefix.updateOne(
        { businessId: ctx.businessId, documentType: item.documentType },
        { $set: { prefix: item.prefix, padding: item.padding, updatedBy: ctx.userId } },
        { upsert: true }
      );
    }
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "document-prefixes",
    documentType: "Document prefix",
    newValue: input.items,
  });

  return listPrefixes(ctx.businessId);
}
