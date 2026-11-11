import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export const ITEM_TYPES = ["FINISHED_GOODS", "RAW_MATERIAL", "CONSUMABLE", "SERVICE"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const GENDERS = ["MENS", "WOMENS", "UNISEX", "BOYS", "GIRLS", "NA"] as const;

/**
 * A concrete sellable/stockable variant of an item — the size/colour matrix
 * row (e.g. TSHIRT-BLK-M). Stock is always tracked at variant level once an
 * item has variants, which is why the SKU is unique per business.
 */
export interface IItemVariant {
  _id?: Types.ObjectId;
  sku: string;
  color?: string;
  size?: string;
  barcode?: string;
  isActive: boolean;
}

export interface IItem extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  itemCode: string;
  name: string;
  description?: string;
  itemType: ItemType;
  categoryId?: Types.ObjectId | null;
  brandId?: Types.ObjectId | null;
  unitId?: Types.ObjectId | null;

  hsnCode?: string;
  taxRatePercent: number;

  purchasePrice: Types.Decimal128;
  sellingPrice: Types.Decimal128;
  costPrice: Types.Decimal128;

  minStock: number;
  maxStock: number;
  reorderLevel: number;

  // Garment-specific attributes
  style?: string;
  season?: string;
  collectionName?: string;
  gender?: (typeof GENDERS)[number];
  fabric?: string;
  pattern?: string;
  gsm?: number;
  composition?: string;
  countryOfOrigin?: string;

  hasVariants: boolean;
  variants: IItemVariant[];

  status: "ACTIVE" | "INACTIVE";
  deletedAt?: Date | null;
}

const itemVariantSchema = new Schema<IItemVariant>({
  sku: { type: String, required: true, trim: true, uppercase: true },
  color: { type: String, trim: true },
  size: { type: String, trim: true, uppercase: true },
  barcode: { type: String, trim: true },
  isActive: { type: Boolean, required: true, default: true },
});

const itemSchema = new Schema<IItem>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    itemCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    itemType: { type: String, enum: ITEM_TYPES, required: true, default: "FINISHED_GOODS" },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", default: null },
    unitId: { type: Schema.Types.ObjectId, ref: "Unit", default: null },

    hsnCode: { type: String, trim: true },
    taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },

    purchasePrice: { type: Schema.Types.Decimal128, required: true, default: "0" },
    sellingPrice: { type: Schema.Types.Decimal128, required: true, default: "0" },
    costPrice: { type: Schema.Types.Decimal128, required: true, default: "0" },

    minStock: { type: Number, required: true, default: 0, min: 0 },
    maxStock: { type: Number, required: true, default: 0, min: 0 },
    reorderLevel: { type: Number, required: true, default: 0, min: 0 },

    style: { type: String, trim: true },
    season: { type: String, trim: true },
    collectionName: { type: String, trim: true },
    gender: { type: String, enum: GENDERS, default: "NA" },
    fabric: { type: String, trim: true },
    pattern: { type: String, trim: true },
    gsm: { type: Number, min: 0 },
    composition: { type: String, trim: true },
    countryOfOrigin: { type: String, trim: true },

    hasVariants: { type: Boolean, required: true, default: false },
    variants: { type: [itemVariantSchema], default: [] },

    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

itemSchema.index({ businessId: 1, itemCode: 1 }, { unique: true });
itemSchema.index({ businessId: 1, status: 1, name: 1 });
itemSchema.index({ businessId: 1, categoryId: 1 });
// Variant SKUs must be unique within a business — sparse so items without
// variants don't collide on a missing key.
itemSchema.index({ businessId: 1, "variants.sku": 1 }, { sparse: true });

export const Item = models.Item ?? model<IItem>("Item", itemSchema);
