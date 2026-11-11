import type { FieldConfig } from "@/lib/resources/ui/types";

export interface DocumentColumn {
  key: string;
  label: string;
  /** "party" renders the customer/vendor name bold and linked to its master. */
  type?: "text" | "date" | "datetime" | "money" | "status" | "payment" | "party";
}

export interface DocumentUi {
  key: string;
  title: string;
  singular: string;
  apiPath: string;
  basePath: string;
  /** Which master supplies the party picker, and where its records live. */
  partyLabel: string;
  partyField: "customer" | "vendor";
  partyIdField: "customerId" | "vendorId";
  partyApiPath: string;
  partyBasePath: string;
  columns: DocumentColumn[];
  /** Header fields specific to this document type. */
  extraFields: FieldConfig[];
  convertsTo: { key: string; label: string }[];
}

const CUSTOMER_PARTY = {
  partyLabel: "Customer",
  partyField: "customer" as const,
  partyIdField: "customerId" as const,
  partyApiPath: "/api/customers",
  partyBasePath: "/customers",
};

const VENDOR_PARTY = {
  partyLabel: "Vendor",
  partyField: "vendor" as const,
  partyIdField: "vendorId" as const,
  partyApiPath: "/api/masters/vendors",
  partyBasePath: "/vendors",
};

function baseColumns(party: "customer" | "vendor", partyLabel: string): DocumentColumn[] {
  return [
    { key: "documentNumber", label: "Doc No" },
    { key: "documentDate", label: "Date", type: "date" },
    { key: "createdAt", label: "Created Date", type: "datetime" },
    { key: `${party}.name`, label: `${partyLabel} Name`, type: "party" },
    { key: "totals.grandTotal", label: "Total Amount", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ];
}

const SALES_BASE = baseColumns("customer", "Customer");
const PURCHASE_BASE = baseColumns("vendor", "Vendor");

const ORDER_TYPE_OPTIONS = [
  { value: "REGULAR", label: "Regular" },
  { value: "WALKIN", label: "Walk-in" },
  { value: "ONLINE", label: "Online" },
  { value: "EXPORT", label: "Export" },
];

const PAYMENT_MODE_OPTIONS = [
  { value: "CREDIT", label: "Credit" },
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "UPI", label: "UPI" },
  { value: "BANK", label: "Bank transfer" },
  { value: "MIXED", label: "Mixed" },
];

function warehouseField(hint: string): FieldConfig {
  return {
    name: "warehouseId",
    label: "Warehouse",
    type: "reference",
    reference: { resource: "warehouses", labelField: "name" },
    required: true,
    hint,
    tab: "partner",
  };
}

