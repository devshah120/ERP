import type { SVGProps, ComponentType } from "react";
import {
  IconDashboard,
  IconSales,
  IconPurchase,
  IconBox,
  IconClipboard,
  IconSettings,
  IconChart,
  IconUsers,
  IconShield,
  // IconBuilding, IconFactory — used by the hidden Locations / Production groups below
  IconStore,
  IconHeart,
  IconBank,
  IconBook,
  IconTool,
  IconGlobe,
  IconPlug,
  IconList,
} from "@/components/icons";

export interface NavChild {
  href: string;
  label: string;
  /** false = module is designed but not yet implemented; rendered as "Soon"
   * and non-clickable rather than linking to a dead page. */
  enabled: boolean;
  /** Where "New …" goes for this module; feeds quick-create and the command palette. */
  createHref?: string;
  /** Extra words the command palette and menu filter should match on. */
  keywords?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Groups without children link directly (Dashboard, Activity Log). */
  href?: string;
  /** A top-level link whose module isn't built yet. */
  soon?: boolean;
  children?: NavChild[];
  keywords?: string;
}

export interface NavSection {
  key: string;
  /** Omitted for the first, unlabelled block. */
  label?: string;
  groups: NavGroup[];
}

/**
 * The single source for navigation. The sidebar, breadcrumbs, quick-create
 * menu and command palette all read this, so a module can't be reachable
 * from one place and missing from another.
 *
 * A module that is designed but not built can be listed with
 * `enabled: false`; it then renders as "Soon" and is never a link.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: "home",
    groups: [{ key: "dashboard", label: "Business Pulse", icon: IconDashboard, href: "/dashboard", keywords: "dashboard" }],
  },
  {
    key: "business",
    label: "Operations",
    groups: [
      {
        key: "contacts",
        label: "Parties",
        keywords: "contacts",
        icon: IconUsers,
        children: [
          { href: "/customers", label: "Buyers", enabled: true, createHref: "/customers/new", keywords: "party buyer client contact customers" },
          { href: "/vendors", label: "Vendors", enabled: true, createHref: "/vendors/new", keywords: "vendor party contact suppliers" },
          { href: "/agents", label: "Sales Agents", enabled: true, createHref: "/agents/new", keywords: "broker commission agents" },
          { href: "/transporters", label: "Logistics Partners", enabled: true, createHref: "/transporters/new", keywords: "logistics eway transporters" },
        ],
      },
      {
        key: "items",
        label: "Catalog & Stock",
        keywords: "items",
        icon: IconBox,
        children: [
          { href: "/items", label: "Product Catalog", enabled: true, createHref: "/items/new", keywords: "item sku garment variant products" },
          { href: "/inventory", label: "Stock on Hand", enabled: true, keywords: "stock on hand low stock warehouse overview stocks" },
          { href: "/stock-adjustments", label: "Stock Audits", enabled: true, createHref: "/stock-adjustments/new", keywords: "adjustment count physical shrinkage stock verification" },
          { href: "/stock-ledger", label: "Stock Movements", enabled: true, keywords: "movement history stock ledger" },
          { href: "/categories", label: "Product Categories", enabled: true, createHref: "/categories/new", keywords: "categories" },
          { href: "/brands", label: "Brand Labels", enabled: true, createHref: "/brands/new", keywords: "brands" },
          { href: "/units", label: "Measuring Units", enabled: true, createHref: "/units/new", keywords: "uom unit units of measurement" },
          { href: "/departments", label: "Store Sections", enabled: true, createHref: "/departments/new", keywords: "section menswear departments" },
          { href: "/category-variants", label: "Size & Colour Sets", enabled: true, createHref: "/category-variants/new", keywords: "size colour range category-wise variants" },
          { href: "/combo-products", label: "Product Bundles", enabled: true, createHref: "/combo-products/new", keywords: "bundle kit pack combo products" },
        ],
      },
      {
        key: "sales",
        label: "Selling",
        keywords: "sales",
        icon: IconSales,
        children: [
          { href: "/sales-quotations", label: "Price Quotes", enabled: true, createHref: "/sales-quotations/new", keywords: "estimate quote quotations" },
          { href: "/sales-orders", label: "Customer Orders", enabled: true, createHref: "/sales-orders/new", keywords: "so booking sales orders" },
          { href: "/delivery-challans", label: "Dispatch Notes", enabled: true, createHref: "/delivery-challans/new", keywords: "dispatch delivery dc delivery challans" },
          { href: "/sales-invoices", label: "Sales Bills", enabled: true, createHref: "/sales-invoices/new", keywords: "sales invoice bill tax invoices" },
          { href: "/sales-returns", label: "Customer Returns", enabled: true, createHref: "/sales-returns/new", keywords: "return sales returns" },
          { href: "/credit-notes", label: "Credit Memos", enabled: true, createHref: "/credit-notes/new", keywords: "cn credit notes" },
          // (hidden for now) { href: "/catalog-listings", label: "eCommerce Catalog", enabled: true, createHref: "/catalog-listings/new", keywords: "online store website listing" },
          // (hidden for now) { href: "/price-lists", label: "Categories & Price Mapping", enabled: true, createHref: "/price-lists/new", keywords: "price list rate wholesale" },
          { href: "/sales-terms", label: "Selling Terms", enabled: true, createHref: "/sales-terms/new", keywords: "sales terms conditions terms & conditions" },
        ],
      },
      {
        key: "purchase",
        label: "Buying",
        keywords: "purchase",
        icon: IconPurchase,
        children: [
          { href: "/purchase-orders", label: "Vendor Orders", enabled: true, createHref: "/purchase-orders/new", keywords: "po purchase orders" },
          { href: "/goods-receipts", label: "Goods Received", enabled: true, createHref: "/goods-receipts/new", keywords: "goods receipt grn inward material inwards" },
          { href: "/purchase-invoices", label: "Vendor Bills", enabled: true, createHref: "/purchase-invoices/new", keywords: "purchase invoice bill vendor supplier bills" },
          { href: "/purchase-returns", label: "Vendor Returns", enabled: true, createHref: "/purchase-returns/new", keywords: "return purchase returns" },
          { href: "/debit-notes", label: "Debit Memos", enabled: true, createHref: "/debit-notes/new", keywords: "dn debit notes" },
          { href: "/purchase-terms", label: "Buying Terms", enabled: true, createHref: "/purchase-terms/new", keywords: "purchase terms conditions terms & conditions" },
        ],
      },
      // Hidden for now — uncomment this group to show Locations / Outlets in the menu again.
      // {
        // key: "locations",
        // label: "Locations / Outlets",
        // icon: IconBuilding,
        // children: [
          // { href: "/branches", label: "Branches", enabled: true, createHref: "/branches/new", keywords: "location outlet office" },
          // { href: "/warehouses", label: "Warehouses", enabled: true, createHref: "/warehouses/new", keywords: "godown location" },
          // { href: "/stock-transfers", label: "Stock Transfers", enabled: true, createHref: "/stock-transfers/new", keywords: "move warehouse" },
          // { href: "/stock-transfer-requests", label: "Stock Transfer Requests", enabled: true, createHref: "/stock-transfer-requests/new", keywords: "indent request replenish" },
        // ],
      // },
      // Hidden for now — uncomment this group to show Production in the menu again.
      // {
        // key: "production",
        // label: "Production",
        // icon: IconFactory,
        // children: [
          // { href: "/recipes", label: "Recipes", enabled: true, createHref: "/recipes/new", keywords: "dyeing process formula" },
          // { href: "/bill-of-materials", label: "Bill of Materials", enabled: true, createHref: "/bill-of-materials/new", keywords: "bom components" },
          // { href: "/material-creation", label: "Material Creation", enabled: true, createHref: "/material-creation/new", keywords: "manufacture production output finished" },
          // { href: "/material-consumption", label: "Material Consumption", enabled: true, createHref: "/material-consumption/new", keywords: "issue raw material used" },
        // ],
      // },
      {
        key: "pos",
        label: "Store Counter",
        keywords: "point of sale",
        icon: IconStore,
        children: [
          { href: "/pos/register", label: "Start Billing", enabled: true, keywords: "pos counter billing checkout open register" },
          { href: "/pos/orders", label: "Counter Bills", enabled: true, keywords: "pos bills receipts pos orders" },
          { href: "/pos/credit-notes", label: "Counter Refunds", enabled: true, keywords: "pos return refund exchange pos credit notes" },
          { href: "/pos/registers", label: "Counter Sessions", enabled: true, keywords: "pos sessions shift closing all registers" },
        ],
      },
      {
        key: "crm",
        label: "Engagement",
        keywords: "crm",
        icon: IconHeart,
        children: [
          { href: "/coupons", label: "Promo Codes", enabled: true, createHref: "/coupons/new", keywords: "promo code voucher coupons" },
          { href: "/memberships", label: "Member Plans", enabled: true, createHref: "/memberships/new", keywords: "member card plan memberships" },
          { href: "/discounts", label: "Price Offers", enabled: true, createHref: "/discounts/new", keywords: "sale markdown offer discounts" },
          { href: "/loyalty-programs", label: "Reward Points", enabled: true, createHref: "/loyalty-programs/new", keywords: "points rewards loyalty" },
          { href: "/feedback", label: "Customer Voice", enabled: true, createHref: "/feedback/new", keywords: "complaint review rating feedback" },
        ],
      },
    ],
  },
  {
    key: "finance",
    label: "Money",
    groups: [
      {
        key: "bank",
        label: "Cash & Bank",
        keywords: "bank / cash",
        icon: IconBank,
        children: [
          { href: "/receipts", label: "Money Received", enabled: true, createHref: "/receipts/new", keywords: "money in collection customer payment receipts" },
          { href: "/payments", label: "Money Paid", enabled: true, createHref: "/payments/new", keywords: "money out vendor payment payments" },
          { href: "/bank-accounts", label: "Linked Banks", enabled: true, createHref: "/bank-accounts/new", keywords: "ifsc account number bank accounts" },
          { href: "/bank-transactions", label: "Bank Activity", enabled: true, keywords: "bank book cash book passbook bank transactions" },
          { href: "/expenses", label: "Business Expenses", enabled: true, createHref: "/expenses/new", keywords: "rent salary electricity petty cash expenses" },
          // (hidden for now) { href: "/cash-flow", label: "Cash Flow", enabled: true, keywords: "inflow outflow money" },
          // (hidden for now) { href: "/owner-cash-flow", label: "Owner Cash Flow", enabled: true, keywords: "capital drawings proprietor" },
          // (hidden for now) { href: "/manager-cash-flow", label: "Manager Cash Flow", enabled: true, keywords: "cash handled employee counter" },
          { href: "/bank-reconciliation", label: "Match Bank Statement", enabled: true, keywords: "brs statement clear bank reconciliation" },
        ],
      },
      {
        key: "accounting",
        label: "Books",
        keywords: "accounting",
        icon: IconBook,
        children: [
          { href: "/chart-of-accounts", label: "Account Heads", enabled: true, keywords: "chart of accounts ledger coa accounts" },
          { href: "/account-vouchers", label: "Journal Entries", enabled: true, createHref: "/account-vouchers/new", keywords: "voucher journal contra journal vouchers" },
          { href: "/general-ledger", label: "Ledger Book", enabled: true, keywords: "gl postings general ledger" },
          { href: "/reports/trial-balance", label: "Balance Check", enabled: true, keywords: "trial balance" },
          { href: "/reports/profit-and-loss", label: "Profit Statement", enabled: true, keywords: "pnl income profit & loss" },
        ],
      },
    ],
  },
  {
    key: "insights",
    label: "Analyze",
    groups: [
      {
        key: "reports",
        label: "Report Library",
        keywords: "reports",
        icon: IconClipboard,
        children: [
          { href: "/reports/sales-register", label: "Sales Book", enabled: true, keywords: "sales register" },
          { href: "/reports/sales-detail", label: "Sales Line Items", enabled: true, keywords: "sales detail" },
          { href: "/reports/purchase-register", label: "Purchase Book", enabled: true, keywords: "purchase register" },
          { href: "/reports/purchase-detail", label: "Purchase Line Items", enabled: true, keywords: "purchase detail" },
          { href: "/reports/gst-hsn-summary", label: "GST by HSN Code", enabled: true, keywords: "gstr tax gst hsn summary" },
          { href: "/reports/stock-summary", label: "Stock Position", enabled: true, keywords: "stock summary" },
          { href: "/reports/customer-report", label: "Buyer Statement", enabled: true, keywords: "customer report" },
          { href: "/reports/vendor-report", label: "Vendor Statement", enabled: true, keywords: "supplier report" },
          { href: "/reports/item-report", label: "Product Performance", enabled: true, keywords: "product report" },
          // (hidden for now) { href: "/reports/target-vs-actual", label: "Target vs Actual", enabled: true, keywords: "targets achievement" },
        ],
      },
      {
        key: "analysis",
        label: "Deep Dives",
        keywords: "analytics",
        icon: IconChart,
        children: [
          { href: "/analysis/sales", label: "Sales Trends", enabled: true, keywords: "sales analysis" },
          { href: "/analysis/purchase", label: "Buying Trends", enabled: true, keywords: "purchase analysis" },
          { href: "/analysis/inventory", label: "Stock Health", enabled: true, keywords: "inventory analysis" },
          { href: "/analysis/customers", label: "Buyer Behaviour", enabled: true, keywords: "customer analysis" },
          { href: "/analysis/vendors", label: "Vendor Performance", enabled: true, keywords: "supplier analysis" },
          { href: "/analysis/accounting", label: "Cash Flow & Dues", enabled: true, keywords: "receivables aging collection cash flow cash & settlement" },
        ],
      },
    ],
  },
  {
    key: "admin",
    label: "Admin & Setup",
    groups: [
      {
        key: "users",
        label: "Team & Access",
        keywords: "users",
        icon: IconShield,
        children: [
          { href: "/users", label: "Team Members", enabled: true, keywords: "team staff user login employees" },
          { href: "/user-roles", label: "Roles & Permissions", enabled: true, keywords: "permission access rbac user roles" },
        ],
      },
      {
        key: "utilities",
        label: "Tools",
        keywords: "utilities",
        icon: IconTool,
        children: [
          // (hidden for now) { href: "/storage", label: "Storage", enabled: true, keywords: "files documents drive upload" },
          { href: "/barcode-labels", label: "Label Printing", enabled: true, keywords: "print label tag sticker barcode / labels" },
          { href: "/tally-export", label: "Tally Export", enabled: false, keywords: "tally xml accountant export to tally" },
        ],
      },
      {
        key: "setup",
        label: "Master Setup",
        keywords: "global setup",
        icon: IconGlobe,
        children: [
          { href: "/document-prefixes", label: "Numbering Series", enabled: true, keywords: "numbering series invoice number format document prefix" },
          { href: "/tax-rates", label: "GST Slabs", enabled: true, createHref: "/tax-rates/new", keywords: "gst slab cess tax rates" },
          { href: "/payment-terms", label: "Credit Terms", enabled: true, createHref: "/payment-terms/new", keywords: "credit days net 30 payment terms" },
          { href: "/additional-charges", label: "Extra Charges", enabled: true, createHref: "/additional-charges/new", keywords: "freight packing insurance additional charges" },
          // (hidden for now) { href: "/devices", label: "Device Binding", enabled: true, createHref: "/devices/new", keywords: "mac terminal device" },
          // (hidden for now) { href: "/targets", label: "Targets", enabled: true, createHref: "/targets/new", keywords: "target vs actual goal" },
        ],
      },
      {
        key: "settings",
        label: "Preferences",
        keywords: "settings",
        icon: IconSettings,
        children: [
          { href: "/settings", label: "Business Profile", enabled: true, keywords: "business profile account general workspace" },
          { href: "/settings/financial-years", label: "Accounting Years", enabled: true, keywords: "fy year close open switch financial years" },
          { href: "/settings/items", label: "Product Defaults", enabled: true, keywords: "product defaults item settings" },
          { href: "/settings/sales", label: "Selling Defaults", enabled: true, keywords: "invoice defaults sales settings" },
          { href: "/settings/purchase", label: "Buying Defaults", enabled: true, keywords: "bill defaults purchase settings" },
          { href: "/settings/pos", label: "Counter Defaults", enabled: true, keywords: "counter receipt pos settings" },
          { href: "/settings/print-formats", label: "Print Templates", enabled: true, keywords: "receipt invoice layout template thermal a4 a5 print print formats" },
          { href: "/settings/notifications", label: "Alerts", enabled: true, keywords: "alerts email low stock notifications" },
        ],
      },
      // Not built yet: hidden from the menu, search and breadcrumbs until it is.
      { key: "apps", label: "Connected Apps", icon: IconPlug, href: "/apps", soon: true, keywords: "integration connect api apps & integrations" },
      { key: "logs", label: "Audit Trail", icon: IconList, href: "/logs", keywords: "audit logs history who changed activity log" },
    ],
  },
];

/** Flat list of groups, in sidebar order. */
export const NAV_GROUPS: NavGroup[] = NAV_SECTIONS.flatMap((s) => s.groups);

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The nav entry a path belongs to — the longest matching href wins, so
 * /reports/sales-register resolves to "Sales Register", not a shorter prefix.
 */
