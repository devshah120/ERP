import type { PaymentTypeConfig } from "./types";
import { PAYMENT_TYPES } from "./types";

export interface PaymentColumn {
  key: string;
  label: string;
  type?: "text" | "date" | "money" | "status" | "party";
}

export interface PaymentUi extends PaymentTypeConfig {
  singular: string;
  apiPath: string;
  basePath: string;
  /** Wording that changes between money-in and money-out. */
  amountLabel: string;
  partyHint: string;
  columns: PaymentColumn[];
}

function columns(partyLabel: string): PaymentColumn[] {
  return [
    { key: "documentNumber", label: "No." },
    { key: "documentDate", label: "Date", type: "date" },
    { key: "party.name", label: partyLabel, type: "party" },
    { key: "mode", label: "Mode" },
    { key: "referenceNumber", label: "Reference" },
    { key: "amount", label: "Amount", type: "money" },
    { key: "allocatedAmount", label: "Settled", type: "money" },
    { key: "unallocatedAmount", label: "On account", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ];
}

export const PAYMENT_UI: Record<string, PaymentUi> = {
  receipts: {
    ...PAYMENT_TYPES.receipts,
    singular: "Receipt",
    apiPath: "/api/payments/receipts",
    basePath: "/receipts",
    amountLabel: "Amount received",
    partyHint: "The customer the money came from",
    columns: columns("Customer"),
  },
  payments: {
    ...PAYMENT_TYPES.payments,
    singular: "Payment",
    apiPath: "/api/payments/payments",
    basePath: "/payments",
    amountLabel: "Amount paid",
    partyHint: "The supplier the money went to",
    columns: columns("Supplier"),
  },
};

export function getPaymentUi(key: string): PaymentUi | undefined {
  return PAYMENT_UI[key];
}
