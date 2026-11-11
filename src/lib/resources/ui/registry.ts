import type { ResourceUi, SectionConfig } from "./types";
import { EXTENDED_RESOURCE_UI } from "./extendedRegistry";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

function addressSection(prefix: string, label = "Address"): SectionConfig {
  return {
    label,
    fields: [
      { name: `${prefix}.line1`, label: "Address line 1", type: "text", required: true, fullWidth: true },
      { name: `${prefix}.line2`, label: "Address line 2", type: "text", hint: "Optional", fullWidth: true },
      { name: `${prefix}.city`, label: "City", type: "text", required: true },
      { name: `${prefix}.state`, label: "State", type: "text", required: true },
      { name: `${prefix}.country`, label: "Country", type: "text", required: true, defaultValue: "India" },
      { name: `${prefix}.postalCode`, label: "Postal code", type: "text", hint: "Optional" },
    ],
  };
}

/**
 * List config for the customer module.
 *
 * Only the listing is generic — creating and editing a customer still goes
 * through the bespoke CustomerForm, which carries fields (shipping address,
 * salesperson, customer group) the generic form builder does not model. The
 * static `/customers/new` and `/customers/[id]` routes take precedence over
 * the `[resource]` segment, so that form stays in place.
 */
const customers: ResourceUi = {
  key: "customers",
  title: "Customers",
  singular: "Customer",
  apiPath: "/api/masters/customers",
  basePath: "/customers",
  columns: [
    { key: "customerCode", label: "Code", filterParam: "customerCode", sortField: "customerCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "companyName", label: "Company", filterParam: "companyName", sortField: "companyName" },
    { key: "billingAddress.city", label: "City", filterParam: "city" },
    { key: "phone", label: "Phone", filterParam: "phone", sortField: "phone" },
    { key: "email", label: "Email", filterParam: "email", sortField: "email" },
    { key: "gstin", label: "GSTIN" },
    { key: "creditDays", label: "Credit Days", type: "number" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [],
};

const chartOfAccounts: ResourceUi = {
  key: "chart-of-accounts",
  title: "Chart of Accounts",
  singular: "Account",
  apiPath: "/api/masters/chart-of-accounts",
  basePath: "/chart-of-accounts",
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Account Name", filterParam: "name", sortField: "name" },
    { key: "type", label: "Type", filterParam: "type", sortField: "type" },
    { key: "systemRole", label: "System Role" },
    { key: "openingBalance", label: "Opening Balance", type: "money" },
    { key: "openingBalanceType", label: "Dr/Cr" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Account details",
      fields: [
        { name: "code", label: "Account code", type: "text", required: true, hint: "e.g. 5150" },
        { name: "name", label: "Account name", type: "text", required: true },
        {
          name: "type",
          label: "Account type",
          type: "select",
          required: true,
          defaultValue: "EXPENSE",
          options: [
            { value: "ASSET", label: "Asset" },
            { value: "LIABILITY", label: "Liability" },
            { value: "EQUITY", label: "Equity" },
            { value: "INCOME", label: "Income" },
            { value: "EXPENSE", label: "Expense" },
          ],
        },
        {
          name: "parentId",
          label: "Under group",
          type: "reference",
          reference: { resource: "chart-of-accounts", labelField: "name" },
          hint: "Optional — groups this account under a heading",
        },
        {
          name: "isGroup",
          label: "This is a group heading",
          type: "checkbox",
          hint: "Group headings cannot be posted to directly",
        },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
    {
      label: "Opening balance",
      fields: [
        { name: "openingBalance", label: "Opening balance", type: "money", defaultValue: "0" },
        {
          name: "openingBalanceType",
          label: "Debit or credit",
          type: "select",
          defaultValue: "DEBIT",
          options: [
            { value: "DEBIT", label: "Debit" },
            { value: "CREDIT", label: "Credit" },
          ],
        },
      ],
    },
  ],
};

const vendors: ResourceUi = {
  key: "vendors",
  title: "Vendors",
  singular: "Vendor",
  apiPath: "/api/masters/vendors",
  basePath: "/vendors",
  columns: [
    { key: "vendorCode", label: "Code", filterParam: "vendorCode", sortField: "vendorCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "companyName", label: "Company", filterParam: "companyName", sortField: "companyName" },
    { key: "billingAddress.city", label: "City", filterParam: "city" },
    { key: "phone", label: "Phone", filterParam: "phone", sortField: "phone" },
    { key: "email", label: "Email", filterParam: "email", sortField: "email" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Basic details",
      fields: [
        { name: "name", label: "Vendor name", type: "text", required: true },
        { name: "companyName", label: "Company name", type: "text", hint: "Optional" },
        { name: "contactPerson", label: "Contact person", type: "text", hint: "Optional" },
        { name: "phone", label: "Phone", type: "tel", required: true },
        { name: "alternatePhone", label: "Alternate phone", type: "tel", hint: "Optional" },
        { name: "email", label: "Email", type: "email", hint: "Optional" },
        { name: "gstin", label: "GSTIN", type: "text", hint: "Optional" },
        { name: "panNumber", label: "PAN", type: "text", hint: "Optional" },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
      ],
    },
    addressSection("billingAddress", "Billing address"),
    {
      label: "Commercial terms",
      fields: [
        { name: "creditLimit", label: "Credit limit", type: "money", defaultValue: "0" },
        { name: "creditDays", label: "Credit days", type: "number", defaultValue: 0 },
        { name: "paymentTerms", label: "Payment terms", type: "text", placeholder: "Net 30", hint: "Optional" },
        { name: "currency", label: "Currency", type: "text", defaultValue: "INR" },
        { name: "vendorGroup", label: "Vendor group", type: "text", hint: "Optional" },
        { name: "openingBalance", label: "Opening balance", type: "money", defaultValue: "0" },
        {
          name: "openingBalanceType",
          label: "Opening balance type",
          type: "select",
          defaultValue: "CREDIT",
          options: [
            { value: "CREDIT", label: "Credit (we owe vendor)" },
            { value: "DEBIT", label: "Debit (vendor owes us)" },
          ],
        },
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
};

const agents: ResourceUi = {
  key: "agents",
  title: "Agents",
  singular: "Agent",
  apiPath: "/api/masters/agents",
  basePath: "/agents",
  columns: [
    { key: "agentCode", label: "Code", filterParam: "agentCode", sortField: "agentCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "phone", label: "Phone", filterParam: "phone", sortField: "phone" },
    { key: "email", label: "Email", filterParam: "email" },
    { key: "city", label: "City", filterParam: "city" },
    { key: "commissionPercent", label: "Commission %", type: "number", sortField: "commissionPercent" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Agent details",
      fields: [
        { name: "name", label: "Agent name", type: "text", required: true },
        { name: "phone", label: "Phone", type: "tel", required: true },
        { name: "email", label: "Email", type: "email", hint: "Optional" },
        { name: "commissionPercent", label: "Commission %", type: "number", defaultValue: 0 },
        { name: "panNumber", label: "PAN", type: "text", hint: "Optional" },
        { name: "city", label: "City", type: "text", hint: "Optional" },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
};

const transporters: ResourceUi = {
  key: "transporters",
  title: "Transporters",
  singular: "Transporter",
  apiPath: "/api/masters/transporters",
  basePath: "/transporters",
  columns: [
    { key: "transporterCode", label: "Code", filterParam: "transporterCode", sortField: "transporterCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "phone", label: "Phone", filterParam: "phone", sortField: "phone" },
    { key: "email", label: "Email", filterParam: "email" },
    { key: "gstin", label: "GSTIN", filterParam: "gstin" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Transporter details",
      fields: [
        { name: "name", label: "Transporter name", type: "text", required: true },
        { name: "contactPerson", label: "Contact person", type: "text", hint: "Optional" },
        { name: "phone", label: "Phone", type: "tel", required: true },
        { name: "email", label: "Email", type: "email", hint: "Optional" },
        { name: "gstin", label: "GSTIN", type: "text", hint: "Optional" },
        { name: "transporterId", label: "Transporter ID", type: "text", hint: "For e-way bills" },
        { name: "vehicleTypes", label: "Vehicle types", type: "text", hint: "Optional" },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
};

const categories: ResourceUi = {
  key: "categories",
  title: "Categories",
  singular: "Category",
  apiPath: "/api/masters/categories",
  basePath: "/categories",
  columns: [
    { key: "categoryCode", label: "Code", filterParam: "categoryCode", sortField: "categoryCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "description", label: "Description" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Category details",
      fields: [
        { name: "name", label: "Category name", type: "text", required: true },
        {
          name: "parentId",
          label: "Parent category",
          type: "reference",
          reference: { resource: "categories", labelField: "name" },
          hint: "Optional — leave blank for a top-level category",
        },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
};

const brands: ResourceUi = {
  key: "brands",
  title: "Brands",
  singular: "Brand",
  apiPath: "/api/masters/brands",
  basePath: "/brands",
  columns: [
    { key: "brandCode", label: "Code", filterParam: "brandCode", sortField: "brandCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "description", label: "Description" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Brand details",
      fields: [
        { name: "name", label: "Brand name", type: "text", required: true },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
};

const units: ResourceUi = {
  key: "units",
  title: "Units",
  singular: "Unit",
  apiPath: "/api/masters/units",
  basePath: "/units",
  columns: [
    { key: "unitCode", label: "Code", filterParam: "unitCode", sortField: "unitCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "decimalPlaces", label: "Decimals", type: "number" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Unit details",
      fields: [
        { name: "unitCode", label: "Unit code", type: "text", required: true, placeholder: "PCS" },
        { name: "name", label: "Unit name", type: "text", required: true, placeholder: "Pieces" },
        { name: "decimalPlaces", label: "Decimal places", type: "number", defaultValue: 0, hint: "0 for pieces, 2-3 for metres/kg" },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
      ],
    },
  ],
};

const items: ResourceUi = {
  key: "items",
  title: "Items",
  singular: "Item",
  apiPath: "/api/masters/items",
  basePath: "/items",
  settingsDefaults: {
    section: "items",
    map: {
      itemType: "defaultItemType",
      taxRatePercent: "defaultTaxRatePercent",
      reorderLevel: "defaultReorderLevel",
      gender: "defaultGender",
      countryOfOrigin: "defaultCountryOfOrigin",
    },
  },
  columns: [
    { key: "itemCode", label: "Code", filterParam: "itemCode", sortField: "itemCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "style", label: "Style", filterParam: "style", sortField: "style" },
    { key: "hsnCode", label: "HSN", filterParam: "hsnCode" },
    { key: "sellingPrice", label: "Selling price", type: "money", sortField: "sellingPrice" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Basic details",
      fields: [
        { name: "name", label: "Item name", type: "text", required: true },
        {
          name: "itemType",
          label: "Item type",
          type: "select",
          defaultValue: "FINISHED_GOODS",
          options: [
            { value: "FINISHED_GOODS", label: "Finished goods" },
            { value: "RAW_MATERIAL", label: "Raw material" },
            { value: "CONSUMABLE", label: "Consumable" },
            { value: "SERVICE", label: "Service" },
          ],
        },
        {
          name: "categoryId",
          label: "Category",
          type: "reference",
          reference: { resource: "categories", labelField: "name" },
          hint: "Optional",
        },
        {
          name: "brandId",
          label: "Brand",
          type: "reference",
          reference: { resource: "brands", labelField: "name" },
          hint: "Optional",
        },
        {
          name: "unitId",
          label: "Unit",
          type: "reference",
          reference: { resource: "units", labelField: "name" },
          hint: "Optional",
        },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
    {
      label: "Pricing & tax",
      fields: [
        { name: "hsnCode", label: "HSN / SAC code", type: "text", hint: "Optional" },
        { name: "taxRatePercent", label: "GST rate %", type: "number", defaultValue: 0 },
        { name: "purchasePrice", label: "Purchase price", type: "money", defaultValue: "0" },
        { name: "sellingPrice", label: "Selling price", type: "money", defaultValue: "0" },
        { name: "costPrice", label: "Cost price", type: "money", defaultValue: "0" },
      ],
    },
    {
      label: "Stock levels",
      fields: [
        { name: "minStock", label: "Minimum stock", type: "number", defaultValue: 0 },
        { name: "maxStock", label: "Maximum stock", type: "number", defaultValue: 0 },
        { name: "reorderLevel", label: "Reorder level", type: "number", defaultValue: 0 },
      ],
    },
    {
      label: "Garment attributes",
      fields: [
        { name: "style", label: "Style", type: "text", hint: "Optional" },
        { name: "season", label: "Season", type: "text", hint: "Optional" },
        { name: "collectionName", label: "Collection", type: "text", hint: "Optional" },
        {
          name: "gender",
          label: "Gender",
          type: "select",
          defaultValue: "NA",
          options: [
            { value: "NA", label: "Not applicable" },
            { value: "MENS", label: "Mens" },
            { value: "WOMENS", label: "Womens" },
            { value: "UNISEX", label: "Unisex" },
            { value: "BOYS", label: "Boys" },
            { value: "GIRLS", label: "Girls" },
          ],
        },
        { name: "fabric", label: "Fabric", type: "text", hint: "Optional" },
        { name: "pattern", label: "Pattern", type: "text", hint: "Optional" },
        { name: "gsm", label: "GSM", type: "number", hint: "Optional" },
        { name: "composition", label: "Composition", type: "text", hint: "e.g. 60% Cotton 40% Polyester" },
        { name: "countryOfOrigin", label: "Country of origin", type: "text", hint: "Optional" },
      ],
    },
    {
      label: "Size / colour variants",
      fields: [
        { name: "hasVariants", label: "This item has size/colour variants", type: "checkbox", fullWidth: true },
        { name: "variants", label: "Variants", type: "variants", fullWidth: true },
      ],
    },
  ],
};

const warehouses: ResourceUi = {
  key: "warehouses",
  title: "Warehouses",
  singular: "Warehouse",
  apiPath: "/api/masters/warehouses",
  basePath: "/warehouses",
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "address", label: "Address" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Warehouse details",
      fields: [
        { name: "code", label: "Warehouse code", type: "text", required: true },
        { name: "name", label: "Warehouse name", type: "text", required: true },
        {
          name: "branchId",
          label: "Branch",
          type: "reference",
          reference: { resource: "branches", labelField: "name" },
          required: true,
        },
        { name: "isDefault", label: "Default warehouse", type: "checkbox" },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "address", label: "Address", type: "textarea", fullWidth: true },
      ],
    },
  ],
};

const branches: ResourceUi = {
  key: "branches",
  title: "Branches",
  singular: "Branch",
  apiPath: "/api/masters/branches",
  basePath: "/branches",
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "address", label: "Address" },
    { key: "status", label: "Status", type: "badge" },
  ],
  sections: [
    {
      label: "Branch details",
      fields: [
        { name: "code", label: "Branch code", type: "text", required: true },
        { name: "name", label: "Branch name", type: "text", required: true },
        { name: "isDefault", label: "Default branch", type: "checkbox" },
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" },
        { name: "address", label: "Address", type: "textarea", fullWidth: true },
      ],
    },
  ],
};

export const RESOURCE_UI: Record<string, ResourceUi> = {
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
  ...EXTENDED_RESOURCE_UI,
};

export function getResourceUi(key: string): ResourceUi | undefined {
  return RESOURCE_UI[key];
}
