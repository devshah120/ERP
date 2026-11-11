import { z } from "zod";
import { moneyStringSchema } from "@/lib/validation/money";
import {
  Department,
  CategoryVariant,
  ComboProduct,
  CatalogListing,
  PriceList,
  TermsTemplate,
  PRICE_ADJUSTMENTS,
} from "@/models/catalogMasters";
import { ProductionFormula } from "@/models/productionMasters";
import {
  Coupon,
  Membership,
  Discount,
  LoyaltyProgram,
  Feedback,
  DISCOUNT_KINDS,
  DISCOUNT_SCOPES,
  FEEDBACK_CHANNELS,
  FEEDBACK_STAGES,
} from "@/models/crm";
import {
  BankAccount,
  TaxRate,
  PaymentTerm,
  AdditionalCharge,
  Device,
  SalesTarget,
  BANK_ACCOUNT_TYPES,
  CHARGE_TYPES,
  CHARGE_APPLIES_TO,
  TARGET_METRICS,
} from "@/models/setupMasters";
import type { ResourceDefinition } from "./types";
import {
  STATUS,
  permissionsFor,
  documentConverter,
  optionalRef,
  optionalDate,
  requiredDate,
  itemLineInput,
} from "./helpers";

/**
 * Masters added after the original eleven. Same framework, same rules —
 * kept in their own file only so registry.ts stays readable.
 */

const status = z.enum(STATUS).default("ACTIVE");
const notes = z.string().trim().max(1000).optional();

/** Builds the boilerplate shared by every definition below. */
function define(
  key: string,
  label: string,
  def: Omit<ResourceDefinition, "key" | "label" | "permissions" | "createSchema" | "updateSchema"> & {
    fields: z.ZodRawShape;
    /** Cross-field rules, applied to create only (updates are partial). */
    refine?: (v: Record<string, unknown>, ctx: z.RefinementCtx) => void;
  }
): ResourceDefinition {
  const { fields, refine, ...rest } = def;
  const base = z.object(fields);
  return {
    key,
    label,
    permissions: permissionsFor(key),
    createSchema: refine ? base.superRefine(refine as never) : base,
    updateSchema: base.partial(),
    ...rest,
  };
}

