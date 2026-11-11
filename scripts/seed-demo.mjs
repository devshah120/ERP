/**
 * Seeds realistic, interconnected demo data through the app's own HTTP API —
 * not by writing to MongoDB directly. That matters: every record therefore
 * goes through the same validation, numbering, status workflow, stock posting
 * and audit logging as real user input, so the seeded data is genuinely
 * consistent rather than hand-crafted rows that bypass business rules.
 *
 * Usage:  node scripts/seed-demo.mjs [--base http://localhost:3000]
 *         (set SEED_DOMAIN / SEED_EMAIL / SEED_PASSWORD to target another tenant)
 */

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3000";
const DOMAIN = process.env.SEED_DOMAIN ?? "rangoli-textiles";
const EMAIL = process.env.SEED_EMAIL ?? "asha@rangoli.test";
const PASSWORD = process.env.SEED_PASSWORD ?? "Str0ng!Passw0rd";

let cookie = "";

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", cookie, ...(options.headers ?? {}) },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function fail(label, res) {
  console.error(`\n✗ ${label} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 400)}`);
  process.exit(1);
}

async function post(path, payload, label) {
  const res = await call(path, { method: "POST", body: JSON.stringify(payload) });
  if (!res.body?.success) fail(label, res);
  return res.body.data;
}

/** Creates a master only if one with the same name doesn't already exist, so
 *  re-running the seed tops up rather than duplicating. */
async function ensureMaster(resource, payload, matchField = "name") {
  const list = await call(`/api/masters/${resource}?pageSize=200`);
  const existing = list.body?.data?.items?.find((i) => i[matchField] === payload[matchField]);
  if (existing) return existing;
  return post(`/api/masters/${resource}`, payload, `create ${resource}`);
}

async function ensureCustomer(payload) {
  const list = await call("/api/customers?pageSize=200");
  const existing = list.body?.data?.items?.find((c) => c.name === payload.name);
  if (existing) return existing;
  return post("/api/customers", payload, "create customer");
}

async function transition(type, id, toStatus, reason) {
  const res = await call(`/api/documents/${type}/${id}/transition`, {
    method: "POST",
    body: JSON.stringify({ toStatus, reason }),
  });
  if (!res.body?.success) fail(`${type} → ${toStatus}`, res);
  return res.body.data;
}

async function convert(fromType, id, toType, extra = {}) {
  const res = await call(`/api/documents/${fromType}/${id}/convert`, {
    method: "POST",
    body: JSON.stringify({ toType, extra }),
  });
  if (!res.body?.success) fail(`${fromType} → ${toType}`, res);
  return res.body.data;
}

const addr = (line1, city, state = "Gujarat") => ({ line1, city, state, country: "India" });

// ---------------------------------------------------------------- run

console.log(`Seeding demo data into ${BASE} (tenant: ${DOMAIN})\n`);

const login = await call("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ domain: DOMAIN, email: EMAIL, password: PASSWORD }),
});
if (!login.body?.success) fail("login", login);
console.log(`✓ logged in as ${login.body.data.user.email}\n`);

// ---- Masters ------------------------------------------------------------
console.log("Masters");

const branchList = await call("/api/masters/branches?pageSize=10");
const branch = branchList.body.data.items[0];
if (!branch) fail("find default branch", branchList);

const warehouses = [];
for (const w of [
  { code: "WH-MAIN", name: "Main Warehouse", branchId: branch.id, address: "Plot 12, GIDC" },
  { code: "WH-FG", name: "Finished Goods Store", branchId: branch.id, address: "Plot 14, GIDC" },
]) {
  warehouses.push(await ensureMaster("warehouses", w, "code"));
}
console.log(`  ✓ ${warehouses.length} warehouses`);

const units = [];
for (const u of [
  { unitCode: "PCS", name: "Pieces", decimalPlaces: 0 },
  { unitCode: "MTR", name: "Metres", decimalPlaces: 2 },
  { unitCode: "KG", name: "Kilograms", decimalPlaces: 3 },
  { unitCode: "DOZ", name: "Dozen", decimalPlaces: 0 },
]) {
  units.push(await ensureMaster("units", u, "unitCode"));
}
console.log(`  ✓ ${units.length} units`);

