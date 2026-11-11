import { z } from "zod";
import type { Model } from "mongoose";
import { moneyStringSchema } from "@/lib/validation/money";
import {
  SalesQuotation,
  SalesOrder,
  DeliveryChallan,
  SalesInvoice,
  SalesReturn,
  CreditNote,
} from "@/models/salesDocuments";
import {
  PurchaseOrder,
  GoodsReceipt,
  PurchaseInvoice,
  PurchaseReturn,
  DebitNote,
} from "@/models/purchaseDocuments";
import { Customer } from "@/models/Customer";
import { Vendor } from "@/models/Vendor";
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

/** How a document identifies its trading party — customers for sales,
 * vendors for purchase. Lets one engine serve both sides of the ledger. */
export interface PartyConfig {
  kind: "customer" | "vendor";
  idField: "customerId" | "vendorId";
  snapshotField: "customer" | "vendor";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;
  codeField: "customerCode" | "vendorCode";
  label: string;
}

const CUSTOMER_PARTY: PartyConfig = {
  kind: "customer",
  idField: "customerId",
  snapshotField: "customer",
  model: Customer,
  codeField: "customerCode",
  label: "Customer",
};

const VENDOR_PARTY: PartyConfig = {
  kind: "vendor",
  idField: "vendorId",
  snapshotField: "vendor",
  model: Vendor,
  codeField: "vendorCode",
  label: "Vendor",
};

export const documentLineInput = z.object({
  itemId: z.string().trim().min(1),
  variantSku: z.string().trim().optional(),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
  description: z.string().trim().max(500).optional(),
  quantity: z.coerce.number().positive(),
  unitName: z.string().trim().optional(),
  rate: moneyStringSchema,
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  discountAmount: moneyStringSchema.optional(),
  taxRatePercent: z.coerce.number().min(0).max(100).default(0),
});

const baseDocumentInput = {
  documentDate: z.string().trim().min(1).optional(),
  // The party field is swapped in per document type below — sales documents
  // take customerId, purchase documents take vendorId.
  lines: z.array(documentLineInput).min(1, "At least one line item is required"),
  shippingCharge: moneyStringSchema.default("0"),
  notes: z.string().trim().max(2000).optional(),
  termsAndConditions: z.string().trim().max(4000).optional(),
  agentId: z.string().trim().optional().or(z.literal("")),
};

export interface DocumentDefinition {
  key: string;
  label: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;
  party: PartyConfig;
  workflow: DocumentWorkflow;
  /** Document-number prefix, e.g. QTN → QTN-2026-2027-000001. */
  prefix: string;
  /** Sequence key stored on DocumentSequence. */
  sequenceType: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSchema: z.ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSchema: z.ZodType<any>;
  /** Document types this one can be converted into. */
  convertsTo: string[];
  /** Whether this document moves stock, and in which direction. */
  stock?: {
    direction: "IN" | "OUT";
    movementType: "SALES_DELIVERY" | "SALES_RETURN" | "PURCHASE_RECEIPT" | "PURCHASE_RETURN";
    atStatus: string;
  };
  /**
   * True when this document fulfils its source order, so posting it should
   * roll quantities up to that order. Deliberately explicit rather than
   * inferred from stock direction: a delivery is OUT and a goods receipt is
   * IN, yet both fulfil an order, while returns move stock without
   * fulfilling anything.
   */
  fulfilsSourceOrder?: boolean;
  requiresWarehouse: boolean;
  permissions: { view: string; create: string; edit: string; approve: string };
}

function permissionsFor(key: string) {
  return {
    view: `${key}.view`,
    create: `${key}.create`,
    edit: `${key}.edit`,
    approve: `${key}.approve`,
  };
}

const quotationExtras = {
  validUntil: z.string().trim().optional(),
};

const orderExtras = {
  expectedDeliveryDate: z.string().trim().optional(),
  orderType: z.enum(["REGULAR", "WALKIN", "ONLINE", "EXPORT"]).default("REGULAR"),
  customerPoNumber: z.string().trim().max(60).optional(),
};

