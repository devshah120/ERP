import { Schema, model, models, Types } from "mongoose";
import { buildDocumentSchema } from "./shared/documentSchema";
import type {
  IDocumentLine,
  IDocumentTotals,
  ISourceDocument,
  IPartySnapshot,
  IAddress,
} from "./shared/documentParts";

/** Mirror of ISalesDocumentBase for the buying side — vendor instead of customer. */
export interface IPurchaseDocumentBase {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYearId: Types.ObjectId;

  documentNumber: string;
  documentDate: Date;

  vendorId: Types.ObjectId;
  vendor: IPartySnapshot;
  billingAddress?: IAddress;
  shippingAddress?: IAddress;

  agentId?: Types.ObjectId | null;
  intraState: boolean;
  supplyType: "INTRA_STATE" | "INTER_STATE";
  placeOfSupplyCode?: string;
  placeOfSupplyName?: string;
  isUnionTerritory: boolean;

  lines: IDocumentLine[];
  totals: IDocumentTotals;

  notes?: string;
  termsAndConditions?: string;

  status: string;
  sourceDocuments: ISourceDocument[];

  approvedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancellationReason?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

// --------------------------------------------------------- Purchase Order

export interface IPurchaseOrder extends IPurchaseDocumentBase {
  expectedDeliveryDate?: Date;
  vendorQuotationRef?: string;
}

const purchaseOrderSchema = buildDocumentSchema("vendor", {
  expectedDeliveryDate: { type: Date },
  vendorQuotationRef: { type: String },
});

export const PurchaseOrder =
  models.PurchaseOrder ?? model<IPurchaseOrder>("PurchaseOrder", purchaseOrderSchema);

// ----------------------------------------------------------- Goods Receipt

export interface IGoodsReceipt extends IPurchaseDocumentBase {
  warehouseId: Types.ObjectId;
  vendorInvoiceRef?: string;
  vehicleNumber?: string;
  receivedAt?: Date | null;
  /** Guards against double-posting stock for the same receipt. */
  stockPosted: boolean;
}

const goodsReceiptSchema = buildDocumentSchema("vendor", {
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
  vendorInvoiceRef: { type: String },
  vehicleNumber: { type: String },
  receivedAt: { type: Date, default: null },
  stockPosted: { type: Boolean, required: true, default: false },
});

export const GoodsReceipt =
  models.GoodsReceipt ?? model<IGoodsReceipt>("GoodsReceipt", goodsReceiptSchema);

// -------------------------------------------------------- Purchase Invoice

export interface IPurchaseInvoice extends IPurchaseDocumentBase {
  dueDate?: Date;
  paymentTerms?: string;
  paymentMode?: string;
  vendorInvoiceNumber?: string;
  paidAmount: Types.Decimal128;
  dueAmount: Types.Decimal128;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  postedAt?: Date | null;
}

const purchaseInvoiceSchema = buildDocumentSchema("vendor", {
  dueDate: { type: Date },
  paymentTerms: { type: String },
  paymentMode: { type: String },
  vendorInvoiceNumber: { type: String },
  paidAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
  dueAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
  paymentStatus: {
    type: String,
    enum: ["UNPAID", "PARTIALLY_PAID", "PAID"],
    required: true,
    default: "UNPAID",
  },
  postedAt: { type: Date, default: null },
});

export const PurchaseInvoice =
  models.PurchaseInvoice ?? model<IPurchaseInvoice>("PurchaseInvoice", purchaseInvoiceSchema);

// --------------------------------------------------------- Purchase Return

export interface IPurchaseReturn extends IPurchaseDocumentBase {
  warehouseId: Types.ObjectId;
  returnReason?: string;
  dispatchedAt?: Date | null;
  stockPosted: boolean;
}

const purchaseReturnSchema = buildDocumentSchema("vendor", {
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
  returnReason: { type: String },
  dispatchedAt: { type: Date, default: null },
  stockPosted: { type: Boolean, required: true, default: false },
});

export const PurchaseReturn =
  models.PurchaseReturn ?? model<IPurchaseReturn>("PurchaseReturn", purchaseReturnSchema);

// -------------------------------------------------------------- Debit Note

export interface IDebitNote extends IPurchaseDocumentBase {
  reason?: string;
  issuedAt?: Date | null;
}

const debitNoteSchema = buildDocumentSchema("vendor", {
  reason: { type: String },
  issuedAt: { type: Date, default: null },
});

export const DebitNote = models.DebitNote ?? model<IDebitNote>("DebitNote", debitNoteSchema);
