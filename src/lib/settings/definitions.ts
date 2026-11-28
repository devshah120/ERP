import { z } from "zod";
import type { FieldConfig } from "@/lib/resources/ui/types";
import { PRINT_DOC_TYPES } from "@/lib/printFormats/catalog";

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

/**
 * Chosen layout per document type. A stored value that is no longer offered
 * (layout retired, or never valid) falls back to that type's default rather
 * than failing the whole section.
 */
export const printFormatSettingsSchema = z.object(
  Object.fromEntries(
    PRINT_DOC_TYPES.map((d) => [d.key, z.enum(d.layouts as [string, ...string[]]).default(d.defaultLayout).catch(d.defaultLayout)])
  )
);

/**
 * Attendance regularization (correction requests) policy. Read by
 * src/lib/hr/regularization.ts when a request is raised and again when it is
 * approved. Defaults keep the rules that applied before this screen existed:
 * past days, blank days, weekly offs, holidays and punch times allowed;
 * future days and half-day-leave days not. 0 in a limit means no limit.
 */
const flag = (def: boolean) => z.coerce.boolean().default(def);
export const attendanceRegularizationSchema = z.object({
  applicable: flag(true),
  pastDaysLimit: days(0),
  futureApplicable: flag(false),
  futureDaysLimit: days(0),
  pastBlankAttendance: flag(true),
  futureBlankAttendance: flag(false),
  allowOnWeeklyOffs: flag(true),
  allowOnHolidays: flag(true),
  maxDaysPerMonth: z.coerce.number().int().min(0).max(31).default(0),
  punchApplicable: flag(true),
  punchPastDaysLimit: days(0),
  applyOnHalfDayLeave: flag(false),
  skipPolicyOnApproval: flag(false),
});

/** Dashboard insight keys each notification switch controls. */
export const NOTIFICATION_INSIGHTS: Record<keyof z.infer<typeof notificationSettingsSchema>, string[]> = {
  alertReceivables: ["receivables-aging", "collection"],
  alertPendingOrders: ["pending-orders"],
  alertInvoiceStatus: ["invoice-status"],
  alertTrends: ["sales-vs-purchase", "revenue-trend", "top-customers", "top-products"],
};

/**
 * Payroll Settings. Read by src/lib/hr/payrollSettings.ts (salary split,
 * payroll generation and approval), the payslip PDF and the employee form
 * (defaults and mandatory fields). Defaults keep payroll behaving as it did
 * before this screen existed.
 */
export const hrPayrollSettingsSchema = z.object({
  salaryAmountBasis: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY"),
  restrictIfPfAccountMissing: flag(false),
  restrictIfLeavesPending: flag(false),
  showBankNameOnPayslip: flag(true),
  reportingManagerMandatory: flag(false),
  departmentMandatory: flag(false),
  defaultPfApplicable: flag(true),
  defaultEsiApplicable: flag(false),
  defaultPtApplicable: flag(true),
});

const percent = (def: number) => z.coerce.number().min(0, "Can't be negative").max(100, "At most 100").default(def);
const rupees = (def: number) => z.coerce.number().min(0, "Can't be negative").max(10_000_000).default(def);

/** PF Settings: read by payroll (src/lib/hr/payrollSettings.ts → computePayslip). Defaults are the statutory 12% on wages up to ₹15,000. */
export const hrPfSettingsSchema = z.object({
  pfApplicable: flag(true),
  employeeRate: percent(12),
  employerRate: percent(12),
  wageCeiling: rupees(15000),
  capAtCeiling: flag(true),
});

/** ESIC Settings: read by payroll. Defaults are 0.75% / 3.25% for a gross up to ₹21,000. */
export const hrEsicSettingsSchema = z.object({
  esicApplicable: flag(true),
  grossLimit: rupees(21000),
  employeeRate: percent(0.75),
  employerRate: percent(3.25),
});

