import { z } from "zod";
import type { FieldConfig } from "@/lib/resources/ui/types";

/**
 * Workspace settings, one section per settings screen.
 *
 * Each section is a zod schema (the stored shape, with defaults) plus the
 * form fields that edit it. Stored values are always read back through the
 * schema, so a setting added later simply takes its default for businesses
 * that saved before it existed.
 *
 * Every setting here is read somewhere — `usedBy` on each section says where,
 * and is shown on the screen so nobody has to guess what a switch does.
 */

const days = (def: number) => z.coerce.number().int().min(0).max(3650).default(def);
const text = (max: number) => z.string().trim().max(max).default("");

export const itemSettingsSchema = z.object({
  defaultItemType: z.enum(["FINISHED_GOODS", "RAW_MATERIAL", "CONSUMABLE", "SERVICE"]).default("FINISHED_GOODS"),
  defaultTaxRatePercent: z.coerce.number().min(0).max(100).default(5),
  defaultReorderLevel: z.coerce.number().min(0).default(0),
  defaultGender: z.enum(["NA", "MENS", "WOMENS", "UNISEX", "BOYS", "GIRLS"]).default("NA"),
  defaultCountryOfOrigin: text(100).default("India"),
});

export const salesSettingsSchema = z.object({
  quotationValidityDays: days(15),
  invoiceDueDays: days(30),
  defaultPaymentTerms: text(100),
  defaultNotes: text(2000),
});

export const purchaseSettingsSchema = z.object({
  billDueDays: days(30),
  defaultPaymentTerms: text(100),
  defaultNotes: text(2000),
});

export const posSettingsSchema = z.object({
  defaultWarehouseId: z.string().trim().default(""),
  pricesIncludeTax: z.coerce.boolean().default(true),
  allowNegativeStock: z.coerce.boolean().default(false),
  defaultPaymentMode: z.enum(["CASH", "CARD", "UPI"]).default("CASH"),
  maxManualDiscountPercent: z.coerce.number().min(0).max(100).default(20),
  requireCustomer: z.coerce.boolean().default(false),
  applyAutomaticDiscounts: z.coerce.boolean().default(true),
  receiptHeader: text(500),
  receiptFooter: text(500).default("Thank you for shopping with us!"),
});

export const notificationSettingsSchema = z.object({
  alertReceivables: z.coerce.boolean().default(true),
  alertPendingOrders: z.coerce.boolean().default(true),
  alertInvoiceStatus: z.coerce.boolean().default(true),
  alertTrends: z.coerce.boolean().default(true),
});

/** Dashboard insight keys each notification switch controls. */
export const NOTIFICATION_INSIGHTS: Record<keyof z.infer<typeof notificationSettingsSchema>, string[]> = {
  alertReceivables: ["receivables-aging", "collection"],
  alertPendingOrders: ["pending-orders"],
  alertInvoiceStatus: ["invoice-status"],
  alertTrends: ["sales-vs-purchase", "revenue-trend", "top-customers", "top-products"],
};

export interface SettingsSection {
  key: string;
  title: string;
  description: string;
  usedBy: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>;
  fields: FieldConfig[];
}

const ITEM_TYPES = [
  { value: "FINISHED_GOODS", label: "Finished goods" },
  { value: "RAW_MATERIAL", label: "Raw material" },
  { value: "CONSUMABLE", label: "Consumable" },
  { value: "SERVICE", label: "Service" },
];

const GENDERS = [
  { value: "NA", label: "Not applicable" },
  { value: "MENS", label: "Mens" },
  { value: "WOMENS", label: "Womens" },
  { value: "UNISEX", label: "Unisex" },
  { value: "BOYS", label: "Boys" },
  { value: "GIRLS", label: "Girls" },
];

