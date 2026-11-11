import { Schema, type SchemaDefinition } from "mongoose";
import {
  documentLineSchema,
  documentTotalsSchema,
  sourceDocumentSchema,
  partySnapshotSchema,
  addressSchema,
} from "./documentParts";

/**
 * Shared schema for every transactional document (sales and purchase alike).
 *
 * `partyField` is "customer" for sales documents and "vendor" for purchase
 * documents — the rest of the shape (lines, totals, status, linkage, audit)
 * is identical, so both sides of the ledger go through the same engine
 * rather than duplicated near-identical schemas.
 */
export function buildDocumentSchema(partyField: "customer" | "vendor", extra: SchemaDefinition = {}) {
  const partyRef = partyField === "customer" ? "Customer" : "Vendor";

  const schema = new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
      financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },

      documentNumber: { type: String, required: true },
      documentDate: { type: Date, required: true, default: () => new Date() },

      [`${partyField}Id`]: { type: Schema.Types.ObjectId, ref: partyRef, required: true },
      [partyField]: { type: partySnapshotSchema, required: true },

      billingAddress: { type: addressSchema },
      shippingAddress: { type: addressSchema },

      salespersonId: { type: Schema.Types.ObjectId, ref: "User", default: null },
      agentId: { type: Schema.Types.ObjectId, ref: "Agent", default: null },

      // --- GST supply determination -----------------------------------
      // intraState drives the CGST+SGST vs IGST split; the rest is printed
      // on the invoice and used by the GST reports.
      intraState: { type: Boolean, required: true, default: true },
      supplyType: {
        type: String,
        enum: ["INTRA_STATE", "INTER_STATE"],
        required: true,
        default: "INTRA_STATE",
      },
      placeOfSupplyCode: { type: String },
      placeOfSupplyName: { type: String },
      /** UT without a legislature → the state half of the tax is UTGST. */
      isUnionTerritory: { type: Boolean, required: true, default: false },

      lines: { type: [documentLineSchema], required: true, default: [] },
      totals: { type: documentTotalsSchema, required: true, default: () => ({}) },

      notes: { type: String },
      termsAndConditions: { type: String },

      status: { type: String, required: true },
      sourceDocuments: { type: [sourceDocumentSchema], default: [] },

      approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      approvedAt: { type: Date, default: null },
      cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      cancelledAt: { type: Date, default: null },
      cancellationReason: { type: String },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      ...extra,
    },
    { timestamps: true }
  );

  schema.index({ businessId: 1, documentNumber: 1 }, { unique: true });
  schema.index({ businessId: 1, status: 1, documentDate: -1 });
  schema.index({ businessId: 1, [`${partyField}Id`]: 1, documentDate: -1 });

  return schema;
}
