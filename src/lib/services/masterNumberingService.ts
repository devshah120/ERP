import { Types } from "mongoose";
import { MasterCounter } from "@/models/MasterCounter";

export async function getNextMasterCode(params: {
  businessId: Types.ObjectId | string;
  entityType: string;
  prefix: string;
  padding?: number;
}): Promise<string> {
  const { businessId, entityType, prefix, padding = 6 } = params;

  const counter = await MasterCounter.findOneAndUpdate(
    { businessId, entityType },
    { $inc: { lastNumber: 1 } },
    { new: true, upsert: true }
  );

  return `${prefix}-${String(counter.lastNumber).padStart(padding, "0")}`;
}
