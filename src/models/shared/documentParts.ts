import { Schema, Types } from "mongoose";
import { addressSchema, type IAddress } from "./Address";

/**
 * One line of a transactional document. Master-data values are snapshotted
 * alongside the reference id so a historical document never changes when an
 * item is renamed or repriced later.
 */
export interface IDocumentLine {
  _id?: Types.ObjectId;
  itemId: Types.ObjectId;
  itemCode: string;
  itemName: string;
  variantSku?: string;
  color?: string;
  size?: string;
  description?: string;

  quantity: number;
  unitName?: string;

  rate: Types.Decimal128;
  discountPercent: number;
  discountAmount: Types.Decimal128;

  taxRatePercent: number;
  taxableAmount: Types.Decimal128;
  cgstAmount: Types.Decimal128;
  sgstAmount: Types.Decimal128;
  igstAmount: Types.Decimal128;
  taxAmount: Types.Decimal128;
  lineTotal: Types.Decimal128;

  /** Downstream fulfilment tracking — how much of this line has flowed on. */
  deliveredQty: number;
  invoicedQty: number;
  returnedQty: number;
}

export const documentLineSchema = new Schema<IDocumentLine>({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  itemCode: { type: String, required: true },
  itemName: { type: String, required: true },
  variantSku: { type: String },
  color: { type: String },
  size: { type: String },
  description: { type: String },

  quantity: { type: Number, required: true, min: 0 },
  unitName: { type: String },

  rate: { type: Schema.Types.Decimal128, required: true, default: "0" },
  discountPercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
  discountAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },

  taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
  taxableAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
  cgstAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
  sgstAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
  igstAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
  taxAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
  lineTotal: { type: Schema.Types.Decimal128, required: true, default: "0" },

  deliveredQty: { type: Number, required: true, default: 0, min: 0 },
  invoicedQty: { type: Number, required: true, default: 0, min: 0 },
  returnedQty: { type: Number, required: true, default: 0, min: 0 },
});

export interface IDocumentTotals {
  subTotal: Types.Decimal128;
  totalDiscount: Types.Decimal128;
  taxableAmount: Types.Decimal128;
  cgstAmount: Types.Decimal128;
  sgstAmount: Types.Decimal128;
  igstAmount: Types.Decimal128;
  totalTax: Types.Decimal128;
  shippingCharge: Types.Decimal128;
  roundOff: Types.Decimal128;
  grandTotal: Types.Decimal128;
}

export const documentTotalsSchema = new Schema<IDocumentTotals>(
  {
    subTotal: { type: Schema.Types.Decimal128, required: true, default: "0" },
    totalDiscount: { type: Schema.Types.Decimal128, required: true, default: "0" },
    taxableAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
    cgstAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
    sgstAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
    igstAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
    totalTax: { type: Schema.Types.Decimal128, required: true, default: "0" },
    shippingCharge: { type: Schema.Types.Decimal128, required: true, default: "0" },
    roundOff: { type: Schema.Types.Decimal128, required: true, default: "0" },
    grandTotal: { type: Schema.Types.Decimal128, required: true, default: "0" },
  },
  { _id: false }
);

/** Backward link to the document this one was created from (Section 37). */
export interface ISourceDocument {
  docType: string;
  docId: Types.ObjectId;
  docNumber: string;
}

export const sourceDocumentSchema = new Schema<ISourceDocument>(
  {
    docType: { type: String, required: true },
    docId: { type: Schema.Types.ObjectId, required: true },
    docNumber: { type: String, required: true },
  },
  { _id: false }
);

/** Party details snapshotted onto the document at creation time. */
export interface IPartySnapshot {
  code: string;
  name: string;
  gstin?: string;
  state?: string;
  phone?: string;
  email?: string;
}

export const partySnapshotSchema = new Schema<IPartySnapshot>(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    gstin: { type: String },
    state: { type: String },
    phone: { type: String },
    email: { type: String },
  },
  { _id: false }
);

export type { IAddress };
export { addressSchema };
