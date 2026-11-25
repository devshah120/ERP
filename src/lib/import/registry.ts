import type { ImportDefinition } from "./types";

/**
 * Import definitions for the master modules. Each maps spreadsheet columns to
 * the same create payload the API already validates, so an import can never
 * bypass the business rules a manual entry goes through.
 *
 * Transactional documents are deliberately not importable: they move stock and
 * post financial effects through a status workflow, which a bulk spreadsheet
 * upload cannot express safely.
 */
export const IMPORTS: Record<string, ImportDefinition> = {
  customers: {
    resource: "customers",
    title: "Customers",
    duplicateKey: { path: "name", header: "Customer Name" },
    fields: [
      { header: "Customer Name", path: "name", required: true, example: "Blue Horizon Apparel" },
      { header: "Company Name", path: "companyName", example: "Blue Horizon Apparel LLP" },
      { header: "Contact Person", path: "contactPerson", example: "Rahul Mehta" },
      { header: "Phone", path: "phone", required: true, example: "9820011221" },
      { header: "Alternate Phone", path: "alternatePhone", example: "" },
      { header: "Email", path: "email", example: "purchase@bluehorizon.example" },
      { header: "GSTIN", path: "gstin", hint: "15 characters; validated including check digit", example: "24AABCB1234M1ZZ" },
      { header: "Address Line 1", path: "billingAddress.line1", required: true, example: "45 Textile Market" },
      { header: "Address Line 2", path: "billingAddress.line2", example: "" },
      { header: "City", path: "billingAddress.city", required: true, example: "Surat" },
      { header: "State", path: "billingAddress.state", required: true, hint: "Must match a GST state, e.g. Gujarat", example: "Gujarat" },
      { header: "Country", path: "billingAddress.country", required: true, example: "India" },
      { header: "Postal Code", path: "billingAddress.postalCode", example: "395002" },
      { header: "Credit Limit", path: "creditLimit", type: "money", example: "500000" },
      { header: "Credit Days", path: "creditDays", type: "number", example: "30" },
      { header: "Payment Terms", path: "paymentTerms", example: "Net 30" },
    ],
  },

  vendors: {
    resource: "vendors",
    title: "Vendors",
    duplicateKey: { path: "name", header: "Vendor Name" },
    fields: [
      { header: "Vendor Name", path: "name", required: true, example: "Shree Fabrics" },
      { header: "Company Name", path: "companyName", example: "Shree Fabrics Pvt Ltd" },
      { header: "Contact Person", path: "contactPerson", example: "Nitin Patel" },
      { header: "Phone", path: "phone", required: true, example: "9876500011" },
      { header: "Email", path: "email", example: "sales@shreefabrics.example" },
      { header: "GSTIN", path: "gstin", hint: "15 characters; validated including check digit", example: "24AAECS9012P1Z1" },
      { header: "PAN", path: "panNumber", example: "AAECS9012P" },
      { header: "Address Line 1", path: "billingAddress.line1", required: true, example: "Plot 7, Pandesara" },
      { header: "City", path: "billingAddress.city", required: true, example: "Surat" },
      { header: "State", path: "billingAddress.state", required: true, example: "Gujarat" },
      { header: "Country", path: "billingAddress.country", required: true, example: "India" },
      { header: "Credit Limit", path: "creditLimit", type: "money", example: "800000" },
      { header: "Credit Days", path: "creditDays", type: "number", example: "30" },
    ],
  },

  items: {
    resource: "items",
    title: "Items",
    duplicateKey: { path: "name", header: "Item Name" },
    fields: [
      { header: "Item Name", path: "name", required: true, example: "Round Neck T-Shirt" },
      { header: "Description", path: "description", example: "Cotton single jersey tee" },
      {
        header: "Item Type",
        path: "itemType",
        hint: "FINISHED_GOODS, RAW_MATERIAL, CONSUMABLE or SERVICE",
        example: "FINISHED_GOODS",
      },
      {
        header: "Category",
        path: "categoryId",
        hint: "Category name as it appears in the Categories master",
        example: "T-Shirts",
        lookup: { resource: "categories", matchField: "name", label: "Category" },
      },
      {
        header: "Brand",
        path: "brandId",
        hint: "Brand name as it appears in the Brands master",
        example: "Rangoli Basics",
        lookup: { resource: "brands", matchField: "name", label: "Brand" },
      },
      {
        header: "Unit",
        path: "unitId",
        hint: "Unit name, e.g. Pieces",
        example: "Pieces",
        lookup: { resource: "units", matchField: "name", label: "Unit" },
      },
      { header: "HSN Code", path: "hsnCode", example: "6109" },
      { header: "GST Rate %", path: "taxRatePercent", type: "number", example: "5" },
      { header: "Purchase Price", path: "purchasePrice", type: "money", example: "220" },
      { header: "Selling Price", path: "sellingPrice", type: "money", example: "499" },
      { header: "Cost Price", path: "costPrice", type: "money", example: "240" },
      { header: "Minimum Stock", path: "minStock", type: "number", example: "50" },
      { header: "Reorder Level", path: "reorderLevel", type: "number", example: "100" },
      { header: "Style", path: "style", example: "RNT-101" },
      { header: "Season", path: "season", example: "SS26" },
      { header: "Gender", path: "gender", hint: "MENS, WOMENS, UNISEX, BOYS, GIRLS or NA", example: "MENS" },
      { header: "Fabric", path: "fabric", example: "Cotton Single Jersey" },
      { header: "GSM", path: "gsm", type: "number", example: "180" },
      { header: "Composition", path: "composition", example: "100% Cotton" },
    ],
  },

  categories: {
    resource: "categories",
    title: "Categories",
    duplicateKey: { path: "name", header: "Category Name" },
    fields: [
      { header: "Category Name", path: "name", required: true, example: "T-Shirts" },
      { header: "Description", path: "description", example: "Knitted tops" },
    ],
  },

  brands: {
    resource: "brands",
    title: "Brands",
    duplicateKey: { path: "name", header: "Brand Name" },
    fields: [
      { header: "Brand Name", path: "name", required: true, example: "Rangoli Basics" },
      { header: "Description", path: "description", example: "House brand" },
    ],
  },

  units: {
    resource: "units",
    title: "Units",
    duplicateKey: { path: "unitCode", header: "Unit Code" },
    fields: [
      { header: "Unit Code", path: "unitCode", required: true, example: "PCS" },
      { header: "Unit Name", path: "name", required: true, example: "Pieces" },
      { header: "Decimal Places", path: "decimalPlaces", type: "number", hint: "0 for pieces, 2-3 for metres/kg", example: "0" },
    ],
  },

  agents: {
    resource: "agents",
    title: "Agents",
    duplicateKey: { path: "name", header: "Agent Name" },
    fields: [
      { header: "Agent Name", path: "name", required: true, example: "Ketan Shah" },
      { header: "Phone", path: "phone", required: true, example: "9812345670" },
      { header: "Email", path: "email", example: "ketan@example.com" },
      { header: "Commission %", path: "commissionPercent", type: "number", example: "2.5" },
      { header: "City", path: "city", example: "Surat" },
    ],
  },

  transporters: {
    resource: "transporters",
    title: "Transporters",
    duplicateKey: { path: "name", header: "Transporter Name" },
    fields: [
      { header: "Transporter Name", path: "name", required: true, example: "Speedway Logistics" },
      { header: "Contact Person", path: "contactPerson", example: "Imran Shaikh" },
      { header: "Phone", path: "phone", required: true, example: "9800011122" },
      { header: "Email", path: "email", example: "ops@speedway.example" },
      { header: "GSTIN", path: "gstin", example: "24AAFCS3456Q1ZU" },
      { header: "Vehicle Types", path: "vehicleTypes", example: "Truck, Tempo" },
    ],
  },
};

