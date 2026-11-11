import { z } from "zod";
import { moneyStringSchema } from "@/lib/validation/money";
import { gstinSchema } from "@/lib/validation/gstin";
import { Account, ACCOUNT_TYPES } from "@/models/Account";
import { Customer } from "@/models/Customer";
import { Vendor } from "@/models/Vendor";
import { Agent } from "@/models/Agent";
import { Transporter } from "@/models/Transporter";
import { Category } from "@/models/Category";
import { Brand } from "@/models/Brand";
import { Unit } from "@/models/Unit";
import { Item, ITEM_TYPES, GENDERS } from "@/models/Item";
import { Warehouse } from "@/models/Warehouse";
import { Branch } from "@/models/Branch";
import type { ResourceDefinition } from "@/lib/resources/types";
import { STATUS, permissionsFor, documentConverter } from "@/lib/resources/helpers";
import { EXTENDED_RESOURCES } from "@/lib/resources/extendedRegistry";

const addressInput = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  country: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional(),
});

// -------------------------------------------------------------- Customers

/**
 * Customers also have a bespoke module (`/api/customers`, CustomerForm) with a
 * richer create/edit screen. This definition exists so customers get the same
 * generic list, export and import as every other master.
 *
 * It is not a duplicate implementation: without it, `getResource("customers")`
 * returned undefined, which meant the customer importer silently skipped
 * schema validation on preview and then failed at commit. Both paths now run
 * the same rules.
 */
const customerFields = {
  name: z.string().trim().min(2).max(200),
  companyName: z.string().trim().max(200).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().min(7).max(20),
  alternatePhone: z.string().trim().max(20).optional(),
  billingAddress: addressInput,
  shippingAddress: addressInput.optional(),
  gstin: gstinSchema,
  creditLimit: moneyStringSchema.default("0"),
  creditDays: z.coerce.number().int().min(0).max(3650).default(0),
  paymentTerms: z.string().trim().max(100).optional(),
  currency: z.string().trim().toUpperCase().length(3).default("INR"),
  customerGroup: z.string().trim().max(100).optional(),
  openingBalance: moneyStringSchema.default("0"),
  openingBalanceType: z.enum(["DEBIT", "CREDIT"]).default("DEBIT"),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(STATUS).default("ACTIVE"),
};