export const SETTINGS_SECTIONS: Record<string, SettingsSection> = {
  items: {
    key: "items",
    title: "Item Settings",
    description: "Starting values for every new product, so the common case needs no typing.",
    usedBy: "Pre-filled on the New product form. Existing products are not changed.",
    schema: itemSettingsSchema,
    fields: [
      { name: "defaultItemType", label: "Default item type", type: "select", options: ITEM_TYPES },
      { name: "defaultTaxRatePercent", label: "Default GST rate %", type: "number" },
      { name: "defaultReorderLevel", label: "Default reorder level", type: "number", hint: "Stock at or below this shows as low" },
      { name: "defaultGender", label: "Default gender", type: "select", options: GENDERS },
      { name: "defaultCountryOfOrigin", label: "Default country of origin", type: "text" },
    ],
  },
  sales: {
    key: "sales",
    title: "Sales Settings",
    description: "Defaults applied when a new quotation, order or invoice is started.",
    usedBy:
      "Pre-filled on new sales documents: quotation validity, invoice due date, payment terms and notes. The default Sales Terms & Conditions template is added too.",
    schema: salesSettingsSchema,
    fields: [
      { name: "quotationValidityDays", label: "Quotations valid for (days)", type: "number" },
      { name: "invoiceDueDays", label: "Invoices due after (days)", type: "number" },
      { name: "defaultPaymentTerms", label: "Default payment terms", type: "text", placeholder: "Net 30" },
      { name: "defaultNotes", label: "Default notes", type: "textarea", fullWidth: true },
    ],
  },
  purchase: {
    key: "purchase",
    title: "Purchase Settings",
    description: "Defaults applied when a new purchase order or supplier bill is started.",
    usedBy: "Pre-filled on new purchase documents, along with the default Purchase Terms & Conditions template.",
    schema: purchaseSettingsSchema,
    fields: [
      { name: "billDueDays", label: "Supplier bills due after (days)", type: "number" },
      { name: "defaultPaymentTerms", label: "Default payment terms", type: "text", placeholder: "Net 45" },
      { name: "defaultNotes", label: "Default notes", type: "textarea", fullWidth: true },
    ],
  },
  pos: {
    key: "pos",
    title: "POS Settings",
    description: "How the billing counter behaves.",
    usedBy: "Read by Open Register on every sale and by the printed receipt.",
    schema: posSettingsSchema,
    fields: [
      {
        name: "defaultWarehouseId",
        label: "Sell from warehouse",
        type: "reference",
        reference: { resource: "warehouses", labelField: "name" },
        hint: "Pre-selected when a register is opened",
      },
      {
        name: "defaultPaymentMode",
        label: "Default payment mode",
        type: "select",
        options: [
          { value: "CASH", label: "Cash" },
          { value: "CARD", label: "Card" },
          { value: "UPI", label: "UPI" },
        ],
      },
      { name: "maxManualDiscountPercent", label: "Maximum manual discount %", type: "number", hint: "Per line, entered by the cashier" },
      { name: "pricesIncludeTax", label: "Selling prices include GST (MRP pricing)", type: "checkbox", fullWidth: true },
      { name: "applyAutomaticDiscounts", label: "Apply active Discounts automatically", type: "checkbox", fullWidth: true },
      { name: "allowNegativeStock", label: "Allow billing items that show no stock", type: "checkbox", fullWidth: true },
      { name: "requireCustomer", label: "Require a customer on every bill", type: "checkbox", fullWidth: true },
      { name: "receiptHeader", label: "Receipt header", type: "textarea", fullWidth: true, hint: "Printed under the business name" },
      { name: "receiptFooter", label: "Receipt footer", type: "textarea", fullWidth: true },
    ],
  },
  notifications: {
    key: "notifications",
    title: "Notifications",
    description: "Which findings appear under the bell in the header.",
    usedBy: "Filters the alerts in the header bell. The dashboard itself still shows every finding.",
    schema: notificationSettingsSchema,
    fields: [
      { name: "alertReceivables", label: "Overdue receivables and slow collections", type: "checkbox", fullWidth: true },
      { name: "alertPendingOrders", label: "Orders waiting to be delivered", type: "checkbox", fullWidth: true },
      { name: "alertInvoiceStatus", label: "Unpaid and partly paid invoices", type: "checkbox", fullWidth: true },
      { name: "alertTrends", label: "Sales trends and concentration warnings", type: "checkbox", fullWidth: true },
    ],
  },
};

export type ItemSettings = z.infer<typeof itemSettingsSchema>;
export type SalesSettings = z.infer<typeof salesSettingsSchema>;
export type PurchaseSettings = z.infer<typeof purchaseSettingsSchema>;
export type PosSettings = z.infer<typeof posSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
