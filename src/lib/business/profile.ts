import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import { recordAudit } from "@/lib/services/auditService";
import { GST_STATES, findStateByCode } from "@/lib/gst/states";
import type { AuthContext } from "@/lib/auth/context";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Business details editable from Settings → Workspace. */
export const businessProfileSchema = z.object({
  tradeName: z.string().trim().min(2, "Business name is required").max(200),
  legalName: z.string().trim().min(2, "Legal name is required").max(200),
  gstin: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z0-9]{13}$/, "A GSTIN is 15 characters, starting with the 2-digit state code")
      .optional()
  ),
  state: z.preprocess(blank, z.string().trim().max(100).optional()),
  phone: z.preprocess(blank, z.string().trim().min(7, "Enter a valid phone number").max(20).optional()),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  city: z.preprocess(blank, z.string().trim().max(100).optional()),
  address: z.preprocess(blank, z.string().trim().max(300).optional()),
  currency: z.string().trim().toUpperCase().length(3, "Use a 3-letter currency code, e.g. INR"),
});
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

const FIELDS = ["tradeName", "legalName", "gstin", "state", "phone", "email", "city", "address", "currency"] as const;

function pick(doc: Record<string, unknown>) {
  return Object.fromEntries(FIELDS.map((f) => [f, (doc[f] as string | undefined) ?? ""]));
}

export async function getBusinessProfile(ctx: AuthContext) {
  const doc = await Business.findById(ctx.businessId).lean<Record<string, unknown>>();
  if (!doc) throw AppError.notFound("Business not found");
  return pick(doc);
}

/**
 * Saves the profile. With a GSTIN, the state always follows its 2-digit
 * code, so place of supply (CGST+SGST vs IGST) can't contradict the GSTIN.
 */
export async function updateBusinessProfile(input: BusinessProfileInput, ctx: AuthContext, ip?: string) {
  let state = input.state ?? "";
  if (input.gstin) {
    const fromGstin = findStateByCode(input.gstin.slice(0, 2));
    if (!fromGstin) throw AppError.badRequest("The GSTIN's first two digits aren't a valid state code", "BAD_GSTIN");
    state = fromGstin.name;
  } else if (state && !GST_STATES.some((s) => s.name === state)) {
    throw AppError.badRequest("Choose a state from the list", "BAD_STATE");
  }

  const before = await Business.findById(ctx.businessId).lean<Record<string, unknown>>();
  if (!before) throw AppError.notFound("Business not found");

  const next = {
    tradeName: input.tradeName,
    legalName: input.legalName,
    gstin: input.gstin ?? "",
    state,
    phone: input.phone ?? "",
    email: input.email,
    city: input.city ?? "",
    address: input.address ?? "",
    currency: input.currency,
  };
  await Business.updateOne({ _id: ctx.businessId }, { $set: { ...next, updatedBy: ctx.userId } });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "settings",
    documentType: "Business",
    documentId: ctx.businessId,
    oldValue: pick(before),
    newValue: next,
    ip,
  });
  return next;
}