const deliveryExtras = {
  warehouseId: z.string().trim().min(1, "Warehouse is required"),
  transporterId: z.string().trim().optional().or(z.literal("")),
  vehicleNumber: z.string().trim().max(30).optional(),
  lrNumber: z.string().trim().max(40).optional(),
  ewayBillNumber: z.string().trim().max(40).optional(),
};

const invoiceExtras = {
  dueDate: z.string().trim().optional(),
  paymentTerms: z.string().trim().max(100).optional(),
  paymentMode: z.enum(["CASH", "CARD", "UPI", "BANK", "CREDIT", "MIXED"]).default("CREDIT"),
  orderType: z.enum(["REGULAR", "WALKIN", "ONLINE", "EXPORT"]).default("REGULAR"),
};

const returnExtras = {
  warehouseId: z.string().trim().min(1, "Warehouse is required"),
  returnReason: z.string().trim().max(500).optional(),
};

const creditNoteExtras = {
  reason: z.string().trim().max(500).optional(),
};

// ---------------------------------------------------------------- Purchase

const purchaseOrderExtras = {
  expectedDeliveryDate: z.string().trim().optional(),
  vendorQuotationRef: z.string().trim().max(60).optional(),
};

const goodsReceiptExtras = {
  warehouseId: z.string().trim().min(1, "Warehouse is required"),
  vendorInvoiceRef: z.string().trim().max(60).optional(),
  vehicleNumber: z.string().trim().max(30).optional(),
};

const purchaseInvoiceExtras = {
  dueDate: z.string().trim().optional(),
  paymentTerms: z.string().trim().max(100).optional(),
  paymentMode: z.enum(["CASH", "CARD", "UPI", "BANK", "CREDIT", "MIXED"]).default("CREDIT"),
  vendorInvoiceNumber: z.string().trim().max(60).optional(),
};

const purchaseReturnExtras = {
  warehouseId: z.string().trim().min(1, "Warehouse is required"),
  returnReason: z.string().trim().max(500).optional(),
};

const debitNoteExtras = {
  reason: z.string().trim().max(500).optional(),
};

function define(
  key: string,
  label: string,
  title: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>,
  party: PartyConfig,
  workflow: DocumentWorkflow,
  prefix: string,
  sequenceType: string,
  extras: z.ZodRawShape,
  convertsTo: string[],
  options: Partial<Pick<DocumentDefinition, "stock" | "requiresWarehouse" | "fulfilsSourceOrder">> = {}
): DocumentDefinition {
  const shape = {
    ...baseDocumentInput,
    [party.idField]: z.string().trim().min(1, `${party.label} is required`),
    ...extras,
  };
  return {
    key,
    label,
    title,
    model,
    party,
    workflow,
    prefix,
    sequenceType,
    createSchema: z.object(shape),
    updateSchema: z.object(shape).partial(),
    convertsTo,
    requiresWarehouse: options.requiresWarehouse ?? false,
    stock: options.stock,
    fulfilsSourceOrder: options.fulfilsSourceOrder ?? false,
    permissions: permissionsFor(key),
  };
}

