import { DOCUMENTS } from "@/lib/documents/registry";
import { PAYMENT_TYPES } from "@/lib/payments/types";

export interface SequenceDef {
  documentType: string;
  label: string;
  group: string;
  defaultPrefix: string;
}

/**
 * Sequences owned by modules outside the document and payment registries.
 * Services that allocate these numbers import the prefix from here, so the
 * Document Prefix screen and the service can never disagree on the default.
 */
export const SEQUENCES = {
  STOCK_ADJUSTMENT: { documentType: "STOCK_ADJUSTMENT", label: "Stock verification", group: "Inventory", defaultPrefix: "ADJ" },
  STOCK_TRANSFER: { documentType: "STOCK_TRANSFER", label: "Stock transfer", group: "Inventory", defaultPrefix: "TRF" },
  STOCK_TRANSFER_REQUEST: { documentType: "STOCK_TRANSFER_REQUEST", label: "Stock transfer request", group: "Inventory", defaultPrefix: "STR" },
  MATERIAL_CREATION: { documentType: "MATERIAL_CREATION", label: "Material creation", group: "Production", defaultPrefix: "MFG" },
  MATERIAL_CONSUMPTION: { documentType: "MATERIAL_CONSUMPTION", label: "Material consumption", group: "Production", defaultPrefix: "MCN" },
  POS_REGISTER: { documentType: "POS_REGISTER", label: "POS register session", group: "Point of sale", defaultPrefix: "REG" },
  POS_ORDER: { documentType: "POS_ORDER", label: "POS order", group: "Point of sale", defaultPrefix: "POS" },
  POS_CREDIT_NOTE: { documentType: "POS_CREDIT_NOTE", label: "POS credit note", group: "Point of sale", defaultPrefix: "PCN" },
  EXPENSE: { documentType: "EXPENSE", label: "Expense", group: "Bank & cash", defaultPrefix: "EXP" },
  VOUCHER_JOURNAL: { documentType: "VOUCHER_JOURNAL", label: "Journal voucher", group: "Accounting", defaultPrefix: "JV" },
  VOUCHER_PAYMENT: { documentType: "VOUCHER_PAYMENT", label: "Payment voucher", group: "Accounting", defaultPrefix: "PV" },
  VOUCHER_RECEIPT: { documentType: "VOUCHER_RECEIPT", label: "Receipt voucher", group: "Accounting", defaultPrefix: "RV" },
  VOUCHER_CONTRA: { documentType: "VOUCHER_CONTRA", label: "Contra voucher", group: "Accounting", defaultPrefix: "CV" },
  VOUCHER_SALES: { documentType: "VOUCHER_SALES", label: "Sales voucher", group: "Accounting", defaultPrefix: "SV" },
  VOUCHER_PURCHASE: { documentType: "VOUCHER_PURCHASE", label: "Purchase voucher", group: "Accounting", defaultPrefix: "PUV" },
} satisfies Record<string, SequenceDef>;

const SALES_KEYS = new Set(["sales-quotations", "sales-orders", "delivery-challans", "sales-invoices", "sales-returns", "credit-notes"]);

/** Every numbered document in the product, in screen order. */
export function sequenceCatalogue(): SequenceDef[] {
  const docs: SequenceDef[] = Object.values(DOCUMENTS).map((d) => ({
    documentType: d.sequenceType,
    label: d.label,
    group: SALES_KEYS.has(d.key) ? "Sales" : "Purchase",
    defaultPrefix: d.prefix,
  }));
  const money: SequenceDef[] = Object.values(PAYMENT_TYPES).map((p) => ({
    documentType: p.sequenceType,
    label: p.label,
    group: "Bank & cash",
    defaultPrefix: p.prefix,
  }));
  return [...docs, ...money, ...Object.values(SEQUENCES)];
}
