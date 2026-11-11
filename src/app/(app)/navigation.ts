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
  IconBuilding,
  IconFactory,
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
    groups: [{ key: "dashboard", label: "Dashboard", icon: IconDashboard, href: "/dashboard" }],
  },
  {
    key: "business",
    label: "Business",
    groups: [
      {
        key: "contacts",
        label: "Contacts",
        icon: IconUsers,
        children: [
          { href: "/customers", label: "Customers", enabled: true, createHref: "/customers/new", keywords: "party buyer client contact" },
          { href: "/vendors", label: "Suppliers", enabled: true, createHref: "/vendors/new", keywords: "vendor party contact" },
          { href: "/agents", label: "Agents", enabled: true, createHref: "/agents/new", keywords: "broker commission" },
          { href: "/transporters", label: "Transporters", enabled: true, createHref: "/transporters/new", keywords: "logistics eway" },
        ],
      },
      {
        key: "items",
        label: "Items",
        icon: IconBox,
        children: [
          { href: "/items", label: "Products", enabled: true, createHref: "/items/new", keywords: "item sku garment variant" },
          { href: "/inventory", label: "Stocks", enabled: true, keywords: "stock on hand low stock warehouse overview" },
          { href: "/stock-adjustments", label: "Stock Verification", enabled: true, createHref: "/stock-adjustments/new", keywords: "adjustment count physical shrinkage" },
          { href: "/stock-ledger", label: "Stock Ledger", enabled: true, keywords: "movement history" },
          { href: "/categories", label: "Categories", enabled: true, createHref: "/categories/new" },
          { href: "/brands", label: "Brands", enabled: true, createHref: "/brands/new" },
          { href: "/units", label: "Units of Measurement", enabled: true, createHref: "/units/new", keywords: "uom unit" },
          { href: "/departments", label: "Departments", enabled: true, createHref: "/departments/new", keywords: "section menswear" },
          { href: "/category-variants", label: "Category-wise Variants", enabled: true, createHref: "/category-variants/new", keywords: "size colour range" },
          { href: "/combo-products", label: "Combo Products", enabled: true, createHref: "/combo-products/new", keywords: "bundle kit pack" },
        ],
      },
      {
        key: "sales",
        label: "Sales",
        icon: IconSales,
        children: [
          { href: "/sales-quotations", label: "Quotations", enabled: true, createHref: "/sales-quotations/new", keywords: "estimate quote" },
          { href: "/sales-orders", label: "Sales Orders", enabled: true, createHref: "/sales-orders/new", keywords: "so booking" },
          { href: "/delivery-challans", label: "Delivery Challans", enabled: true, createHref: "/delivery-challans/new", keywords: "dispatch delivery dc" },
          { href: "/sales-invoices", label: "Invoices", enabled: true, createHref: "/sales-invoices/new", keywords: "sales invoice bill tax" },
          { href: "/sales-returns", label: "Sales Returns", enabled: true, createHref: "/sales-returns/new", keywords: "return" },
          { href: "/credit-notes", label: "Credit Notes", enabled: true, createHref: "/credit-notes/new", keywords: "cn" },
          { href: "/catalog-listings", label: "eCommerce Catalog", enabled: true, createHref: "/catalog-listings/new", keywords: "online store website listing" },
          { href: "/price-lists", label: "Categories & Price Mapping", enabled: true, createHref: "/price-lists/new", keywords: "price list rate wholesale" },
          { href: "/sales-terms", label: "Terms & Conditions", enabled: true, createHref: "/sales-terms/new", keywords: "sales terms conditions" },
        ],
      },
      {
        key: "purchase",
        label: "Purchase",
        icon: IconPurchase,
        children: [
          { href: "/purchase-orders", label: "Purchase Orders", enabled: true, createHref: "/purchase-orders/new", keywords: "po" },
          { href: "/goods-receipts", label: "Material Inwards", enabled: true, createHref: "/goods-receipts/new", keywords: "goods receipt grn inward" },
          { href: "/purchase-invoices", label: "Supplier Bills", enabled: true, createHref: "/purchase-invoices/new", keywords: "purchase invoice bill vendor" },
          { href: "/purchase-returns", label: "Purchase Returns", enabled: true, createHref: "/purchase-returns/new", keywords: "return" },
          { href: "/debit-notes", label: "Debit Notes", enabled: true, createHref: "/debit-notes/new", keywords: "dn" },
          { href: "/purchase-terms", label: "Terms & Conditions", enabled: true, createHref: "/purchase-terms/new", keywords: "purchase terms conditions" },
        ],
      },
      {
        key: "locations",
        label: "Locations / Outlets",
        icon: IconBuilding,
        children: [
          { href: "/branches", label: "Branches", enabled: true, createHref: "/branches/new", keywords: "location outlet office" },
          { href: "/warehouses", label: "Warehouses", enabled: true, createHref: "/warehouses/new", keywords: "godown location" },
          { href: "/stock-transfers", label: "Stock Transfers", enabled: true, createHref: "/stock-transfers/new", keywords: "move warehouse" },
          { href: "/stock-transfer-requests", label: "Stock Transfer Requests", enabled: true, createHref: "/stock-transfer-requests/new", keywords: "indent request replenish" },
        ],
      },
      {
        key: "production",
        label: "Production",
        icon: IconFactory,
        children: [
          { href: "/recipes", label: "Recipes", enabled: true, createHref: "/recipes/new", keywords: "dyeing process formula" },
          { href: "/bill-of-materials", label: "Bill of Materials", enabled: true, createHref: "/bill-of-materials/new", keywords: "bom components" },
          { href: "/material-creation", label: "Material Creation", enabled: true, createHref: "/material-creation/new", keywords: "manufacture production output finished" },
          { href: "/material-consumption", label: "Material Consumption", enabled: true, createHref: "/material-consumption/new", keywords: "issue raw material used" },
        ],
      },
      {
        key: "pos",
        label: "Point of Sale",
        icon: IconStore,
        children: [
          { href: "/pos/register", label: "Open Register", enabled: true, keywords: "pos counter billing checkout" },
          { href: "/pos/orders", label: "POS Orders", enabled: true, keywords: "pos bills receipts" },
          { href: "/pos/credit-notes", label: "POS Credit Notes", enabled: true, keywords: "pos return refund exchange" },
          { href: "/pos/registers", label: "All Registers", enabled: true, keywords: "pos sessions shift closing" },
        ],
      },
      {
        key: "crm",
        label: "CRM",
        icon: IconHeart,
        children: [
          { href: "/coupons", label: "Coupons", enabled: true, createHref: "/coupons/new", keywords: "promo code voucher" },
          { href: "/memberships", label: "Memberships", enabled: true, createHref: "/memberships/new", keywords: "member card plan" },
          { href: "/discounts", label: "Discounts", enabled: true, createHref: "/discounts/new", keywords: "sale markdown offer" },
          { href: "/loyalty-programs", label: "Loyalty", enabled: true, createHref: "/loyalty-programs/new", keywords: "points rewards" },
          { href: "/feedback", label: "Feedback", enabled: true, createHref: "/feedback/new", keywords: "complaint review rating" },
        ],
      },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    groups: [
      {
        key: "bank",
        label: "Bank / Cash",
        icon: IconBank,
        children: [
          { href: "/receipts", label: "Receipts", enabled: true, createHref: "/receipts/new", keywords: "money in collection customer payment" },
          { href: "/payments", label: "Payments", enabled: true, createHref: "/payments/new", keywords: "money out vendor payment" },
          { href: "/bank-accounts", label: "Bank Accounts", enabled: true, createHref: "/bank-accounts/new", keywords: "ifsc account number" },
          { href: "/bank-transactions", label: "Bank Transactions", enabled: true, keywords: "bank book cash book passbook" },
          { href: "/expenses", label: "Expenses", enabled: true, createHref: "/expenses/new", keywords: "rent salary electricity petty cash" },
          { href: "/cash-flow", label: "Cash Flow", enabled: true, keywords: "inflow outflow money" },
          { href: "/owner-cash-flow", label: "Owner Cash Flow", enabled: true, keywords: "capital drawings proprietor" },
          { href: "/manager-cash-flow", label: "Manager Cash Flow", enabled: true, keywords: "cash handled employee counter" },
          { href: "/bank-reconciliation", label: "Bank Reconciliation", enabled: true, keywords: "brs statement clear" },
        ],
      },
      {
        key: "accounting",
        label: "Accounting",
        icon: IconBook,
        children: [
          { href: "/chart-of-accounts", label: "Accounts", enabled: true, keywords: "chart of accounts ledger coa" },
          { href: "/account-vouchers", label: "Journal Vouchers", enabled: true, createHref: "/account-vouchers/new", keywords: "voucher journal contra" },
          { href: "/general-ledger", label: "General Ledger", enabled: true, keywords: "gl postings" },
          { href: "/reports/trial-balance", label: "Trial Balance", enabled: true },
          { href: "/reports/profit-and-loss", label: "Profit & Loss", enabled: true, keywords: "pnl income" },
        ],
      },
    ],
  },
  {
    key: "insights",
    label: "Insights",
    groups: [
      {
        key: "reports",
        label: "Reports",
        icon: IconClipboard,
        children: [
          { href: "/reports/sales-register", label: "Sales Register", enabled: true },
          { href: "/reports/sales-detail", label: "Sales Detail", enabled: true },
          { href: "/reports/purchase-register", label: "Purchase Register", enabled: true },
          { href: "/reports/purchase-detail", label: "Purchase Detail", enabled: true },
          { href: "/reports/gst-hsn-summary", label: "GST HSN Summary", enabled: true, keywords: "gstr tax" },
          { href: "/reports/stock-summary", label: "Stock Summary", enabled: true },
          { href: "/reports/customer-report", label: "Customer Report", enabled: true },
          { href: "/reports/vendor-report", label: "Supplier Report", enabled: true },
          { href: "/reports/item-report", label: "Product Report", enabled: true },
          { href: "/reports/target-vs-actual", label: "Target vs Actual", enabled: true, keywords: "targets achievement" },
        ],
      },
      {
        key: "analysis",
        label: "Analytics",
        icon: IconChart,
        children: [
          { href: "/analysis/sales", label: "Sales Analysis", enabled: true },
          { href: "/analysis/purchase", label: "Purchase Analysis", enabled: true },
          { href: "/analysis/inventory", label: "Inventory Analysis", enabled: true },
          { href: "/analysis/customers", label: "Customer Analysis", enabled: true },
          { href: "/analysis/vendors", label: "Supplier Analysis", enabled: true },
          { href: "/analysis/accounting", label: "Cash & Settlement", enabled: true, keywords: "receivables aging collection cash flow" },
        ],
      },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    groups: [
      {
        key: "users",
        label: "Users",
        icon: IconShield,
        children: [
          { href: "/users", label: "Employees", enabled: true, keywords: "team staff user login" },
          { href: "/user-roles", label: "User Roles", enabled: true, keywords: "permission access rbac" },
        ],
      },
      {
        key: "utilities",
        label: "Utilities",
        icon: IconTool,
        children: [
          { href: "/storage", label: "Storage", enabled: true, keywords: "files documents drive upload" },
          { href: "/barcode-labels", label: "Barcode / Labels", enabled: true, keywords: "print label tag sticker" },
          { href: "/tally-export", label: "Export to Tally", enabled: true, keywords: "tally xml accountant" },
        ],
      },
      {
        key: "setup",
        label: "Global Setup",
        icon: IconGlobe,
        children: [
          { href: "/document-prefixes", label: "Document Prefix", enabled: true, keywords: "numbering series invoice number format" },
          { href: "/tax-rates", label: "Tax Rates", enabled: true, createHref: "/tax-rates/new", keywords: "gst slab cess" },
          { href: "/payment-terms", label: "Payment Terms", enabled: true, createHref: "/payment-terms/new", keywords: "credit days net 30" },
          { href: "/additional-charges", label: "Additional Charges", enabled: true, createHref: "/additional-charges/new", keywords: "freight packing insurance" },
          { href: "/devices", label: "Device Binding", enabled: true, createHref: "/devices/new", keywords: "mac terminal device" },
          { href: "/targets", label: "Targets", enabled: true, createHref: "/targets/new", keywords: "target vs actual goal" },
        ],
      },
      {
        key: "settings",
        label: "Settings",
        icon: IconSettings,
        children: [
          { href: "/settings", label: "Workspace", enabled: true, keywords: "business profile account general" },
          { href: "/settings/financial-years", label: "Financial Years", enabled: true, keywords: "fy year close open switch" },
          { href: "/settings/items", label: "Item Settings", enabled: true, keywords: "product defaults" },
          { href: "/settings/sales", label: "Sales Settings", enabled: true, keywords: "invoice defaults" },
          { href: "/settings/purchase", label: "Purchase Settings", enabled: true, keywords: "bill defaults" },
          { href: "/settings/pos", label: "POS Settings", enabled: true, keywords: "counter receipt" },
          { href: "/settings/notifications", label: "Notifications", enabled: true, keywords: "alerts email low stock" },
        ],
      },
      // Not built yet: hidden from the menu, search and breadcrumbs until it is.
      { key: "apps", label: "Apps & Integrations", icon: IconPlug, href: "/apps", soon: true, keywords: "integration connect api" },
      { key: "logs", label: "Activity Log", icon: IconList, href: "/logs", keywords: "audit logs history who changed" },
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

