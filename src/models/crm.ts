import { Schema } from "mongoose";
import { defineMasterModel } from "./shared/masterSchema";

export const DISCOUNT_KINDS = ["PERCENT", "FLAT"] as const;

/** A code a customer quotes at the counter for money off. */
export const Coupon = defineMasterModel(
  "Coupon",
  {
    couponCode: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, trim: true },
    discountType: { type: String, enum: DISCOUNT_KINDS, required: true, default: "PERCENT" },
    discountValue: { type: Schema.Types.Decimal128, required: true, default: "0" },
    minOrderValue: { type: Schema.Types.Decimal128, default: "0" },
    /** Cap on a percentage discount; 0 = no cap. */
    maxDiscount: { type: Schema.Types.Decimal128, default: "0" },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    /** 0 = unlimited. */
    usageLimit: { type: Number, default: 0 },
    /** Incremented by POS when the coupon is redeemed; never set by hand. */
    usedCount: { type: Number, default: 0 },
  },
  { uniqueField: "couponCode" }
);

/** A customer's membership card and the discount it carries. */
export const Membership = defineMasterModel(
  "Membership",
  {
    membershipNumber: { type: String, required: true, trim: true, uppercase: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    planName: { type: String, required: true, trim: true },
    discountPercent: { type: Number, default: 0 },
    fee: { type: Schema.Types.Decimal128, default: "0" },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    notes: { type: String, trim: true },
  },
  { uniqueField: "membershipNumber", indexes: [{ customerId: 1 }] }
);

export const DISCOUNT_SCOPES = ["ALL", "CATEGORY", "BRAND", "ITEM"] as const;

/** An automatic markdown — applied at POS without a code. */
export const Discount = defineMasterModel(
  "Discount",
  {
    name: { type: String, required: true, trim: true },
    scope: { type: String, enum: DISCOUNT_SCOPES, required: true, default: "ALL" },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", default: null },
    itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null },
    discountPercent: { type: Number, required: true, default: 0 },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    notes: { type: String, trim: true },
  }
);

/** How customers earn and redeem loyalty points. */
export const LoyaltyProgram = defineMasterModel("LoyaltyProgram", {
  name: { type: String, required: true, trim: true },
  /** Points earned per 100 of bill value. */
  pointsPer100: { type: Number, required: true, default: 1 },
  /** Money value of one point when redeemed. */
  pointValue: { type: Schema.Types.Decimal128, required: true, default: "1" },
  minRedeemPoints: { type: Number, default: 0 },
  /** Points lapse this many days after they are earned; 0 = never. */
  expiryDays: { type: Number, default: 0 },
  notes: { type: String, trim: true },
});

export const FEEDBACK_CHANNELS = ["STORE", "PHONE", "WHATSAPP", "EMAIL", "ONLINE"] as const;
export const FEEDBACK_STAGES = ["NEW", "IN_PROGRESS", "RESOLVED"] as const;

/** What a customer said, and whether anyone did something about it. */
export const Feedback = defineMasterModel(
  "Feedback",
  {
    feedbackCode: { type: String, required: true, trim: true, uppercase: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    rating: { type: Number, min: 1, max: 5, required: true, default: 5 },
    channel: { type: String, enum: FEEDBACK_CHANNELS, default: "STORE" },
    stage: { type: String, enum: FEEDBACK_STAGES, default: "NEW" },
    comments: { type: String, trim: true },
    resolution: { type: String, trim: true },
  },
  { uniqueField: "feedbackCode" }
);
