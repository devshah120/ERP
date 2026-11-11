import { Schema } from "mongoose";
import { defineMasterModel, itemLineSchema } from "./shared/masterSchema";

/** Store departments (Menswear, Kidswear, Accessories…) that products roll up to. */
export const Department = defineMasterModel(
  "Department",
  {
    departmentCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    headName: { type: String, trim: true },
    description: { type: String, trim: true },
  },
  { uniqueField: "departmentCode" }
);

/**
 * The size and colour range a category is normally stocked in. The item form's
 * variant generator reads this so a new kurta starts with the kurta size run
 * instead of a blank grid.
 */
export const CategoryVariant = defineMasterModel(
  "CategoryVariant",
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    sizes: { type: String, trim: true },
    colours: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { indexes: [{ categoryId: 1 }] }
);

/** A bundle sold as one product, made up of other stocked items. */
export const ComboProduct = defineMasterModel(
  "ComboProduct",
  {
    comboCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    sellingPrice: { type: Schema.Types.Decimal128, required: true, default: "0" },
    taxRatePercent: { type: Number, default: 0 },
    barcode: { type: String, trim: true },
    components: { type: [itemLineSchema], default: [] },
    description: { type: String, trim: true },
  },
  { uniqueField: "comboCode" }
);

/** How a product is presented in an online store. */
export const CatalogListing = defineMasterModel(
  "CatalogListing",
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    onlinePrice: { type: Schema.Types.Decimal128, required: true, default: "0" },
    compareAtPrice: { type: Schema.Types.Decimal128, default: "0" },
    published: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    imageUrl: { type: String, trim: true },
    tags: { type: String, trim: true },
    description: { type: String, trim: true },
  },
  { uniqueField: "slug" }
);

export const PRICE_ADJUSTMENTS = ["MARKUP_PERCENT", "DISCOUNT_PERCENT", "FIXED_PRICE"] as const;

/** A price rule mapped to a category — wholesale rates, festive markdowns. */
export const PriceList = defineMasterModel(
  "PriceList",
  {
    name: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    customerGroup: { type: String, trim: true },
    adjustmentType: { type: String, enum: PRICE_ADJUSTMENTS, required: true, default: "DISCOUNT_PERCENT" },
    value: { type: Schema.Types.Decimal128, required: true, default: "0" },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    notes: { type: String, trim: true },
  },
  { indexes: [{ categoryId: 1 }] }
);

/**
 * Reusable terms & conditions text. Sales and purchase terms share this model
 * and are told apart by `appliesTo`; each has its own screen.
 */
export const TermsTemplate = defineMasterModel(
  "TermsTemplate",
  {
    appliesTo: { type: String, enum: ["SALES", "PURCHASE"], required: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { indexes: [{ appliesTo: 1 }] }
);
