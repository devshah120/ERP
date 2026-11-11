/**
 * Central status definitions for every transactional document (Section 18).
 * Screens never invent statuses — they read allowed transitions from here,
 * and every change is validated server-side before it is applied.
 */

export interface TransitionRule {
  to: string;
  /** Button label shown in the UI. */
  label: string;
  /** Permission key required, e.g. "sales-orders.approve". */
  permission?: string;
  /** Requires a reason from the user (cancellations, rejections). */
  requiresReason?: boolean;
  /** Visual weight of the action button. */
  intent?: "primary" | "danger" | "neutral";
}

export interface DocumentWorkflow {
  initial: string;
  /** Statuses after which the document is locked against edits. */
  lockedStatuses: string[];
  /** Terminal statuses — no further transitions. */
  terminalStatuses: string[];
  transitions: Record<string, TransitionRule[]>;
}

const CANCEL: TransitionRule = {
  to: "CANCELLED",
  label: "Cancel",
  requiresReason: true,
  intent: "danger",
};

export const SALES_QUOTATION_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["CONVERTED", "CANCELLED", "EXPIRED", "REJECTED"],
  terminalStatuses: ["CONVERTED", "CANCELLED", "EXPIRED", "REJECTED"],
  transitions: {
    DRAFT: [{ to: "SENT", label: "Send to customer", intent: "primary" }, CANCEL],
    SENT: [
      { to: "UNDER_NEGOTIATION", label: "Mark under negotiation", intent: "neutral" },
      { to: "APPROVED", label: "Customer approved", intent: "primary" },
      { to: "REJECTED", label: "Customer rejected", requiresReason: true, intent: "danger" },
      { to: "EXPIRED", label: "Mark expired", intent: "neutral" },
      CANCEL,
    ],
    UNDER_NEGOTIATION: [
      { to: "APPROVED", label: "Customer approved", intent: "primary" },
      { to: "REJECTED", label: "Customer rejected", requiresReason: true, intent: "danger" },
      CANCEL,
    ],
    APPROVED: [{ to: "EXPIRED", label: "Mark expired", intent: "neutral" }, CANCEL],
    // CONVERTED is set by the conversion flow, not by a manual transition.
    REJECTED: [],
    EXPIRED: [],
    CONVERTED: [],
    CANCELLED: [],
  },
};

export const SALES_ORDER_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "COMPLETED", "CANCELLED"],
  terminalStatuses: ["COMPLETED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "PENDING_APPROVAL", label: "Submit for approval", intent: "primary" }, CANCEL],
    PENDING_APPROVAL: [
      { to: "CONFIRMED", label: "Approve & confirm", permission: "sales-orders.approve", intent: "primary" },
      { to: "DRAFT", label: "Send back to draft", intent: "neutral" },
      CANCEL,
    ],
    // Delivery and invoicing drive these automatically; cancel stays available.
    CONFIRMED: [CANCEL],
    PARTIALLY_DELIVERED: [CANCEL],
    DELIVERED: [],
    PARTIALLY_INVOICED: [],
    INVOICED: [{ to: "COMPLETED", label: "Mark completed", intent: "primary" }],
    COMPLETED: [],
    CANCELLED: [],
  },
};

export const DELIVERY_CHALLAN_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["DISPATCHED", "DELIVERED", "CANCELLED"],
  terminalStatuses: ["DELIVERED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "CONFIRMED", label: "Confirm", intent: "primary" }, CANCEL],
    // Dispatch is the point stock actually leaves the warehouse.
    CONFIRMED: [{ to: "DISPATCHED", label: "Dispatch (moves stock out)", intent: "primary" }, CANCEL],
    DISPATCHED: [{ to: "DELIVERED", label: "Mark delivered", intent: "primary" }, CANCEL],
    DELIVERED: [],
    CANCELLED: [],
  },
};

export const SALES_INVOICE_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["POSTED", "PARTIALLY_PAID", "PAID", "CANCELLED"],
  terminalStatuses: ["PAID", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "POSTED", label: "Post invoice", intent: "primary" }, CANCEL],
    // Payment status is driven by recorded payments, not manual transitions.
    POSTED: [CANCEL],
    PARTIALLY_PAID: [],
    PAID: [],
    CANCELLED: [],
  },
};

