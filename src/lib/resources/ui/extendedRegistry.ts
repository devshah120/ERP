import type { ResourceUi, FieldConfig, LineColumnConfig } from "./types";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

const statusField: FieldConfig = { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" };
const statusColumn = { key: "status", label: "Status", type: "badge" as const };

const ITEM_REF = { resource: "items", labelField: "name" };
const CATEGORY_REF = { resource: "categories", labelField: "name" };

/** item · size/colour · quantity · note — the component table of BOMs, recipes and combos. */
const componentColumns: LineColumnConfig[] = [
  { name: "itemId", label: "Item", type: "reference", reference: ITEM_REF, required: true, width: "40%" },
  { name: "variantSku", label: "Size / colour", type: "variant", itemColumn: "itemId", width: "20%" },
  { name: "quantity", label: "Qty", type: "number", required: true, width: "7rem", defaultValue: 1 },
  { name: "note", label: "Note", type: "text", placeholder: "Optional" },
];

function master(
  key: string,
  title: string,
  singular: string,
  ui: Omit<ResourceUi, "key" | "title" | "singular" | "apiPath" | "basePath">
): ResourceUi {
  return { key, title, singular, apiPath: `/api/masters/${key}`, basePath: `/${key}`, ...ui };
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

const departments = master("departments", "Departments", "Department", {
  columns: [
    { key: "departmentCode", label: "Code", filterParam: "departmentCode", sortField: "departmentCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "headName", label: "Head" },
    { key: "description", label: "Description" },
    statusColumn,
  ],
  sections: [
    {
      label: "Department details",
      fields: [
        { name: "name", label: "Department name", type: "text", required: true, placeholder: "Menswear" },
        { name: "headName", label: "Department head", type: "text", hint: "Optional" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const categoryVariants = master("category-variants", "Category-wise Variants", "Category variant set", {
  columns: [
    { key: "categoryId", label: "Category", type: "reference", reference: CATEGORY_REF },
    { key: "sizes", label: "Sizes", filterParam: "sizes" },
    { key: "colours", label: "Colours", filterParam: "colours" },
    statusColumn,
  ],
  sections: [
    {
      label: "Size & colour range",
      fields: [
        { name: "categoryId", label: "Category", type: "reference", reference: CATEGORY_REF, required: true },
        statusField,
        { name: "sizes", label: "Sizes", type: "text", fullWidth: true, placeholder: "S, M, L, XL, XXL", hint: "Comma-separated" },
        { name: "colours", label: "Colours", type: "text", fullWidth: true, placeholder: "Black, White, Navy", hint: "Comma-separated" },
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const comboProducts = master("combo-products", "Combo Products", "Combo product", {
  columns: [
    { key: "comboCode", label: "Code", filterParam: "comboCode", sortField: "comboCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "components", label: "Items", type: "count" },
    { key: "sellingPrice", label: "Combo price", type: "money", sortField: "sellingPrice" },
    { key: "barcode", label: "Barcode" },
    statusColumn,
  ],
  sections: [
    {
      label: "Combo details",
      fields: [
        { name: "name", label: "Combo name", type: "text", required: true, placeholder: "3 T-shirt pack" },
        { name: "sellingPrice", label: "Combo price", type: "money", required: true, defaultValue: "0" },
        { name: "taxRatePercent", label: "GST rate %", type: "number", defaultValue: 5 },
        { name: "barcode", label: "Barcode", type: "text", hint: "Optional" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
    {
      label: "Items in the combo",
      fields: [{ name: "components", label: "Items", type: "lines", columns: componentColumns, addLabel: "Add item" }],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Sales / purchase                                                    */
/* ------------------------------------------------------------------ */

const catalogListings = master("catalog-listings", "eCommerce Catalog", "Catalog listing", {
  titleField: "title",
  columns: [
    { key: "title", label: "Title", filterParam: "title", sortField: "title" },
    { key: "itemId", label: "Product", type: "reference", reference: ITEM_REF },
    { key: "slug", label: "URL slug", filterParam: "slug" },
    { key: "onlinePrice", label: "Online price", type: "money", sortField: "onlinePrice" },
    { key: "published", label: "Published", type: "yesno" },
    { key: "featured", label: "Featured", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Listing",
      fields: [
        { name: "itemId", label: "Product", type: "reference", reference: ITEM_REF, required: true },
        { name: "title", label: "Listing title", type: "text", required: true },
        { name: "slug", label: "URL slug", type: "text", required: true, placeholder: "classic-cotton-tee", hint: "Lowercase, hyphens" },
        { name: "sortOrder", label: "Sort order", type: "number", defaultValue: 0, hint: "Lower shows first" },
        { name: "published", label: "Published — visible in the online store", type: "checkbox" },
        { name: "featured", label: "Featured on the home page", type: "checkbox" },
        statusField,
      ],
    },
    {
      label: "Online pricing",
      fields: [
        { name: "onlinePrice", label: "Online price", type: "money", required: true, defaultValue: "0" },
        { name: "compareAtPrice", label: "Compare-at (MRP)", type: "money", defaultValue: "0", hint: "Shown struck through" },
      ],
    },
    {
      label: "Content",
      fields: [
        { name: "imageUrl", label: "Image URL", type: "text", fullWidth: true, placeholder: "https://…" },
        { name: "tags", label: "Tags", type: "text", fullWidth: true, placeholder: "summer, cotton, bestseller" },
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const ADJUSTMENT_LABELS = { MARKUP_PERCENT: "Markup %", DISCOUNT_PERCENT: "Discount %", FIXED_PRICE: "Fixed price" };

const priceLists = master("price-lists", "Categories & Price Mapping", "Price mapping", {
  columns: [
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "categoryId", label: "Category", type: "reference", reference: CATEGORY_REF },
    { key: "customerGroup", label: "Customer group", filterParam: "customerGroup" },
    { key: "adjustmentType", label: "Rule", type: "label", labels: ADJUSTMENT_LABELS },
    { key: "value", label: "Value", type: "number" },
    { key: "validFrom", label: "From", type: "date" },
    { key: "validTo", label: "To", type: "date" },
    statusColumn,
  ],
  sections: [
    {
      label: "Price rule",
      fields: [
        { name: "name", label: "Rule name", type: "text", required: true, placeholder: "Wholesale — denim" },
        { name: "categoryId", label: "Category", type: "reference", reference: CATEGORY_REF, required: true },
        { name: "customerGroup", label: "Customer group", type: "text", hint: "Optional — blank applies to everyone" },
        {
          name: "adjustmentType",
          label: "Rule",
          type: "select",
          defaultValue: "DISCOUNT_PERCENT",
          options: Object.entries(ADJUSTMENT_LABELS).map(([value, label]) => ({ value, label })),
        },
        { name: "value", label: "Value", type: "money", required: true, defaultValue: "0", hint: "Percent, or the fixed price" },
        { name: "validFrom", label: "Valid from", type: "date" },
        { name: "validTo", label: "Valid to", type: "date" },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

function termsUi(key: string, title: string, singular: string): ResourceUi {
  return master(key, title, singular, {
    titleField: "title",
    columns: [
      { key: "title", label: "Title", filterParam: "title", sortField: "title" },
      { key: "body", label: "Terms" },
      { key: "isDefault", label: "Default", type: "yesno" },
      statusColumn,
    ],
    sections: [
      {
        label: "Terms & conditions",
        fields: [
          { name: "title", label: "Title", type: "text", required: true, placeholder: "Standard terms" },
          statusField,
          { name: "isDefault", label: "Use as the default for new documents", type: "checkbox", fullWidth: true },
          { name: "body", label: "Terms", type: "textarea", required: true, fullWidth: true },
        ],
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Production                                                          */
/* ------------------------------------------------------------------ */

function formulaUi(key: string, title: string, singular: string, outputLabel: string): ResourceUi {
  return master(key, title, singular, {
    columns: [
      { key: "formulaCode", label: "Code", filterParam: "formulaCode", sortField: "formulaCode" },
      { key: "name", label: "Name", filterParam: "name", sortField: "name" },
      { key: "outputItemId", label: outputLabel, type: "reference", reference: ITEM_REF },
      { key: "outputQuantity", label: "Makes", type: "number" },
      { key: "components", label: "Components", type: "count" },
      { key: "processingCost", label: "Processing cost", type: "money" },
      statusColumn,
    ],
    sections: [
      {
        label: "Output",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "outputItemId", label: outputLabel, type: "reference", reference: ITEM_REF, required: true },
          { name: "outputVariantSku", label: "Size / colour", type: "text", variantOf: "outputItemId" },
          { name: "outputQuantity", label: "Quantity made per run", type: "number", required: true, defaultValue: 1 },
          { name: "processingCost", label: "Processing cost per run", type: "money", defaultValue: "0", hint: "Labour, job work" },
          statusField,
        ],
      },
      {
        label: "Components",
        fields: [{ name: "components", label: "Components", type: "lines", columns: componentColumns, addLabel: "Add component" }],
      },
      {
        label: "Instructions",
        fields: [{ name: "instructions", label: "Process notes", type: "textarea", fullWidth: true }],
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* CRM                                                                 */
/* ------------------------------------------------------------------ */

const KIND_LABELS = { PERCENT: "Percent", FLAT: "Flat amount" };

const coupons = master("coupons", "Coupons", "Coupon", {
  titleField: "couponCode",
  columns: [
    { key: "couponCode", label: "Code", filterParam: "couponCode", sortField: "couponCode" },
    { key: "description", label: "Description" },
    { key: "discountType", label: "Type", type: "label", labels: KIND_LABELS },
    { key: "discountValue", label: "Value", type: "number" },
    { key: "minOrderValue", label: "Min. bill", type: "money" },
    { key: "validTo", label: "Valid to", type: "date" },
    { key: "usedCount", label: "Used", type: "number", sortField: "usedCount" },
    { key: "usageLimit", label: "Limit", type: "number" },
    statusColumn,
  ],
  sections: [
    {
      label: "Coupon",
      fields: [
        { name: "couponCode", label: "Coupon code", type: "text", required: true, placeholder: "DIWALI20" },
        { name: "description", label: "Description", type: "text", hint: "Optional" },
        {
          name: "discountType",
          label: "Discount type",
          type: "select",
          defaultValue: "PERCENT",
          options: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
        },
        { name: "discountValue", label: "Discount value", type: "money", required: true, defaultValue: "0" },
        { name: "maxDiscount", label: "Maximum discount", type: "money", defaultValue: "0", hint: "0 = no cap", showWhen: { field: "discountType", values: ["PERCENT"] } },
        { name: "minOrderValue", label: "Minimum bill value", type: "money", defaultValue: "0" },
        statusField,
      ],
    },
    {
      label: "Validity",
      fields: [
        { name: "validFrom", label: "Valid from", type: "date" },
        { name: "validTo", label: "Valid to", type: "date" },
        { name: "usageLimit", label: "Usage limit", type: "number", defaultValue: 0, hint: "0 = unlimited" },
      ],
    },
  ],
});

const memberships = master("memberships", "Memberships", "Membership", {
  titleField: "planName",
  columns: [
    { key: "membershipNumber", label: "Card no.", filterParam: "membershipNumber", sortField: "membershipNumber" },
    { key: "customerId", label: "Customer", type: "reference", reference: { resource: "customers", labelField: "name" } },
    { key: "planName", label: "Plan", filterParam: "planName", sortField: "planName" },
    { key: "discountPercent", label: "Discount %", type: "number" },
    { key: "startDate", label: "Start", type: "date" },
    { key: "endDate", label: "Expires", type: "date", sortField: "endDate" },
    statusColumn,
  ],
  sections: [
    {
      label: "Membership",
      fields: [
        { name: "customerId", label: "Customer", type: "reference", reference: { resource: "customers", labelField: "name" }, required: true },
        { name: "planName", label: "Plan", type: "text", required: true, placeholder: "Gold" },
        { name: "discountPercent", label: "Member discount %", type: "number", defaultValue: 0 },
        { name: "fee", label: "Membership fee", type: "money", defaultValue: "0" },
        { name: "startDate", label: "Start date", type: "date" },
        { name: "endDate", label: "Expiry date", type: "date" },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const SCOPE_LABELS = { ALL: "Everything", CATEGORY: "A category", BRAND: "A brand", ITEM: "One product" };

const discounts = master("discounts", "Discounts", "Discount", {
  columns: [
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "scope", label: "Applies to", type: "label", labels: SCOPE_LABELS },
    { key: "discountPercent", label: "Discount %", type: "number", sortField: "discountPercent" },
    { key: "validFrom", label: "From", type: "date" },
    { key: "validTo", label: "To", type: "date" },
    statusColumn,
  ],
  sections: [
    {
      label: "Discount",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, placeholder: "End of season sale" },
        { name: "discountPercent", label: "Discount %", type: "number", required: true, defaultValue: 10 },
        {
          name: "scope",
          label: "Applies to",
          type: "select",
          defaultValue: "ALL",
          options: Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label })),
        },
        { name: "categoryId", label: "Category", type: "reference", reference: CATEGORY_REF, showWhen: { field: "scope", values: ["CATEGORY"] } },
        { name: "brandId", label: "Brand", type: "reference", reference: { resource: "brands", labelField: "name" }, showWhen: { field: "scope", values: ["BRAND"] } },
        { name: "itemId", label: "Product", type: "reference", reference: ITEM_REF, showWhen: { field: "scope", values: ["ITEM"] } },
        { name: "validFrom", label: "Valid from", type: "date" },
        { name: "validTo", label: "Valid to", type: "date" },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const loyaltyPrograms = master("loyalty-programs", "Loyalty", "Loyalty program", {
  columns: [
    { key: "name", label: "Program", filterParam: "name", sortField: "name" },
    { key: "pointsPer100", label: "Points per ₹100", type: "number" },
    { key: "pointValue", label: "Point value", type: "money" },
    { key: "minRedeemPoints", label: "Min. redeem", type: "number" },
    { key: "expiryDays", label: "Expiry (days)", type: "number" },
    statusColumn,
  ],
  sections: [
    {
      label: "Earning & redemption",
      fields: [
        { name: "name", label: "Program name", type: "text", required: true, placeholder: "Style Rewards" },
        { name: "pointsPer100", label: "Points earned per ₹100", type: "number", required: true, defaultValue: 1 },
        { name: "pointValue", label: "Value of one point (₹)", type: "money", required: true, defaultValue: "1" },
        { name: "minRedeemPoints", label: "Minimum points to redeem", type: "number", defaultValue: 100 },
        { name: "expiryDays", label: "Points expire after (days)", type: "number", defaultValue: 365, hint: "0 = never" },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const STAGE_LABELS = { NEW: "New", IN_PROGRESS: "In progress", RESOLVED: "Resolved" };
const CHANNEL_LABELS = { STORE: "In store", PHONE: "Phone", WHATSAPP: "WhatsApp", EMAIL: "Email", ONLINE: "Online" };

const feedback = master("feedback", "Feedback", "Feedback", {
  titleField: "customerName",
  columns: [
    { key: "feedbackCode", label: "Ref", filterParam: "feedbackCode", sortField: "feedbackCode" },
    { key: "customerName", label: "Customer", filterParam: "customerName", sortField: "customerName" },
    { key: "rating", label: "Rating", type: "number", sortField: "rating" },
    { key: "channel", label: "Channel", type: "label", labels: CHANNEL_LABELS },
    { key: "stage", label: "Stage", type: "label", labels: STAGE_LABELS, filterParam: "stage" },
    { key: "comments", label: "Comments" },
    { key: "createdAt", label: "Received", type: "date", sortField: "createdAt" },
  ],
  sections: [
    {
      label: "Feedback",
      fields: [
        { name: "customerName", label: "Customer name", type: "text", required: true },
        { name: "customerId", label: "Linked customer", type: "reference", reference: { resource: "customers", labelField: "name" }, hint: "Optional" },
        { name: "phone", label: "Phone", type: "tel", hint: "Optional" },
        { name: "rating", label: "Rating (1–5)", type: "number", required: true, defaultValue: 5 },
        { name: "channel", label: "Channel", type: "select", defaultValue: "STORE", options: Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })) },
        { name: "stage", label: "Stage", type: "select", defaultValue: "NEW", options: Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label })) },
        { name: "comments", label: "What they said", type: "textarea", fullWidth: true },
        { name: "resolution", label: "What we did", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Bank & global setup                                                 */
/* ------------------------------------------------------------------ */

const ACCOUNT_TYPE_LABELS = { CURRENT: "Current", SAVINGS: "Savings", OVERDRAFT: "Overdraft", CASH_CREDIT: "Cash credit" };

const bankAccounts = master("bank-accounts", "Bank Accounts", "Bank account", {
  titleField: "accountName",
  columns: [
    { key: "accountName", label: "Account", filterParam: "accountName", sortField: "accountName" },
    { key: "bankName", label: "Bank", filterParam: "bankName", sortField: "bankName" },
    { key: "accountNumber", label: "Account no.", filterParam: "accountNumber" },
    { key: "ifscCode", label: "IFSC" },
    { key: "accountType", label: "Type", type: "label", labels: ACCOUNT_TYPE_LABELS },
    { key: "ledgerAccountId", label: "Ledger", type: "reference", reference: { resource: "chart-of-accounts", labelField: "name" } },
    { key: "isDefault", label: "Default", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Bank details",
      fields: [
        { name: "accountName", label: "Account name", type: "text", required: true, placeholder: "HDFC Current — Main" },
        { name: "bankName", label: "Bank", type: "text", required: true },
        { name: "accountNumber", label: "Account number", type: "text", required: true },
        { name: "ifscCode", label: "IFSC", type: "text", hint: "Optional" },
        { name: "branchName", label: "Branch", type: "text", hint: "Optional" },
        { name: "accountType", label: "Account type", type: "select", defaultValue: "CURRENT", options: Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
        { name: "upiId", label: "UPI ID", type: "text", hint: "Optional" },
        statusField,
      ],
    },
    {
      label: "Ledger link",
      fields: [
        {
          name: "ledgerAccountId",
          label: "Ledger account",
          type: "reference",
          reference: { resource: "chart-of-accounts", labelField: "name" },
          hint: "Where this account's money is recorded — used by reconciliation",
        },
        { name: "isDefault", label: "Default bank account", type: "checkbox" },
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const taxRates = master("tax-rates", "Tax Rates", "Tax rate", {
  columns: [
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "ratePercent", label: "GST %", type: "number", sortField: "ratePercent" },
    { key: "cessPercent", label: "Cess %", type: "number" },
    { key: "hsnCodes", label: "HSN codes" },
    { key: "isDefault", label: "Default", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Tax rate",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, placeholder: "GST 12%" },
        { name: "ratePercent", label: "GST rate %", type: "number", required: true, defaultValue: 5, hint: "Split equally into CGST + SGST within the state" },
        { name: "cessPercent", label: "Cess %", type: "number", defaultValue: 0 },
        { name: "isDefault", label: "Default rate for new products", type: "checkbox" },
        statusField,
        { name: "hsnCodes", label: "HSN codes at this rate", type: "textarea", fullWidth: true, hint: "Optional, comma-separated" },
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const paymentTerms = master("payment-terms", "Payment Terms", "Payment term", {
  columns: [
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "creditDays", label: "Credit days", type: "number", sortField: "creditDays" },
    { key: "earlyPaymentDiscountPercent", label: "Early-pay disc. %", type: "number" },
    { key: "earlyPaymentDays", label: "If paid within (days)", type: "number" },
    { key: "isDefault", label: "Default", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Payment term",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, placeholder: "Net 30" },
        { name: "creditDays", label: "Credit days", type: "number", required: true, defaultValue: 30 },
        { name: "earlyPaymentDiscountPercent", label: "Early-payment discount %", type: "number", defaultValue: 0 },
        { name: "earlyPaymentDays", label: "If paid within (days)", type: "number", defaultValue: 0 },
        { name: "isDefault", label: "Default for new parties", type: "checkbox" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const CHARGE_TYPE_LABELS = { FIXED: "Fixed amount", PERCENT: "% of goods value" };
const APPLIES_LABELS = { SALES: "Sales", PURCHASE: "Purchase", BOTH: "Sales & purchase" };

const additionalCharges = master("additional-charges", "Additional Charges", "Additional charge", {
  columns: [
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "chargeType", label: "Type", type: "label", labels: CHARGE_TYPE_LABELS },
    { key: "defaultAmount", label: "Default", type: "number" },
    { key: "taxRatePercent", label: "GST %", type: "number" },
    { key: "hsnSac", label: "HSN/SAC" },
    { key: "appliesTo", label: "Used on", type: "label", labels: APPLIES_LABELS, filterParam: "appliesTo" },
    statusColumn,
  ],
  sections: [
    {
      label: "Charge",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, placeholder: "Freight" },
        { name: "chargeType", label: "Charge type", type: "select", defaultValue: "FIXED", options: Object.entries(CHARGE_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
        { name: "defaultAmount", label: "Default amount / %", type: "money", defaultValue: "0" },
        { name: "taxRatePercent", label: "GST rate %", type: "number", defaultValue: 18 },
        { name: "hsnSac", label: "HSN / SAC", type: "text", hint: "Optional" },
        { name: "appliesTo", label: "Used on", type: "select", defaultValue: "BOTH", options: Object.entries(APPLIES_LABELS).map(([value, label]) => ({ value, label })) },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const DEVICE_LABELS = { POS_TERMINAL: "POS terminal", DESKTOP: "Desktop", TABLET: "Tablet", MOBILE: "Mobile", SCANNER: "Scanner", PRINTER: "Printer" };

const devices = master("devices", "Device Binding", "Device", {
  titleField: "deviceName",
  columns: [
    { key: "deviceName", label: "Device", filterParam: "deviceName", sortField: "deviceName" },
    { key: "deviceId", label: "Device ID / MAC", filterParam: "deviceId", sortField: "deviceId" },
    { key: "deviceType", label: "Type", type: "label", labels: DEVICE_LABELS },
    { key: "branchId", label: "Branch", type: "reference", reference: { resource: "branches", labelField: "name" } },
    { key: "assignedTo", label: "Assigned to" },
    statusColumn,
  ],
  sections: [
    {
      label: "Device",
      fields: [
        { name: "deviceName", label: "Device name", type: "text", required: true, placeholder: "Counter 1 billing PC" },
        { name: "deviceId", label: "Device ID / MAC address", type: "text", required: true, placeholder: "00:1A:2B:3C:4D:5E" },
        { name: "deviceType", label: "Type", type: "select", defaultValue: "POS_TERMINAL", options: Object.entries(DEVICE_LABELS).map(([value, label]) => ({ value, label })) },
        { name: "branchId", label: "Branch", type: "reference", reference: { resource: "branches", labelField: "name" }, hint: "Optional" },
        { name: "assignedTo", label: "Assigned to", type: "text", hint: "Optional" },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const METRIC_LABELS = {
  SALES_AMOUNT: "Sales value",
  SALES_QUANTITY: "Sales quantity",
  COLLECTION_AMOUNT: "Collections",
  PURCHASE_AMOUNT: "Purchase value",
};

const targets = master("targets", "Targets", "Target", {
  columns: [
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "metric", label: "Measures", type: "label", labels: METRIC_LABELS },
    { key: "periodFrom", label: "From", type: "date", sortField: "periodFrom" },
    { key: "periodTo", label: "To", type: "date", sortField: "periodTo" },
    { key: "targetValue", label: "Target", type: "number" },
    { key: "agentId", label: "Agent", type: "reference", reference: { resource: "agents", labelField: "name" } },
    statusColumn,
  ],
  sections: [
    {
      label: "Target",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, placeholder: "Q3 sales" },
        { name: "metric", label: "What it measures", type: "select", defaultValue: "SALES_AMOUNT", options: Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label })) },
        { name: "targetValue", label: "Target", type: "money", required: true, defaultValue: "0", hint: "Amount, or units for quantity" },
        { name: "periodFrom", label: "From", type: "date", required: true },
        { name: "periodTo", label: "To", type: "date", required: true },
        statusField,
      ],
    },
    {
      label: "Scope",
      fields: [
        { name: "agentId", label: "Agent", type: "reference", reference: { resource: "agents", labelField: "name" }, hint: "Optional — only this agent's sales", showWhen: { field: "metric", values: ["SALES_AMOUNT", "SALES_QUANTITY"] } },
        { name: "categoryId", label: "Category", type: "reference", reference: CATEGORY_REF, hint: "Optional — only this category", showWhen: { field: "metric", values: ["SALES_AMOUNT", "SALES_QUANTITY"] } },
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

export const EXTENDED_RESOURCE_UI: Record<string, ResourceUi> = {
  departments,
  "category-variants": categoryVariants,
  "combo-products": comboProducts,
  "catalog-listings": catalogListings,
  "price-lists": priceLists,
  "sales-terms": termsUi("sales-terms", "Sales Terms & Conditions", "Sales terms"),
  "purchase-terms": termsUi("purchase-terms", "Purchase Terms & Conditions", "Purchase terms"),
  "bill-of-materials": formulaUi("bill-of-materials", "Bill of Materials", "Bill of materials", "Finished product"),
  recipes: formulaUi("recipes", "Recipes", "Recipe", "Output material"),
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
