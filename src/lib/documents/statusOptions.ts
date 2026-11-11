import {
  SALES_QUOTATION_WORKFLOW,
  SALES_ORDER_WORKFLOW,
  DELIVERY_CHALLAN_WORKFLOW,
  SALES_INVOICE_WORKFLOW,
  SALES_RETURN_WORKFLOW,
  CREDIT_NOTE_WORKFLOW,
  PURCHASE_ORDER_WORKFLOW,
  GOODS_RECEIPT_WORKFLOW,
  PURCHASE_INVOICE_WORKFLOW,
  PURCHASE_RETURN_WORKFLOW,
  DEBIT_NOTE_WORKFLOW,
  type DocumentWorkflow,
} from "./workflows";

const BY_KEY: Record<string, DocumentWorkflow> = {
  "sales-quotations": SALES_QUOTATION_WORKFLOW,
  "sales-orders": SALES_ORDER_WORKFLOW,
  "delivery-challans": DELIVERY_CHALLAN_WORKFLOW,
  "sales-invoices": SALES_INVOICE_WORKFLOW,
  "sales-returns": SALES_RETURN_WORKFLOW,
  "credit-notes": CREDIT_NOTE_WORKFLOW,
  "purchase-orders": PURCHASE_ORDER_WORKFLOW,
  "goods-receipts": GOODS_RECEIPT_WORKFLOW,
  "purchase-invoices": PURCHASE_INVOICE_WORKFLOW,
  "purchase-returns": PURCHASE_RETURN_WORKFLOW,
  "debit-notes": DEBIT_NOTE_WORKFLOW,
};

/**
 * Every status a document type can be in, in lifecycle order — read from the
 * same workflow the server enforces, so the filter can't offer a status that
 * doesn't exist or miss one that does.
 */
export function statusOptionsFor(docKey: string): string[] {
  const wf = BY_KEY[docKey];
  if (!wf) return [];
  const seen: string[] = [];
  const visit = (s: string) => {
    if (!seen.includes(s)) seen.push(s);
  };
  visit(wf.initial);
  // Breadth-first over transitions keeps the natural forward order.
  for (let i = 0; i < seen.length; i++) {
    for (const t of wf.transitions[seen[i]] ?? []) visit(t.to);
  }
  for (const s of Object.keys(wf.transitions)) visit(s);
  // Terminal "negative" outcomes read best at the end.
  const tail = ["REJECTED", "EXPIRED", "CANCELLED"];
  return [...seen.filter((s) => !tail.includes(s)), ...tail.filter((s) => seen.includes(s))];
}