export interface SettingsSection {
  key: string;
  title: string;
  description: string;
  usedBy: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>;
  fields: FieldConfig[];
  /** Permission that shows the screen in the menu (reading the values needs only a sign-in: forms pre-fill from them). */
  viewPermission: string;
  /** Permission to change it. */
  editPermission: string;
  /** Where the screen's back link goes, when not the Settings page. */
  back?: { href: string; label: string };
  /** Collapsible groups (accordion), each listing its field names; without them the fields show as one form. */
  groups?: { title: string; description?: string; fields: string[] }[];
  /** Key into PAYROLL_HELP (src/lib/hr/payrollHelp.ts) for the "How this works" panel. */
  help?: string;
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
    viewPermission: "settings-items.view",
    editPermission: "settings-items.edit",
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
    viewPermission: "settings-sales.view",
    editPermission: "settings-sales.edit",
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
    viewPermission: "settings-purchase.view",
    editPermission: "settings-purchase.edit",
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
    viewPermission: "settings-pos.view",
    editPermission: "settings-pos.edit",
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
  "print-formats": {
    key: "print-formats",
    viewPermission: "settings-print-formats.view",
    editPermission: "settings-print-formats.edit",
    title: "Print Formats",
    description: "Pick the layout used when printing each document type.",
    usedBy: "The POS receipt, POS bill reprints and the Print screen of every sales and purchase document.",
    schema: printFormatSettingsSchema,
    // Edited on its own screen (settings/print-formats), not the generic form.
    fields: [],
  },
  notifications: {
    key: "notifications",
    viewPermission: "settings-notifications.view",
    editPermission: "settings-notifications.edit",
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
  "attendance-regularization": {
    key: "attendance-regularization",
    viewPermission: "hr-attendance-regularization.view",
    editPermission: "hr-attendance-regularization.edit",
    title: "Attendance Regularization",
    description: "Which days employees may ask to have their attendance corrected, and how many.",
    usedBy:
      "Checked when an employee raises a correction request and again when a manager or HR approves it. Limits count days back (or ahead) from the day the request is raised; 0 means no limit.",
    schema: attendanceRegularizationSchema,
    back: { href: "/hr/attendance/requests", label: "Attendance corrections" },
    fields: [
      { name: "applicable", label: "Attendance regularization applicable", type: "checkbox", fullWidth: true, hint: "Off: employees cannot raise correction requests" },
      { name: "pastDaysLimit", label: "Past days limit (in days)", type: "number", hint: "0 = no limit" },
      { name: "maxDaysPerMonth", label: "Max. regularization days in a month", type: "number", hint: "Pending and approved requests; 0 = no limit" },
      { name: "futureApplicable", label: "Future days regularization applicable", type: "checkbox", fullWidth: true, hint: "e.g. on duty or travel planned ahead" },
      { name: "futureDaysLimit", label: "Future days limit (in days)", type: "number", hint: "0 = no limit" },
      { name: "punchPastDaysLimit", label: "Punch past days limit (in days)", type: "number", hint: "How far back check-in / check-out times can be corrected; 0 = no limit" },
      { name: "pastBlankAttendance", label: "Regularization for past days (blank attendance)", type: "checkbox", fullWidth: true, hint: "Past days with nothing marked" },
      { name: "futureBlankAttendance", label: "Regularization for future days (blank attendance)", type: "checkbox", fullWidth: true, hint: "Future days are usually blank, so turn this on with future days" },
      { name: "allowOnWeeklyOffs", label: "Allow regularization on weekly offs", type: "checkbox", fullWidth: true },
      { name: "allowOnHolidays", label: "Allow regularization on holidays", type: "checkbox", fullWidth: true },
      { name: "punchApplicable", label: "Punch regularization applicable", type: "checkbox", fullWidth: true, hint: "Requests may include check-in / check-out times" },
      { name: "applyOnHalfDayLeave", label: "Apply request on half day leave", type: "checkbox", fullWidth: true, hint: "Correct the worked half of a half-day leave; the leave stays" },
      { name: "skipPolicyOnApproval", label: "Do not check attendance policy while approving AR", type: "checkbox", fullWidth: true, hint: "Approval then only refuses full-day leave and locked payroll months" },
    ],
  },
  "hr-payroll-settings": {
    key: "hr-payroll-settings",
    viewPermission: "hr-payroll-settings.view",
    editPermission: "hr-payroll-settings.edit",
    title: "Payroll Settings",
    description: "Workspace-wide payroll rules: how salary amounts are entered, what holds a payroll back, and employee defaults.",
    usedBy:
      "The employee form (salary split, defaults, mandatory fields), payslip generation (PF account check), payroll approval (pending leave check) and the payslip PDF (bank name).",
    schema: hrPayrollSettingsSchema,
    back: { href: "/hr/settings", label: "HR Settings" },
    help: "hr-payroll-settings",
    groups: [
      { title: "Payroll configurations", fields: ["salaryAmountBasis", "restrictIfPfAccountMissing", "restrictIfLeavesPending", "showBankNameOnPayslip"] },
      {
        title: "Employee configurations",
        description: "What the employee form insists on, and the deductions a new employee starts with.",
        fields: ["reportingManagerMandatory", "departmentMandatory", "defaultPfApplicable", "defaultEsiApplicable", "defaultPtApplicable"],
      },
    ],
    fields: [
      {
        name: "salaryAmountBasis",
        label: "Salary amount entered as",
        type: "select",
        options: [
          { value: "MONTHLY", label: "Monthly gross" },
          { value: "ANNUAL", label: "Annual gross (divided by 12)" },
        ],
        hint: "The amount typed on an employee who has a salary structure",
      },
      { name: "restrictIfPfAccountMissing", label: "Restrict salary if PF account no. is not allocated", type: "checkbox", fullWidth: true, hint: "Payslips are not generated while a PF-deducted employee has no UAN or PF number" },
      { name: "restrictIfLeavesPending", label: "Restrict salary if leaves are pending for approval", type: "checkbox", fullWidth: true, hint: "A month can't be approved while its leave requests wait for a decision" },
      { name: "showBankNameOnPayslip", label: "Display bank name in payslip", type: "checkbox", fullWidth: true },
      { name: "reportingManagerMandatory", label: "Reporting manager mandatory", type: "checkbox", fullWidth: true },
      { name: "departmentMandatory", label: "Department mandatory", type: "checkbox", fullWidth: true },
      { name: "defaultPfApplicable", label: "New employees: deduct PF", type: "checkbox", fullWidth: true },
      { name: "defaultEsiApplicable", label: "New employees: deduct ESI", type: "checkbox", fullWidth: true },
      { name: "defaultPtApplicable", label: "New employees: deduct professional tax", type: "checkbox", fullWidth: true },
    ],
  },
  "hr-pf-settings": {
    key: "hr-pf-settings",
    viewPermission: "hr-pf-settings.view",
    editPermission: "hr-pf-settings.edit",
    title: "PF Settings",
    description: "Provident fund rates and wage ceiling.",
    usedBy: "Every payslip generated from now on, for employees with “Deduct Provident Fund” ticked. Approved payslips keep the amounts they were made with.",
    schema: hrPfSettingsSchema,
    back: { href: "/hr/settings", label: "HR Settings" },
    help: "hr-pf-settings",
    fields: [
      { name: "pfApplicable", label: "PF applicable", type: "checkbox", fullWidth: true, hint: "Off: no PF for anyone, whatever the employee record says" },
      { name: "employeeRate", label: "Employee contribution (%)", type: "number" },
      { name: "employerRate", label: "Employer contribution (%)", type: "number", hint: "EPF + EPS together" },
      { name: "wageCeiling", label: "Wage ceiling (₹)", type: "number", hint: "Statutory ceiling ₹15,000" },
      { name: "capAtCeiling", label: "Deduct PF up to ceiling only", type: "checkbox", fullWidth: true, hint: "Off: PF on the whole earned basic" },
    ],
  },
  "hr-esic-settings": {
    key: "hr-esic-settings",
    viewPermission: "hr-esic-settings.view",
    editPermission: "hr-esic-settings.edit",
    title: "ESIC Settings",
    description: "Employee State Insurance rates and gross limit.",
    usedBy: "Every payslip generated from now on, for employees with “Deduct ESI” ticked. Approved payslips keep the amounts they were made with.",
    schema: hrEsicSettingsSchema,
    back: { href: "/hr/settings", label: "HR Settings" },
    help: "hr-esic-settings",
    fields: [
      { name: "esicApplicable", label: "ESIC applicable", type: "checkbox", fullWidth: true, hint: "Off: no ESI for anyone" },
      { name: "grossLimit", label: "Gross limit (₹)", type: "number", hint: "ESI applies when the full-month gross is at or under this" },
      { name: "employeeRate", label: "Employee contribution (%)", type: "number" },
      { name: "employerRate", label: "Employer contribution (%)", type: "number" },
    ],
  },
};

export type HrPayrollSettings = z.infer<typeof hrPayrollSettingsSchema>;
export type HrPfSettings = z.infer<typeof hrPfSettingsSchema>;
export type HrEsicSettings = z.infer<typeof hrEsicSettingsSchema>;
export type ItemSettings = z.infer<typeof itemSettingsSchema>;
export type SalesSettings = z.infer<typeof salesSettingsSchema>;
export type PurchaseSettings = z.infer<typeof purchaseSettingsSchema>;
export type PosSettings = z.infer<typeof posSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type AttendanceRegularizationSettings = z.infer<typeof attendanceRegularizationSchema>;
export type PrintFormatSettings = Record<string, string>;