export const DOCUMENTS: Record<string, DocumentDefinition> = {
  "sales-quotations": define(
    "sales-quotations",
    "Sales Quotation",
    "Sales Quotations",
    SalesQuotation,
    CUSTOMER_PARTY,
    SALES_QUOTATION_WORKFLOW,
    "QTN",
    "SALES_QUOTATION",
    quotationExtras,
    ["sales-orders"]
  ),
  "sales-orders": define(
    "sales-orders",
    "Sales Order",
    "Sales Orders",
    SalesOrder,
    CUSTOMER_PARTY,
    SALES_ORDER_WORKFLOW,
    "SO",
    "SALES_ORDER",
    orderExtras,
    ["delivery-challans", "sales-invoices"]
  ),
  "delivery-challans": define(
    "delivery-challans",
    "Sales Delivery",
    "Sales Deliveries",
    DeliveryChallan,
    CUSTOMER_PARTY,
    DELIVERY_CHALLAN_WORKFLOW,
    "DC",
    "DELIVERY_CHALLAN",
    deliveryExtras,
    ["sales-invoices"],
    {
      requiresWarehouse: true,
      fulfilsSourceOrder: true,
      stock: { direction: "OUT", movementType: "SALES_DELIVERY", atStatus: "DISPATCHED" },
    }
  ),
  "sales-invoices": define(
    "sales-invoices",
    "Invoice",
    "Invoices",
    SalesInvoice,
    CUSTOMER_PARTY,
    SALES_INVOICE_WORKFLOW,
    "INV",
    "SALES_INVOICE",
    invoiceExtras,
    ["sales-returns", "credit-notes"]
  ),
  "sales-returns": define(
    "sales-returns",
    "Sales Return",
    "Sales Returns",
    SalesReturn,
    CUSTOMER_PARTY,
    SALES_RETURN_WORKFLOW,
    "SR",
    "SALES_RETURN",
    returnExtras,
    ["credit-notes"],
    {
      requiresWarehouse: true,
      stock: { direction: "IN", movementType: "SALES_RETURN", atStatus: "RECEIVED" },
    }
  ),
  "credit-notes": define(
    "credit-notes",
    "Credit Note",
    "Credit Notes",
    CreditNote,
    CUSTOMER_PARTY,
    CREDIT_NOTE_WORKFLOW,
    "CN",
    "CREDIT_NOTE",
    creditNoteExtras,
    []
  ),

  // ------------------------------------------------------------- Purchase

  "purchase-orders": define(
    "purchase-orders",
    "Purchase Order",
    "Purchase Orders",
    PurchaseOrder,
    VENDOR_PARTY,
    PURCHASE_ORDER_WORKFLOW,
    "PO",
    "PURCHASE_ORDER",
    purchaseOrderExtras,
    ["goods-receipts", "purchase-invoices"]
  ),
  "goods-receipts": define(
    "goods-receipts",
    "Goods Receipt",
    "Goods Receipts",
    GoodsReceipt,
    VENDOR_PARTY,
    GOODS_RECEIPT_WORKFLOW,
    "GRN",
    "GOODS_RECEIPT",
    goodsReceiptExtras,
    ["purchase-invoices"],
    {
      requiresWarehouse: true,
      fulfilsSourceOrder: true,
      stock: { direction: "IN", movementType: "PURCHASE_RECEIPT", atStatus: "RECEIVED" },
    }
  ),
  "purchase-invoices": define(
    "purchase-invoices",
    "Purchase Invoice",
    "Purchase Invoices",
    PurchaseInvoice,
    VENDOR_PARTY,
    PURCHASE_INVOICE_WORKFLOW,
    "PINV",
    "PURCHASE_INVOICE",
    purchaseInvoiceExtras,
    ["purchase-returns", "debit-notes"]
  ),
  "purchase-returns": define(
    "purchase-returns",
    "Purchase Return",
    "Purchase Returns",
    PurchaseReturn,
    VENDOR_PARTY,
    PURCHASE_RETURN_WORKFLOW,
    "PR",
    "PURCHASE_RETURN",
    purchaseReturnExtras,
    ["debit-notes"],
    {
      requiresWarehouse: true,
      stock: { direction: "OUT", movementType: "PURCHASE_RETURN", atStatus: "DISPATCHED" },
    }
  ),
  "debit-notes": define(
    "debit-notes",
    "Debit Note",
    "Debit Notes",
    DebitNote,
    VENDOR_PARTY,
    DEBIT_NOTE_WORKFLOW,
    "DN",
    "DEBIT_NOTE",
    debitNoteExtras,
    []
  ),
};

export function getDocumentDefinition(key: string): DocumentDefinition | undefined {
  return DOCUMENTS[key];
}
