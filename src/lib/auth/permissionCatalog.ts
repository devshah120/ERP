/**
 * Every permission the application checks, grouped the way the role editor
 * shows them. Keys are "<module>.<action>", matching what the API routes pass
 * to requirePermission().
 *
 * Client-safe: no model imports, so the role editor can render it directly.
 * When a module adds a permission check, add the key here too, or no custom
 * role will ever be able to grant it.
 */

export interface PermissionModule {
  key: string;
  label: string;
  actions: string[];
}

export interface PermissionGroup {
  label: string;
  modules: PermissionModule[];
}

const CRUD = ["view", "create", "edit", "delete"];
const DOC = ["view", "create", "edit", "approve"];
const MONEY = ["view", "create", "cancel"];

const m = (key: string, label: string, actions: string[] = CRUD): PermissionModule => ({ key, label, actions });

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "Contacts",
    modules: [m("customers", "Customers"), m("vendors", "Suppliers"), m("agents", "Agents"), m("transporters", "Transporters")],
  },
  {
    label: "Items & stock",
    modules: [
      m("items", "Products"),
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
      m("bank-reconciliation", "Bank reconciliation", ["view", "edit"]),
      m("chart-of-accounts", "Chart of accounts"),
      m("vouchers", "Journal vouchers", MONEY),
      m("analytics", "Dashboard & analytics", ["view"]),
    ],
  },
  {
    label: "HR · People",
    modules: [
      m("hr-dashboard", "HR dashboard", ["view"]),
      m("hr-employees", "Employees"),
      m("hr-departments", "HR departments"),
      m("hr-designations", "Designations"),
      m("hr-shifts", "Shifts"),
      m("hr-holidays", "Holidays"),
      m("hr-announcements", "Announcements"),
      m("hr-assets", "Employee assets"),
    ],
  },
  {
    label: "HR · Time & leave",
    modules: [
      m("hr-attendance", "Attendance", ["view", "edit"]),
      m("hr-leave-types", "Leave types"),
      // approve: leave of people who report to you; approve-all: anyone's leave (HR).
      m("hr-leaves", "Leave requests", ["view", "create", "approve", "approve-all", "allocate"]),
    ],
  },
  {
    label: "HR · Payroll",
    modules: [
      m("hr-payroll", "Payroll runs & payslips", ["view", "process", "approve"]),
      m("hr-loans", "Loans & advances", MONEY),
      m("hr-claims", "Expense claims", ["view", "create", "approve"]),
      m("hr-reports", "HR reports", ["view"]),
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
    modules: [m("hr-self", "My workspace (own attendance, leave, payslips, claims)", ["view"])],
  },
  {
    label: "Administration",
    modules: [
      m("users", "Employees", ["view", "create", "edit", "disable"]),
      m("roles", "User roles", ["view", "manage"]),
      m("audit-logs", "Activity log", ["view"]),
      m("settings", "Settings", ["view", "edit"]),
      m("financial-years", "Financial years", ["view", "manage"]),
      m("document-prefixes", "Document prefixes", ["view", "edit"]),
      m("tax-rates", "Tax rates"),
      m("payment-terms", "Payment terms"),
      m("additional-charges", "Additional charges"),
      m("devices", "Device binding"),
      m("targets", "Targets"),
      m("storage", "Storage", ["view", "upload", "delete"]),
      m("tally-export", "Export to Tally", ["view"]),
    ],
  },
];

/** Flat set of every valid permission key. */
export const ALL_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_GROUPS.flatMap((g) => g.modules.flatMap((mod) => mod.actions.map((a) => `${mod.key}.${a}`)))
);

/** Every HRMS permission key — the HR Manager role is seeded with these. */
export const HR_PERMISSION_KEYS: string[] = PERMISSION_GROUPS.filter((g) => g.label.startsWith("HR"))
  .flatMap((g) => g.modules.flatMap((mod) => mod.actions.map((a) => `${mod.key}.${a}`)))
  .filter((k) => !k.startsWith("hr-self."));

/** What an employee's own portal login can do. */
export const HR_SELF_SERVICE_PERMISSIONS: string[] = ["hr-self.view"];