export function findNavMatch(pathname: string): { group: NavGroup; child?: NavChild } | null {
  let best: { group: NavGroup; child?: NavChild; len: number } | null = null;
  for (const group of NAV_GROUPS) {
    if (group.href && !group.soon && matches(pathname, group.href) && (!best || group.href.length > best.len)) {
      best = { group, len: group.href.length };
    }
    for (const child of group.children ?? []) {
      if (child.enabled && matches(pathname, child.href) && (!best || child.href.length > best.len)) {
        best = { group, child, len: child.href.length };
      }
    }
  }
  return best ? { group: best.group, child: best.child } : null;
}

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail for a path: group › module › record/action. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const match = findNavMatch(pathname);
  if (!match) return [];

  const crumbs: Crumb[] = [{ label: match.group.label }];
  const base = match.child?.href ?? match.group.href ?? "";
  if (match.child) crumbs.push({ label: match.child.label, href: match.child.href });
  else if (match.group.href) crumbs[0] = { label: match.group.label, href: match.group.href };

  const rest = pathname.slice(base.length).split("/").filter(Boolean);
  if (rest[0] === "new") crumbs.push({ label: "New" });
  else if (rest.length > 0) {
    crumbs.push({ label: "Details", href: rest.length > 1 ? `${base}/${rest[0]}` : undefined });
    if (rest[1] === "print") crumbs.push({ label: "Print" });
  }

  // The last crumb is the current page and is never a link.
  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}