const categories = [];
for (const c of [
  { name: "T-Shirts", description: "Knitted tops" },
  { name: "Shirts", description: "Woven formal and casual shirts" },
  { name: "Denim", description: "Jeans and denim wear" },
  { name: "Fabric", description: "Raw fabric rolls" },
]) {
  categories.push(await ensureMaster("categories", c));
}
console.log(`  ✓ ${categories.length} categories`);

const brands = [];
for (const b of [{ name: "Rangoli Basics" }, { name: "Rangoli Premium" }, { name: "UrbanThread" }]) {
  brands.push(await ensureMaster("brands", b));
}
console.log(`  ✓ ${brands.length} brands`);

const customers = [];
for (const c of [
  {
    name: "Blue Horizon Apparel",
    companyName: "Blue Horizon Apparel LLP",
    phone: "9820011221",
    email: "purchase@bluehorizon.example",
    billingAddress: addr("45 Textile Market", "Surat"),
    gstin: "24AABCB1234M1ZZ",
    creditLimit: "500000",
    creditDays: 30,
    paymentTerms: "Net 30",
  },
  {
    name: "Metro Retail Chain",
    companyName: "Metro Retail Pvt Ltd",
    phone: "9930044556",
    email: "buying@metroretail.example",
    billingAddress: addr("Unit 8, Andheri East", "Mumbai", "Maharashtra"),
    gstin: "27AAACM5678N1ZT",
    creditLimit: "1200000",
    creditDays: 45,
    paymentTerms: "Net 45",
  },
  {
    name: "Nirvana Boutique",
    phone: "9845066778",
    email: "hello@nirvanaboutique.example",
    billingAddress: addr("22 MG Road", "Bengaluru", "Karnataka"),
    creditLimit: "150000",
    creditDays: 15,
  },
]) {
  customers.push(await ensureCustomer(c));
}
console.log(`  ✓ ${customers.length} customers`);

const vendors = [];
for (const v of [
  {
    name: "Shree Fabrics",
    companyName: "Shree Fabrics Pvt Ltd",
    phone: "9876500011",
    email: "sales@shreefabrics.example",
    billingAddress: addr("Plot 7, Pandesara", "Surat"),
    gstin: "24AAECS9012P1Z1",
    creditLimit: "800000",
    creditDays: 30,
  },
  {
    name: "Gujarat Trims & Accessories",
    phone: "9876500022",
    email: "orders@gjtrims.example",
    billingAddress: addr("Shed 19, Sachin GIDC", "Surat"),
    creditDays: 21,
  },
]) {
  vendors.push(await ensureMaster("vendors", v));
}
console.log(`  ✓ ${vendors.length} vendors`);

const agents = [];
for (const a of [
  { name: "Ketan Shah", phone: "9812345670", commissionPercent: 2.5, city: "Surat" },
  { name: "Priya Menon", phone: "9812345671", commissionPercent: 3, city: "Mumbai" },
]) {
  agents.push(await ensureMaster("agents", a));
}
console.log(`  ✓ ${agents.length} agents`);

const transporters = [];
for (const t of [
  { name: "Speedway Logistics", phone: "9800011122", gstin: "24AAFCS3456Q1ZU", vehicleTypes: "Truck, Tempo" },
  { name: "Gati Express", phone: "9800011133", vehicleTypes: "Container" },
]) {
  transporters.push(await ensureMaster("transporters", t));
}
console.log(`  ✓ ${transporters.length} transporters`);

const pcs = units.find((u) => u.unitCode === "PCS");
const mtr = units.find((u) => u.unitCode === "MTR");

