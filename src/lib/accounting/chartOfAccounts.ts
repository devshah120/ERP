import { Types, type ClientSession } from "mongoose";
import { Account, type AccountType, type SystemAccountRole } from "@/models/Account";

interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  isGroup?: boolean;
  systemRole?: SystemAccountRole;
  parent?: string;
  description?: string;
}

/**
 * A standard Indian trading/manufacturing chart of accounts.
 *
 * Codes follow the usual 1000/2000/3000/4000/5000 blocks so an accountant
 * recognises the structure immediately, and every account the posting engine
 * needs carries a `systemRole` — the engine looks accounts up by role, never
 * by name, so renaming "Sales" to "Revenue" cannot break posting.
 */
export const DEFAULT_CHART: SeedAccount[] = [
  // --- Assets -------------------------------------------------------
  { code: "1000", name: "Assets", type: "ASSET", isGroup: true },
  { code: "1100", name: "Current Assets", type: "ASSET", isGroup: true, parent: "1000" },
  { code: "1110", name: "Cash in Hand", type: "ASSET", parent: "1100", systemRole: "CASH" },
  { code: "1120", name: "Bank Accounts", type: "ASSET", parent: "1100", systemRole: "BANK" },
  {
    code: "1130",
    name: "Accounts Receivable",
    type: "ASSET",
    parent: "1100",
    systemRole: "ACCOUNTS_RECEIVABLE",
    description: "Money owed by customers against posted invoices",
  },
  { code: "1140", name: "Inventory", type: "ASSET", parent: "1100", systemRole: "INVENTORY" },
  { code: "1150", name: "Input CGST", type: "ASSET", parent: "1100", systemRole: "INPUT_CGST" },
  { code: "1151", name: "Input SGST/UTGST", type: "ASSET", parent: "1100", systemRole: "INPUT_SGST" },
  { code: "1152", name: "Input IGST", type: "ASSET", parent: "1100", systemRole: "INPUT_IGST" },
  {
    code: "1160",
    name: "Advances to Suppliers",
    type: "ASSET",
    parent: "1100",
    systemRole: "SUPPLIER_ADVANCES",
    description: "Payments made that are not yet matched to a supplier bill",
  },
  { code: "1200", name: "Fixed Assets", type: "ASSET", isGroup: true, parent: "1000" },

  // --- Liabilities --------------------------------------------------
  { code: "2000", name: "Liabilities", type: "LIABILITY", isGroup: true },
  { code: "2100", name: "Current Liabilities", type: "LIABILITY", isGroup: true, parent: "2000" },
  {
    code: "2110",
    name: "Accounts Payable",
    type: "LIABILITY",
    parent: "2100",
    systemRole: "ACCOUNTS_PAYABLE",
    description: "Money owed to suppliers against received bills",
  },
  { code: "2120", name: "Output CGST", type: "LIABILITY", parent: "2100", systemRole: "OUTPUT_CGST" },
  { code: "2121", name: "Output SGST/UTGST", type: "LIABILITY", parent: "2100", systemRole: "OUTPUT_SGST" },
  { code: "2122", name: "Output IGST", type: "LIABILITY", parent: "2100", systemRole: "OUTPUT_IGST" },
  {
    code: "2130",
    name: "Advances from Customers",
    type: "LIABILITY",
    parent: "2100",
    systemRole: "CUSTOMER_ADVANCES",
    description: "Money received that is not yet matched to an invoice",
  },

  // --- Equity -------------------------------------------------------
  { code: "3000", name: "Equity", type: "EQUITY", isGroup: true },
  { code: "3010", name: "Capital Account", type: "EQUITY", parent: "3000" },
  {
    code: "3020",
    name: "Opening Balance Equity",
    type: "EQUITY",
    parent: "3000",
    systemRole: "OPENING_BALANCE_EQUITY",
    description: "Balancing account for opening balances entered on other accounts",
  },

  // --- Income -------------------------------------------------------
  { code: "4000", name: "Income", type: "INCOME", isGroup: true },
  { code: "4010", name: "Sales", type: "INCOME", parent: "4000", systemRole: "SALES" },
  { code: "4020", name: "Sales Returns", type: "INCOME", parent: "4000", systemRole: "SALES_RETURNS" },
  { code: "4030", name: "Freight & Packing Charged", type: "INCOME", parent: "4000", systemRole: "FREIGHT_INCOME" },
  {
    code: "4040",
    name: "Round Off",
    type: "INCOME",
    parent: "4000",
    systemRole: "ROUND_OFF",
    description: "Absorbs the rounding on document totals, either way",
  },

  // --- Expenses -----------------------------------------------------
  { code: "5000", name: "Expenses", type: "EXPENSE", isGroup: true },
  { code: "5010", name: "Purchases", type: "EXPENSE", parent: "5000", systemRole: "PURCHASES" },
  { code: "5020", name: "Purchase Returns", type: "EXPENSE", parent: "5000", systemRole: "PURCHASE_RETURNS" },
  { code: "5030", name: "Freight & Carriage Inward", type: "EXPENSE", parent: "5000", systemRole: "FREIGHT_EXPENSE" },
  {
    code: "5040",
    name: "Stock Adjustment / Shrinkage",
    type: "EXPENSE",
    parent: "5000",
    systemRole: "STOCK_ADJUSTMENT",
    description: "Write-offs and gains from physical stock counts, damage and wastage",
  },
  {
    code: "5050",
    name: "Materials Consumed",
    type: "EXPENSE",
    parent: "5000",
    systemRole: "MATERIAL_CONSUMPTION",
    description: "Raw materials and consumables issued through Material Consumption",
  },
  { code: "5100", name: "Operating Expenses", type: "EXPENSE", isGroup: true, parent: "5000" },
  { code: "5110", name: "Salaries & Wages", type: "EXPENSE", parent: "5100" },
  { code: "5120", name: "Rent", type: "EXPENSE", parent: "5100" },
  { code: "5130", name: "Electricity & Utilities", type: "EXPENSE", parent: "5100" },
  { code: "5140", name: "Bank Charges", type: "EXPENSE", parent: "5100" },
];