/** Contract labour (HRMS). */
IMPORTS["hr-contractors"] = {
  resource: "hr-contractors",
  title: "Contractors",
  duplicateKey: { path: "name", header: "Contractor Name" },
  fields: [
    { header: "Contractor Name", path: "name", required: true, example: "Ramesh Patel" },
    { header: "Contractor Code", path: "contractorCode", hint: "Leave blank to number automatically", example: "" },
    { header: "Firm Name", path: "firmName", example: "Patel Labour Services" },
    { header: "Mobile", path: "phone", example: "9825012345" },
    { header: "Email", path: "email", example: "ramesh@example.com" },
    { header: "Emergency Contact", path: "emergencyContactName", example: "Kiran Patel" },
    { header: "Emergency Phone", path: "emergencyContactPhone", example: "9825098765" },
    { header: "Address", path: "currentAddress", example: "12 Udhna Road, Surat" },
    {
      header: "Works Under",
      path: "parentContractorId",
      hint: "Code or name of the main contractor (must already exist); blank if engaged directly",
      example: "",
      lookup: { resource: "hr-contractors", matchField: ["contractorCode", "name"], label: "Contractor" },
    },
    { header: "Work Location", path: "workLocation", example: "Unit 2, Sachin GIDC" },
    { header: "Contract From", path: "contractStartDate", hint: "yyyy-mm-dd", example: "2026-04-01" },
    { header: "Contract To", path: "contractEndDate", hint: "yyyy-mm-dd", example: "2027-03-31" },
    { header: "Labour Licence No", path: "labourLicenceNumber", example: "CLRA/SRT/2026/114" },
    { header: "Licence Valid Until", path: "licenceValidUpto", hint: "yyyy-mm-dd", example: "2027-03-31" },
    { header: "Workers Allowed", path: "maxWorkers", type: "number", hint: "0 = no limit", example: "50" },
    { header: "PAN", path: "panNumber", example: "ABCPP1234K" },
    { header: "GSTIN", path: "gstin", example: "" },
    { header: "Bank Name", path: "bankName", example: "HDFC Bank" },
    { header: "Account Number", path: "bankAccountNumber", example: "50100123456789" },
    { header: "IFSC", path: "ifscCode", example: "HDFC0001234" },
    { header: "Day Wage", path: "defaultDailyWage", type: "money", example: "550" },
    { header: "Overtime Paid At", path: "overtimeRateType", hint: "MULTIPLIER (× hourly wage) or FIXED (rate per hour)", example: "MULTIPLIER" },
    { header: "Overtime Multiple", path: "overtimeMultiplier", type: "number", hint: "2 = double rate", example: "2" },
    { header: "Overtime Rate Per Hour", path: "overtimeRatePerHour", type: "money", hint: "Used when Overtime Paid At is FIXED", example: "" },
  ],
};