export const DOCUMENT_UI: Record<string, DocumentUi> = {
  // ------------------------------------------------------------------ Sales

  "sales-quotations": {
    key: "sales-quotations",
    title: "Sales Quotations",
    singular: "Sales Quotation",
    apiPath: "/api/documents/sales-quotations",
    basePath: "/sales-quotations",
    ...CUSTOMER_PARTY,
    columns: [
      ...SALES_BASE.slice(0, 4),
      { key: "validUntil", label: "Valid Until", type: "date" },
      ...SALES_BASE.slice(4),
    ],
    extraFields: [{ name: "validUntil", label: "Valid until", type: "text", header: true }],
    convertsTo: [{ key: "sales-orders", label: "Convert to Sales Order" }],
  },

  "sales-orders": {
    key: "sales-orders",
    title: "Sales Orders",
    singular: "Sales Order",
    apiPath: "/api/documents/sales-orders",
    basePath: "/sales-orders",
    ...CUSTOMER_PARTY,
    columns: [...SALES_BASE.slice(0, 4), { key: "orderType", label: "Order Type" }, ...SALES_BASE.slice(4)],
    extraFields: [
      { name: "expectedDeliveryDate", label: "Delivery date", type: "text", header: true },
      { name: "orderType", label: "Order type", type: "select", options: ORDER_TYPE_OPTIONS, defaultValue: "REGULAR", header: true },
      { name: "customerPoNumber", label: "Customer PO no.", type: "text", hint: "Optional", tab: "additional" },
    ],
    convertsTo: [
      { key: "delivery-challans", label: "Create Delivery" },
      { key: "sales-invoices", label: "Create Invoice" },
    ],
  },

  "delivery-challans": {
    key: "delivery-challans",
    title: "Sales Deliveries",
    singular: "Sales Delivery",
    apiPath: "/api/documents/delivery-challans",
    basePath: "/delivery-challans",
    ...CUSTOMER_PARTY,
    columns: [...SALES_BASE.slice(0, 4), { key: "vehicleNumber", label: "Vehicle No" }, ...SALES_BASE.slice(4)],
    extraFields: [
      warehouseField("Stock is deducted from here on dispatch"),
      {
        name: "transporterId",
        label: "Transporter",
        type: "reference",
        reference: { resource: "transporters", labelField: "name" },
        hint: "Optional",
        tab: "partner",
      },
      { name: "vehicleNumber", label: "Vehicle number", type: "text", hint: "Optional", tab: "partner" },
      { name: "lrNumber", label: "LR number", type: "text", hint: "Optional", tab: "partner" },
      { name: "ewayBillNumber", label: "E-way bill no.", type: "text", hint: "Optional", tab: "additional" },
    ],
    convertsTo: [{ key: "sales-invoices", label: "Create Invoice" }],
  },

  "sales-invoices": {
    key: "sales-invoices",
    title: "Invoices",
    singular: "Invoice",
    apiPath: "/api/documents/sales-invoices",
    basePath: "/sales-invoices",
    ...CUSTOMER_PARTY,
    columns: [
      { key: "documentNumber", label: "Invoice No" },
      { key: "documentDate", label: "Date", type: "date" },
      { key: "createdAt", label: "Created Date", type: "datetime" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "customer.name", label: "Customer Name", type: "party" },
      { key: "totals.grandTotal", label: "Total Amount", type: "money" },
      { key: "dueAmount", label: "Due Amount", type: "money" },
      { key: "paymentMode", label: "Payment Mode" },
      { key: "paymentStatus", label: "Payment Status", type: "payment" },
      { key: "orderType", label: "Order Type" },
      { key: "status", label: "Status", type: "status" },
    ],
    extraFields: [
      { name: "dueDate", label: "Due date", type: "text", header: true },
      { name: "paymentTerms", label: "Payment terms", type: "text", hint: "e.g. Net 30", tab: "additional" },
      { name: "paymentMode", label: "Payment mode", type: "select", defaultValue: "CREDIT", options: PAYMENT_MODE_OPTIONS, tab: "additional" },
      { name: "orderType", label: "Order type", type: "select", options: ORDER_TYPE_OPTIONS, defaultValue: "REGULAR", header: true },
    ],
    convertsTo: [
      { key: "sales-returns", label: "Create Sales Return" },
      { key: "credit-notes", label: "Create Credit Note" },
    ],
  },

  "sales-returns": {
    key: "sales-returns",
    title: "Sales Returns",
    singular: "Sales Return",
    apiPath: "/api/documents/sales-returns",
    basePath: "/sales-returns",
    ...CUSTOMER_PARTY,
    columns: [...SALES_BASE],
    extraFields: [
      warehouseField("Returned stock comes back into here"),
      { name: "returnReason", label: "Return reason", type: "textarea", fullWidth: true, tab: "other" },
    ],
    convertsTo: [{ key: "credit-notes", label: "Create Credit Note" }],
  },

  "credit-notes": {
    key: "credit-notes",
    title: "Credit Notes",
    singular: "Credit Note",
    apiPath: "/api/documents/credit-notes",
    basePath: "/credit-notes",
    ...CUSTOMER_PARTY,
    columns: [...SALES_BASE],
    extraFields: [{ name: "reason", label: "Reason", type: "textarea", fullWidth: true, tab: "other" }],
    convertsTo: [],
  },

  // --------------------------------------------------------------- Purchase

  "purchase-orders": {
    key: "purchase-orders",
    title: "Purchase Orders",
    singular: "Purchase Order",
    apiPath: "/api/documents/purchase-orders",
    basePath: "/purchase-orders",
    ...VENDOR_PARTY,
    columns: [
      ...PURCHASE_BASE.slice(0, 4),
      { key: "expectedDeliveryDate", label: "Expected Date", type: "date" },
      ...PURCHASE_BASE.slice(4),
    ],
    extraFields: [
      { name: "expectedDeliveryDate", label: "Delivery date", type: "text", header: true },
      { name: "vendorQuotationRef", label: "Vendor quotation ref", type: "text", hint: "Optional", tab: "additional" },
    ],
    convertsTo: [
      { key: "goods-receipts", label: "Create Goods Receipt" },
      { key: "purchase-invoices", label: "Create Purchase Invoice" },
    ],
  },

  "goods-receipts": {
    key: "goods-receipts",
    title: "Goods Receipts",
    singular: "Goods Receipt",
    apiPath: "/api/documents/goods-receipts",
    basePath: "/goods-receipts",
    ...VENDOR_PARTY,
    columns: [
      ...PURCHASE_BASE.slice(0, 4),
      { key: "vendorInvoiceRef", label: "Vendor Inv. Ref" },
      ...PURCHASE_BASE.slice(4),
    ],
    extraFields: [
      warehouseField("Received stock is added here"),
      { name: "vendorInvoiceRef", label: "Vendor invoice ref", type: "text", hint: "Optional", tab: "additional" },
      { name: "vehicleNumber", label: "Vehicle number", type: "text", hint: "Optional", tab: "partner" },
    ],
    convertsTo: [{ key: "purchase-invoices", label: "Create Purchase Invoice" }],
  },

  "purchase-invoices": {
    key: "purchase-invoices",
    title: "Purchase Invoices",
    singular: "Purchase Invoice",
    apiPath: "/api/documents/purchase-invoices",
    basePath: "/purchase-invoices",
    ...VENDOR_PARTY,
    columns: [
      { key: "documentNumber", label: "Invoice No" },
      { key: "documentDate", label: "Date", type: "date" },
      { key: "vendorInvoiceNumber", label: "Vendor Inv. No" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "vendor.name", label: "Vendor Name", type: "party" },
      { key: "totals.grandTotal", label: "Total Amount", type: "money" },
      { key: "dueAmount", label: "Due Amount", type: "money" },
      { key: "paymentMode", label: "Payment Mode" },
      { key: "paymentStatus", label: "Payment Status", type: "payment" },
      { key: "status", label: "Status", type: "status" },
    ],
    extraFields: [
      { name: "vendorInvoiceNumber", label: "Vendor invoice no.", type: "text", hint: "Optional", header: true },
      { name: "dueDate", label: "Due date", type: "text", header: true },
      { name: "paymentTerms", label: "Payment terms", type: "text", hint: "e.g. Net 30", tab: "additional" },
      { name: "paymentMode", label: "Payment mode", type: "select", defaultValue: "CREDIT", options: PAYMENT_MODE_OPTIONS, tab: "additional" },
    ],
    convertsTo: [
      { key: "purchase-returns", label: "Create Purchase Return" },
      { key: "debit-notes", label: "Create Debit Note" },
    ],
  },

  "purchase-returns": {
    key: "purchase-returns",
    title: "Purchase Returns",
    singular: "Purchase Return",
    apiPath: "/api/documents/purchase-returns",
    basePath: "/purchase-returns",
    ...VENDOR_PARTY,
    columns: [...PURCHASE_BASE],
    extraFields: [
      warehouseField("Returned stock is taken out of here"),
      { name: "returnReason", label: "Return reason", type: "textarea", fullWidth: true, tab: "other" },
    ],
    convertsTo: [{ key: "debit-notes", label: "Create Debit Note" }],
  },

  "debit-notes": {
    key: "debit-notes",
    title: "Debit Notes",
    singular: "Debit Note",
    apiPath: "/api/documents/debit-notes",
    basePath: "/debit-notes",
    ...VENDOR_PARTY,
    columns: [...PURCHASE_BASE],
    extraFields: [{ name: "reason", label: "Reason", type: "textarea", fullWidth: true, tab: "other" }],
    convertsTo: [],
  },
};

