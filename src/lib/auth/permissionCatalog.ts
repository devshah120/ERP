/**
 * Every permission the application checks, grouped by area. Keys are
 * "<module>.<action>", matching what the API routes pass to
 * requirePermission().
 *
 * The role editor lays these out the way the sidebar is (navigation.ts), so
 * every menu and sub-menu has the rights that control it next to its name.
 * Each screen therefore has its own module here, reports and settings pages
 * included; a screen that is only a step of a bigger module (Disburse
 * Payroll, Leave Balances) is controlled by that module's actions.
 *
 * Client-safe: no model imports, so the role editor can render it directly.
 * When a module adds a permission check, add the key here too, or no custom
 * role will ever be able to grant it.
 */
import { HR_REPORTS } from "@/lib/hr/reportCatalog";

export interface PermissionModule {
  key: string;
  label: string;
  actions: string[];
  /**
   * Other permissions the module's screens need to work (dropdown lookups).
   * The role editor ticks them along with any action but view (or with view,
   * for a view-only module).
   */
  requires?: string[];
}

export interface PermissionGroup {
  label: string;
  modules: PermissionModule[];
}

const CRUD = ["view", "create", "edit", "delete"];
const DOC = ["view", "create", "edit", "approve"];
const MONEY = ["view", "create", "cancel"];
const VIEW = ["view"];
const SETTING = ["view", "edit"];

const m = (key: string, label: string, actions: string[] = CRUD, requires?: string[]): PermissionModule => ({
  key,
  label,
  actions,
  ...(requires ? { requires } : {}),
});

/**
 * The ERP reports (src/lib/reports/registry.ts), each with its own view
 * permission. Kept here as plain data because the registry imports models;
 * test/permissions.test.ts checks the two lists match.
 */
export const ERP_REPORT_PERMISSIONS: { key: string; label: string }[] = [
  { key: "sales-register", label: "Sales book" },
  { key: "sales-detail", label: "Sales line items" },
  { key: "purchase-register", label: "Purchase book" },
  { key: "purchase-detail", label: "Purchase line items" },
  { key: "gst-hsn-summary", label: "GST by HSN code" },
  { key: "stock-summary", label: "Stock position" },
  { key: "stock-ledger", label: "Stock movements" },
  { key: "customer-report", label: "Buyer statement" },
  { key: "vendor-report", label: "Vendor statement" },
  { key: "item-report", label: "Product performance" },
  { key: "bank-transactions", label: "Bank activity" },
  { key: "general-ledger", label: "Ledger book" },
  { key: "trial-balance", label: "Balance check (trial balance)" },
  { key: "profit-and-loss", label: "Profit statement" },
  { key: "cash-flow", label: "Cash flow" },
  { key: "owner-cash-flow", label: "Owner cash flow" },
  { key: "manager-cash-flow", label: "Manager cash flow" },
  { key: "target-vs-actual", label: "Target vs actual" },
];

/** Permission that opens one ERP report. */
export function reportPermission(reportKey: string): string {
  return `report-${reportKey}.view`;
}

/** Permission that opens one HR report. */
export function hrReportPermission(reportKey: string): string {
  return `hr-report-${reportKey}.view`;
}

/** Deep-dive analysis screens (/analysis/<module>). */
export const ANALYSIS_PERMISSIONS: { key: string; label: string }[] = [
  { key: "sales", label: "Sales trends" },
  { key: "purchase", label: "Buying trends" },
  { key: "inventory", label: "Stock health" },
  { key: "customers", label: "Buyer behaviour" },
  { key: "vendors", label: "Vendor performance" },
  { key: "accounting", label: "Cash flow & dues" },
];

export function analysisPermission(moduleKey: string): string {
  return `analysis-${moduleKey}.view`;
}

