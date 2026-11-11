import Decimal from "decimal.js";
import { stateTaxLabel } from "@/lib/gst/supply";

/**
 * One shape every print layout renders from. POS bills, POS credit notes and
 * sales / purchase documents are each turned into a PrintModel by the
 * builders below, so a layout never needs to know where the data came from.
 *
 * Money stays as decimal strings (as stored); layouts format for display.
 */

export interface PrintBusiness {
  name: string;
  gstin?: string;
  state?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  currency?: string;
}

export interface PrintLine {
  name: string;
  code?: string;
  sku?: string;
  hsn?: string;
  description?: string;
  quantity: number;
  unit?: string;
  rate: string;
  discountPercent: number;
  discountAmount: string;
  taxRate: number;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  amount: string;
}

export interface PrintParty {
  label: string;
  name: string;
  code?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  address: string[];
}

export interface PrintTotals {
  subTotal: string;
  discount: string;
  coupon?: { code: string; amount: string };
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  shipping: string;
  roundOff: string;
  grandTotal: string;
}

export interface PrintModel {
  /** "TAX INVOICE", "Credit Note", "Sales Quotation"… */
  title: string;
  number: string;
  date: string;
  /** Receipts print the time of sale too. */
  showTime: boolean;
  dueDate?: string;
  business: PrintBusiness;
  party?: PrintParty;
  shipTo?: PrintParty;
  intraState: boolean;
  /** "SGST", or "UTGST" for a union territory without a legislature. */
  stateTaxLabel: string;
  placeOfSupply?: string;
  /** Extra label/value pairs: payment terms, vehicle, against bill, cashier… */
  meta: { label: string; value: string }[];
  lines: PrintLine[];
  totals: PrintTotals;
  grandLabel: string;
  payments: { mode: string; amount: string }[];
  change?: string;
  refundNote?: string;
  notes?: string;
  terms?: string;
  /** Free text under the business name (POS Settings · receipt header). */
  header?: string;
  footer?: string;
  currencyWord: string;
}

type AnyRecord = Record<string, unknown>;

const str = (v: unknown, fallback = "0"): string => (v === undefined || v === null || v === "" ? fallback : String(v));
const opt = (v: unknown): string | undefined => (v === undefined || v === null || v === "" ? undefined : String(v));

function currencyWord(business: PrintBusiness) {
  return business.currency && business.currency !== "INR" ? business.currency : "Rupees";
}

function addressLines(a?: AnyRecord | null): string[] {
  if (!a) return [];
  return [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(", ")].filter(Boolean) as string[];
}

/* ------------------------------------------------------------------ */
/* POS                                                                 */
/* ------------------------------------------------------------------ */

function posLines(lines: AnyRecord[]): PrintLine[] {
  return lines.map((l) => {
    const qty = Number(l.quantity ?? 0);
    const price = new Decimal(str(l.price));
    const discountPercent = Number(l.discountPercent ?? 0);
    const discountAmount = price.times(qty).times(discountPercent).dividedBy(100).toFixed(2);
    return {
      name: str(l.itemName, ""),
      code: opt(l.itemCode),
      sku: opt(l.variantSku),
      hsn: opt(l.hsnCode),
      quantity: qty,
      rate: price.toFixed(2),
      discountPercent,
      discountAmount,
      taxRate: Number(l.taxRatePercent ?? 0),
      taxable: str(l.taxableAmount),
      cgst: str(l.cgstAmount),
      sgst: str(l.sgstAmount),
      igst: "0",
      amount: str(l.lineTotal),
    };
  });
}

function posTotals(t: AnyRecord, couponCode?: unknown): PrintTotals {
  const coupon = Number(t.couponDiscount ?? 0) > 0 ? { code: str(couponCode, ""), amount: str(t.couponDiscount) } : undefined;
  return {
    // grossAmount is price × qty, tax-inclusive under MRP pricing, so it
    // isn't a pre-tax sub total; POS bills go straight from discount to taxable.
    subTotal: "",
    discount: str(t.discountAmount),
    coupon,
    taxable: str(t.taxableAmount),
    cgst: str(t.cgstAmount),
    sgst: str(t.sgstAmount),
    igst: "0",
    shipping: "0",
    roundOff: str(t.roundOff),
    grandTotal: str(t.grandTotal),
  };
}

function posParty(name: unknown, phone: unknown): PrintParty {
  return { label: "Customer", name: str(name, "Walk-in customer"), phone: opt(phone), address: [] };
}

