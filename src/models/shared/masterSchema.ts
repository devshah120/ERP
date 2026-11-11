import { Schema, model, models, type Model, type SchemaDefinition } from "mongoose";

/**
 * Builds a tenant-scoped master-data model with the fields every master in
 * the generic resource framework relies on: businessId, ACTIVE/INACTIVE
 * status, soft-delete stamp and audit users.
 *
 * Only the entity's own fields are passed in, so a new master is a few lines
 * rather than another copy of the same boilerplate.
 */
export function defineMasterModel(
  name: string,
  fields: SchemaDefinition,
  options: {
    /** Field holding the per-tenant unique code, e.g. "couponCode". */
    uniqueField?: string;
    /** Extra compound indexes (businessId is prepended automatically). */
    indexes?: Record<string, 1 | -1>[];
  } = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Model<any> {
  // Hot reload re-evaluates this module; reuse the compiled model.
  if (models[name]) return models[name];

  const schema = new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      ...fields,
      status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
      deletedAt: { type: Date, default: null },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  if (options.uniqueField) {
    // Unique among live rows only, so a soft-deleted code can be reused.
    schema.index(
      { businessId: 1, [options.uniqueField]: 1 },
      // $type rather than `deletedAt: null`: partial indexes accept $type, and
      // every live row stores an explicit null (see the default above).
      { unique: true, partialFilterExpression: { deletedAt: { $type: "null" } } }
    );
  }
  for (const idx of options.indexes ?? []) schema.index({ businessId: 1, ...idx });
  schema.index({ businessId: 1, deletedAt: 1, createdAt: -1 });

  return model(name, schema);
}

/** A line of item + quantity, shared by BOMs, recipes and combo products. */
export const itemLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    variantSku: { type: String, trim: true, uppercase: true },
    quantity: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true },
  },
  { _id: false }
);