const SALES_REPORTS = new Set(["sales-register", "sales-detail", "gst-hsn-summary"]);
const PURCHASE_REPORTS = new Set(["purchase-register", "purchase-detail"]);
const STOCK_REPORTS = new Set(["stock-summary", "stock-ledger", "item-report"]);
const PARTY_REPORTS = new Set(["customer-report", "vendor-report"]);
const BOOKS_REPORTS = new Set(["general-ledger", "trial-balance", "profit-and-loss"]);

const reportModules = (keys: ReadonlySet<string>) =>
  ERP_REPORT_PERMISSIONS.filter((r) => keys.has(r.key)).map((r) => m(`report-${r.key}`, r.label, VIEW));

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "Dashboard",
    modules: [m("analytics", "Business Pulse dashboard (opens on sign-in)", VIEW)],
  },
  {
    label: "Contacts",
    modules: [m("customers", "Customers"), m("vendors", "Suppliers"), m("agents", "Agents"), m("transporters", "Transporters")],
  },
  {
    label: "Items & stock",
    modules: [
      m("items", "Products"),
      m("inventory", "Stock on hand", VIEW),
      m("categories", "Categories"),
      m("brands", "Brands"),
      m("units", "Units"),
      m("departments", "Departments"),
      m("category-variants", "Category-wise variants"),
      m("combo-products", "Combo products"),
      m("stock-adjustments", "Stock verification", MONEY),
      m("stock-transfers", "Stock transfers", MONEY),
      m("stock-transfer-requests", "Stock transfer requests", ["view", "create", "approve", "cancel"]),
      m("branches", "Branches"),
      m("warehouses", "Warehouses"),
    ],
  },
  {
    label: "Sales",
    modules: [
      m("sales-quotations", "Quotations", DOC),
      m("sales-orders", "Sales orders", DOC),
      m("delivery-challans", "Delivery challans", DOC),
      m("sales-invoices", "Invoices", DOC),
      m("sales-returns", "Sales returns", DOC),
      m("credit-notes", "Credit notes", DOC),
      m("catalog-listings", "eCommerce catalog"),
      m("price-lists", "Price mapping"),
      m("sales-terms", "Sales terms & conditions"),
    ],
  },
  {
    label: "Purchase",
    modules: [
      m("purchase-orders", "Purchase orders", DOC),
      m("goods-receipts", "Material inwards", DOC),
      m("purchase-invoices", "Supplier bills", DOC),
      m("purchase-returns", "Purchase returns", DOC),
      m("debit-notes", "Debit notes", DOC),
      m("purchase-terms", "Purchase terms & conditions"),
    ],
  },
  {
    label: "Production",
    modules: [
      m("recipes", "Recipes"),
      m("bill-of-materials", "Bill of materials"),
      m("material-creation", "Material creation", MONEY),
      m("material-consumption", "Material consumption", MONEY),
    ],
  },
  {
    label: "Point of sale",
    modules: [m("pos", "POS", ["view", "sell", "refund", "cancel", "manage-registers"])],
  },
  {
    label: "CRM",
    modules: [
      m("coupons", "Coupons"),
      m("memberships", "Memberships"),
      m("discounts", "Discounts"),
      m("loyalty-programs", "Loyalty"),
      m("feedback", "Feedback"),
    ],
  },
  {
    label: "Bank & accounting",
    modules: [
      m("receipts", "Receipts", MONEY),
      m("payments", "Payments", MONEY),
      m("expenses", "Expenses", MONEY),
      m("bank-accounts", "Bank accounts"),
      m("report-bank-transactions", "Bank activity", VIEW),
      m("bank-reconciliation", "Bank reconciliation", ["view", "edit"]),
      m("chart-of-accounts", "Chart of accounts"),
      m("vouchers", "Journal vouchers", MONEY),
      ...reportModules(BOOKS_REPORTS),
      m("report-cash-flow", "Cash flow", VIEW),
      m("report-owner-cash-flow", "Owner cash flow", VIEW),
      m("report-manager-cash-flow", "Manager cash flow", VIEW),
    ],
  },
  {
    label: "Reports",
    modules: [
      ...reportModules(SALES_REPORTS),
      ...reportModules(PURCHASE_REPORTS),
      ...reportModules(STOCK_REPORTS),
      ...reportModules(PARTY_REPORTS),
      m("report-target-vs-actual", "Target vs actual", VIEW),
    ],
  },
  {
    label: "Analysis",
    modules: ANALYSIS_PERMISSIONS.map((a) => m(`analysis-${a.key}`, a.label, VIEW)),
  },
  {
    label: "HR · People",
    modules: [
      m("hr-dashboard", "HR dashboard", VIEW),
      // One module per Employees sub-menu: the directory & profiles, the org tree, and the employee records themselves.
      m("hr-employee-directory", "Employee directory", ["view", "edit"]),
      m("hr-org-tree", "Organization tree", VIEW),
      m("hr-employees", "Employee records", CRUD, ["hr-grades.view", "hr-holiday-calendars.view", "hr-salary-structures.view"]),
      m("hr-departments", "HR departments"),
      m("hr-designations", "Designations"),
      m("hr-grades", "Grades"),
      m("hr-announcements", "Announcements"),
      m("hr-assets", "Employee assets"),
    ],
  },
  {
    label: "HR · Time & leave",
    modules: [
      m("hr-attendance", "Attendance", ["view", "edit"]),
      m("hr-attendance-regularization", "Attendance regularization policy", SETTING),
      m("hr-attendance-reasons", "Attendance regularization reasons"),
      m("hr-shifts", "Shifts"),
      m("hr-holidays", "Holidays"),
      m("hr-holiday-calendars", "Holiday calendars"),
      m("hr-leave-types", "Leave types"),
      m("hr-leave-groups", "Leave groups"),
      m("hr-grade-leave-groups", "Assign leave group to grade", CRUD, ["hr-grades.view", "hr-leave-groups.view"]),
      // approve: leave of people who report to you; approve-all: anyone's leave (HR).
      m("hr-leaves", "Leave requests", ["view", "create", "approve", "approve-all", "allocate"]),
    ],
  },
  {
    label: "HR · Payroll",
    modules: [
      m("hr-payroll", "Payroll runs & payslips", ["view", "process", "approve"]),
      m("hr-pay-components", "Pay components"),
      m("hr-salary-structures", "Salary structures"),
      m("hr-pt-slabs", "PT slabs"),
      m("hr-incentive-matrices", "Incentive matrix"),
      m("hr-payroll-settings", "Payroll settings", SETTING),
      m("hr-pf-settings", "PF settings", SETTING),
      m("hr-esic-settings", "ESIC settings", SETTING),
      m("hr-loans", "Loans & advances", ["view", "create", "edit", "cancel"]),
      m("hr-claims", "Expense claims", ["view", "create", "approve"]),
    ],
  },
  {
    label: "HR · Reports",
    modules: HR_REPORTS.map((r) => m(`hr-report-${r.key}`, r.label, VIEW)),
  },
  {
    label: "HR · Contract labour",
    modules: [
      m("hr-contractors", "Contractors"),
      m("hr-contract-workers", "Contract workers"),
      m("hr-contract-attendance", "Contract labour attendance & overtime", ["view", "edit"]),
    ],
  },
  {
    label: "HR · Talent",
    modules: [
      m("hr-job-openings", "Job openings"),
      m("hr-candidates", "Candidates"),
      m("hr-appraisals", "Appraisals"),
    ],
  },
  {
    label: "HR · Employee self-service",
    modules: [m("hr-self", "My workspace (own attendance, leave, payslips, claims)", VIEW)],
  },
  {
    label: "Settings",
    modules: [
      m("settings", "Business profile", SETTING),
      m("financial-years", "Financial years", ["view", "manage"]),
      m("settings-items", "Product defaults", SETTING),
      m("settings-sales", "Selling defaults", SETTING),
      m("settings-purchase", "Buying defaults", SETTING),
      m("settings-pos", "Counter defaults", SETTING),
      m("settings-print-formats", "Print templates", SETTING),
      m("settings-notifications", "Alerts", SETTING),
    ],
  },
  {
    label: "Administration",
    modules: [
      m("users", "Employees", ["view", "create", "edit", "disable"]),
      m("roles", "User roles", ["view", "manage"]),
      m("audit-logs", "Activity log", VIEW),
      m("approvals", "Approval schemes & user groups", ["view", "manage"]),
      m("document-prefixes", "Document prefixes", ["view", "edit"]),
      m("tax-rates", "Tax rates"),
      m("payment-terms", "Payment terms"),
      m("additional-charges", "Additional charges"),
      m("devices", "Device binding"),
      m("targets", "Targets"),
      m("barcode-labels", "Label printing", VIEW, ["items.view", "categories.view", "brands.view"]),
      m("storage", "Storage", ["view", "upload", "delete"]),
      m("tally-export", "Export to Tally", VIEW),
    ],
  },
];