export interface PosTextOptions {
  header?: string;
  footer?: string;
}

/** A completed counter sale. */
export function fromPosOrder(doc: AnyRecord, business: PrintBusiness, text: PosTextOptions = {}): PrintModel {
  const meta: PrintModel["meta"] = [];
  if (doc.counterName) meta.push({ label: "Counter", value: String(doc.counterName) });
  if (doc.cashierName && doc.cashierName !== "—") meta.push({ label: "Cashier", value: String(doc.cashierName) });
  if (doc.status === "CANCELLED") meta.push({ label: "Status", value: "CANCELLED" });

  return {
    title: "TAX INVOICE",
    number: str(doc.orderNumber, ""),
    date: str(doc.orderDate, new Date().toISOString()),
    showTime: true,
    business,
    party: posParty(doc.customerName, doc.customerPhone),
    intraState: true,
    stateTaxLabel: "SGST",
    placeOfSupply: business.state,
    meta,
    lines: posLines((doc.lines as AnyRecord[]) ?? []),
    totals: posTotals((doc.totals as AnyRecord) ?? {}, doc.couponCode),
    grandLabel: "TOTAL",
    payments: ((doc.payments as AnyRecord[]) ?? []).map((p) => ({ mode: str(p.mode, ""), amount: str(p.amount) })),
    change: Number(doc.changeReturned ?? 0) > 0 ? str(doc.changeReturned) : undefined,
    notes: opt(doc.notes),
    header: text.header || undefined,
    footer: text.footer || undefined,
    currencyWord: currencyWord(business),
  };
}

/** Goods returned against a counter sale. */
export function fromPosCreditNote(doc: AnyRecord, business: PrintBusiness, text: PosTextOptions = {}): PrintModel {
  const meta: PrintModel["meta"] = [{ label: "Against bill", value: str(doc.orderNumber, "—") }];
  if (doc.reason) meta.push({ label: "Reason", value: String(doc.reason) });
  if (doc.status === "CANCELLED") meta.push({ label: "Status", value: "CANCELLED" });

  return {
    title: "CREDIT NOTE",
    number: str(doc.creditNoteNumber, ""),
    date: str(doc.creditNoteDate, new Date().toISOString()),
    showTime: true,
    business,
    party: posParty(doc.customerName, undefined),
    intraState: true,
    stateTaxLabel: "SGST",
    placeOfSupply: business.state,
    meta,
    lines: posLines((doc.lines as AnyRecord[]) ?? []),
    totals: posTotals((doc.totals as AnyRecord) ?? {}),
    grandLabel: "REFUND",
    payments: [],
    refundNote: doc.refundMode ? `Refunded by ${String(doc.refundMode)}` : undefined,
    header: text.header || undefined,
    footer: text.footer || undefined,
    currencyWord: currencyWord(business),
  };
}

/* ------------------------------------------------------------------ */
/* Sales / purchase documents                                          */
/* ------------------------------------------------------------------ */

const PAYMENT_MODE_LABELS: Record<string, string> = {
  CREDIT: "Credit",
  CASH: "Cash",
  CARD: "Card",
  UPI: "UPI",
  BANK: "Bank transfer",
  MIXED: "Mixed",
};

/**
 * A transactional document (quotation, invoice, purchase order…).
 * `partyField` is "customer" for sales and "vendor" for purchases.
 */
