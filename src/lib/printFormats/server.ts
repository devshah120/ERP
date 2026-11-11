import type { Types } from "mongoose";
import { Business } from "@/models/Business";
import { getPrintFormats } from "@/lib/settings/service";
import type { PrintBusiness } from "@/components/print/model";
import { PRINT_DOC_TYPE_MAP, PRINT_LAYOUTS, resolveLayout, type LayoutId } from "./catalog";

/** The business as printed on every document. Null when it no longer exists. */
export async function loadPrintBusiness(businessId: Types.ObjectId): Promise<PrintBusiness | null> {
  const b = await Business.findById(businessId).lean<{
    tradeName: string;
    gstin?: string;
    state?: string;
    city?: string;
    address?: string;
    phone?: string;
    email?: string;
    currency?: string;
  }>();
  if (!b) return null;
  return {
    name: b.tradeName,
    gstin: b.gstin,
    state: b.state,
    city: b.city,
    address: b.address,
    phone: b.phone,
    email: b.email,
    currency: b.currency,
  };
}

/**
 * Which layout a print page uses: a one-off `?layout=` choice when the type
 * offers it, otherwise the saved Print Formats setting. Also returns what
 * the toolbar needs to offer a switch.
 */
export async function choosePrintLayout(businessId: Types.ObjectId, docType: string, override?: string | string[]) {
  const formats = await getPrintFormats(businessId);
  const saved = resolveLayout(docType, formats[docType]);
  const offered: LayoutId[] = PRINT_DOC_TYPE_MAP[docType]?.layouts ?? [saved.id];
  const layout = typeof override === "string" && offered.includes(override as LayoutId) ? PRINT_LAYOUTS[override as LayoutId] : saved;
  return {
    layout,
    savedId: saved.id,
    options: offered.map((id) => ({ id, name: PRINT_LAYOUTS[id].name })),
  };
}