export const SALES_RETURN_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["RECEIVED", "COMPLETED", "CANCELLED"],
  terminalStatuses: ["COMPLETED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "APPROVED", label: "Approve return", intent: "primary" }, CANCEL],
    // Receiving the goods back is the point stock comes in.
    APPROVED: [{ to: "RECEIVED", label: "Receive goods (stock in)", intent: "primary" }, CANCEL],
    RECEIVED: [{ to: "COMPLETED", label: "Mark completed", intent: "primary" }],
    COMPLETED: [],
    CANCELLED: [],
  },
};

export const CREDIT_NOTE_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["ISSUED", "CANCELLED"],
  terminalStatuses: ["ISSUED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "ISSUED", label: "Issue credit note", intent: "primary" }, CANCEL],
    ISSUED: [CANCEL],
    CANCELLED: [],
  },
};

// ---------------------------------------------------------------- Purchase
// Mirrors the sales side: the order is the commitment, the goods receipt is
// where stock actually arrives, and the invoice is where the payable lands.

export const PURCHASE_ORDER_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED", "COMPLETED", "CANCELLED"],
  terminalStatuses: ["COMPLETED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "PENDING_APPROVAL", label: "Submit for approval", intent: "primary" }, CANCEL],
    PENDING_APPROVAL: [
      { to: "CONFIRMED", label: "Approve & confirm", permission: "purchase-orders.approve", intent: "primary" },
      { to: "DRAFT", label: "Send back to draft", intent: "neutral" },
      CANCEL,
    ],
    CONFIRMED: [CANCEL],
    PARTIALLY_RECEIVED: [CANCEL],
    RECEIVED: [],
    PARTIALLY_INVOICED: [],
    INVOICED: [{ to: "COMPLETED", label: "Mark completed", intent: "primary" }],
    COMPLETED: [],
    CANCELLED: [],
  },
};

export const GOODS_RECEIPT_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["RECEIVED", "CANCELLED"],
  terminalStatuses: ["RECEIVED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "CONFIRMED", label: "Confirm", intent: "primary" }, CANCEL],
    // Receiving is the point stock actually enters the warehouse.
    CONFIRMED: [{ to: "RECEIVED", label: "Receive goods (stock in)", intent: "primary" }, CANCEL],
    RECEIVED: [CANCEL],
    CANCELLED: [],
  },
};

export const PURCHASE_INVOICE_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["POSTED", "PARTIALLY_PAID", "PAID", "CANCELLED"],
  terminalStatuses: ["PAID", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "POSTED", label: "Post invoice", intent: "primary" }, CANCEL],
    POSTED: [CANCEL],
    PARTIALLY_PAID: [],
    PAID: [],
    CANCELLED: [],
  },
};

export const PURCHASE_RETURN_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["DISPATCHED", "COMPLETED", "CANCELLED"],
  terminalStatuses: ["COMPLETED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "APPROVED", label: "Approve return", intent: "primary" }, CANCEL],
    // Returning goods to the vendor takes stock back out.
    APPROVED: [{ to: "DISPATCHED", label: "Dispatch to vendor (stock out)", intent: "primary" }, CANCEL],
    DISPATCHED: [{ to: "COMPLETED", label: "Mark completed", intent: "primary" }],
    COMPLETED: [],
    CANCELLED: [],
  },
};

export const DEBIT_NOTE_WORKFLOW: DocumentWorkflow = {
  initial: "DRAFT",
  lockedStatuses: ["ISSUED", "CANCELLED"],
  terminalStatuses: ["ISSUED", "CANCELLED"],
  transitions: {
    DRAFT: [{ to: "ISSUED", label: "Issue debit note", intent: "primary" }, CANCEL],
    ISSUED: [CANCEL],
    CANCELLED: [],
  },
};

export function canEdit(workflow: DocumentWorkflow, status: string): boolean {
  return !workflow.lockedStatuses.includes(status);
}

export function allowedTransitions(workflow: DocumentWorkflow, status: string): TransitionRule[] {
  return workflow.transitions[status] ?? [];
}