IMPORTS["hr-contract-workers"] = {
  resource: "hr-contract-workers",
  title: "Contract Workers",
  duplicateKey: { path: "phone", header: "Mobile Number" },
  fields: [
    { header: "Name", path: "name", required: true, example: "Suresh Kumar" },
    { header: "Mobile Number", path: "phone", required: true, example: "9898012345" },
    { header: "Emergency Number", path: "emergencyPhone", example: "9898054321" },
    {
      header: "Contractors",
      path: "contractorIds",
      required: true,
      hint: "Code or name of each contractor the worker works under, separated by commas, e.g. CON-000001, CON-000003",
      example: "CON-000001",
      lookup: { resource: "hr-contractors", matchField: ["contractorCode", "name"], label: "Contractor", multiple: true },
    },
    { header: "Worker Code", path: "workerCode", hint: "Leave blank to number automatically", example: "" },
    { header: "Gender", path: "gender", hint: "MALE, FEMALE or OTHER", example: "MALE" },
    { header: "Aadhaar", path: "aadhaarNumber", hint: "12 digits", example: "" },
    { header: "Skill Category", path: "skillCategory", hint: "UNSKILLED, SEMI_SKILLED, SKILLED or HIGHLY_SKILLED", example: "SKILLED" },
    { header: "Date of Joining", path: "dateOfJoining", hint: "yyyy-mm-dd", example: "2026-11-01" },
    { header: "Day Wage", path: "dailyWage", type: "money", hint: "Blank or 0 = the contractor's day wage", example: "" },
    { header: "Overtime Rate Per Hour", path: "overtimeRatePerHour", type: "money", hint: "Blank or 0 = the contractor's overtime terms", example: "" },
  ],
};

export function getImportDefinition(resource: string): ImportDefinition | undefined {
  return IMPORTS[resource];
}

export function listImportable() {
  return Object.values(IMPORTS).map((i) => ({ resource: i.resource, title: i.title }));
}
