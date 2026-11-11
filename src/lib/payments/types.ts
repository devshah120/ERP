import { z } from "zod";
import { moneyStringSchema } from "@/lib/validation/money";


/**
 * Payment modes, declared here rather than on the Mongoose model so client
 * components can import them without pulling the database driver into the
 * browser bundle.
 */
export const PAYMENT_MODES = ["CASH", "CHEQUE", "BANK", "UPI", "CARD", "ADJUSTMENT"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** A receipt settles sales invoices; a payment settles purchase invoices. */
export type PaymentDirection = "RECEIPT" | "PAYMENT";

export interface PaymentTypeConfig {
  key: "receipts" | "payments";
  direction: PaymentDirection;
  label: string;
  title: string;
  partyType: "customer" | "vendor";
  partyLabel: string;
  partyApiPath: string;
  partyBasePath: string;
  /** Which invoices this entry can be allocated against. */
  invoiceType: "sales-invoices" | "purchase-invoices";
  invoiceBasePath: string;
  prefix: string;
  sequenceType: string;
  permissions: { view: string; create: string; cancel: string };
}

export const PAYMENT_TYPES: Record<string, PaymentTypeConfig> = {
  receipts: {
    key: "receipts",
    direction: "RECEIPT",
    label: "Receipt",
    title: "Receipts",
    partyType: "customer",
    partyLabel: "Customer",
    partyApiPath: "/api/customers",
    partyBasePath: "/customers",
    invoiceType: "sales-invoices",
    invoiceBasePath: "/sales-invoices",
    prefix: "RCPT",
    sequenceType: "RECEIPT",
    permissions: { view: "receipts.view", create: "receipts.create", cancel: "receipts.cancel" },
  },
  payments: {
    key: "payments",
    direction: "PAYMENT",
    label: "Payment",
    title: "Payments",
    partyType: "vendor",
    partyLabel: "Vendor",
    partyApiPath: "/api/masters/vendors",
    partyBasePath: "/vendors",
    invoiceType: "purchase-invoices",
    invoiceBasePath: "/purchase-invoices",
    prefix: "PAY",
    sequenceType: "PAYMENT",
    permissions: { view: "payments.view", create: "payments.create", cancel: "payments.cancel" },
  },
};

export function getPaymentType(key: string): PaymentTypeConfig | undefined {
  return PAYMENT_TYPES[key];
}

export const paymentAllocationInput = z.object({
  invoiceId: z.string().trim().min(1),
  amount: moneyStringSchema,
});

export const paymentCreateSchema = z.object({
  documentDate: z.string().trim().min(1).optional(),
  partyId: z.string().trim().min(1, "Party is required"),
  amount: moneyStringSchema,
  mode: z.enum(PAYMENT_MODES).default("BANK"),
  referenceNumber: z.string().trim().max(60).optional(),
  referenceDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
  allocations: z.array(paymentAllocationInput).default([]),
});
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

export const paymentListSchema = z.object({
  query: z.string().trim().max(200).optional(),
  partyName: z.string().trim().max(200).optional(),
  mode: z.string().trim().max(20).optional(),
  status: z.string().trim().max(20).optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
});