/** Every module that can create a record, for quick-create and the palette. */
export function creatableModules(): { label: string; href: string; group: string }[] {
  return NAV_GROUPS.flatMap((g) =>
    (g.children ?? [])
      .filter((c) => c.enabled && c.createHref)
      .map((c) => ({ label: c.label, href: c.createHref!, group: g.label }))
  );
}

/** Permission required to view a specific route in the sidebar / palette. */
const ROUTE_PERMISSIONS: Record<string, string> = {
  // Contacts
  "/customers": "customers.view",
  "/vendors": "vendors.view",
  "/agents": "agents.view",
  "/transporters": "transporters.view",

  // Items & Stock
  "/items": "items.view",
  "/inventory": "items.view",
  "/stock-adjustments": "stock-adjustments.view",
  "/stock-ledger": "items.view",
  "/categories": "categories.view",
  "/brands": "brands.view",
  "/units": "units.view",
  "/departments": "departments.view",
  "/category-variants": "category-variants.view",
  "/combo-products": "combo-products.view",

  // Sales
  "/sales-quotations": "sales-quotations.view",
  "/sales-orders": "sales-orders.view",
  "/delivery-challans": "delivery-challans.view",
  "/sales-invoices": "sales-invoices.view",
  "/sales-returns": "sales-returns.view",
  "/credit-notes": "credit-notes.view",
  "/sales-terms": "sales-terms.view",

  // Purchase
  "/purchase-orders": "purchase-orders.view",
  "/goods-receipts": "goods-receipts.view",
  "/purchase-invoices": "purchase-invoices.view",
  "/purchase-returns": "purchase-returns.view",
  "/debit-notes": "debit-notes.view",
  "/purchase-terms": "purchase-terms.view",

  // POS
  "/pos/register": "pos.view",
  "/pos/orders": "pos.view",
  "/pos/credit-notes": "pos.view",
  "/pos/registers": "pos.manage-registers",

  // CRM
  "/coupons": "coupons.view",
  "/memberships": "memberships.view",
  "/discounts": "discounts.view",
  "/loyalty-programs": "loyalty-programs.view",
  "/feedback": "feedback.view",

  // Finance
  "/receipts": "receipts.view",
  "/payments": "payments.view",
  "/bank-accounts": "bank-accounts.view",
  "/bank-transactions": "bank-accounts.view",
  "/expenses": "expenses.view",
  "/bank-reconciliation": "bank-reconciliation.view",
  "/chart-of-accounts": "chart-of-accounts.view",
  "/account-vouchers": "vouchers.view",
  "/general-ledger": "chart-of-accounts.view",
  "/reports/trial-balance": "chart-of-accounts.view",
  "/reports/profit-and-loss": "chart-of-accounts.view",

  // Reports
  "/reports/sales-register": "sales-invoices.view",
  "/reports/sales-detail": "sales-invoices.view",
  "/reports/purchase-register": "purchase-invoices.view",
  "/reports/purchase-detail": "purchase-invoices.view",
  "/reports/gst-hsn-summary": "sales-invoices.view",
  "/reports/stock-summary": "items.view",
  "/reports/customer-report": "customers.view",
  "/reports/vendor-report": "vendors.view",
  "/reports/item-report": "items.view",

  // Analytics
  "/analysis/sales": "analytics.view",
  "/analysis/purchase": "analytics.view",
  "/analysis/inventory": "analytics.view",
  "/analysis/customers": "analytics.view",
  "/analysis/vendors": "analytics.view",
  "/analysis/accounting": "analytics.view",

  // Admin
  "/users": "users.view",
  "/user-roles": "roles.view",
  "/barcode-labels": "items.view",
  "/tally-export": "tally-export.view",
  "/document-prefixes": "document-prefixes.view",
  "/tax-rates": "tax-rates.view",
  "/payment-terms": "payment-terms.view",
  "/additional-charges": "additional-charges.view",
  "/settings": "settings.view",
  "/settings/financial-years": "financial-years.view",
  "/settings/items": "settings.view",
  "/settings/sales": "settings.view",
  "/settings/purchase": "settings.view",
  "/settings/pos": "settings.view",
  "/settings/print-formats": "settings.view",
  "/settings/notifications": "settings.view",
  "/logs": "audit-logs.view",
};