const items = [];
for (const i of [
  {
    name: "Round Neck T-Shirt",
    categoryId: categories[0].id,
    brandId: brands[0].id,
    unitId: pcs?.id,
    hsnCode: "6109",
    taxRatePercent: 5,
    purchasePrice: "220",
    sellingPrice: "499",
    costPrice: "240",
    style: "RNT-101",
    season: "SS26",
    gender: "MENS",
    fabric: "Cotton Single Jersey",
    gsm: 180,
    composition: "100% Cotton",
    minStock: 50,
    reorderLevel: 100,
    hasVariants: true,
    variants: [
      { sku: "RNT101-BLK-M", color: "Black", size: "M", isActive: true },
      { sku: "RNT101-BLK-L", color: "Black", size: "L", isActive: true },
      { sku: "RNT101-WHT-M", color: "White", size: "M", isActive: true },
      { sku: "RNT101-WHT-L", color: "White", size: "L", isActive: true },
    ],
  },
  {
    name: "Formal Shirt Slim Fit",
    categoryId: categories[1].id,
    brandId: brands[1].id,
    unitId: pcs?.id,
    hsnCode: "6205",
    taxRatePercent: 12,
    purchasePrice: "560",
    sellingPrice: "1299",
    costPrice: "590",
    style: "FSH-220",
    season: "AW26",
    gender: "MENS",
    fabric: "Cotton Poplin",
    gsm: 120,
    minStock: 25,
    reorderLevel: 60,
    hasVariants: true,
    variants: [
      { sku: "FSH220-SKY-39", color: "Sky Blue", size: "39", isActive: true },
      { sku: "FSH220-SKY-40", color: "Sky Blue", size: "40", isActive: true },
    ],
  },
  {
    name: "Slim Fit Denim Jeans",
    categoryId: categories[2].id,
    brandId: brands[2].id,
    unitId: pcs?.id,
    hsnCode: "6203",
    taxRatePercent: 12,
    purchasePrice: "780",
    sellingPrice: "1899",
    costPrice: "820",
    style: "DNM-330",
    gender: "UNISEX",
    fabric: "Denim",
    gsm: 340,
    minStock: 20,
    reorderLevel: 40,
  },
  {
    name: "Cotton Jersey Fabric",
    categoryId: categories[3].id,
    unitId: mtr?.id,
    hsnCode: "6006",
    taxRatePercent: 5,
    purchasePrice: "180",
    sellingPrice: "240",
    costPrice: "185",
    itemType: "RAW_MATERIAL",
    fabric: "Cotton",
    gsm: 180,
    minStock: 500,
    reorderLevel: 1000,
  },
]) {
  items.push(await ensureMaster("items", i));
}
console.log(`  ✓ ${items.length} items (with size/colour variants)\n`);

const mainWarehouse = warehouses[0];

// ---- Purchase cycle -----------------------------------------------------
// Run first so stock exists before anything is sold.
console.log("Purchase cycle");

const po = await post(
  "/api/documents/purchase-orders",
  {
    vendorId: vendors[0].id,
    // Variant-tracked items are always bought per size/colour, so the stock
    // that arrives is the same SKU the sales side later ships.
    lines: [
      { itemId: items[0].id, variantSku: "RNT101-BLK-M", quantity: 120, rate: "220", taxRatePercent: 5 },
      { itemId: items[0].id, variantSku: "RNT101-BLK-L", quantity: 80, rate: "220", taxRatePercent: 5 },
      { itemId: items[0].id, variantSku: "RNT101-WHT-M", quantity: 60, rate: "220", taxRatePercent: 5 },
      { itemId: items[0].id, variantSku: "RNT101-WHT-L", quantity: 90, rate: "220", taxRatePercent: 5 },
      { itemId: items[3].id, quantity: 1500, rate: "180", taxRatePercent: 5 },
    ],
    notes: "Opening stock purchase for SS26",
  },
  "purchase order"
);
await transition("purchase-orders", po.id, "PENDING_APPROVAL");
await transition("purchase-orders", po.id, "CONFIRMED");
console.log(`  ✓ ${po.documentNumber} confirmed (${vendors[0].name})`);

const grn = await convert("purchase-orders", po.id, "goods-receipts", { warehouseId: mainWarehouse.id });
await transition("goods-receipts", grn.id, "CONFIRMED");
await transition("goods-receipts", grn.id, "RECEIVED");
console.log(`  ✓ ${grn.documentNumber} received — stock IN`);

const pinv = await convert("purchase-orders", po.id, "purchase-invoices");
await transition("purchase-invoices", pinv.id, "POSTED");
console.log(`  ✓ ${pinv.documentNumber} posted — payable raised`);