/** Every module, by key. */
export const PERMISSION_MODULES: ReadonlyMap<string, PermissionModule> = new Map(
  PERMISSION_GROUPS.flatMap((g) => g.modules.map((mod) => [mod.key, mod] as const))
);

/** Flat set of every valid permission key. */
export const ALL_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_GROUPS.flatMap((g) => g.modules.flatMap((mod) => mod.actions.map((a) => `${mod.key}.${a}`)))
);

/** Every HRMS permission key — the HR Manager role is seeded with these. */
export const HR_PERMISSION_KEYS: string[] = [...ALL_PERMISSION_KEYS].filter((k) => k.startsWith("hr-") && !k.startsWith("hr-self."));

/** What an employee's own portal login can do. */
export const HR_SELF_SERVICE_PERMISSIONS: string[] = ["hr-self.view"];

/* ------------------------------------------------------------------ */
/* Upgrading roles saved before a screen had its own permission        */
/* ------------------------------------------------------------------ */

/**
 * Bump when a screen moves onto a permission of its own, and say in
 * LEGACY_GRANTS which old keys gave the access. Roles with a lower
 * `permissionsVersion` are upgraded once (roleUpgrade.ts), so nobody loses a
 * screen they could open before; after that the new key is revoked on its own.
 */
export const PERMISSIONS_VERSION = 2;