export function getRequiredPermission(href: string): string | null {
  return ROUTE_PERMISSIONS[href] ?? null;
}

/** Permission required to perform a "create" action for a module. */
const CREATE_PERMISSIONS: Record<string, string> = {
  "/customers/new": "customers.create",
  "/vendors/new": "vendors.create",
  "/agents/new": "agents.create",
  "/transporters/new": "transporters.create",
  "/items/new": "items.create",
  "/stock-adjustments/new": "stock-adjustments.create",
  "/categories/new": "categories.create",
  "/brands/new": "brands.create",
  "/units/new": "units.create",
  "/departments/new": "departments.create",
  "/category-variants/new": "category-variants.create",
  "/combo-products/new": "combo-products.create",
  "/sales-quotations/new": "sales-quotations.create",
  "/sales-orders/new": "sales-orders.create",
  "/delivery-challans/new": "delivery-challans.create",
  "/sales-invoices/new": "sales-invoices.create",
  "/sales-returns/new": "sales-returns.create",
  "/credit-notes/new": "credit-notes.create",
  "/sales-terms/new": "sales-terms.create",
  "/purchase-orders/new": "purchase-orders.create",
  "/goods-receipts/new": "goods-receipts.create",
  "/purchase-invoices/new": "purchase-invoices.create",
  "/purchase-returns/new": "purchase-returns.create",
  "/debit-notes/new": "debit-notes.create",
  "/purchase-terms/new": "purchase-terms.create",
  "/coupons/new": "coupons.create",
  "/memberships/new": "memberships.create",
  "/discounts/new": "discounts.create",
  "/loyalty-programs/new": "loyalty-programs.create",
  "/feedback/new": "feedback.create",
  "/receipts/new": "receipts.create",
  "/payments/new": "payments.create",
  "/bank-accounts/new": "bank-accounts.create",
  "/expenses/new": "expenses.create",
  "/account-vouchers/new": "vouchers.create",
  "/tax-rates/new": "tax-rates.create",
  "/payment-terms/new": "payment-terms.create",
  "/additional-charges/new": "additional-charges.create",
};

export function getCreatePermission(createHref: string): string | null {
  return CREATE_PERMISSIONS[createHref] ?? null;
}


