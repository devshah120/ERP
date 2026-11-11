import { Types } from "mongoose";
import { DocumentSequence } from "@/models/DocumentSequence";
import { DocumentPrefix } from "@/models/DocumentPrefix";

export interface GetNextNumberParams {
  businessId: Types.ObjectId | string;
  branchId: Types.ObjectId | string;
  financialYearId: Types.ObjectId | string;
  documentType: string; // e.g. "SALES_QUOTATION"
  prefix: string; // e.g. "QTN"
  financialYearLabel: string; // e.g. "2026-2027", used in the formatted number
  padding?: number;
}

/**
 * Atomically allocates the next sequence number for a (business, branch,
 * financial year, document type) tuple using a single findOneAndUpdate with
 * $inc + upsert. Mongo guarantees this is race-free under concurrent
 * requests without needing an application-level lock (decision J-4).
 *
 * Returns both the raw number and the formatted document number, e.g.
 * "QTN-2026-2027-000001".
 */
export async function getNextDocumentNumber(
  params: GetNextNumberParams
): Promise<{ number: number; formatted: string }> {
  const { businessId, branchId, financialYearId, documentType, financialYearLabel } = params;

  // Settings → Document Prefix can override the caller's built-in default.
  const override = await DocumentPrefix.findOne({ businessId, documentType }, { prefix: 1, padding: 1 }).lean<{
    prefix: string;
    padding: number;
  }>();
  const prefix = override?.prefix || params.prefix;
  const padding = override?.padding ?? params.padding ?? 6;

  const sequence = await DocumentSequence.findOneAndUpdate(
    { businessId, branchId, financialYearId, documentType },
    { $inc: { lastNumber: 1 }, $setOnInsert: { prefix, padding } },
    { new: true, upsert: true }
  );

  const formatted = `${prefix}-${financialYearLabel}-${String(sequence.lastNumber).padStart(padding, "0")}`;
  return { number: sequence.lastNumber, formatted };
}