// A second, smaller purchase left mid-flow so the data isn't all "complete".
const po2 = await post(
  "/api/documents/purchase-orders",
  {
    vendorId: vendors[1].id,
    lines: [
      { itemId: items[1].id, variantSku: "FSH220-SKY-39", quantity: 60, rate: "560", taxRatePercent: 12 },
      { itemId: items[1].id, variantSku: "FSH220-SKY-40", quantity: 60, rate: "560", taxRatePercent: 12 },
    ],
    notes: "Trims and shirts top-up",
  },
  "purchase order 2"
);
await transition("purchase-orders", po2.id, "PENDING_APPROVAL");
await transition("purchase-orders", po2.id, "CONFIRMED");
const grn2 = await convert("purchase-orders", po2.id, "goods-receipts", { warehouseId: mainWarehouse.id });
await transition("goods-receipts", grn2.id, "CONFIRMED");
await transition("goods-receipts", grn2.id, "RECEIVED");
console.log(`  ✓ ${po2.documentNumber} → ${grn2.documentNumber} received (awaiting invoice)\n`);

// ---- Sales cycle --------------------------------------------------------
console.log("Sales cycle");

const qtn = await post(
  "/api/documents/sales-quotations",
  {
    customerId: customers[0].id,
    lines: [
      { itemId: items[0].id, variantSku: "RNT101-BLK-M", quantity: 60, rate: "499", discountPercent: 5, taxRatePercent: 5 },
      { itemId: items[0].id, variantSku: "RNT101-WHT-L", quantity: 40, rate: "499", discountPercent: 5, taxRatePercent: 5 },
    ],
    shippingCharge: "750",
    notes: "Bulk order enquiry for summer season",
  },
  "sales quotation"
);
await transition("sales-quotations", qtn.id, "SENT");
await transition("sales-quotations", qtn.id, "APPROVED");
console.log(`  ✓ ${qtn.documentNumber} approved (${customers[0].name})`);

const so = await convert("sales-quotations", qtn.id, "sales-orders");
await transition("sales-orders", so.id, "PENDING_APPROVAL");
await transition("sales-orders", so.id, "CONFIRMED");
console.log(`  ✓ ${so.documentNumber} confirmed`);

const dc = await convert("sales-orders", so.id, "delivery-challans", { warehouseId: mainWarehouse.id });
await transition("delivery-challans", dc.id, "CONFIRMED");
await transition("delivery-challans", dc.id, "DISPATCHED");
await transition("delivery-challans", dc.id, "DELIVERED");
console.log(`  ✓ ${dc.documentNumber} delivered — stock OUT`);

const inv = await convert("sales-orders", so.id, "sales-invoices");
await transition("sales-invoices", inv.id, "POSTED");
console.log(`  ✓ ${inv.documentNumber} posted — receivable raised`);

// A second customer, invoiced directly without a preceding order.
const inv2 = await post(
  "/api/documents/sales-invoices",
  {
    customerId: customers[1].id,
    lines: [{ itemId: items[1].id, variantSku: "FSH220-SKY-40", quantity: 25, rate: "1299", taxRatePercent: 12 }],
    paymentMode: "CREDIT",
    orderType: "REGULAR",
    notes: "Direct invoice — repeat order",
  },
  "direct invoice"
);
await transition("sales-invoices", inv2.id, "POSTED");
console.log(`  ✓ ${inv2.documentNumber} posted (direct, ${customers[1].name})`);

// A third quotation left open, so the pipeline isn't empty.
const qtn2 = await post(
  "/api/documents/sales-quotations",
  {
    customerId: customers[2].id,
    lines: [{ itemId: items[2].id, quantity: 30, rate: "1899", discountPercent: 10, taxRatePercent: 12 }],
    notes: "Awaiting customer confirmation",
  },
  "open quotation"
);
await transition("sales-quotations", qtn2.id, "SENT");
console.log(`  ✓ ${qtn2.documentNumber} sent — open in the pipeline`);

// Return + credit note against the posted invoice, so every sales document
// type has at least one realistic, properly linked entry.
const sret = await convert("sales-invoices", inv.id, "sales-returns", { warehouseId: mainWarehouse.id });
await transition("sales-returns", sret.id, "APPROVED");
await transition("sales-returns", sret.id, "RECEIVED");
console.log(`  ✓ ${sret.documentNumber} received back — stock IN`);

