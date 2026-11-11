/**
 * The single source of truth for keyboard shortcuts: the handler in
 * ShortcutProvider and the help dialog both read this list, so a shortcut
 * can never be implemented but undocumented, or documented but dead.
 */

export type ShortcutScopeName = "Global" | "Listing" | "Form" | "Document" | "Navigation" | "POS";

export interface ShortcutDef {
  /** Canonical id, also used as the React key. */
  id: string;
  /** Display form, e.g. "Ctrl + N". Mac substitution happens at render time. */
  keys: string;
  description: string;
  scope: ShortcutScopeName;
  /** Where it applies; omitted means everywhere in scope. */
  appliesTo?: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  // --- global -------------------------------------------------------
  { id: "help", keys: "Ctrl + /", description: "Open this keyboard shortcuts reference", scope: "Global" },
  { id: "helpF1", keys: "F1", description: "Open help and the keyboard shortcuts reference", scope: "Global" },
  { id: "palette", keys: "Ctrl + K", description: "Open the command palette — jump to any screen or create a record", scope: "Global" },
  { id: "search", keys: "Ctrl + F", description: "Focus the search box on the current screen", scope: "Global" },
  { id: "refresh", keys: "Ctrl + R", description: "Reload the current listing or dashboard without a full page refresh", scope: "Global", appliesTo: "Falls back to the browser's own reload on screens with nothing to refresh" },
  { id: "escape", keys: "Esc", description: "Close the open dialog, dropdown or filter panel", scope: "Global" },

  // --- listings -----------------------------------------------------
  { id: "new", keys: "Ctrl + N", description: "Create a new record in the current module", scope: "Listing" },
  { id: "export", keys: "Ctrl + E", description: "Export the current listing or report", scope: "Listing" },
  { id: "import", keys: "Ctrl + I", description: "Open the import dialog, where the module supports it", scope: "Listing" },
  { id: "filters", keys: "Ctrl + Shift + F", description: "Show or hide the advanced filter panel", scope: "Listing" },
  { id: "columns", keys: "Ctrl + Shift + K", description: "Open the column picker", scope: "Listing" },

  // --- forms and documents ------------------------------------------
  { id: "save", keys: "Ctrl + S", description: "Save the current form (works while typing in a field)", scope: "Form" },
  { id: "addLine", keys: "Ctrl + Enter", description: "Add another line item to a document", scope: "Document" },
  { id: "print", keys: "Ctrl + P", description: "Print the open document", scope: "Document" },

  // --- navigation ---------------------------------------------------
  { id: "back", keys: "Alt + ←", description: "Go back", scope: "Navigation" },
  { id: "forward", keys: "Alt + →", description: "Go forward", scope: "Navigation" },
  { id: "goDashboard", keys: "Alt + D", description: "Go to the Dashboard", scope: "Navigation" },
  { id: "goReports", keys: "Alt + L", description: "Go to Reports", scope: "Navigation" },

  // --- point of sale (handled by the register screen itself) --------
  { id: "posSearch", keys: "F2", description: "Jump to the product search / barcode box", scope: "POS", appliesTo: "Open Register" },
  { id: "posCard", keys: "F3", description: "Take the whole bill by card and complete the sale", scope: "POS", appliesTo: "Open Register" },
  { id: "posCash", keys: "F4", description: "Take the whole bill in cash and complete the sale", scope: "POS", appliesTo: "Open Register" },
  { id: "posUpi", keys: "F5", description: "Take the whole bill by UPI and complete the sale", scope: "POS", appliesTo: "Open Register" },
  { id: "posHold", keys: "F6", description: "Put the current bill on hold", scope: "POS", appliesTo: "Open Register" },
  { id: "posHeld", keys: "F7", description: "Show bills on hold to recall one", scope: "POS", appliesTo: "Open Register" },
  { id: "posSplit", keys: "F8", description: "Split the payment or enter cash tendered for change", scope: "POS", appliesTo: "Open Register" },
  { id: "posPay", keys: "F9", description: "Complete the sale in the default payment mode", scope: "POS", appliesTo: "Open Register" },

  // --- quick create -------------------------------------------------
  { id: "newQuotation", keys: "Alt + Q", description: "New Sales Quotation", scope: "Navigation", appliesTo: "Sales" },
  { id: "newSalesOrder", keys: "Alt + O", description: "New Sales Order", scope: "Navigation", appliesTo: "Sales" },
  { id: "newInvoice", keys: "Alt + S", description: "New Sales Invoice", scope: "Navigation", appliesTo: "Sales" },
  { id: "newPurchaseOrder", keys: "Alt + P", description: "New Purchase Order", scope: "Navigation", appliesTo: "Purchase" },
  { id: "newBill", keys: "Alt + B", description: "New Purchase Invoice", scope: "Navigation", appliesTo: "Purchase" },
  { id: "newReceipt", keys: "Alt + R", description: "New Receipt (money in)", scope: "Navigation", appliesTo: "Accounting" },
  { id: "newPayment", keys: "Alt + Y", description: "New Payment (money out)", scope: "Navigation", appliesTo: "Accounting" },
  { id: "newCustomer", keys: "Alt + C", description: "New Customer", scope: "Navigation", appliesTo: "Masters" },
  { id: "newVendor", keys: "Alt + V", description: "New Supplier", scope: "Navigation", appliesTo: "Masters" },
  { id: "newItem", keys: "Alt + M", description: "New Item", scope: "Navigation", appliesTo: "Masters" },
];

/** Alt-key quick-create targets, keyed by the lowercase letter pressed. */
export const QUICK_NAV: Record<string, { href: string; label: string }> = {
  d: { href: "/dashboard", label: "Dashboard" },
  l: { href: "/reports", label: "Reports" },
  q: { href: "/sales-quotations/new", label: "New Sales Quotation" },
  o: { href: "/sales-orders/new", label: "New Sales Order" },
  s: { href: "/sales-invoices/new", label: "New Sales Invoice" },
  p: { href: "/purchase-orders/new", label: "New Purchase Order" },
  b: { href: "/purchase-invoices/new", label: "New Purchase Invoice" },
  r: { href: "/receipts/new", label: "New Receipt" },
  y: { href: "/payments/new", label: "New Payment" },
  c: { href: "/customers/new", label: "New Customer" },
  v: { href: "/vendors/new", label: "New Supplier" },
  m: { href: "/items/new", label: "New Item" },
};

/** True on macOS, where Ctrl is written and pressed as Cmd. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
}

/** "Ctrl + N" → "⌘ + N" on a Mac, left alone elsewhere. */
export function displayKeys(keys: string, mac: boolean): string {
  if (!mac) return keys;
  return keys.replace("Ctrl", "⌘").replace("Alt", "⌥");
}
