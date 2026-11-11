/**
 * Central registry of permission keys. Each future module appends its own
 * keys here rather than inventing ad hoc strings inline — keeps the set
 * discoverable and typo-proof via the `Permission` union type.
 *
 * "*" (see Role.OWNER_ALL_PERMISSIONS) bypasses this list entirely and is
 * reserved for the auto-created Owner role.
 */
export const PERMISSIONS = {
  USER_VIEW: "users.view",
  USER_CREATE: "users.create",
  USER_EDIT: "users.edit",
  USER_DISABLE: "users.disable",
  ROLE_VIEW: "roles.view",
  ROLE_MANAGE: "roles.manage",

  CUSTOMER_VIEW: "customers.view",
  CUSTOMER_CREATE: "customers.create",
  CUSTOMER_EDIT: "customers.edit",
  CUSTOMER_DELETE: "customers.delete",

  // Master-data resources served by the generic resource framework
  // (src/lib/resources). Keys follow "<resource>.<action>" so
  // permissionsFor() in the registry stays in sync with this list.
  VENDOR_VIEW: "vendors.view",
  VENDOR_CREATE: "vendors.create",
  VENDOR_EDIT: "vendors.edit",
  VENDOR_DELETE: "vendors.delete",

  AGENT_VIEW: "agents.view",
  AGENT_CREATE: "agents.create",
  AGENT_EDIT: "agents.edit",
  AGENT_DELETE: "agents.delete",

  TRANSPORTER_VIEW: "transporters.view",
  TRANSPORTER_CREATE: "transporters.create",
  TRANSPORTER_EDIT: "transporters.edit",
  TRANSPORTER_DELETE: "transporters.delete",

  CATEGORY_VIEW: "categories.view",
  CATEGORY_CREATE: "categories.create",
  CATEGORY_EDIT: "categories.edit",
  CATEGORY_DELETE: "categories.delete",

  BRAND_VIEW: "brands.view",
  BRAND_CREATE: "brands.create",
  BRAND_EDIT: "brands.edit",
  BRAND_DELETE: "brands.delete",

  UNIT_VIEW: "units.view",
  UNIT_CREATE: "units.create",
  UNIT_EDIT: "units.edit",
  UNIT_DELETE: "units.delete",

  ITEM_VIEW: "items.view",
  ITEM_CREATE: "items.create",
  ITEM_EDIT: "items.edit",
  ITEM_DELETE: "items.delete",

  WAREHOUSE_VIEW: "warehouses.view",
  WAREHOUSE_CREATE: "warehouses.create",
  WAREHOUSE_EDIT: "warehouses.edit",
  WAREHOUSE_DELETE: "warehouses.delete",

  BRANCH_VIEW: "branches.view",
  BRANCH_CREATE: "branches.create",
  BRANCH_EDIT: "branches.edit",
  BRANCH_DELETE: "branches.delete",

  // Money actually moving. Cancel is a separate key from create because
  // reversing a banked receipt is a materially bigger permission than
  // recording one.
  RECEIPT_VIEW: "receipts.view",
  RECEIPT_CREATE: "receipts.create",
  RECEIPT_CANCEL: "receipts.cancel",

  PAYMENT_VIEW: "payments.view",
  PAYMENT_CREATE: "payments.create",
  PAYMENT_CANCEL: "payments.cancel",

  /** Read access to the dashboard and the per-module analysis panels. */
  ANALYTICS_VIEW: "analytics.view",

  // Accounting. The chart of accounts is a master; vouchers move the ledger,
  // so cancelling one is a separate key from creating one.
  ACCOUNT_VIEW: "chart-of-accounts.view",
  ACCOUNT_CREATE: "chart-of-accounts.create",
  ACCOUNT_EDIT: "chart-of-accounts.edit",
  ACCOUNT_DELETE: "chart-of-accounts.delete",

  VOUCHER_VIEW: "vouchers.view",
  VOUCHER_CREATE: "vouchers.create",
  VOUCHER_CANCEL: "vouchers.cancel",

  // Stock documents move inventory without a customer or supplier behind
  // them, which is exactly why they need their own permissions.
  STOCK_ADJUSTMENT_VIEW: "stock-adjustments.view",
  STOCK_ADJUSTMENT_CREATE: "stock-adjustments.create",
  STOCK_ADJUSTMENT_CANCEL: "stock-adjustments.cancel",

  STOCK_TRANSFER_VIEW: "stock-transfers.view",
  STOCK_TRANSFER_CREATE: "stock-transfers.create",
  STOCK_TRANSFER_CANCEL: "stock-transfers.cancel",

  /** Read the activity (audit) log. Owners have it via "*". */
  AUDIT_LOG_VIEW: "audit-logs.view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