/** Keys no longer checked anywhere; upgrading drops them. */
export const RETIRED_PERMISSION_KEYS: ReadonlySet<string> = new Set(["hr-reports.view"]);

/**
 * New key → every key a role had to hold to reach that screen before.
 * Built for version 1 (one module per menu entry, reports and settings included).
 */
function legacyGrantsV1(): Record<string, string[]> {
  const g: Record<string, string[]> = {};
  const same = (from: string, to: string, actions: string[]) => actions.forEach((a) => (g[`${to}.${a}`] = [`${from}.${a}`]));

  // Reports: the menu entry needed the module the report reads.
  const reportFrom: Record<string, string> = {
    "sales-register": "sales-invoices.view",
    "sales-detail": "sales-invoices.view",
    "gst-hsn-summary": "sales-invoices.view",
    "purchase-register": "purchase-invoices.view",
    "purchase-detail": "purchase-invoices.view",
    "stock-summary": "items.view",
    "stock-ledger": "items.view",
    "item-report": "items.view",
    "customer-report": "customers.view",
    "vendor-report": "vendors.view",
    "bank-transactions": "bank-accounts.view",
    "general-ledger": "chart-of-accounts.view",
    "trial-balance": "chart-of-accounts.view",
    "profit-and-loss": "chart-of-accounts.view",
    "cash-flow": "bank-accounts.view",
    "owner-cash-flow": "bank-accounts.view",
    "manager-cash-flow": "bank-accounts.view",
    "target-vs-actual": "targets.view",
  };
  for (const [report, from] of Object.entries(reportFrom)) g[reportPermission(report)] = [from];

  // Analysis: the menu needed analytics.view and the API the module's own view.
  const analysisFrom: Record<string, string> = {
    sales: "sales-invoices.view",
    purchase: "purchase-invoices.view",
    inventory: "items.view",
    customers: "customers.view",
    vendors: "vendors.view",
    accounting: "sales-invoices.view",
  };
  for (const [mod, from] of Object.entries(analysisFrom)) g[analysisPermission(mod)] = ["analytics.view", from];

  g["inventory.view"] = ["items.view"];
  g["barcode-labels.view"] = ["items.view"];

  for (const s of ["items", "sales", "purchase", "pos", "print-formats", "notifications"]) {
    g[`settings-${s}.view`] = ["settings.view"];
    g[`settings-${s}.edit`] = ["settings.edit"];
  }

  for (const r of HR_REPORTS) g[hrReportPermission(r.key)] = ["hr-reports.view"];

  for (const s of ["hr-payroll-settings", "hr-pf-settings", "hr-esic-settings"]) {
    g[`${s}.view`] = ["hr-payroll.view"];
    g[`${s}.edit`] = ["hr-payroll.process"];
  }
  g["hr-attendance-regularization.view"] = ["hr-attendance.view"];
  g["hr-attendance-regularization.edit"] = ["hr-attendance.edit"];

  same("hr-designations", "hr-grades", CRUD);
  same("hr-holidays", "hr-holiday-calendars", CRUD);
  same("hr-leave-types", "hr-leave-groups", CRUD);
  same("hr-leave-types", "hr-grade-leave-groups", CRUD);
  g["hr-attendance-reasons.view"] = ["hr-attendance.view"];
  for (const a of ["create", "edit", "delete"]) g[`hr-attendance-reasons.${a}`] = ["hr-attendance.edit"];
  for (const mod of ["hr-pay-components", "hr-salary-structures", "hr-pt-slabs", "hr-incentive-matrices"]) {
    g[`${mod}.view`] = ["hr-payroll.view"];
    for (const a of ["create", "edit", "delete"]) g[`${mod}.${a}`] = ["hr-payroll.process"];
  }
  return g;
}

