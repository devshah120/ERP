import { Schema, model, models, Types } from "mongoose";
import { buildDocumentSchema } from "./shared/documentSchema";
import type {
  IDocumentLine,
  IDocumentTotals,
  ISourceDocument,
  IPartySnapshot,
  IAddress,
} from "./shared/documentParts";

/** Fields every sales document carries (Section 2). */
export interface ISalesDocumentBase {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYearId: Types.ObjectId;

  documentNumber: string;
  documentDate: Date;

  customerId: Types.ObjectId;
  customer: IPartySnapshot;
  billingAddress?: IAddress;
  shippingAddress?: IAddress;

  salespersonId?: Types.ObjectId | null;
  agentId?: Types.ObjectId | null;

  /** True when seller and buyer are in the same state (CGST+SGST vs IGST). */
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

// ------------------------------------------------------------- Quotation

export interface ISalesQuotation extends ISalesDocumentBase {
  validUntil?: Date;
  convertedToOrderId?: Types.ObjectId | null;
}

const salesQuotationSchema = buildDocumentSchema("customer", {
  validUntil: { type: Date },
  convertedToOrderId: { type: Schema.Types.ObjectId, ref: "SalesOrder", default: null },
});

export const SalesQuotation =
  models.SalesQuotation ?? model<ISalesQuotation>("SalesQuotation", salesQuotationSchema);

// ----------------------------------------------------------- Sales Order

export interface ISalesOrder extends ISalesDocumentBase {
  expectedDeliveryDate?: Date;
  orderType: string;
  customerPoNumber?: string;
}

const salesOrderSchema = buildDocumentSchema("customer", {
  expectedDeliveryDate: { type: Date },
  orderType: { type: String, required: true, default: "REGULAR" },
  customerPoNumber: { type: String },
});

export const SalesOrder = models.SalesOrder ?? model<ISalesOrder>("SalesOrder", salesOrderSchema);

// ------------------------------------------------------- Delivery Challan

export interface IDeliveryChallan extends ISalesDocumentBase {
  warehouseId: Types.ObjectId;
  transporterId?: Types.ObjectId | null;
  vehicleNumber?: string;
  lrNumber?: string;
  ewayBillNumber?: string;
  dispatchedAt?: Date | null;
  deliveredAt?: Date | null;
  /** Set once the stock ledger entries exist, so dispatch can't double-post. */
  stockPosted: boolean;
}

const deliveryChallanSchema = buildDocumentSchema("customer", {
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
  transporterId: { type: Schema.Types.ObjectId, ref: "Transporter", default: null },
  vehicleNumber: { type: String },
  lrNumber: { type: String },
  ewayBillNumber: { type: String },
  dispatchedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  stockPosted: { type: Boolean, required: true, default: false },
});

export const DeliveryChallan =
  models.DeliveryChallan ?? model<IDeliveryChallan>("DeliveryChallan", deliveryChallanSchema);

// --------------------------------------------------------- Sales Invoice

export interface ISalesInvoice extends ISalesDocumentBase {
  dueDate?: Date;
  paymentTerms?: string;
  paymentMode?: string;
  orderType: string;
  paidAmount: Types.Decimal128;
  dueAmount: Types.Decimal128;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  postedAt?: Date | null;
}

const salesInvoiceSchema = buildDocumentSchema("customer", {
  dueDate: { type: Date },
  paymentTerms: { type: String },
  paymentMode: { type: String },
  orderType: { type: String, required: true, default: "REGULAR" },
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

export const SalesInvoice = models.SalesInvoice ?? model<ISalesInvoice>("SalesInvoice", salesInvoiceSchema);

// ---------------------------------------------------------- Sales Return

export interface ISalesReturn extends ISalesDocumentBase {
  warehouseId: Types.ObjectId;
  returnReason?: string;
  receivedAt?: Date | null;
  stockPosted: boolean;
}

const salesReturnSchema = buildDocumentSchema("customer", {
  warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
  returnReason: { type: String },
  receivedAt: { type: Date, default: null },
  stockPosted: { type: Boolean, required: true, default: false },
});

export const SalesReturn = models.SalesReturn ?? model<ISalesReturn>("SalesReturn", salesReturnSchema);

// ----------------------------------------------------------- Credit Note

export interface ICreditNote extends ISalesDocumentBase {
  reason?: string;
  issuedAt?: Date | null;
}

const creditNoteSchema = buildDocumentSchema("customer", {
  reason: { type: String },
  issuedAt: { type: Date, default: null },
});

export const CreditNote = models.CreditNote ?? model<ICreditNote>("CreditNote", creditNoteSchema);