const customers: ResourceDefinition = {
  key: "customers",
  label: "Customer",
  model: Customer,
  autoCode: { field: "customerCode", prefix: "CUST", entityType: "CUSTOMER" },
  createSchema: z.object(customerFields),
  updateSchema: z.object(customerFields).partial(),
  searchFields: ["name", "companyName", "customerCode", "phone", "email"],
  filterFields: {
    customerCode: "customerCode",
    name: "name",
    companyName: "companyName",
    city: "billingAddress.city",
    phone: "phone",
    email: "email",
  },
  sortableFields: ["customerCode", "name", "companyName", "phone", "email", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  permissions: permissionsFor("customers"),
  toDocument: documentConverter({ money: ["creditLimit", "openingBalance"] }),
};

// ------------------------------------------------------- Chart of accounts

/**
 * Accounts are a master like any other, so they get the generic list, form,
 * filters, export and import for free. The one rule the generic framework
 * cannot express — that a system account may not be deleted — is enforced in
 * the delete route.
 */
const accountFields = {
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  type: z.enum(ACCOUNT_TYPES),
  parentId: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().max(500).optional(),
  openingBalance: moneyStringSchema.default("0"),
  openingBalanceType: z.enum(["DEBIT", "CREDIT"]).default("DEBIT"),
  isGroup: z.coerce.boolean().default(false),
  status: z.enum(STATUS).default("ACTIVE"),
};

const chartOfAccounts: ResourceDefinition = {
  key: "chart-of-accounts",
  label: "Account",
  model: Account,
  createSchema: z.object(accountFields),
  updateSchema: z.object(accountFields).partial(),
  searchFields: ["name", "code"],
  filterFields: { code: "code", name: "name", type: "type" },
  sortableFields: ["code", "name", "type", "createdAt"],
  defaultSort: "code",
  defaultSortDir: "asc",
  permissions: permissionsFor("chart-of-accounts"),
  toDocument: documentConverter({ money: ["openingBalance"], refs: ["parentId"] }),
};

// ---------------------------------------------------------------- Vendors

const vendorFields = {
  name: z.string().trim().min(2).max(200),
  companyName: z.string().trim().max(200).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().min(7).max(20),
  alternatePhone: z.string().trim().max(20).optional(),
  billingAddress: addressInput,
  gstin: gstinSchema,
  panNumber: z.string().trim().toUpperCase().max(20).optional(),
  creditLimit: moneyStringSchema.default("0"),
  creditDays: z.coerce.number().int().min(0).max(3650).default(0),
  paymentTerms: z.string().trim().max(100).optional(),
  currency: z.string().trim().toUpperCase().length(3).default("INR"),
  vendorGroup: z.string().trim().max(100).optional(),
  openingBalance: moneyStringSchema.default("0"),
  openingBalanceType: z.enum(["DEBIT", "CREDIT"]).default("CREDIT"),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(STATUS).default("ACTIVE"),
};

const vendors: ResourceDefinition = {
  key: "vendors",
  label: "Vendor",
  model: Vendor,
  autoCode: { field: "vendorCode", prefix: "VEND", entityType: "VENDOR" },
  createSchema: z.object(vendorFields),
  updateSchema: z.object(vendorFields).partial(),
  searchFields: ["name", "companyName", "vendorCode", "phone", "email"],
  filterFields: {
    vendorCode: "vendorCode",
    name: "name",
    companyName: "companyName",
    city: "billingAddress.city",
    phone: "phone",
    email: "email",
  },
  sortableFields: ["vendorCode", "name", "companyName", "phone", "email", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  permissions: permissionsFor("vendors"),
  toDocument: documentConverter({ money: ["creditLimit", "openingBalance"] }),
};

// ----------------------------------------------------------------- Agents

const agentFields = {
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  commissionPercent: z.coerce.number().min(0).max(100).default(0),
  panNumber: z.string().trim().toUpperCase().max(20).optional(),
  city: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(STATUS).default("ACTIVE"),
};

const agents: ResourceDefinition = {
  key: "agents",
  label: "Agent",
  model: Agent,
  autoCode: { field: "agentCode", prefix: "AGNT", entityType: "AGENT" },
  createSchema: z.object(agentFields),
  updateSchema: z.object(agentFields).partial(),
  searchFields: ["name", "agentCode", "phone", "email"],
  filterFields: { agentCode: "agentCode", name: "name", phone: "phone", email: "email", city: "city" },
  sortableFields: ["agentCode", "name", "phone", "commissionPercent", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  permissions: permissionsFor("agents"),
};

// ----------------------------------------------------------- Transporters

const transporterFields = {
  name: z.string().trim().min(2).max(200),
  contactPerson: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  gstin: gstinSchema,
  transporterId: z.string().trim().toUpperCase().max(30).optional(),
  address: addressInput.optional(),
  vehicleTypes: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(STATUS).default("ACTIVE"),
};

const transporters: ResourceDefinition = {
  key: "transporters",
  label: "Transporter",
  model: Transporter,
  autoCode: { field: "transporterCode", prefix: "TRSP", entityType: "TRANSPORTER" },
  createSchema: z.object(transporterFields),
  updateSchema: z.object(transporterFields).partial(),
  searchFields: ["name", "transporterCode", "phone", "email", "transporterId"],
  filterFields: {
    transporterCode: "transporterCode",
    name: "name",
    phone: "phone",
    email: "email",
    gstin: "gstin",
  },
  sortableFields: ["transporterCode", "name", "phone", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  permissions: permissionsFor("transporters"),
};

// ------------------------------------------------------------- Categories

const categoryFields = {
  name: z.string().trim().min(2).max(150),
  parentId: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().max(500).optional(),
  status: z.enum(STATUS).default("ACTIVE"),
};

const categories: ResourceDefinition = {
  key: "categories",
  label: "Category",
  model: Category,
  autoCode: { field: "categoryCode", prefix: "CAT", entityType: "CATEGORY" },
  createSchema: z.object(categoryFields),
  updateSchema: z.object(categoryFields).partial(),
  searchFields: ["name", "categoryCode"],
  filterFields: { categoryCode: "categoryCode", name: "name" },
  sortableFields: ["categoryCode", "name", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
  permissions: permissionsFor("categories"),
  toDocument: documentConverter({ refs: ["parentId"] }),
};

// ----------------------------------------------------------------- Brands

const brandFields = {
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(500).optional(),
  status: z.enum(STATUS).default("ACTIVE"),
};

const brands: ResourceDefinition = {
  key: "brands",
  label: "Brand",
  model: Brand,
  autoCode: { field: "brandCode", prefix: "BRND", entityType: "BRAND" },
  createSchema: z.object(brandFields),
  updateSchema: z.object(brandFields).partial(),
  searchFields: ["name", "brandCode"],
  filterFields: { brandCode: "brandCode", name: "name" },
  sortableFields: ["brandCode", "name", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
  permissions: permissionsFor("brands"),
};

// ------------------------------------------------------------------ Units

const unitFields = {
  unitCode: z.string().trim().toUpperCase().min(1).max(10),
  name: z.string().trim().min(1).max(100),
  decimalPlaces: z.coerce.number().int().min(0).max(4).default(0),
  status: z.enum(STATUS).default("ACTIVE"),
};

const units: ResourceDefinition = {
  key: "units",
  label: "Unit",
  model: Unit,
  createSchema: z.object(unitFields),
  updateSchema: z.object(unitFields).partial(),
  searchFields: ["name", "unitCode"],
  filterFields: { unitCode: "unitCode", name: "name" },
  sortableFields: ["unitCode", "name", "createdAt"],
  defaultSort: "unitCode",
  defaultSortDir: "asc",
  permissions: permissionsFor("units"),
};

// ------------------------------------------------------------------ Items

const itemVariantInput = z.object({
  sku: z.string().trim().toUpperCase().min(1).max(60),
  color: z.string().trim().max(60).optional(),
  size: z.string().trim().toUpperCase().max(20).optional(),
  barcode: z.string().trim().max(60).optional(),
  isActive: z.coerce.boolean().default(true),
});

const itemFields = {
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).optional(),
  itemType: z.enum(ITEM_TYPES).default("FINISHED_GOODS"),
  categoryId: z.string().trim().optional().or(z.literal("")),
  brandId: z.string().trim().optional().or(z.literal("")),
  unitId: z.string().trim().optional().or(z.literal("")),
  hsnCode: z.string().trim().max(15).optional(),
  taxRatePercent: z.coerce.number().min(0).max(100).default(0),
  purchasePrice: moneyStringSchema.default("0"),
  sellingPrice: moneyStringSchema.default("0"),
  costPrice: moneyStringSchema.default("0"),
  minStock: z.coerce.number().min(0).default(0),
  maxStock: z.coerce.number().min(0).default(0),
  reorderLevel: z.coerce.number().min(0).default(0),
  style: z.string().trim().max(100).optional(),
  season: z.string().trim().max(100).optional(),
  collectionName: z.string().trim().max(100).optional(),
  gender: z.enum(GENDERS).default("NA"),
  fabric: z.string().trim().max(100).optional(),
  pattern: z.string().trim().max(100).optional(),
  gsm: z.coerce.number().min(0).max(10000).optional(),
  composition: z.string().trim().max(200).optional(),
  countryOfOrigin: z.string().trim().max(100).optional(),
  hasVariants: z.coerce.boolean().default(false),
  variants: z.array(itemVariantInput).default([]),
  status: z.enum(STATUS).default("ACTIVE"),
};

const items: ResourceDefinition = {
  key: "items",
  label: "Item",
  model: Item,
  autoCode: { field: "itemCode", prefix: "ITEM", entityType: "ITEM" },
  createSchema: z.object(itemFields),
  updateSchema: z.object(itemFields).partial(),
  searchFields: ["name", "itemCode", "style", "hsnCode"],
  filterFields: { itemCode: "itemCode", name: "name", style: "style", hsnCode: "hsnCode" },
  sortableFields: ["itemCode", "name", "sellingPrice", "style", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  permissions: permissionsFor("items"),
  toDocument: documentConverter({
    money: ["purchasePrice", "sellingPrice", "costPrice"],
    refs: ["categoryId", "brandId", "unitId"],
  }),
};

// ------------------------------------------------------------- Warehouses

const warehouseFields = {
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(2).max(150),
  branchId: z.string().trim().min(1),
  address: z.string().trim().max(300).optional(),
  isDefault: z.coerce.boolean().default(false),
  status: z.enum(STATUS).default("ACTIVE"),
};

const warehouses: ResourceDefinition = {
  key: "warehouses",
  label: "Warehouse",
  model: Warehouse,
  createSchema: z.object(warehouseFields),
  updateSchema: z.object(warehouseFields).partial(),
  searchFields: ["name", "code"],
  filterFields: { code: "code", name: "name" },
  sortableFields: ["code", "name", "createdAt"],
  defaultSort: "code",
  defaultSortDir: "asc",
  permissions: permissionsFor("warehouses"),
  toDocument: documentConverter({ refs: ["branchId"] }),
};

// ---------------------------------------------------------------- Branches

const branchFields = {
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(2).max(150),
  address: z.string().trim().max(300).optional(),
  isDefault: z.coerce.boolean().default(false),
  status: z.enum(STATUS).default("ACTIVE"),
};

const branches: ResourceDefinition = {
  key: "branches",
  label: "Branch",
  model: Branch,
  createSchema: z.object(branchFields),
  updateSchema: z.object(branchFields).partial(),
  searchFields: ["name", "code"],
  filterFields: { code: "code", name: "name" },
  sortableFields: ["code", "name", "createdAt"],
  defaultSort: "code",
  defaultSortDir: "asc",
  permissions: permissionsFor("branches"),
};

export const RESOURCES: Record<string, ResourceDefinition> = {
  customers,
  "chart-of-accounts": chartOfAccounts,
  vendors,
  agents,
  transporters,
  categories,
  brands,
  units,
  items,
  warehouses,
  branches,
  ...EXTENDED_RESOURCES,
};

export function getResource(key: string): ResourceDefinition | undefined {
  return RESOURCES[key];
}