export function fromDocument(
  record: AnyRecord,
  business: PrintBusiness,
  opts: { title: string; partyField: "customer" | "vendor" }
): PrintModel {
  const sales = opts.partyField === "customer";
  const party = (record[opts.partyField] as AnyRecord | undefined) ?? {};
  const billing = record.billingAddress as AnyRecord | undefined;
  const shipping = (record.shippingAddress as AnyRecord | undefined) ?? billing;
  const t = (record.totals as AnyRecord) ?? {};

  const meta: PrintModel["meta"] = [];
  if (record.paymentTerms) meta.push({ label: "Payment terms", value: String(record.paymentTerms) });
  if (record.paymentMode) meta.push({ label: "Payment mode", value: PAYMENT_MODE_LABELS[String(record.paymentMode)] ?? String(record.paymentMode) });
  if (record.validUntil) meta.push({ label: "Valid until", value: formatPrintDate(String(record.validUntil)) });
  if (record.vehicleNumber) meta.push({ label: "Vehicle", value: String(record.vehicleNumber) });
  if (record.ewayBillNumber) meta.push({ label: "E-way bill", value: String(record.ewayBillNumber) });
  const sources = (record.sourceDocuments as { docNumber: string }[] | undefined) ?? [];
  if (sources.length) meta.push({ label: "Against", value: sources.map((s) => s.docNumber).join(", ") });

  const lines: PrintLine[] = ((record.lines as AnyRecord[]) ?? []).map((l) => ({
    name: str(l.itemName, ""),
    code: opt(l.itemCode),
    sku: opt(l.variantSku),
    description: opt(l.description),
    quantity: Number(l.quantity ?? 0),
    unit: opt(l.unitName),
    rate: str(l.rate),
    discountPercent: Number(l.discountPercent ?? 0),
    discountAmount: str(l.discountAmount),
    taxRate: Number(l.taxRatePercent ?? 0),
    taxable: str(l.taxableAmount),
    cgst: str(l.cgstAmount),
    sgst: str(l.sgstAmount),
    igst: str(l.igstAmount),
    amount: str(l.lineTotal),
  }));

  return {
    title: opts.title,
    number: str(record.documentNumber, ""),
    date: str(record.documentDate, new Date().toISOString()),
    showTime: false,
    dueDate: opt(record.dueDate),
    business,
    party: {
      label: sales ? "Bill To" : "Supplier",
      name: str(party.name, "—"),
      code: opt(party.code),
      gstin: opt(party.gstin),
      phone: opt(party.phone),
      email: opt(party.email),
      address: addressLines(billing),
    },
    shipTo: { label: sales ? "Ship To" : "Deliver To", name: str(party.name, "—"), address: addressLines(shipping) },
    intraState: record.intraState !== false,
    stateTaxLabel: stateTaxLabel(Boolean(record.isUnionTerritory)),
    placeOfSupply: record.placeOfSupplyName ? `${String(record.placeOfSupplyName)} (${str(record.placeOfSupplyCode, "")})` : undefined,
    meta,
    lines,
    totals: {
      subTotal: str(t.subTotal),
      discount: str(t.totalDiscount),
      taxable: str(t.taxableAmount),
      cgst: str(t.cgstAmount),
      sgst: str(t.sgstAmount),
      igst: str(t.igstAmount),
      shipping: str(t.shippingCharge),
      roundOff: str(t.roundOff),
      grandTotal: str(t.grandTotal),
    },
    grandLabel: "Grand Total",
    payments: [],
    notes: opt(record.notes),
    terms: opt(record.termsAndConditions),
    currencyWord: currencyWord(business),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers shared by the layouts                                       */
/* ------------------------------------------------------------------ */

export function formatPrintDate(value: string | undefined, withTime = false): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export interface TaxSummaryRow {
  rate: number;
  hsn?: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

/** GST grouped by rate (and HSN when `byHsn`), as GST invoices summarise it. */
export function taxSummary(lines: PrintLine[], byHsn = false): TaxSummaryRow[] {
  const groups = new Map<string, { rate: number; hsn?: string; taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }>();
  for (const l of lines) {
    const key = byHsn ? `${l.hsn ?? ""}|${l.taxRate}` : String(l.taxRate);
    const g = groups.get(key) ?? { rate: l.taxRate, hsn: byHsn ? l.hsn : undefined, taxable: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0) };
    g.taxable = g.taxable.plus(l.taxable || 0);
    g.cgst = g.cgst.plus(l.cgst || 0);
    g.sgst = g.sgst.plus(l.sgst || 0);
    g.igst = g.igst.plus(l.igst || 0);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.rate - b.rate || (a.hsn ?? "").localeCompare(b.hsn ?? ""))
    .map((g) => ({
      rate: g.rate,
      hsn: g.hsn,
      taxable: g.taxable.toFixed(2),
      cgst: g.cgst.toFixed(2),
      sgst: g.sgst.toFixed(2),
      igst: g.igst.toFixed(2),
      total: g.cgst.plus(g.sgst).plus(g.igst).toFixed(2),
    }));
}

/** Total quantity across lines (receipts print "Items: 3 · Qty: 7"). */
export function totalQuantity(lines: PrintLine[]): number {
  return lines.reduce((s, l) => s + l.quantity, 0);
}

/** What the customer saved against list price: line discounts plus coupon. */
export function totalSavings(model: PrintModel): string {
  return new Decimal(model.totals.discount || 0).plus(model.totals.coupon?.amount || 0).toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Sample data for previews                                            */
/* ------------------------------------------------------------------ */

/** A realistic bill used by the settings thumbnails and preview. */
export function sampleModel(business: PrintBusiness, kind: "pos" | "pos-return" | "document", title: string, partyField: "customer" | "vendor" = "customer"): PrintModel {
  const lines: AnyRecord[] = [
    { itemName: "Cotton Kurta – Indigo", itemCode: "KUR-1042", variantSku: "KUR-1042-M", hsnCode: "6211", quantity: 2, price: "899.00", rate: "856.19", discountPercent: 10, taxRatePercent: 5, taxableAmount: "1541.14", cgstAmount: "38.53", sgstAmount: "38.53", igstAmount: "0", lineTotal: "1618.20", discountAmount: "171.24" },
    { itemName: "Silk Dupatta", itemCode: "DUP-220", hsnCode: "5007", quantity: 1, price: "1299.00", rate: "1159.82", discountPercent: 0, taxRatePercent: 12, taxableAmount: "1159.82", cgstAmount: "69.59", sgstAmount: "69.59", igstAmount: "0", lineTotal: "1299.00", discountAmount: "0" },
    { itemName: "Leggings – Black", itemCode: "LEG-008", variantSku: "LEG-008-L", hsnCode: "6104", quantity: 3, price: "349.00", rate: "332.38", discountPercent: 0, taxRatePercent: 5, taxableAmount: "997.14", cgstAmount: "24.93", sgstAmount: "24.93", igstAmount: "0", lineTotal: "1047.00", discountAmount: "0" },
  ];
  const posTotalsRaw = { discountAmount: "179.80", couponDiscount: "0", taxableAmount: "3698.10", cgstAmount: "133.05", sgstAmount: "133.05", roundOff: "-0.20", grandTotal: "3964.00" };
  const sampleDate = "2026-11-11T13:05:00.000Z";

  if (kind === "pos") {
    return fromPosOrder(
      {
        orderNumber: "POS-2026-27-000124",
        orderDate: sampleDate,
        customerName: "Priya Sharma",
        customerPhone: "98250 12345",
        counterName: "Counter 1",
        cashierName: "Rahul",
        lines,
        totals: posTotalsRaw,
        payments: [{ mode: "CASH", amount: "4000.00" }],
        changeReturned: "36.00",
      },
      business,
      { footer: "Thank you for shopping with us!" }
    );
  }
  if (kind === "pos-return") {
    return fromPosCreditNote(
      {
        creditNoteNumber: "PCN-2026-27-000009",
        creditNoteDate: sampleDate,
        orderNumber: "POS-2026-27-000124",
        customerName: "Priya Sharma",
        refundMode: "CASH",
        reason: "Size exchange",
        lines: lines.slice(1, 2),
        totals: { discountAmount: "0", taxableAmount: "1159.82", cgstAmount: "69.59", sgstAmount: "69.59", roundOff: "0", grandTotal: "1299.00" },
      },
      business,
      { footer: "Thank you for shopping with us!" }
    );
  }
  return fromDocument(
    {
      documentNumber: "INV-2026-27-000057",
      documentDate: sampleDate,
      dueDate: "2026-12-11T00:00:00.000Z",
      intraState: true,
      placeOfSupplyName: business.state || "Gujarat",
      placeOfSupplyCode: "24",
      [partyField]: { name: partyField === "customer" ? "Shree Fashion House" : "Aarav Textile Mills", code: "C-0042", gstin: "24AAKFS4521M1Z3", phone: "98790 55511" },
      billingAddress: { line1: "12, Ring Road Market", city: "Surat", state: business.state || "Gujarat", postalCode: "395002" },
      paymentTerms: "Net 30",
      lines: lines.map((l) => ({ ...l, unitName: "PCS" })),
      totals: { subTotal: "3869.34", totalDiscount: "171.24", taxableAmount: "3698.10", cgstAmount: "133.05", sgstAmount: "133.05", igstAmount: "0", shippingCharge: "0", roundOff: "-0.20", grandTotal: "3964.00" },
      notes: "Goods once sold will be exchanged within 7 days with the original bill.",
      termsAndConditions: "1. Interest @18% p.a. on payments after the due date.\n2. Subject to local jurisdiction.",
    },
    business,
    { title, partyField }
  );
}
