import { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { BusinessSettings } from "@/models/BusinessSettings";
import { TermsTemplate } from "@/models/catalogMasters";
import { recordAudit } from "@/lib/services/auditService";
import {
  SETTINGS_SECTIONS,
  type PosSettings,
  type SalesSettings,
  type PurchaseSettings,
} from "./definitions";

/** Reads one settings section, filling defaults for anything never saved. */
export async function getSettings<T = Record<string, unknown>>(businessId: Types.ObjectId, section: string): Promise<T> {
  const def = SETTINGS_SECTIONS[section];
  if (!def) throw AppError.notFound("Unknown settings section");
  const doc = await BusinessSettings.findOne({ businessId }, { [`sections.${section}`]: 1 }).lean<{
    sections?: Record<string, unknown>;
  }>();
  const stored = (doc?.sections?.[section] ?? {}) as Record<string, unknown>;
  // safeParse: a value made invalid by a later rule change falls back to the
  // defaults rather than locking the screen.
  const parsed = def.schema.safeParse(stored);
  return (parsed.success ? parsed.data : def.schema.parse({})) as T;
}

export async function updateSettings(
  businessId: Types.ObjectId,
  userId: Types.ObjectId,
  section: string,
  input: unknown
) {
  const def = SETTINGS_SECTIONS[section];
  if (!def) throw AppError.notFound("Unknown settings section");
  const value = def.schema.parse(input);
  const before = await getSettings(businessId, section);

  await BusinessSettings.updateOne(
    { businessId },
    { $set: { [`sections.${section}`]: value, updatedBy: userId }, $setOnInsert: { businessId } },
    { upsert: true }
  );

  await recordAudit({
    businessId,
    userId,
    action: "UPDATE",
    module: `settings.${section}`,
    documentType: def.title,
    oldValue: before,
    newValue: value,
  });

  return value;
}

export function getPosSettings(businessId: Types.ObjectId) {
  return getSettings<PosSettings>(businessId, "pos");
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const SALES_DOCS = new Set(["sales-quotations", "sales-orders", "delivery-challans", "sales-invoices", "sales-returns", "credit-notes"]);
const PURCHASE_DOCS = new Set(["purchase-orders", "goods-receipts", "purchase-invoices", "purchase-returns", "debit-notes"]);

/**
 * What a brand-new document of this type should start with, from Sales /
 * Purchase Settings and the default Terms & Conditions template. Only the
 * fields that type actually has are returned.
 */
export async function documentDefaults(businessId: Types.ObjectId, docType: string) {
  const isSales = SALES_DOCS.has(docType);
  if (!isSales && !PURCHASE_DOCS.has(docType)) return {};

  const [settings, terms] = await Promise.all([
    isSales ? getSettings<SalesSettings>(businessId, "sales") : getSettings<PurchaseSettings>(businessId, "purchase"),
    TermsTemplate.findOne({
      businessId,
      appliesTo: isSales ? "SALES" : "PURCHASE",
      isDefault: true,
      status: "ACTIVE",
      deletedAt: null,
    })
      .sort({ updatedAt: -1 })
      .lean<{ body?: string }>(),
  ]);

  const out: Record<string, string> = {};
  if (settings.defaultNotes) out.notes = settings.defaultNotes;
  if (terms?.body) out.termsAndConditions = terms.body;

  if (docType === "sales-quotations") out.validUntil = addDays((settings as SalesSettings).quotationValidityDays);
  if (docType === "sales-invoices") {
    out.dueDate = addDays((settings as SalesSettings).invoiceDueDays);
    if (settings.defaultPaymentTerms) out.paymentTerms = settings.defaultPaymentTerms;
  }
  if (docType === "purchase-invoices") {
    out.dueDate = addDays((settings as PurchaseSettings).billDueDays);
    if (settings.defaultPaymentTerms) out.paymentTerms = settings.defaultPaymentTerms;
  }
  return out;
}