function validRange(fromKey: string, toKey: string) {
  return (v: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const from = v[fromKey] ? Date.parse(String(v[fromKey])) : NaN;
    const to = v[toKey] ? Date.parse(String(v[toKey])) : NaN;
    if (!Number.isNaN(from) && !Number.isNaN(to) && to < from) {
      ctx.addIssue({ code: "custom", path: [toKey], message: "End date is before the start date" });
    }
  };
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

const departments = define("departments", "Department", {
  model: Department,
  autoCode: { field: "departmentCode", prefix: "DEPT", entityType: "DEPARTMENT" },
  fields: {
    name: z.string().trim().min(2).max(150),
    headName: z.string().trim().max(120).optional(),
    description: z.string().trim().max(500).optional(),
    status,
  },
  searchFields: ["name", "departmentCode", "headName"],
  filterFields: { departmentCode: "departmentCode", name: "name" },
  sortableFields: ["departmentCode", "name", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
});

const categoryVariants = define("category-variants", "Category variant set", {
  model: CategoryVariant,
  fields: {
    categoryId: z.string().trim().min(1, "Choose a category"),
    sizes: z.string().trim().max(500).optional(),
    colours: z.string().trim().max(1000).optional(),
    notes,
    status,
  },
  refine: (v, ctx) => {
    if (!String(v.sizes ?? "").trim() && !String(v.colours ?? "").trim()) {
      ctx.addIssue({ code: "custom", path: ["sizes"], message: "Enter sizes, colours or both" });
    }
  },
  searchFields: ["sizes", "colours"],
  filterFields: { sizes: "sizes", colours: "colours" },
  sortableFields: ["createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ refs: ["categoryId"] }),
});

const comboProducts = define("combo-products", "Combo product", {
  model: ComboProduct,
  autoCode: { field: "comboCode", prefix: "CMB", entityType: "COMBO" },
  fields: {
    name: z.string().trim().min(2).max(200),
    sellingPrice: moneyStringSchema,
    taxRatePercent: z.coerce.number().min(0).max(100).default(0),
    barcode: z.string().trim().max(60).optional(),
    components: z.array(itemLineInput).min(2, "A combo needs at least two items"),
    description: z.string().trim().max(1000).optional(),
    status,
  },
  searchFields: ["name", "comboCode", "barcode"],
  filterFields: { comboCode: "comboCode", name: "name" },
  sortableFields: ["comboCode", "name", "sellingPrice", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ money: ["sellingPrice"], lines: { components: { refs: ["itemId"] } } }),
});

/* ------------------------------------------------------------------ */
/* Sales / purchase                                                    */
/* ------------------------------------------------------------------ */

const catalogListings = define("catalog-listings", "Catalog listing", {
  model: CatalogListing,
  fields: {
    itemId: z.string().trim().min(1, "Choose a product"),
    title: z.string().trim().min(2).max(200),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens"),
    onlinePrice: moneyStringSchema,
    compareAtPrice: moneyStringSchema.default("0"),
    published: z.coerce.boolean().default(false),
    featured: z.coerce.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
    imageUrl: z.string().trim().url("Enter a full image URL").max(500).optional().or(z.literal("")),
    tags: z.string().trim().max(300).optional(),
    description: z.string().trim().max(4000).optional(),
    status,
  },
  searchFields: ["title", "slug", "tags"],
  filterFields: { title: "title", slug: "slug" },
  sortableFields: ["title", "onlinePrice", "sortOrder", "createdAt"],
  defaultSort: "sortOrder",
  defaultSortDir: "asc",
  toDocument: documentConverter({ money: ["onlinePrice", "compareAtPrice"], refs: ["itemId"] }),
});

const priceLists = define("price-lists", "Price mapping", {
  model: PriceList,
  fields: {
    name: z.string().trim().min(2).max(150),
    categoryId: z.string().trim().min(1, "Choose a category"),
    customerGroup: z.string().trim().max(100).optional(),
    adjustmentType: z.enum(PRICE_ADJUSTMENTS).default("DISCOUNT_PERCENT"),
    value: moneyStringSchema,
    validFrom: optionalDate,
    validTo: optionalDate,
    notes,
    status,
  },
  refine: (v, ctx) => {
    validRange("validFrom", "validTo")(v, ctx);
    const value = Number(v.value);
    if (String(v.adjustmentType).endsWith("PERCENT") && value > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage cannot exceed 100" });
    }
  },
  searchFields: ["name", "customerGroup"],
  filterFields: { name: "name", customerGroup: "customerGroup" },
  sortableFields: ["name", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
  toDocument: documentConverter({ money: ["value"], refs: ["categoryId"], dates: ["validFrom", "validTo"] }),
});

const termsFields = {
  title: z.string().trim().min(2).max(150),
  body: z.string().trim().min(1, "Enter the terms").max(4000),
  isDefault: z.coerce.boolean().default(false),
  status,
};

const salesTerms = define("sales-terms", "Sales terms", {
  model: TermsTemplate,
  baseFilter: { appliesTo: "SALES" },
  fields: termsFields,
  searchFields: ["title", "body"],
  filterFields: { title: "title" },
  sortableFields: ["title", "createdAt"],
  defaultSort: "title",
  defaultSortDir: "asc",
});

const purchaseTerms = define("purchase-terms", "Purchase terms", {
  model: TermsTemplate,
  baseFilter: { appliesTo: "PURCHASE" },
  fields: termsFields,
  searchFields: ["title", "body"],
  filterFields: { title: "title" },
  sortableFields: ["title", "createdAt"],
  defaultSort: "title",
  defaultSortDir: "asc",
});

/* ------------------------------------------------------------------ */
/* Production                                                          */
/* ------------------------------------------------------------------ */

const formulaFields = {
  name: z.string().trim().min(2).max(200),
  outputItemId: z.string().trim().min(1, "Choose what this makes"),
  outputVariantSku: z.string().trim().toUpperCase().max(60).optional().or(z.literal("")),
  outputQuantity: z.coerce.number().positive("Output quantity must be more than zero").default(1),
  components: z.array(itemLineInput).min(1, "Add at least one component"),
  processingCost: moneyStringSchema.default("0"),
  instructions: z.string().trim().max(4000).optional(),
  status,
};

const formulaConverter = documentConverter({
  money: ["processingCost"],
  refs: ["outputItemId"],
  lines: { components: { refs: ["itemId"] } },
});

const billOfMaterials = define("bill-of-materials", "Bill of materials", {
  model: ProductionFormula,
  baseFilter: { kind: "BOM" },
  autoCode: { field: "formulaCode", prefix: "BOM", entityType: "BOM" },
  fields: formulaFields,
  searchFields: ["name", "formulaCode"],
  filterFields: { formulaCode: "formulaCode", name: "name" },
  sortableFields: ["formulaCode", "name", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: formulaConverter,
});

const recipes = define("recipes", "Recipe", {
  model: ProductionFormula,
  baseFilter: { kind: "RECIPE" },
  autoCode: { field: "formulaCode", prefix: "RCP", entityType: "RECIPE" },
  fields: formulaFields,
  searchFields: ["name", "formulaCode"],
  filterFields: { formulaCode: "formulaCode", name: "name" },
  sortableFields: ["formulaCode", "name", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: formulaConverter,
});

/* ------------------------------------------------------------------ */
/* CRM                                                                 */
/* ------------------------------------------------------------------ */

const coupons = define("coupons", "Coupon", {
  model: Coupon,
  fields: {
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(30)
      .regex(/^[A-Z0-9_-]+$/, "Letters, numbers, - and _ only"),
    description: z.string().trim().max(300).optional(),
    discountType: z.enum(DISCOUNT_KINDS).default("PERCENT"),
    discountValue: moneyStringSchema,
    minOrderValue: moneyStringSchema.default("0"),
    maxDiscount: moneyStringSchema.default("0"),
    validFrom: optionalDate,
    validTo: optionalDate,
    usageLimit: z.coerce.number().int().min(0).default(0),
    status,
  },
  refine: (v, ctx) => {
    validRange("validFrom", "validTo")(v, ctx);
    if (v.discountType === "PERCENT" && Number(v.discountValue) > 100) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A percentage cannot exceed 100" });
    }
  },
  searchFields: ["couponCode", "description"],
  filterFields: { couponCode: "couponCode" },
  sortableFields: ["couponCode", "usedCount", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({
    money: ["discountValue", "minOrderValue", "maxDiscount"],
    dates: ["validFrom", "validTo"],
  }),
});

const memberships = define("memberships", "Membership", {
  model: Membership,
  autoCode: { field: "membershipNumber", prefix: "MEM", entityType: "MEMBERSHIP" },
  fields: {
    customerId: z.string().trim().min(1, "Choose a customer"),
    planName: z.string().trim().min(2).max(100),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
    fee: moneyStringSchema.default("0"),
    startDate: optionalDate,
    endDate: optionalDate,
    notes,
    status,
  },
  refine: validRange("startDate", "endDate"),
  searchFields: ["membershipNumber", "planName"],
  filterFields: { membershipNumber: "membershipNumber", planName: "planName" },
  sortableFields: ["membershipNumber", "planName", "endDate", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ money: ["fee"], refs: ["customerId"], dates: ["startDate", "endDate"] }),
});

const discounts = define("discounts", "Discount", {
  model: Discount,
  fields: {
    name: z.string().trim().min(2).max(150),
    scope: z.enum(DISCOUNT_SCOPES).default("ALL"),
    categoryId: optionalRef,
    brandId: optionalRef,
    itemId: optionalRef,
    discountPercent: z.coerce.number().min(0).max(100),
    validFrom: optionalDate,
    validTo: optionalDate,
    notes,
    status,
  },
  refine: (v, ctx) => {
    validRange("validFrom", "validTo")(v, ctx);
    const need = { CATEGORY: "categoryId", BRAND: "brandId", ITEM: "itemId" }[String(v.scope)];
    if (need && !v[need]) {
      ctx.addIssue({ code: "custom", path: [need], message: `Choose the ${String(v.scope).toLowerCase()} this applies to` });
    }
  },
  searchFields: ["name"],
  filterFields: { name: "name", scope: "scope" },
  sortableFields: ["name", "discountPercent", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ refs: ["categoryId", "brandId", "itemId"], dates: ["validFrom", "validTo"] }),
});

const loyaltyPrograms = define("loyalty-programs", "Loyalty program", {
  model: LoyaltyProgram,
  fields: {
    name: z.string().trim().min(2).max(150),
    pointsPer100: z.coerce.number().min(0).max(1000),
    pointValue: moneyStringSchema,
    minRedeemPoints: z.coerce.number().int().min(0).default(0),
    expiryDays: z.coerce.number().int().min(0).max(3650).default(0),
    notes,
    status,
  },
  searchFields: ["name"],
  filterFields: { name: "name" },
  sortableFields: ["name", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ money: ["pointValue"] }),
});

const feedback = define("feedback", "Feedback", {
  model: Feedback,
  autoCode: { field: "feedbackCode", prefix: "FDB", entityType: "FEEDBACK" },
  fields: {
    customerId: optionalRef,
    customerName: z.string().trim().min(2).max(150),
    phone: z.string().trim().max(20).optional(),
    rating: z.coerce.number().int().min(1, "Rating is 1 to 5").max(5, "Rating is 1 to 5"),
    channel: z.enum(FEEDBACK_CHANNELS).default("STORE"),
    stage: z.enum(FEEDBACK_STAGES).default("NEW"),
    comments: z.string().trim().max(2000).optional(),
    resolution: z.string().trim().max(2000).optional(),
    status,
  },
  searchFields: ["feedbackCode", "customerName", "phone", "comments"],
  filterFields: { feedbackCode: "feedbackCode", customerName: "customerName", stage: "stage" },
  sortableFields: ["feedbackCode", "customerName", "rating", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ refs: ["customerId"] }),
});

/* ------------------------------------------------------------------ */
/* Bank & global setup                                                 */
/* ------------------------------------------------------------------ */

const bankAccounts = define("bank-accounts", "Bank account", {
  model: BankAccount,
  fields: {
    accountName: z.string().trim().min(2).max(150),
    bankName: z.string().trim().min(2).max(150),
    accountNumber: z.string().trim().min(4).max(40),
    ifscCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC is 11 characters, e.g. HDFC0001234")
      .optional()
      .or(z.literal("")),
    branchName: z.string().trim().max(150).optional(),
    accountType: z.enum(BANK_ACCOUNT_TYPES).default("CURRENT"),
    ledgerAccountId: optionalRef,
    upiId: z.string().trim().max(100).optional(),
    isDefault: z.coerce.boolean().default(false),
    notes,
    status,
  },
  searchFields: ["accountName", "bankName", "accountNumber", "ifscCode"],
  filterFields: { accountName: "accountName", bankName: "bankName", accountNumber: "accountNumber" },
  sortableFields: ["accountName", "bankName", "createdAt"],
  defaultSort: "accountName",
  defaultSortDir: "asc",
  toDocument: documentConverter({ refs: ["ledgerAccountId"] }),
});

const taxRates = define("tax-rates", "Tax rate", {
  model: TaxRate,
  fields: {
    name: z.string().trim().min(2).max(100),
    ratePercent: z.coerce.number().min(0).max(100),
    cessPercent: z.coerce.number().min(0).max(100).default(0),
    hsnCodes: z.string().trim().max(1000).optional(),
    description: z.string().trim().max(500).optional(),
    isDefault: z.coerce.boolean().default(false),
    status,
  },
  searchFields: ["name", "hsnCodes"],
  filterFields: { name: "name" },
  sortableFields: ["name", "ratePercent", "createdAt"],
  defaultSort: "ratePercent",
  defaultSortDir: "asc",
});

const paymentTerms = define("payment-terms", "Payment term", {
  model: PaymentTerm,
  fields: {
    name: z.string().trim().min(2).max(100),
    creditDays: z.coerce.number().int().min(0).max(3650),
    earlyPaymentDiscountPercent: z.coerce.number().min(0).max(100).default(0),
    earlyPaymentDays: z.coerce.number().int().min(0).max(3650).default(0),
    description: z.string().trim().max(500).optional(),
    isDefault: z.coerce.boolean().default(false),
    status,
  },
  searchFields: ["name", "description"],
  filterFields: { name: "name" },
  sortableFields: ["name", "creditDays", "createdAt"],
  defaultSort: "creditDays",
  defaultSortDir: "asc",
});

const additionalCharges = define("additional-charges", "Additional charge", {
  model: AdditionalCharge,
  fields: {
    name: z.string().trim().min(2).max(100),
    chargeType: z.enum(CHARGE_TYPES).default("FIXED"),
    defaultAmount: moneyStringSchema.default("0"),
    taxRatePercent: z.coerce.number().min(0).max(100).default(0),
    hsnSac: z.string().trim().max(15).optional(),
    appliesTo: z.enum(CHARGE_APPLIES_TO).default("BOTH"),
    description: z.string().trim().max(500).optional(),
    status,
  },
  searchFields: ["name", "hsnSac"],
  filterFields: { name: "name", appliesTo: "appliesTo" },
  sortableFields: ["name", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
  toDocument: documentConverter({ money: ["defaultAmount"] }),
});

const devices = define("devices", "Device", {
  model: Device,
  fields: {
    deviceName: z.string().trim().min(2).max(100),
    deviceId: z.string().trim().toUpperCase().min(4).max(64),
    deviceType: z.enum(["POS_TERMINAL", "DESKTOP", "TABLET", "MOBILE", "SCANNER", "PRINTER"]).default("POS_TERMINAL"),
    branchId: optionalRef,
    assignedTo: z.string().trim().max(120).optional(),
    notes,
    status,
  },
  searchFields: ["deviceName", "deviceId", "assignedTo"],
  filterFields: { deviceName: "deviceName", deviceId: "deviceId" },
  sortableFields: ["deviceName", "deviceId", "createdAt"],
  defaultSort: "deviceName",
  defaultSortDir: "asc",
  toDocument: documentConverter({ refs: ["branchId"] }),
});

const targets = define("targets", "Target", {
  model: SalesTarget,
  fields: {
    name: z.string().trim().min(2).max(150),
    metric: z.enum(TARGET_METRICS).default("SALES_AMOUNT"),
    periodFrom: requiredDate,
    periodTo: requiredDate,
    targetValue: moneyStringSchema,
    agentId: optionalRef,
    categoryId: optionalRef,
    notes,
    status,
  },
  refine: validRange("periodFrom", "periodTo"),
  searchFields: ["name"],
  filterFields: { name: "name", metric: "metric" },
  sortableFields: ["name", "periodFrom", "periodTo", "createdAt"],
  defaultSort: "periodFrom",
  defaultSortDir: "desc",
  toDocument: documentConverter({
    money: ["targetValue"],
    refs: ["agentId", "categoryId"],
    dates: ["periodFrom", "periodTo"],
  }),
});

export const EXTENDED_RESOURCES: Record<string, ResourceDefinition> = {
  departments,
  "category-variants": categoryVariants,
  "combo-products": comboProducts,
  "catalog-listings": catalogListings,
  "price-lists": priceLists,
  "sales-terms": salesTerms,
  "purchase-terms": purchaseTerms,
  "bill-of-materials": billOfMaterials,
  recipes,
  coupons,
  memberships,
  discounts,
  "loyalty-programs": loyaltyPrograms,
  feedback,
  "bank-accounts": bankAccounts,
  "tax-rates": taxRates,
  "payment-terms": paymentTerms,
  "additional-charges": additionalCharges,
  devices,
  targets,
};
