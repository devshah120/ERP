/**
 * Print formats: which paper layouts exist, and which document types can use
 * them. Pure data, shared by the settings schema (server), the Print Formats
 * settings screen and every print path (POS receipt, document print page).
 *
 * Every layout renders from one normalised print model (see
 * components/print/model.ts), so any layout *can* print any document; the
 * per-type lists below only offer the ones that make sense for that paper.
 */

export type PaperSize = "THERMAL_58" | "THERMAL_80" | "A5" | "A4";

export const PAPER_SIZES: Record<PaperSize, { label: string; short: string; widthMm: number; thermal: boolean }> = {
  THERMAL_58: { label: "Thermal 58 mm", short: "58 mm", widthMm: 58, thermal: true },
  THERMAL_80: { label: "Thermal 80 mm", short: "80 mm", widthMm: 80, thermal: true },
  A5: { label: "A5", short: "A5", widthMm: 148, thermal: false },
  A4: { label: "A4", short: "A4", widthMm: 210, thermal: false },
};

export type LayoutId =
  | "thermal-80-standard"
  | "thermal-80-detailed"
  | "thermal-80-compact"
  | "thermal-58-standard"
  | "a4-standard"
  | "a4-gst-detailed"
  | "a4-simple"
  | "a4-modern"
  | "a5-compact"
  | "a5-receipt";

export interface PrintLayoutDef {
  id: LayoutId;
  name: string;
  size: PaperSize;
  description: string;
}

export const PRINT_LAYOUTS: Record<LayoutId, PrintLayoutDef> = {
  "thermal-80-standard": {
    id: "thermal-80-standard",
    name: "Thermal 80 mm · Standard",
    size: "THERMAL_80",
    description: "Item, qty × rate and GST % per line, with a CGST / SGST summary. The everyday till receipt.",
  },
  "thermal-80-detailed": {
    id: "thermal-80-detailed",
    name: "Thermal 80 mm · GST detailed",
    size: "THERMAL_80",
    description: "Adds item code, HSN and a rate-wise GST table, plus the customer's savings. For buyers who claim credit.",
  },
  "thermal-80-compact": {
    id: "thermal-80-compact",
    name: "Thermal 80 mm · Compact",
    size: "THERMAL_80",
    description: "One line per item and just the totals. Uses the least paper on busy counters.",
  },
  "thermal-58-standard": {
    id: "thermal-58-standard",
    name: "Thermal 58 mm · Standard",
    size: "THERMAL_58",
    description: "Narrow-roll receipt for 2-inch printers and handheld billing devices.",
  },
  "a4-standard": {
    id: "a4-standard",
    name: "A4 · Tax invoice",
    size: "A4",
    description: "Full GST invoice: Bill To / Ship To, per-line CGST / SGST or IGST, amount in words and signature.",
  },
  "a4-gst-detailed": {
    id: "a4-gst-detailed",
    name: "A4 · GST classic (boxed)",
    size: "A4",
    description: "Fully ruled, government-style format with a rate-wise tax summary and copy marking.",
  },
  "a4-simple": {
    id: "a4-simple",
    name: "A4 · Simple",
    size: "A4",
    description: "Qty, rate and amount only, with tax shown once in the totals. Suits quotations, orders and challans.",
  },
  "a4-modern": {
    id: "a4-modern",
    name: "A4 · Modern",
    size: "A4",
    description: "Clean, lightly coloured layout with a bold total band. Good for e-mailing customers.",
  },
  "a5-compact": {
    id: "a5-compact",
    name: "A5 · Compact invoice",
    size: "A5",
    description: "Half-page tax invoice. Two fit on one A4 sheet; good for small bills.",
  },
  "a5-receipt": {
    id: "a5-receipt",
    name: "A5 · Counter bill",
    size: "A5",
    description: "Counter bill on half A4 with payment details. For stores without a thermal printer.",
  },
};

export type PrintGroup = "POS" | "SALES" | "PURCHASE";

export interface PrintDocTypeDef {
  key: string;
  label: string;
  group: PrintGroup;
  layouts: LayoutId[];
  defaultLayout: LayoutId;
}

const POS_LAYOUTS: LayoutId[] = [
  "thermal-80-standard",
  "thermal-80-detailed",
  "thermal-80-compact",
  "thermal-58-standard",
  "a5-receipt",
  "a5-compact",
  "a4-standard",
];

const SALES_LAYOUTS: LayoutId[] = ["a4-standard", "a4-gst-detailed", "a4-modern", "a4-simple", "a5-compact", "thermal-80-standard", "thermal-80-detailed"];
const NON_TAX_LAYOUTS: LayoutId[] = ["a4-simple", "a4-standard", "a4-modern", "a4-gst-detailed", "a5-compact"];
const PURCHASE_LAYOUTS: LayoutId[] = ["a4-standard", "a4-gst-detailed", "a4-simple", "a4-modern", "a5-compact"];

const doc = (key: string, label: string, group: PrintGroup, layouts: LayoutId[], defaultLayout: LayoutId = layouts[0]): PrintDocTypeDef => ({
  key,
  label,
  group,
  layouts,
  defaultLayout,
});

/** Keys are the document resource keys (sales-invoices…) plus the two POS documents. */
export const PRINT_DOC_TYPES: PrintDocTypeDef[] = [
  doc("pos-orders", "POS Bill", "POS", POS_LAYOUTS),
  doc("pos-credit-notes", "POS Credit Note", "POS", POS_LAYOUTS),
  doc("sales-quotations", "Sales Quotation", "SALES", NON_TAX_LAYOUTS),
  doc("sales-orders", "Sales Order", "SALES", NON_TAX_LAYOUTS),
  doc("delivery-challans", "Sales Delivery", "SALES", NON_TAX_LAYOUTS),
  doc("sales-invoices", "Sales Invoice", "SALES", SALES_LAYOUTS),
  doc("sales-returns", "Sales Return", "SALES", SALES_LAYOUTS),
  doc("credit-notes", "Credit Note", "SALES", SALES_LAYOUTS),
  doc("purchase-orders", "Purchase Order", "PURCHASE", NON_TAX_LAYOUTS),
  doc("goods-receipts", "Goods Receipt", "PURCHASE", NON_TAX_LAYOUTS),
  doc("purchase-invoices", "Purchase Invoice", "PURCHASE", PURCHASE_LAYOUTS),
  doc("purchase-returns", "Purchase Return", "PURCHASE", PURCHASE_LAYOUTS),
  doc("debit-notes", "Debit Note", "PURCHASE", PURCHASE_LAYOUTS),
];

export const PRINT_GROUP_LABELS: Record<PrintGroup, string> = {
  POS: "Point of sale",
  SALES: "Sales",
  PURCHASE: "Purchase",
};

export const PRINT_DOC_TYPE_MAP: Record<string, PrintDocTypeDef> = Object.fromEntries(PRINT_DOC_TYPES.map((d) => [d.key, d]));

/** Saved choice → a layout this type actually offers, else its default. */
export function resolveLayout(docType: string, chosen?: string | null): PrintLayoutDef {
  const def = PRINT_DOC_TYPE_MAP[docType];
  const offered: readonly string[] = def?.layouts ?? Object.keys(PRINT_LAYOUTS);
  const id = chosen && offered.includes(chosen) ? (chosen as LayoutId) : (def?.defaultLayout ?? "a4-standard");
  return PRINT_LAYOUTS[id];
}

export function isThermal(layout: PrintLayoutDef) {
  return PAPER_SIZES[layout.size].thermal;
}