/**
 * Creates any missing accounts for a tenant and returns the full set.
 *
 * Safe to call repeatedly: it inserts only what is absent, so enabling
 * accounting on an existing business tops up the chart rather than
 * duplicating it or wiping accounts the business already added.
 */
export async function ensureChartOfAccounts(
  businessId: Types.ObjectId,
  userId?: Types.ObjectId,
  session?: ClientSession
): Promise<{ created: number; total: number }> {
  const existing = await Account.find({ businessId }, { code: 1 }, { session }).lean();
  const have = new Set(existing.map((a) => a.code));

  // Parents must exist before children, so the seed list is walked in order
  // and ids are resolved as we go.
  const idByCode = new Map<string, Types.ObjectId>();
  for (const a of await Account.find({ businessId }, { code: 1 }, { session }).lean()) {
    idByCode.set(a.code, a._id);
  }

  let created = 0;
  for (const seed of DEFAULT_CHART) {
    if (have.has(seed.code)) continue;

    const docs = await Account.create(
      [
        {
          businessId,
          code: seed.code,
          name: seed.name,
          type: seed.type,
          isGroup: seed.isGroup ?? false,
          systemRole: seed.systemRole ?? null,
          parentId: seed.parent ? (idByCode.get(seed.parent) ?? null) : null,
          description: seed.description,
          openingBalance: "0",
          openingBalanceType: seed.type === "ASSET" || seed.type === "EXPENSE" ? "DEBIT" : "CREDIT",
          status: "ACTIVE",
          createdBy: userId ?? null,
        },
      ],
      session ? { session } : {}
    );
    idByCode.set(seed.code, docs[0]._id);
    created += 1;
  }

  return { created, total: idByCode.size };
}

/**
 * Looks up the accounts the posting engine needs, keyed by role.
 * Throws if the chart has not been set up, rather than posting a
 * half-complete voucher.
 */
export async function loadSystemAccounts(
  businessId: Types.ObjectId,
  session?: ClientSession
): Promise<Map<SystemAccountRole, { _id: Types.ObjectId; code: string; name: string }>> {
  const accounts = await Account.find(
    { businessId, systemRole: { $ne: null } },
    { code: 1, name: 1, systemRole: 1 },
    { session }
  ).lean();

  const map = new Map<SystemAccountRole, { _id: Types.ObjectId; code: string; name: string }>();
  for (const a of accounts) {
    if (a.systemRole) map.set(a.systemRole, { _id: a._id, code: a.code, name: a.name });
  }
  return map;
}
