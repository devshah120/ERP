/**
 * Products a workspace can be sold. A business carries the list it has
 * bought; ERP-only workspaces (everything registered before products existed)
 * have no list stored, which reads as ["ERP"].
 *
 * Client-safe: no model or server imports, so the sidebar, command palette
 * and API permission checks all share exactly the same rules.
 */

export const PRODUCTS = ["ERP", "HRMS"] as const;
export type Product = (typeof PRODUCTS)[number];

export const PRODUCT_LABELS: Record<Product, string> = {
  ERP: "ERP (Sales, Stock & Accounts)",
  HRMS: "HRMS (People & Payroll)",
};

export const PRODUCT_SHORT_LABELS: Record<Product, string> = {
  ERP: "ERP",
  HRMS: "HRMS",
};

/** Plans the product owner sells. Free text is stored, these are the presets. */
export const PLANS = ["TRIAL", "STARTER", "GROWTH", "ENTERPRISE"] as const;
export type Plan = (typeof PLANS)[number];

/**
 * Permission modules every workspace has whatever it bought: people need to
 * sign in, manage colleagues and roles, and see the audit trail.
 */
const CORE_PERMISSION_MODULES = new Set(["users", "roles", "audit-logs", "settings", "storage"]);

/** Routes every workspace has. `/settings` itself is the business profile; its sub-pages are ERP defaults. */
const CORE_ROUTES = new Set(["/users", "/user-roles", "/settings", "/logs", "/unauthorized"]);

/** HRMS permission modules and routes all start with "hr" ("hr-employees.view", "/hr/payroll", "/hr-employees"). */
const HR_PREFIX = "hr-";

/** Which product a permission key belongs to; null for core keys every workspace has. */
export function productForPermission(permission: string): Product | null {
  if (permission === "*") return null;
  const moduleKey = permission.split(".")[0];
  if (CORE_PERMISSION_MODULES.has(moduleKey)) return null;
  if (moduleKey.startsWith(HR_PREFIX)) return "HRMS";
  return "ERP";
}

/** Which product a screen belongs to; null for core screens. */
export function productForHref(href: string): Product | null {
  const path = href.split("?")[0];
  if (CORE_ROUTES.has(path)) return null;
  if (path === "/hr" || path.startsWith("/hr/") || path.startsWith("/hr-")) return "HRMS";
  return "ERP";
}

/** Stored value → a clean product list. Missing or empty means a legacy ERP workspace. */
export function normalizeProducts(value: unknown): Product[] {
  if (!Array.isArray(value) || value.length === 0) return ["ERP"];
  const valid = value.filter((v): v is Product => (PRODUCTS as readonly string[]).includes(String(v)));
  return valid.length > 0 ? [...new Set(valid)] : ["ERP"];
}

export function hasProduct(products: readonly Product[], product: Product | null): boolean {
  return product === null || products.includes(product);
}

/** True when the workspace's products include the module a permission belongs to. */
export function permissionInProducts(permission: string, products: readonly Product[]): boolean {
  return hasProduct(products, productForPermission(permission));
}

/** True when a role's permission list grants a key (with "*" granting everything) and the plan includes it. */
export function grants(permissions: readonly string[], products: readonly Product[], permission: string): boolean {
  if (!permissionInProducts(permission, products)) return false;
  return permissions.includes("*") || permissions.includes(permission);
}

/**
 * Where a signed-in person lands. ERP workspaces keep the Business Pulse
 * dashboard; HRMS-only workspaces open on the HR dashboard; an employee whose
 * role only covers self-service opens on their own workspace.
 */
export function homePathFor(permissions: readonly string[], products: readonly Product[]): string {
  const can = (p: string) => grants(permissions, products, p);
  if (products.includes("ERP") && (can("analytics.view") || !products.includes("HRMS"))) return "/dashboard";
  if (can("hr-dashboard.view")) return "/hr/dashboard";
  if (can("hr-self.view")) return "/hr/me";
  if (products.includes("ERP")) return "/dashboard";
  return "/hr/me";
}