/** Version 2: Employee Directory and Organization Tree got their own rights (both opened with hr-employees.view before). */
function legacyGrantsV2(): Record<string, string[]> {
  return {
    "hr-employee-directory.view": ["hr-employees.view"],
    "hr-employee-directory.edit": ["hr-employees.edit"],
    "hr-org-tree.view": ["hr-employees.view"],
  };
}

/**
 * Grants per catalog version. A role is given only the grants of versions
 * newer than its own, so a right revoked after an earlier upgrade is never
 * handed back by a later one.
 */
export const LEGACY_GRANTS_BY_VERSION: Readonly<Record<number, Readonly<Record<string, string[]>>>> = {
  1: legacyGrantsV1(),
  2: legacyGrantsV2(),
};

/** Every legacy grant of every version (new key → old keys). */
export const LEGACY_GRANTS: Readonly<Record<string, string[]>> = Object.assign({}, ...Object.values(LEGACY_GRANTS_BY_VERSION));

/**
 * A role's permissions brought up to PERMISSIONS_VERSION: adds each new key
 * whose old keys the role held, drops retired keys. "*" is left alone.
 */
export function upgradePermissionList(permissions: readonly string[], fromVersion = 0): string[] {
  if (permissions.includes("*")) return [...permissions];
  const next = new Set(permissions);
  for (const [version, grants] of Object.entries(LEGACY_GRANTS_BY_VERSION)) {
    if (Number(version) <= fromVersion) continue;
    // Each version reads the list as the previous versions left it.
    const held = new Set(next);
    for (const [key, from] of Object.entries(grants)) {
      if (from.every((f) => held.has(f))) next.add(key);
    }
  }
  // Retired keys go last: grants above may still be based on them.
  return [...next].filter((p) => !RETIRED_PERMISSION_KEYS.has(p));
}
