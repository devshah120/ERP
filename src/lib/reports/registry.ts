import Decimal from "decimal.js";
import { SalesInvoice } from "@/models/salesDocuments";
import { PurchaseInvoice } from "@/models/purchaseDocuments";
import { StockBalance, InventoryTransaction } from "@/models/inventory";
import { Item } from "@/models/Item";
import { Warehouse } from "@/models/Warehouse";
import { Customer } from "@/models/Customer";
import { Vendor } from "@/models/Vendor";
import { Category } from "@/models/Category";
import { Brand } from "@/models/Brand";
import { escapeRegex, money, dateFilter } from "./helpers";
import { unitValuation } from "@/lib/inventory/valuation";
import { trialBalance, generalLedger, profitAndLoss } from "@/lib/accounting/ledgerReports";
import { bankTransactions, cashFlow, ownerCashFlow, managerCashFlow, targetVsActual } from "./financeReports";
import type { ReportColumnDef, ReportDefinition, ReportContext, ReportQuery, ReportRunResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/* ------------------------------------------------------------------ */
/* Invoice registers (header level)                                    */
/* ------------------------------------------------------------------ */

function invoiceRegisterColumns(partyLabel: string): ReportColumnDef[] {
  return [
    { key: "documentNumber", label: "Invoice No", type: "link" },
    { key: "documentDate", label: "Invoice Date", type: "date" },
    { key: "createdAt", label: "Created Date", type: "datetime", defaultVisible: false },
    { key: "partyName", label: `${partyLabel} Name`, type: "link" },
    { key: "partyCode", label: `${partyLabel} Code`, defaultVisible: false },
    { key: "partyGstin", label: "GSTIN", defaultVisible: false },
    { key: "placeOfSupply", label: "Place of Supply" },
    { key: "supplyType", label: "Supply Type", defaultVisible: false },
    { key: "paymentMode", label: "Payment Mode", defaultVisible: false },
    { key: "paymentTerms", label: "Payment Terms", defaultVisible: false },
    { key: "dueDate", label: "Due Date", type: "date", defaultVisible: false },
    { key: "taxableAmount", label: "Taxable", type: "money", total: true },
    { key: "cgstAmount", label: "CGST", type: "money", total: true },
    { key: "sgstAmount", label: "SGST/UTGST", type: "money", total: true },
    { key: "igstAmount", label: "IGST", type: "money", total: true },
    { key: "totalTax", label: "Total GST", type: "money", total: true },
    { key: "shippingCharge", label: "Shipping", type: "money", total: true, defaultVisible: false },
    { key: "roundOff", label: "Round Off", type: "money", defaultVisible: false },
    { key: "grandTotal", label: "Grand Total", type: "money", total: true },
    { key: "paidAmount", label: "Paid", type: "money", total: true, defaultVisible: false },
    { key: "dueAmount", label: "Due", type: "money", total: true },
    { key: "paymentStatus", label: "Payment Status", type: "status" },
    { key: "status", label: "Status", type: "status" },
  ];
}

async function invoiceRegister(
  ctx: ReportContext,
  query: ReportQuery,
  side: "sales" | "purchase"
): Promise<ReportRunResult> {
  const isSales = side === "sales";
  const model = isSales ? SalesInvoice : PurchaseInvoice;
  const partyField = isSales ? "customer" : "vendor";
  const partyIdField = isSales ? "customerId" : "vendorId";
  const docBase = isSales ? "/sales-invoices" : "/purchase-invoices";
  const partyBase = isSales ? "/customers" : "/vendors";

  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  const range = dateFilter(query);
  if (range) filter.documentDate = range;
  // Cancelled invoices carry no financial effect and would distort totals.
  filter.status = query.status ? query.status : { $ne: "CANCELLED" };
  if (query.partyName) {
    filter[`${partyField}.name`] = { $regex: escapeRegex(query.partyName), $options: "i" };
  }

  const skip = (query.page - 1) * query.pageSize;
  const [docs, total, agg] = await Promise.all([
    model.find(filter).sort({ documentDate: -1 }).skip(skip).limit(query.pageSize).lean(),
    model.countDocuments(filter),
    model.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          taxable: { $sum: "$totals.taxableAmount" },
          cgst: { $sum: "$totals.cgstAmount" },
          sgst: { $sum: "$totals.sgstAmount" },
          igst: { $sum: "$totals.igstAmount" },
          grand: { $sum: "$totals.grandTotal" },
          due: { $sum: "$dueAmount" },
        },
      },
    ]),
  ]);

  const a = agg[0] ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0, grand: 0, due: 0 };

  return {
    total,
    summary: [
      { label: "Invoices", value: String(total) },
      { label: "Taxable value", value: money(a.taxable) },
      { label: "CGST", value: money(a.cgst) },
      { label: "SGST/UTGST", value: money(a.sgst) },
      { label: "IGST", value: money(a.igst) },
      { label: "Grand total", value: money(a.grand) },
      { label: "Outstanding", value: money(a.due) },
    ],
    rows: docs.map((d: AnyDoc) => ({
      documentNumber: d.documentNumber,
      documentNumberHref: `${docBase}/${d._id.toString()}`,
      documentDate: d.documentDate?.toISOString(),
      createdAt: d.createdAt?.toISOString(),
      partyName: d[partyField]?.name ?? "—",
      partyNameHref: d[partyIdField] ? `${partyBase}/${d[partyIdField].toString()}` : undefined,
      partyCode: d[partyField]?.code ?? "—",
      partyGstin: d[partyField]?.gstin ?? "—",
      placeOfSupply: d.placeOfSupplyName ? `${d.placeOfSupplyName} (${d.placeOfSupplyCode})` : "—",
      supplyType: d.supplyType === "INTER_STATE" ? "Inter-state" : "Intra-state",
      paymentMode: d.paymentMode ?? "—",
      paymentTerms: d.paymentTerms ?? "—",
      dueDate: d.dueDate?.toISOString(),
      taxableAmount: money(d.totals?.taxableAmount),
      cgstAmount: money(d.totals?.cgstAmount),
      sgstAmount: money(d.totals?.sgstAmount),
      igstAmount: money(d.totals?.igstAmount),
      totalTax: money(d.totals?.totalTax),
      shippingCharge: money(d.totals?.shippingCharge),
      roundOff: money(d.totals?.roundOff),
      grandTotal: money(d.totals?.grandTotal),
      paidAmount: money(d.paidAmount),
      dueAmount: money(d.dueAmount),
      paymentStatus: d.paymentStatus ?? "UNPAID",
      status: d.status,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Invoice detail (line level)                                         */
/* ------------------------------------------------------------------ */

function invoiceDetailColumns(partyLabel: string): ReportColumnDef[] {
  return [
    { key: "documentNumber", label: "Invoice No", type: "link" },
    { key: "documentDate", label: "Invoice Date", type: "date" },
    { key: "partyName", label: `${partyLabel} Name`, type: "link" },
    { key: "itemCode", label: "Item Code", defaultVisible: false },
    { key: "itemName", label: "Product Name", type: "link" },
    { key: "variantSku", label: "Variant", defaultVisible: false },
    { key: "hsnCode", label: "HSN", defaultVisible: false },
    { key: "quantity", label: "Quantity", type: "number", total: true },
    { key: "unitName", label: "Unit", defaultVisible: false },
    { key: "rate", label: "Rate", type: "money" },
    { key: "discountPercent", label: "Disc %", type: "number", defaultVisible: false },
    { key: "discountAmount", label: "Discount", type: "money", total: true },
    { key: "taxableAmount", label: "Taxable Amount", type: "money", total: true },
    { key: "taxRatePercent", label: "GST %", type: "number", defaultVisible: false },
    { key: "cgstAmount", label: "CGST", type: "money", total: true, defaultVisible: false },
    { key: "sgstAmount", label: "SGST/UTGST", type: "money", total: true, defaultVisible: false },
    { key: "igstAmount", label: "IGST", type: "money", total: true, defaultVisible: false },
    { key: "taxAmount", label: "Tax Amount", type: "money", total: true },
    { key: "lineTotal", label: "Line Total", type: "money", total: true },
    { key: "status", label: "Status", type: "status", defaultVisible: false },
  ];
}

async function invoiceDetail(
  ctx: ReportContext,
  query: ReportQuery,
  side: "sales" | "purchase"
): Promise<ReportRunResult> {
  const isSales = side === "sales";
  const model = isSales ? SalesInvoice : PurchaseInvoice;
  const partyField = isSales ? "customer" : "vendor";
  const partyIdField = isSales ? "customerId" : "vendorId";
  const docBase = isSales ? "/sales-invoices" : "/purchase-invoices";
  const partyBase = isSales ? "/customers" : "/vendors";

  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  const range = dateFilter(query);
  if (range) filter.documentDate = range;
  filter.status = query.status ? query.status : { $ne: "CANCELLED" };
  if (query.partyName) {
    filter[`${partyField}.name`] = { $regex: escapeRegex(query.partyName), $options: "i" };
  }

  const docs = await model.find(filter).sort({ documentDate: -1 }).lean();

  const itemIds = [...new Set(docs.flatMap((d: AnyDoc) => d.lines.map((l: AnyDoc) => l.itemId.toString())))];
  const items = await Item.find({ businessId: ctx.businessId, _id: { $in: itemIds } }).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

  let rows = docs.flatMap((d: AnyDoc) =>
    d.lines.map((l: AnyDoc) => {
      const item = itemMap.get(l.itemId.toString());
      return {
        documentNumber: d.documentNumber,
        documentNumberHref: `${docBase}/${d._id.toString()}`,
        documentDate: d.documentDate?.toISOString(),
        partyName: d[partyField]?.name ?? "—",
        partyNameHref: d[partyIdField] ? `${partyBase}/${d[partyIdField].toString()}` : undefined,
        itemCode: l.itemCode,
        itemName: l.itemName,
        itemNameHref: `/items/${l.itemId.toString()}`,
        variantSku: l.variantSku ?? "—",
        hsnCode: item?.hsnCode ?? "—",
        quantity: l.quantity,
        unitName: l.unitName ?? "—",
        rate: money(l.rate),
        discountPercent: l.discountPercent ?? 0,
        discountAmount: money(l.discountAmount),
        taxableAmount: money(l.taxableAmount),
        taxRatePercent: l.taxRatePercent ?? 0,
        cgstAmount: money(l.cgstAmount),
        sgstAmount: money(l.sgstAmount),
        igstAmount: money(l.igstAmount),
        taxAmount: money(l.taxAmount),
        lineTotal: money(l.lineTotal),
        status: d.status,
      };
    })
  );

  if (query.itemName) {
    const needle = query.itemName.toLowerCase();
    rows = rows.filter(
      (r: AnyDoc) =>
        String(r.itemName).toLowerCase().includes(needle) || String(r.itemCode).toLowerCase().includes(needle)
    );
  }

  const totalQty = rows.reduce((acc: number, r: AnyDoc) => acc + Number(r.quantity), 0);
  const totalValue = rows.reduce((acc: Decimal, r: AnyDoc) => acc.plus(String(r.lineTotal)), new Decimal(0));

  // Paged in memory: one invoice explodes into several rows, so the page
  // window has to be applied after the lines are flattened.
  const start = (query.page - 1) * query.pageSize;
  const paged = rows.slice(start, start + query.pageSize);

  return {
    total: rows.length,
    summary: [
      { label: "Line items", value: String(rows.length) },
      { label: "Total quantity", value: String(totalQty) },
      { label: "Total value", value: totalValue.toFixed(2) },
    ],
    rows: paged,
  };
}

/* ------------------------------------------------------------------ */
/* GST HSN summary (GSTR-1 shape)                                      */
/* ------------------------------------------------------------------ */

async function hsnSummary(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, status: { $ne: "CANCELLED" } };
  const range = dateFilter(query);
  if (range) filter.documentDate = range;

  const invoices = await SalesInvoice.find(filter).lean();
  const itemIds = [
    ...new Set(invoices.flatMap((i: AnyDoc) => i.lines.map((l: AnyDoc) => l.itemId.toString()))),
  ];
  const items = await Item.find({ businessId: ctx.businessId, _id: { $in: itemIds } }).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

  interface Bucket {
    hsn: string;
    description: string;
    uqc: string;
    rate: number;
    quantity: number;
    taxable: Decimal;
    cgst: Decimal;
    sgst: Decimal;
    igst: Decimal;
  }
  const buckets = new Map<string, Bucket>();

  for (const inv of invoices as AnyDoc[]) {
    for (const line of inv.lines as AnyDoc[]) {
      const item = itemMap.get(line.itemId.toString());
      const hsn = item?.hsnCode?.trim() || "—";
      const rate = line.taxRatePercent ?? 0;
      // GSTR-1 groups by HSN *and* rate: same HSN at two rates is two rows.
      const key = `${hsn}|${rate}`;

      const b = buckets.get(key) ?? {
        hsn,
        description: item?.name ?? line.itemName,
        uqc: line.unitName ?? "—",
        rate,
        quantity: 0,
        taxable: new Decimal(0),
        cgst: new Decimal(0),
        sgst: new Decimal(0),
        igst: new Decimal(0),
      };

      b.quantity += line.quantity;
      b.taxable = b.taxable.plus(String(line.taxableAmount ?? 0));
      b.cgst = b.cgst.plus(String(line.cgstAmount ?? 0));
      b.sgst = b.sgst.plus(String(line.sgstAmount ?? 0));
      b.igst = b.igst.plus(String(line.igstAmount ?? 0));
      buckets.set(key, b);
    }
  }

  let list = [...buckets.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
  if (query.itemName) {
    const needle = query.itemName.toLowerCase();
    list = list.filter((r) => r.description.toLowerCase().includes(needle) || r.hsn.includes(needle));
  }

  const sum = (pick: (r: Bucket) => Decimal) => list.reduce((acc, r) => acc.plus(pick(r)), new Decimal(0));

  return {
    total: list.length,
    summary: [
      { label: "HSN rows", value: String(list.length) },
      { label: "Taxable value", value: sum((r) => r.taxable).toFixed(2) },
      { label: "CGST", value: sum((r) => r.cgst).toFixed(2) },
      { label: "SGST/UTGST", value: sum((r) => r.sgst).toFixed(2) },
      { label: "IGST", value: sum((r) => r.igst).toFixed(2) },
    ],
    rows: list.map((r) => ({
      hsn: r.hsn,
      description: r.description,
      uqc: r.uqc,
      rate: r.rate,
      quantity: r.quantity,
      taxable: r.taxable.toFixed(2),
      cgst: r.cgst.toFixed(2),
      sgst: r.sgst.toFixed(2),
      igst: r.igst.toFixed(2),
      totalTax: r.cgst.plus(r.sgst).plus(r.igst).toFixed(2),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

async function stockSummary(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (query.warehouseId) filter.warehouseId = query.warehouseId;

  const balances = await StockBalance.find(filter).sort({ updatedAt: -1 }).lean();
  const itemIds = [...new Set(balances.map((b) => b.itemId.toString()))];
  const warehouseIds = [...new Set(balances.map((b) => b.warehouseId.toString()))];

  const [items, warehouses] = await Promise.all([
    Item.find({ businessId: ctx.businessId, _id: { $in: itemIds } }).lean(),
    Warehouse.find({ businessId: ctx.businessId, _id: { $in: warehouseIds } }).lean(),
  ]);
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
  const whMap = new Map(warehouses.map((w) => [w._id.toString(), w]));

  let rows = balances.map((b) => {
    const item = itemMap.get(b.itemId.toString());
    // Same valuation rule as the dashboard tile — see unitValuation.
    const unit = unitValuation(b.averageCost, item?.costPrice);
    const value = unit.times(b.quantity);
    return {
      itemCode: item?.itemCode ?? "—",
      itemName: item?.name ?? "(deleted item)",
      itemNameHref: item ? `/items/${b.itemId.toString()}` : undefined,
      variantSku: b.variantSku || "—",
      warehouse: whMap.get(b.warehouseId.toString())?.name ?? "—",
      quantity: b.quantity,
      reservedQty: b.reservedQty,
      available: b.quantity - b.reservedQty,
      reorderLevel: item?.reorderLevel ?? 0,
      costPrice: unit.toFixed(2),
      stockValue: value.toFixed(2),
      belowReorder: item && b.quantity <= (item.reorderLevel ?? 0) ? "YES" : "NO",
    };
  });

  if (query.itemName) {
    const needle = query.itemName.toLowerCase();
    rows = rows.filter(
      (r) => r.itemName.toLowerCase().includes(needle) || r.itemCode.toLowerCase().includes(needle)
    );
  }

  // Drill-through from the dashboard's stock tiles. LOW only counts items
  // that declared a reorder level — otherwise every item sitting at its
  // default of 0 would be flagged as needing a reorder forever.
  if (query.stockFilter === "LOW") {
    rows = rows.filter((r) => r.reorderLevel > 0 && r.quantity <= r.reorderLevel && r.quantity > 0);
  } else if (query.stockFilter === "OUT") {
    rows = rows.filter((r) => r.quantity === 0);
  } else if (query.stockFilter === "NEGATIVE") {
    rows = rows.filter((r) => r.quantity < 0);
  }

  const totalQty = rows.reduce((a, r) => a + r.quantity, 0);
  const totalValue = rows.reduce((a, r) => a.plus(r.stockValue), new Decimal(0));
  const start = (query.page - 1) * query.pageSize;

  return {
    total: rows.length,
    summary: [
      { label: "Stock rows", value: String(rows.length) },
      { label: "Quantity on hand", value: String(totalQty) },
      { label: "Stock value", value: totalValue.toFixed(2) },
      { label: "Below reorder", value: String(rows.filter((r) => r.belowReorder === "YES").length) },
    ],
    rows: rows.slice(start, start + query.pageSize),
  };
}

async function stockLedger(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  const range = dateFilter(query);
  if (range) filter.createdAt = range;
  if (query.warehouseId) filter.warehouseId = query.warehouseId;

  const skip = (query.page - 1) * query.pageSize;
  const [txns, total] = await Promise.all([
    InventoryTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize).lean(),
    InventoryTransaction.countDocuments(filter),
  ]);

  const itemIds = [...new Set(txns.map((t) => t.itemId.toString()))];
  const whIds = [...new Set(txns.map((t) => t.warehouseId.toString()))];
  const [items, warehouses] = await Promise.all([
    Item.find({ businessId: ctx.businessId, _id: { $in: itemIds } }).lean(),
    Warehouse.find({ businessId: ctx.businessId, _id: { $in: whIds } }).lean(),
  ]);
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
  const whMap = new Map(warehouses.map((w) => [w._id.toString(), w]));

  const docBase: Record<string, string> = {
    "delivery-challans": "/delivery-challans",
    "sales-returns": "/sales-returns",
    "goods-receipts": "/goods-receipts",
    "purchase-returns": "/purchase-returns",
  };

  const inQty = txns.filter((t) => t.quantity > 0).reduce((a, t) => a + t.quantity, 0);
  const outQty = txns.filter((t) => t.quantity < 0).reduce((a, t) => a + t.quantity, 0);

  return {
    total,
    summary: [
      { label: "Movements", value: String(total) },
      { label: "Stock in (page)", value: String(inQty) },
      { label: "Stock out (page)", value: String(outQty) },
    ],
    rows: txns.map((t) => {
      const item = itemMap.get(t.itemId.toString());
      const base = docBase[t.sourceDocumentType.replace("_REVERSAL", "")];
      return {
        date: t.createdAt?.toISOString(),
        itemCode: item?.itemCode ?? "—",
        itemName: item?.name ?? "(deleted item)",
        itemNameHref: item ? `/items/${t.itemId.toString()}` : undefined,
        variantSku: t.variantSku || "—",
        warehouse: whMap.get(t.warehouseId.toString())?.name ?? "—",
        movementType: t.movementType,
        quantity: t.quantity,
        unitCost: money(t.unitCost),
        documentNumber: t.sourceDocumentNumber,
        documentNumberHref: base ? `${base}/${t.sourceDocumentId.toString()}` : undefined,
        sourceType: t.sourceDocumentType,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Master reports (with transaction roll-ups)                          */
/* ------------------------------------------------------------------ */

async function partyReport(ctx: ReportContext, query: ReportQuery, side: "customer" | "vendor"): Promise<ReportRunResult> {
  const isCustomer = side === "customer";
  const masterModel = isCustomer ? Customer : Vendor;
  const invoiceModel = isCustomer ? SalesInvoice : PurchaseInvoice;
  const codeField = isCustomer ? "customerCode" : "vendorCode";
  const idField = isCustomer ? "customerId" : "vendorId";
  const base = isCustomer ? "/customers" : "/vendors";

  const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null };
  if (query.status) filter.status = query.status;
  if (query.partyName) filter.name = { $regex: escapeRegex(query.partyName), $options: "i" };

  const parties = await masterModel.find(filter).sort({ name: 1 }).lean();

  // One grouped pass over invoices rather than a query per party.
  const totalsByParty = await invoiceModel.aggregate([
    { $match: { businessId: ctx.businessId, status: { $ne: "CANCELLED" } } },
    {
      $group: {
        _id: `$${idField}`,
        invoiceCount: { $sum: 1 },
        invoiced: { $sum: "$totals.grandTotal" },
        outstanding: { $sum: "$dueAmount" },
        lastInvoice: { $max: "$documentDate" },
      },
    },
  ]);
  const aggMap = new Map(totalsByParty.map((t: AnyDoc) => [String(t._id), t]));

  const rows = parties.map((p: AnyDoc) => {
    const agg = aggMap.get(p._id.toString());
    return {
      code: p[codeField],
      name: p.name,
      nameHref: `${base}/${p._id.toString()}`,
      companyName: p.companyName ?? "—",
      contactPerson: p.contactPerson ?? "—",
      phone: p.phone,
      email: p.email ?? "—",
      city: p.billingAddress?.city ?? "—",
      state: p.billingAddress?.state ?? "—",
      gstin: p.gstin ?? "—",
      creditLimit: money(p.creditLimit),
      creditDays: p.creditDays ?? 0,
      paymentTerms: p.paymentTerms ?? "—",
      openingBalance: money(p.openingBalance),
      invoiceCount: agg?.invoiceCount ?? 0,
      totalInvoiced: money(agg?.invoiced ?? 0),
      outstanding: money(agg?.outstanding ?? 0),
      lastInvoiceDate: agg?.lastInvoice ? new Date(agg.lastInvoice).toISOString() : undefined,
      status: p.status,
    };
  });

  const totalOutstanding = rows.reduce((a, r) => a.plus(r.outstanding), new Decimal(0));
  const totalInvoiced = rows.reduce((a, r) => a.plus(r.totalInvoiced), new Decimal(0));
  const start = (query.page - 1) * query.pageSize;

  return {
    total: rows.length,
    summary: [
      { label: isCustomer ? "Customers" : "Vendors", value: String(rows.length) },
      { label: "Total invoiced", value: totalInvoiced.toFixed(2) },
      { label: "Outstanding", value: totalOutstanding.toFixed(2) },
    ],
    rows: rows.slice(start, start + query.pageSize),
  };
}

async function itemReport(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null };
  if (query.status) filter.status = query.status;
  if (query.itemName) {
    filter.$or = [
      { name: { $regex: escapeRegex(query.itemName), $options: "i" } },
      { itemCode: { $regex: escapeRegex(query.itemName), $options: "i" } },
    ];
  }

  const items = await Item.find(filter).sort({ name: 1 }).lean();
  const [categories, brands, balances] = await Promise.all([
    Category.find({ businessId: ctx.businessId }).lean(),
    Brand.find({ businessId: ctx.businessId }).lean(),
    StockBalance.find({ businessId: ctx.businessId }).lean(),
  ]);

  const catMap = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const brandMap = new Map(brands.map((b) => [b._id.toString(), b.name]));

  const stockByItem = new Map<string, number>();
  for (const b of balances) {
    stockByItem.set(b.itemId.toString(), (stockByItem.get(b.itemId.toString()) ?? 0) + b.quantity);
  }

  const rows = items.map((i: AnyDoc) => {
    const onHand = stockByItem.get(i._id.toString()) ?? 0;
    return {
      itemCode: i.itemCode,
      name: i.name,
      nameHref: `/items/${i._id.toString()}`,
      itemType: i.itemType,
      category: i.categoryId ? catMap.get(i.categoryId.toString()) ?? "—" : "—",
      brand: i.brandId ? brandMap.get(i.brandId.toString()) ?? "—" : "—",
      hsnCode: i.hsnCode ?? "—",
      taxRatePercent: i.taxRatePercent ?? 0,
      purchasePrice: money(i.purchasePrice),
      sellingPrice: money(i.sellingPrice),
      costPrice: money(i.costPrice),
      style: i.style ?? "—",
      season: i.season ?? "—",
      gender: i.gender ?? "—",
      fabric: i.fabric ?? "—",
      gsm: i.gsm ?? 0,
      variantCount: i.variants?.length ?? 0,
      stockOnHand: onHand,
      reorderLevel: i.reorderLevel ?? 0,
      belowReorder: onHand <= (i.reorderLevel ?? 0) ? "YES" : "NO",
      stockValue: new Decimal(onHand).times(String(i.costPrice ?? 0)).toFixed(2),
      status: i.status,
    };
  });

  const totalValue = rows.reduce((a, r) => a.plus(r.stockValue), new Decimal(0));
  const start = (query.page - 1) * query.pageSize;

  return {
    total: rows.length,
    summary: [
      { label: "Items", value: String(rows.length) },
      { label: "Stock value", value: totalValue.toFixed(2) },
      { label: "Below reorder", value: String(rows.filter((r) => r.belowReorder === "YES").length) },
    ],
    rows: rows.slice(start, start + query.pageSize),
  };
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

function partyColumns(label: string): ReportColumnDef[] {
  return [
    { key: "code", label: `${label} Code` },
    { key: "name", label: `${label} Name`, type: "link" },
    { key: "companyName", label: "Company", defaultVisible: false },
    { key: "contactPerson", label: "Contact Person", defaultVisible: false },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email", defaultVisible: false },
    { key: "city", label: "City" },
    { key: "state", label: "State", defaultVisible: false },
    { key: "gstin", label: "GSTIN", defaultVisible: false },
    { key: "creditLimit", label: "Credit Limit", type: "money", defaultVisible: false },
    { key: "creditDays", label: "Credit Days", type: "number", defaultVisible: false },
    { key: "paymentTerms", label: "Payment Terms", defaultVisible: false },
    { key: "openingBalance", label: "Opening Balance", type: "money", defaultVisible: false },
    { key: "invoiceCount", label: "Invoices", type: "number", total: true },
    { key: "totalInvoiced", label: "Total Invoiced", type: "money", total: true },
    { key: "outstanding", label: "Outstanding", type: "money", total: true },
    { key: "lastInvoiceDate", label: "Last Invoice", type: "date", defaultVisible: false },
    { key: "status", label: "Status", type: "status" },
  ];
}

export const REPORTS: Record<string, ReportDefinition> = {
  "bank-transactions": {
    key: "bank-transactions",
    title: "Bank Transactions",
    module: "Bank & Cash",
    description: "Every movement on cash and bank accounts, with a running balance — your cash book and bank book.",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "voucherNumber", label: "Voucher", type: "link" },
      { key: "account", label: "Account" },
      { key: "particulars", label: "Particulars" },
      { key: "reference", label: "Reference" },
      { key: "narration", label: "Narration", defaultVisible: false },
      { key: "moneyIn", label: "Money in", type: "money", total: true },
      { key: "moneyOut", label: "Money out", type: "money", total: true },
      { key: "balance", label: "Balance", type: "money" },
    ],
    filters: ["dateRange", "account"],
    run: bankTransactions,
  },
  "cash-flow": {
    key: "cash-flow",
    title: "Cash Flow",
    module: "Bank & Cash",
    description: "Money in and out of cash and bank, by day for a month or less, by month otherwise. Transfers between your own accounts are excluded.",
    columns: [
      { key: "period", label: "Period" },
      { key: "opening", label: "Opening", type: "money" },
      { key: "inflow", label: "Money in", type: "money", total: true },
      { key: "outflow", label: "Money out", type: "money", total: true },
      { key: "net", label: "Net", type: "money", total: true },
      { key: "closing", label: "Closing", type: "money" },
    ],
    filters: ["dateRange"],
    run: cashFlow,
  },
  "owner-cash-flow": {
    key: "owner-cash-flow",
    title: "Owner Cash Flow",
    module: "Bank & Cash",
    description: "Capital the owners brought in and drawings they took out, through cash or bank.",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "voucherNumber", label: "Voucher", type: "link" },
      { key: "account", label: "Equity account" },
      { key: "via", label: "Through" },
      { key: "narration", label: "Narration" },
      { key: "capitalIn", label: "Capital in", type: "money", total: true },
      { key: "drawings", label: "Drawings", type: "money", total: true },
    ],
    filters: ["dateRange"],
    run: ownerCashFlow,
  },
  "manager-cash-flow": {
    key: "manager-cash-flow",
    title: "Manager Cash Flow",
    module: "Bank & Cash",
    description: "Cash and bank movement grouped by the employee who recorded it — who collected and who paid out.",
    columns: [
      { key: "person", label: "Employee" },
      { key: "entries", label: "Entries", type: "number", total: true },
      { key: "cashIn", label: "Cash in", type: "money", total: true },
      { key: "cashOut", label: "Cash out", type: "money", total: true },
      { key: "cashNet", label: "Net cash", type: "money", total: true },
      { key: "bankIn", label: "Bank in", type: "money", total: true },
      { key: "bankOut", label: "Bank out", type: "money", total: true },
      { key: "lastEntry", label: "Last entry", type: "date" },
    ],
    filters: ["dateRange"],
    run: managerCashFlow,
  },
  "target-vs-actual": {
    key: "target-vs-actual",
    title: "Target vs Actual",
    module: "Sales",
    description: "Each active target against actual sales, collections or purchases in its period, with pace against time elapsed.",
    columns: [
      { key: "name", label: "Target", type: "link" },
      { key: "metric", label: "Measures" },
      { key: "periodFrom", label: "From", type: "date" },
      { key: "periodTo", label: "To", type: "date" },
      { key: "target", label: "Target", type: "money" },
      { key: "actual", label: "Actual", type: "money" },
      { key: "achievement", label: "Achieved %", type: "number" },
      { key: "remaining", label: "Remaining", type: "money" },
      { key: "elapsed", label: "Period elapsed %", type: "number", defaultVisible: false },
      { key: "status", label: "Status", type: "status" },
    ],
    filters: ["dateRange"],
    run: targetVsActual,
  },
  "sales-register": {
    key: "sales-register",
    title: "Sales Register",
    module: "Sales",
    description: "One row per sales invoice, with the full GST breakup and outstanding amount.",
    columns: invoiceRegisterColumns("Customer"),
    filters: ["dateRange", "party", "status"],
    run: (ctx, q) => invoiceRegister(ctx, q, "sales"),
  },
  "sales-detail": {
    key: "sales-detail",
    title: "Sales Detail (item-wise)",
    module: "Sales",
    description: "One row per invoice line — product, quantity, rate, discount and tax.",
    columns: invoiceDetailColumns("Customer"),
    filters: ["dateRange", "party", "item", "status"],
    run: (ctx, q) => invoiceDetail(ctx, q, "sales"),
  },
  "purchase-register": {
    key: "purchase-register",
    title: "Purchase Register",
    module: "Purchase",
    description: "One row per purchase invoice, with the GST breakup and payable amount.",
    columns: invoiceRegisterColumns("Vendor"),
    filters: ["dateRange", "party", "status"],
    run: (ctx, q) => invoiceRegister(ctx, q, "purchase"),
  },
  "purchase-detail": {
    key: "purchase-detail",
    title: "Purchase Detail (item-wise)",
    module: "Purchase",
    description: "One row per purchase invoice line — product, quantity, rate and tax.",
    columns: invoiceDetailColumns("Vendor"),
    filters: ["dateRange", "party", "item", "status"],
    run: (ctx, q) => invoiceDetail(ctx, q, "purchase"),
  },
  "gst-hsn-summary": {
    key: "gst-hsn-summary",
    title: "GST HSN Summary",
    module: "GST",
    description: "HSN-wise outward supply summary in the shape GSTR-1 expects.",
    columns: [
      { key: "hsn", label: "HSN / SAC" },
      { key: "description", label: "Description" },
      { key: "uqc", label: "UQC", defaultVisible: false },
      { key: "rate", label: "GST Rate %", type: "number" },
      { key: "quantity", label: "Quantity", type: "number", total: true },
      { key: "taxable", label: "Taxable Value", type: "money", total: true },
      { key: "cgst", label: "CGST", type: "money", total: true },
      { key: "sgst", label: "SGST/UTGST", type: "money", total: true },
      { key: "igst", label: "IGST", type: "money", total: true },
      { key: "totalTax", label: "Total Tax", type: "money", total: true },
    ],
    filters: ["dateRange", "item"],
    run: hsnSummary,
  },
  "stock-summary": {
    key: "stock-summary",
    title: "Stock Summary",
    module: "Inventory",
    description: "Current stock on hand per item, variant and warehouse, with valuation.",
    columns: [
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name", type: "link" },
      { key: "variantSku", label: "Variant" },
      { key: "warehouse", label: "Warehouse" },
      { key: "quantity", label: "On Hand", type: "number", total: true },
      { key: "reservedQty", label: "Reserved", type: "number", total: true, defaultVisible: false },
      { key: "available", label: "Available", type: "number", total: true },
      { key: "reorderLevel", label: "Reorder Level", type: "number", defaultVisible: false },
      { key: "belowReorder", label: "Below Reorder", defaultVisible: false },
      { key: "costPrice", label: "Cost Price", type: "money", defaultVisible: false },
      { key: "stockValue", label: "Stock Value", type: "money", total: true },
    ],
    filters: ["item", "warehouse"],
    run: stockSummary,
  },
  "stock-ledger": {
    key: "stock-ledger",
    title: "Stock Ledger",
    module: "Inventory",
    description: "Every stock movement, newest first — the audit trail behind the summary.",
    columns: [
      { key: "date", label: "Date", type: "datetime" },
      { key: "itemCode", label: "Item Code", defaultVisible: false },
      { key: "itemName", label: "Item", type: "link" },
      { key: "variantSku", label: "Variant" },
      { key: "warehouse", label: "Warehouse", defaultVisible: false },
      { key: "movementType", label: "Movement" },
      { key: "quantity", label: "Qty", type: "number", total: true },
      { key: "unitCost", label: "Unit Cost", type: "money", defaultVisible: false },
      { key: "documentNumber", label: "Document", type: "link" },
      { key: "sourceType", label: "Source Type", defaultVisible: false },
    ],
    filters: ["dateRange", "warehouse"],
    run: stockLedger,
  },
  "trial-balance": {
    key: "trial-balance",
    title: "Trial Balance",
    module: "Accounting",
    description: "Every posting account with its opening balance, period movement and closing balance.",
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Account", type: "link" },
      { key: "type", label: "Type" },
      { key: "normalBalance", label: "Normal Side", defaultVisible: false },
      { key: "openingBalance", label: "Opening", type: "money", total: true },
      { key: "debit", label: "Debit", type: "money", total: true },
      { key: "credit", label: "Credit", type: "money", total: true },
      { key: "closingBalance", label: "Closing", type: "money", total: true },
    ],
    filters: ["dateRange"],
    run: trialBalance,
  },
  "general-ledger": {
    key: "general-ledger",
    title: "General Ledger",
    module: "Accounting",
    description: "Every posting against one account, in date order, with a running balance.",
    columns: [
      { key: "voucherDate", label: "Date", type: "date" },
      { key: "voucherNumber", label: "Voucher", type: "link" },
      { key: "voucherType", label: "Type", defaultVisible: false },
      { key: "particulars", label: "Particulars" },
      { key: "reference", label: "Reference" },
      { key: "narration", label: "Narration", defaultVisible: false },
      { key: "debit", label: "Debit", type: "money", total: true },
      { key: "credit", label: "Credit", type: "money", total: true },
      { key: "balance", label: "Balance", type: "money" },
    ],
    filters: ["dateRange", "account"],
    run: generalLedger,
  },
  "profit-and-loss": {
    key: "profit-and-loss",
    title: "Profit & Loss",
    module: "Accounting",
    description: "Income less expenses for the period, taken from the ledger rather than from invoice totals.",
    columns: [
      { key: "section", label: "Section" },
      { key: "code", label: "Code", defaultVisible: false },
      { key: "name", label: "Account", type: "link" },
      { key: "amount", label: "Amount", type: "money", total: true },
    ],
    filters: ["dateRange"],
    run: profitAndLoss,
  },
  "customer-report": {
    key: "customer-report",
    title: "Customer Report",
    module: "Masters",
    description: "Customer master with invoice count, total invoiced and outstanding balance.",
    columns: partyColumns("Customer"),
    filters: ["party", "status"],
    run: (ctx, q) => partyReport(ctx, q, "customer"),
  },
  "vendor-report": {
    key: "vendor-report",
    title: "Supplier Report",
    module: "Masters",
    description: "Vendor master with invoice count, total purchased and payable balance.",
    columns: partyColumns("Vendor"),
    filters: ["party", "status"],
    run: (ctx, q) => partyReport(ctx, q, "vendor"),
  },
  "item-report": {
    key: "item-report",
    title: "Product / Item Report",
    module: "Masters",
    description: "Item master with garment attributes, pricing, stock on hand and valuation.",
    columns: [
      { key: "itemCode", label: "Item Code" },
      { key: "name", label: "Product Name", type: "link" },
      { key: "itemType", label: "Type", defaultVisible: false },
      { key: "category", label: "Category" },
      { key: "brand", label: "Brand", defaultVisible: false },
      { key: "hsnCode", label: "HSN" },
      { key: "taxRatePercent", label: "GST %", type: "number" },
      { key: "purchasePrice", label: "Purchase Price", type: "money", defaultVisible: false },
      { key: "sellingPrice", label: "Selling Price", type: "money" },
      { key: "costPrice", label: "Cost Price", type: "money", defaultVisible: false },
      { key: "style", label: "Style", defaultVisible: false },
      { key: "season", label: "Season", defaultVisible: false },
      { key: "gender", label: "Gender", defaultVisible: false },
      { key: "fabric", label: "Fabric", defaultVisible: false },
      { key: "gsm", label: "GSM", type: "number", defaultVisible: false },
      { key: "variantCount", label: "Variants", type: "number", defaultVisible: false },
      { key: "stockOnHand", label: "Stock On Hand", type: "number", total: true },
      { key: "reorderLevel", label: "Reorder Level", type: "number", defaultVisible: false },
      { key: "belowReorder", label: "Below Reorder", defaultVisible: false },
      { key: "stockValue", label: "Stock Value", type: "money", total: true },
      { key: "status", label: "Status", type: "status" },
    ],
    filters: ["item", "status"],
    run: itemReport,
  },
};

export function getReport(key: string): ReportDefinition | undefined {
  return REPORTS[key];
}

/** Report catalogue for the reports index, grouped by module. */
export function listReports() {
  return Object.values(REPORTS).map((r) => ({
    key: r.key,
    title: r.title,
    module: r.module,
    description: r.description,
    columnCount: r.columns.length,
  }));
}