const cnote = await convert("sales-invoices", inv.id, "credit-notes");
await transition("credit-notes", cnote.id, "ISSUED");
console.log(`  ✓ ${cnote.documentNumber} issued\n`);

// ---- Purchase return cycle ---------------------------------------------
console.log("Purchase returns");

const pret = await convert("purchase-invoices", pinv.id, "purchase-returns", { warehouseId: mainWarehouse.id });
await transition("purchase-returns", pret.id, "APPROVED");
await transition("purchase-returns", pret.id, "DISPATCHED");
console.log(`  ✓ ${pret.documentNumber} dispatched to vendor — stock OUT`);

const dnote = await convert("purchase-invoices", pinv.id, "debit-notes");
await transition("debit-notes", dnote.id, "ISSUED");
console.log(`  ✓ ${dnote.documentNumber} issued\n`);

// ---- Settlement ---------------------------------------------------------
// Deliberately partial: the dashboard's whole point is showing the gap
// between what was invoiced and what has actually been collected, and a seed
// where everything is paid would hide exactly the analysis being demonstrated.
console.log("Receipts & payments");

const inv2Detail = await call(`/api/documents/sales-invoices/${inv2.id}`);
const inv2Due = Number(inv2Detail.body?.data?.dueAmount ?? 0);

if (inv2Due > 0) {
  // Part-settle one invoice…
  const partial = Math.round(inv2Due * 0.4);
  const receipt = await post(
    "/api/payments/receipts",
    {
      partyId: customers[1].id,
      amount: partial.toFixed(2),
      mode: "BANK",
      referenceNumber: "NEFT-DEMO-0001",
      notes: "Part payment against invoice",
      allocations: [{ invoiceId: inv2.id, amount: partial.toFixed(2) }],
    },
    "demo receipt"
  );
  console.log(`  ✓ ${receipt.documentNumber} — ${partial.toFixed(2)} received against ${inv2.documentNumber}`);
}

// …and leave an unallocated advance sitting on account.
const advance = await post(
  "/api/payments/receipts",
  {
    partyId: customers[2].id,
    amount: "15000.00",
    mode: "UPI",
    referenceNumber: "UPI-DEMO-ADVANCE",
    notes: "Advance against upcoming order",
    allocations: [],
  },
  "demo advance"
);
console.log(`  ✓ ${advance.documentNumber} — 15000.00 advance, unallocated (sits on account)`);

const pinvDetail = await call(`/api/documents/purchase-invoices/${pinv.id}`);
const pinvDue = Number(pinvDetail.body?.data?.dueAmount ?? 0);
if (pinvDue > 0) {
  const paid = Math.round(pinvDue * 0.5);
  const payment = await post(
    "/api/payments/payments",
    {
      partyId: vendors[0].id,
      amount: paid.toFixed(2),
      mode: "BANK",
      referenceNumber: "RTGS-DEMO-0001",
      allocations: [{ invoiceId: pinv.id, amount: paid.toFixed(2) }],
    },
    "demo payment"
  );
  console.log(`  ✓ ${payment.documentNumber} — ${paid.toFixed(2)} paid against ${pinv.documentNumber}\n`);
}

console.log("Demo data seeded successfully.");
console.log(`  Masters   : ${customers.length} customers, ${vendors.length} vendors, ${items.length} items,`);
console.log(`              ${categories.length} categories, ${brands.length} brands, ${units.length} units,`);
console.log(`              ${agents.length} agents, ${transporters.length} transporters, ${warehouses.length} warehouses`);
console.log("  Sales     : 2 quotations, 1 order, 1 delivery, 2 invoices, 1 return, 1 credit note");
console.log("  Purchase  : 2 orders, 2 receipts, 1 invoice, 1 return, 1 debit note");
console.log("  Settlement: 2 receipts (one part payment, one unallocated advance), 1 supplier payment");
console.log("\nEvery Sales and Purchase document type now has at least one linked demo entry.");
console.log("Open the app and check Reports → Sales Register / Purchase Register / Stock Summary,");
console.log("then the Dashboard and Analysis → Sales for the order → invoice → payment gaps.");
