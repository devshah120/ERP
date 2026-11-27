/**
 * Every document an approval scheme can be set up for. Kept free of server
 * imports so the scheme screen and the queue can use it as well as the engine.
 *
 * `amount` = the document carries a money value, so a stage can apply
 * "only if the amount exceeds" a limit.
 * `product` = which product must be bought for the document to be offered.
 * `href` = where the record opens (":id" is replaced).
 */
export const APPROVAL_DOCUMENTS = [
  { key: "sales-quotations", label: "Sales Quotation", module: "Sales", product: "ERP", amount: true, href: "/sales-quotations/:id" },
  { key: "sales-orders", label: "Sales Order", module: "Sales", product: "ERP", amount: true, href: "/sales-orders/:id" },
  { key: "delivery-challans", label: "Delivery Challan", module: "Sales", product: "ERP", amount: true, href: "/delivery-challans/:id" },
  { key: "sales-invoices", label: "Sales Invoice", module: "Sales", product: "ERP", amount: true, href: "/sales-invoices/:id" },
  { key: "sales-returns", label: "Sales Return", module: "Sales", product: "ERP", amount: true, href: "/sales-returns/:id" },
  { key: "credit-notes", label: "Credit Note", module: "Sales", product: "ERP", amount: true, href: "/credit-notes/:id" },
  { key: "purchase-orders", label: "Purchase Order", module: "Purchase", product: "ERP", amount: true, href: "/purchase-orders/:id" },
  { key: "goods-receipts", label: "Goods Receipt", module: "Purchase", product: "ERP", amount: true, href: "/goods-receipts/:id" },
  { key: "purchase-invoices", label: "Purchase Invoice", module: "Purchase", product: "ERP", amount: true, href: "/purchase-invoices/:id" },
  { key: "purchase-returns", label: "Purchase Return", module: "Purchase", product: "ERP", amount: true, href: "/purchase-returns/:id" },
  { key: "debit-notes", label: "Debit Note", module: "Purchase", product: "ERP", amount: true, href: "/debit-notes/:id" },
  { key: "hr-leave", label: "ESS Leave Request", module: "HR", product: "HRMS", amount: false, href: "/hr/leaves" },
  { key: "hr-claim", label: "ESS Claim Request", module: "HR", product: "HRMS", amount: true, href: "/hr/claims" },
  { key: "hr-advance", label: "ESS Advance Request", module: "HR", product: "HRMS", amount: true, href: "/hr/loans/requests" },
  { key: "hr-attendance-correction", label: "Attendance Correction", module: "HR", product: "HRMS", amount: false, href: "/hr/attendance/requests" },
] as const;

export type ApprovalDocumentKey = (typeof APPROVAL_DOCUMENTS)[number]["key"];

export const APPROVER_TYPES = ["REPORTING_MANAGER", "SPECIFIC_USER", "USER_GROUP"] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];
export const APPROVER_TYPE_LABELS: Record<ApproverType, string> = {
  REPORTING_MANAGER: "Reporting Manager",
  SPECIFIC_USER: "Specific User",
  USER_GROUP: "User Group",
};

export const MAX_APPROVAL_STAGES = 3;

export function approvalDocument(key: string) {
  return APPROVAL_DOCUMENTS.find((d) => d.key === key);
}

export function approvalHref(key: string, recordId: string): string {
  return (approvalDocument(key)?.href ?? "/").replace(":id", recordId);
}
