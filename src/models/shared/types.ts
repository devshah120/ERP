import { Types } from "mongoose";

export type ObjectIdLike = Types.ObjectId | string;

/** Fields present on every tenant-scoped document. */
export interface TenantScoped {
  businessId: Types.ObjectId;
}

/** Fields present on every document created via the shared base schema. */
export interface BaseAuditFields {
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