// Every document can carry terms & conditions. New documents are pre-filled
// with the default template from Sales / Purchase Terms & Conditions, and
// the print sheet shows them under the totals.
for (const ui of Object.values(DOCUMENT_UI)) {
  ui.extraFields.push({
    name: "termsAndConditions",
    label: "Terms & conditions",
    type: "textarea",
    fullWidth: true,
    tab: "additional",
  });
}

export function getDocumentUi(key: string): DocumentUi | undefined {
  return DOCUMENT_UI[key];
}

/** Status → badge colour class, shared by list and detail screens. */
export function statusClass(status: string): string {
  if (
    ["APPROVED", "CONFIRMED", "DELIVERED", "PAID", "COMPLETED", "POSTED", "ISSUED", "RECEIVED"].includes(status)
  ) {
    return "badgeSuccess";
  }
  if (["CANCELLED", "REJECTED", "EXPIRED"].includes(status)) return "badgeDanger";
  if (status === "DRAFT") return "badgeNeutral";
  return "badgeWarning";
}

/**
 * Label for the "save and send it onward" checkbox on the create form.
 *
 * Every document type has exactly one non-cancel transition out of DRAFT, so
 * the checkbox generalises across all of them — only the wording differs.
 * The actual transition is read back from the saved document rather than
 * assumed here, so this string can never send a document somewhere the
 * workflow does not allow.
 */
export function submitActionLabel(docTypeKey: string): string {
  switch (docTypeKey) {
    case "sales-orders":
    case "purchase-orders":
      return "Send for approval";
    case "sales-quotations":
      return "Send to customer";
    case "sales-invoices":
    case "purchase-invoices":
      return "Post immediately";
    case "credit-notes":
    case "debit-notes":
      return "Issue immediately";
    case "sales-returns":
    case "purchase-returns":
      return "Approve immediately";
    default:
      return "Confirm immediately";
  }
}
