import { Types } from "mongoose";
import Decimal from "decimal.js";
import { SalesOrder, SalesInvoice, SalesQuotation } from "@/models/salesDocuments";
import { PurchaseOrder, PurchaseInvoice } from "@/models/purchaseDocuments";
import { AppError } from "@/lib/errors/AppError";
import type { AnalyticsQuery, Chart, Insight, Kpi, ModuleAnalysis } from "./types";
import { COLORS } from "./types";
import { resolvePeriod, periodParams, type ResolvedPeriod } from "./period";
import {
  agingBuckets,
  conversionSummary,
  invoiceSummary,
  topItems,
  topParties,
  trend,
  type AgingBucket,
} from "./queries";
import { cashSummary, partySummary, topOutstandingParties } from "./cash";
import { VALUATION_BASIS } from "@/lib/inventory/valuation";
import { formatMoney } from "@/lib/format/number";

/** Money inside a sentence: "460056.00" → "₹4,60,056.00". KPI values stay raw; the UI formats those. */
function inr(value: string | number | Decimal): string {
  return `₹${formatMoney(value.toString())}`;
}
import { lowStockItems, movers, stockMovement, stockSummary } from "./stock";

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0.0";
  return new Decimal(part).div(whole).times(100).toFixed(1);
}

function kpi(
  key: string,
  label: string,
  value: string | number,
  kind: Kpi["kind"],
  extra: Partial<Kpi> = {}
): Kpi {
  return { key, label, value: String(value), kind, tone: "neutral", ...extra };
}

/** Turns aging buckets into a chart whose bars link to the invoices behind them. */
function agingChart(buckets: AgingBucket[], basePath: string, title: string): Chart {
  return {
    key: "aging",
    title,
    type: "bar",
    valueKind: "money",
    emptyMessage: "Nothing outstanding — every posted invoice is settled.",
    series: [
      {
        name: "Outstanding",
        color: COLORS.outstanding,
        points: buckets.map((b) => ({
          label: b.label,
          value: Number(b.amount),
          href: `${basePath}?outstanding=true&minAgeDays=${b.minDays}${
            b.maxDays === null ? "" : `&maxAgeDays=${b.maxDays}`
          }`,
        })),
      },
    ],
  };
}

function rankChart(
  key: string,
  title: string,
  rows: { name: string; value: string; quantity?: number; id: string }[],
  basePath: string,
  color: string,
  valueKind: "money" | "quantity" = "money"
): Chart {
  return {
    key,
    title,
    type: "hbar",
    valueKind,
    emptyMessage: "No activity in this period.",
    series: [
      {
        name: title,
        color,
        points: rows.map((r) => ({
          label: r.name,
          value: valueKind === "quantity" ? (r.quantity ?? 0) : Number(r.value),
          href: r.id ? `${basePath}/${r.id}` : undefined,
        })),
      },
    ],
  };
}

/* ================================================================== */
/* Sales                                                               */
/* ================================================================== */

async function salesAnalysis(
  businessId: Types.ObjectId,
  period: ResolvedPeriod
): Promise<ModuleAnalysis> {
  const range = periodParams(period);

  const [inv, orderConv, quoteConv, deliveryConv, aging, customers, items, salesTrend] =
    await Promise.all([
      invoiceSummary(SalesInvoice, businessId, period),
      conversionSummary(SalesOrder, businessId, "invoicedQty", period),
      conversionSummary(SalesQuotation, businessId, "invoicedQty", period),
      conversionSummary(SalesOrder, businessId, "deliveredQty", period),
      agingBuckets(SalesInvoice, businessId),
      topParties(SalesInvoice, businessId, "customer", period),
      topItems(SalesInvoice, businessId, period),
      trend(SalesInvoice, businessId, period, { excludeDraft: true }),
    ]);

  const outstandingTotal = aging.reduce((a, b) => a.plus(b.amount), new Decimal(0)).toFixed(2);

  const kpis: Kpi[] = [
    kpi("salesValue", "Total sales", inv.grandTotal, "money", {
      href: `/sales-invoices?${range}`,
      hint: "Posted invoices, excluding cancelled",
    }),
    kpi("invoiceCount", "Invoices raised", inv.count, "count", { href: `/sales-invoices?${range}` }),
    kpi("received", "Payment received", inv.paidAmount, "money", {
      tone: "good",
      href: `/receipts?${range}`,
    }),
    kpi("outstanding", "Outstanding (all time)", outstandingTotal, "money", {
      tone: Number(outstandingTotal) > 0 ? "bad" : "good",
      href: "/sales-invoices?outstanding=true",
      hint: "Every unsettled invoice, not just this period",
    }),
    kpi("collection", "Collection rate", inv.collectionPercent, "percent", {
      tone: Number(inv.collectionPercent) >= 80 ? "good" : Number(inv.collectionPercent) >= 40 ? "warn" : "bad",
    }),
    kpi("openOrders", "Orders awaiting invoice", orderConv.pending, "count", {
      tone: orderConv.pending > 0 ? "warn" : "good",
      href: `/sales-orders?pendingInvoice=true&${range}`,
    }),
  ];

  const insights: Insight[] = [];

  // --- order → invoice conversion ------------------------------------
  if (orderConv.total > 0) {
    const headline =
      orderConv.pending === 0
        ? `All ${orderConv.total} sales order(s) in this period have been fully invoiced.`
        : `${orderConv.total} sales order(s) were created, but only ${orderConv.fullyConverted} ${
            orderConv.fullyConverted === 1 ? "has" : "have"
          } been fully converted into invoices. ${orderConv.pending} still ${
            orderConv.pending === 1 ? "has" : "have"
          } quantity left to invoice.`;

    insights.push({
      key: "sales-order-conversion",
      headline,
      detail:
        orderConv.partiallyConverted > 0
          ? `${orderConv.partiallyConverted} of those ${orderConv.partiallyConverted === 1 ? "is" : "are"} partly invoiced — some lines have gone through, the rest have not.`
          : undefined,
      tone: orderConv.pending === 0 ? "good" : orderConv.pending > orderConv.fullyConverted ? "bad" : "warn",
      metrics: [
        kpi("total", "Orders created", orderConv.total, "count", { href: `/sales-orders?${range}` }),
        kpi("full", "Fully invoiced", orderConv.fullyConverted, "count"),
        kpi("partial", "Partly invoiced", orderConv.partiallyConverted, "count"),
        kpi("none", "Not invoiced at all", orderConv.notConverted, "count"),
        kpi("rate", "Conversion rate", orderConv.conversionPercent, "percent"),
        kpi("pendingValue", "Value still to invoice", orderConv.pendingValue, "money", {
          tone: Number(orderConv.pendingValue) > 0 ? "warn" : "neutral",
        }),
      ],
      chart: {
        key: "order-conversion",
        title: "Sales orders by invoicing progress",
        type: "donut",
        valueKind: "count",
        series: [
          {
            name: "Orders",
            color: COLORS.sales,
            points: [
              { label: "Fully invoiced", value: orderConv.fullyConverted },
              { label: "Partly invoiced", value: orderConv.partiallyConverted, href: `/sales-orders?pendingInvoice=true&${range}` },
              { label: "Not invoiced", value: orderConv.notConverted, href: `/sales-orders?pendingInvoice=true&${range}` },
            ],
          },
        ],
      },
      action:
        orderConv.pending > 0
          ? { label: `View ${orderConv.pending} order(s) pending invoice`, href: `/sales-orders?pendingInvoice=true&${range}` }
          : undefined,
    });
  }

  // --- invoice → payment ---------------------------------------------
  if (inv.count > 0) {
    const unsettled = inv.count - inv.settledCount;
    insights.push({
      key: "sales-collection",
      headline:
        inv.settledCount === inv.count
          ? `All ${inv.count} invoice(s) raised in this period have been paid in full.`
          : `${inv.count} invoice(s) were raised, but payment has been received against only ${inv.settledCount}. ${unsettled} still need follow-up.`,
      detail: `Invoiced ${inr(inv.grandTotal)} and collected ${inr(inv.paidAmount)} — a count and a value are different measures and are shown separately here.`,
      tone: Number(inv.collectionPercent) >= 80 ? "good" : Number(inv.collectionPercent) >= 40 ? "warn" : "bad",
      metrics: [
        kpi("count", "Invoices raised", inv.count, "count", { href: `/sales-invoices?${range}` }),
        kpi("paidCount", "Fully paid", inv.paidCount, "count", { href: `/sales-invoices?paymentStatus=PAID&${range}` }),
        kpi("partialCount", "Partly paid", inv.partiallyPaidCount, "count", {
          href: `/sales-invoices?paymentStatus=PARTIALLY_PAID&${range}`,
        }),
        kpi("unpaidCount", "Unpaid", inv.unpaidCount, "count", {
          tone: inv.unpaidCount > 0 ? "bad" : "good",
          href: `/sales-invoices?paymentStatus=UNPAID&${range}`,
        }),
        kpi("invoiced", "Total invoiced", inv.grandTotal, "money"),
        kpi("received", "Total received", inv.paidAmount, "money", { tone: "good" }),
        kpi("due", "Still outstanding", inv.dueAmount, "money", {
          tone: Number(inv.dueAmount) > 0 ? "bad" : "good",
        }),
        kpi("rate", "Collection rate", inv.collectionPercent, "percent"),
      ],
      chart: {
        key: "collection-split",
        title: "Invoiced vs received",
        type: "bar",
        valueKind: "money",
        series: [
          {
            name: "Amount",
            color: COLORS.sales,
            points: [
              { label: "Invoiced", value: Number(inv.grandTotal) },
              { label: "Received", value: Number(inv.paidAmount) },
              { label: "Outstanding", value: Number(inv.dueAmount), href: `/sales-invoices?outstanding=true&${range}` },
            ],
          },
        ],
      },
      action:
        unsettled > 0
          ? { label: `View ${unsettled} invoice(s) awaiting payment`, href: `/sales-invoices?outstanding=true&${range}` }
          : undefined,
    });
  }

  // --- aging -----------------------------------------------------------
  const overdue = aging.slice(1).reduce((a, b) => a.plus(b.amount), new Decimal(0));
  if (Number(outstandingTotal) > 0) {
    insights.push({
      key: "sales-aging",
      headline: `${inr(outstandingTotal)} is outstanding from customers, of which ${inr(overdue)} has been owed for more than 30 days.`,
      detail: "Aging is measured as of today across all open invoices, not just the selected period.",
      tone: overdue.gt(0) ? "bad" : "warn",
      metrics: aging.map((b) =>
        kpi(b.label, b.label, b.amount, "money", {
          hint: `${b.count} invoice(s)`,
          tone: b.minDays >= 61 ? "bad" : b.minDays >= 31 ? "warn" : "neutral",
          href: `/sales-invoices?outstanding=true&minAgeDays=${b.minDays}${b.maxDays === null ? "" : `&maxAgeDays=${b.maxDays}`}`,
        })
      ),
      chart: agingChart(aging, "/sales-invoices", "Receivables aging"),
    });
  }

  // --- quotations and deliveries ---------------------------------------
  if (quoteConv.total > 0) {
    insights.push({
      key: "quote-conversion",
      headline: `${quoteConv.total} quotation(s) were sent and ${quoteConv.fullyConverted} converted onward — a ${quoteConv.conversionPercent}% win rate.`,
      tone: Number(quoteConv.conversionPercent) >= 50 ? "good" : "warn",
      metrics: [
        kpi("total", "Quotations", quoteConv.total, "count", { href: `/sales-quotations?${range}` }),
        kpi("won", "Converted", quoteConv.fullyConverted, "count"),
        kpi("open", "Still open", quoteConv.pending, "count", { tone: "warn" }),
        kpi("value", "Quoted value", quoteConv.orderValue, "money"),
      ],
    });
  }

  if (deliveryConv.pending > 0) {
    insights.push({
      key: "sales-delivery",
      headline: `${deliveryConv.pending} confirmed order(s) still have goods to dispatch, worth ${inr(deliveryConv.pendingValue)}.`,
      tone: "warn",
      metrics: [
        kpi("pending", "Orders to dispatch", deliveryConv.pending, "count", {
          href: `/sales-orders?pendingDelivery=true&${range}`,
        }),
        kpi("value", "Undelivered value", deliveryConv.pendingValue, "money"),
      ],
      action: { label: "View orders awaiting dispatch", href: `/sales-orders?pendingDelivery=true&${range}` },
    });
  }

  const charts: Chart[] = [
    {
      key: "sales-trend",
      title: "Sales trend",
      type: "line",
      valueKind: "money",
      emptyMessage: "No invoices in this period.",
      series: [
        {
          name: "Sales",
          color: COLORS.sales,
          points: salesTrend.map((p) => ({
            label: p.label,
            value: p.value,
            href: `/sales-invoices?fromDate=${p.from}&toDate=${p.to}`,
          })),
        },
      ],
    },
    rankChart("top-customers", "Top customers by sales value", customers, "/customers", COLORS.sales),
    rankChart("top-items", "Top products by sales value", items, "/items", COLORS.accent),
    {
      key: "invoice-status",
      title: "Invoice payment status",
      type: "donut",
      valueKind: "count",
      emptyMessage: "No invoices in this period.",
      series: [
        {
          name: "Invoices",
          color: COLORS.sales,
          points: [
            { label: "Paid", value: inv.paidCount, href: `/sales-invoices?paymentStatus=PAID&${range}` },
            { label: "Partly paid", value: inv.partiallyPaidCount, href: `/sales-invoices?paymentStatus=PARTIALLY_PAID&${range}` },
            { label: "Unpaid", value: inv.unpaidCount, href: `/sales-invoices?paymentStatus=UNPAID&${range}` },
          ],
        },
      ],
    },
  ];

  return { module: "sales", title: "Sales analysis", kpis, insights, charts };
}

/* ================================================================== */
/* Purchase                                                            */
/* ================================================================== */

async function purchaseAnalysis(
  businessId: Types.ObjectId,
  period: ResolvedPeriod
): Promise<ModuleAnalysis> {
  const range = periodParams(period);

  const [inv, orderConv, receiptConv, aging, vendors, items, purchaseTrend] = await Promise.all([
    invoiceSummary(PurchaseInvoice, businessId, period),
    conversionSummary(PurchaseOrder, businessId, "invoicedQty", period),
    conversionSummary(PurchaseOrder, businessId, "deliveredQty", period),
    agingBuckets(PurchaseInvoice, businessId),
    topParties(PurchaseInvoice, businessId, "vendor", period),
    topItems(PurchaseInvoice, businessId, period),
    trend(PurchaseInvoice, businessId, period, { excludeDraft: true }),
  ]);

  const payableTotal = aging.reduce((a, b) => a.plus(b.amount), new Decimal(0)).toFixed(2);

  const kpis: Kpi[] = [
    kpi("purchaseValue", "Total purchases", inv.grandTotal, "money", { href: `/purchase-invoices?${range}` }),
    kpi("billCount", "Bills received", inv.count, "count", { href: `/purchase-invoices?${range}` }),
    kpi("paid", "Paid to suppliers", inv.paidAmount, "money", { href: `/payments?${range}` }),
    kpi("payable", "Payable (all time)", payableTotal, "money", {
      tone: Number(payableTotal) > 0 ? "warn" : "good",
      href: "/purchase-invoices?outstanding=true",
    }),
    kpi("openPo", "POs awaiting bill", orderConv.pending, "count", {
      tone: orderConv.pending > 0 ? "warn" : "good",
      href: `/purchase-orders?pendingInvoice=true&${range}`,
    }),
  ];

  const insights: Insight[] = [];

  if (orderConv.total > 0) {
    insights.push({
      key: "purchase-order-conversion",
      headline:
        orderConv.pending === 0
          ? `All ${orderConv.total} purchase order(s) in this period have been fully billed.`
          : `${orderConv.total} purchase order(s) were raised, but only ${orderConv.fullyConverted} ${
              orderConv.fullyConverted === 1 ? "has" : "have"
            } been fully converted into supplier bills. ${orderConv.pending} remain open.`,
      tone: orderConv.pending === 0 ? "good" : "warn",
      metrics: [
        kpi("total", "POs raised", orderConv.total, "count", { href: `/purchase-orders?${range}` }),
        kpi("full", "Fully billed", orderConv.fullyConverted, "count"),
        kpi("partial", "Partly billed", orderConv.partiallyConverted, "count"),
        kpi("none", "Not billed", orderConv.notConverted, "count"),
        kpi("rate", "Conversion rate", orderConv.conversionPercent, "percent"),
        kpi("pendingValue", "Value still to bill", orderConv.pendingValue, "money"),
      ],
      chart: {
        key: "po-conversion",
        title: "Purchase orders by billing progress",
        type: "donut",
        valueKind: "count",
        series: [
          {
            name: "Orders",
            color: COLORS.purchase,
            points: [
              { label: "Fully billed", value: orderConv.fullyConverted },
              { label: "Partly billed", value: orderConv.partiallyConverted },
              { label: "Not billed", value: orderConv.notConverted },
            ],
          },
        ],
      },
      action:
        orderConv.pending > 0
          ? { label: `View ${orderConv.pending} PO(s) pending bill`, href: `/purchase-orders?pendingInvoice=true&${range}` }
          : undefined,
    });
  }

  if (receiptConv.pending > 0) {
    insights.push({
      key: "purchase-receipt",
      headline: `${receiptConv.pending} purchase order(s) are still awaiting goods, worth ${inr(receiptConv.pendingValue)}.`,
      tone: "warn",
      metrics: [
        kpi("pending", "POs awaiting goods", receiptConv.pending, "count", {
          href: `/purchase-orders?pendingDelivery=true&${range}`,
        }),
        kpi("value", "Value not yet received", receiptConv.pendingValue, "money"),
      ],
      action: { label: "View POs awaiting goods", href: `/purchase-orders?pendingDelivery=true&${range}` },
    });
  }

  if (inv.count > 0) {
    const unsettled = inv.count - inv.settledCount;
    insights.push({
      key: "purchase-payment",
      headline:
        unsettled === 0
          ? `All ${inv.count} supplier bill(s) in this period have been paid.`
          : `${inv.count} supplier bill(s) were received and ${inv.settledCount} ${inv.settledCount === 1 ? "has" : "have"} been paid. ${unsettled} remain outstanding.`,
      detail: `Billed ${inr(inv.grandTotal)}, paid ${inr(inv.paidAmount)}.`,
      tone: unsettled === 0 ? "good" : "warn",
      metrics: [
        kpi("count", "Bills", inv.count, "count"),
        kpi("paidCount", "Paid", inv.paidCount, "count"),
        kpi("unpaidCount", "Unpaid", inv.unpaidCount, "count", {
          href: `/purchase-invoices?paymentStatus=UNPAID&${range}`,
        }),
        kpi("billed", "Total billed", inv.grandTotal, "money"),
        kpi("paidValue", "Total paid", inv.paidAmount, "money"),
        kpi("due", "Still payable", inv.dueAmount, "money", { tone: Number(inv.dueAmount) > 0 ? "warn" : "good" }),
      ],
      action:
        unsettled > 0
          ? { label: `View ${unsettled} unpaid bill(s)`, href: `/purchase-invoices?outstanding=true&${range}` }
          : undefined,
    });
  }

  if (Number(payableTotal) > 0) {
    insights.push({
      key: "purchase-aging",
      headline: `${inr(payableTotal)} is payable to suppliers across all open bills.`,
      tone: "warn",
      metrics: aging.map((b) =>
        kpi(b.label, b.label, b.amount, "money", {
          hint: `${b.count} bill(s)`,
          href: `/purchase-invoices?outstanding=true&minAgeDays=${b.minDays}${b.maxDays === null ? "" : `&maxAgeDays=${b.maxDays}`}`,
        })
      ),
      chart: agingChart(aging, "/purchase-invoices", "Payables aging"),
    });
  }

  const charts: Chart[] = [
    {
      key: "purchase-trend",
      title: "Purchase trend",
      type: "line",
      valueKind: "money",
      emptyMessage: "No supplier bills in this period.",
      series: [
        {
          name: "Purchases",
          color: COLORS.purchase,
          points: purchaseTrend.map((p) => ({
            label: p.label,
            value: p.value,
            href: `/purchase-invoices?fromDate=${p.from}&toDate=${p.to}`,
          })),
        },
      ],
    },
    rankChart("top-vendors", "Top suppliers by purchase value", vendors, "/vendors", COLORS.purchase),
    rankChart("top-purchased", "Most purchased products", items, "/items", COLORS.accent),
  ];

  return { module: "purchase", title: "Purchase analysis", kpis, insights, charts };
}

/* ================================================================== */
/* Inventory                                                           */
/* ================================================================== */

async function inventoryAnalysis(
  businessId: Types.ObjectId,
  period: ResolvedPeriod
): Promise<ModuleAnalysis> {
  const [stock, low, movement, fast, slow] = await Promise.all([
    stockSummary(businessId),
    lowStockItems(businessId),
    stockMovement(businessId, period),
    movers(businessId, period, "fast"),
    movers(businessId, period, "slow"),
  ]);

  const kpis: Kpi[] = [
    kpi("items", "Items with stock", stock.trackedItems, "count", { href: "/items" }),
    kpi("qty", "Total stock quantity", stock.totalQuantity, "quantity", {
      href: "/reports/stock-summary",
    }),
    kpi("value", "Stock value (at cost)", stock.totalValue, "money", {
      href: "/reports/stock-summary",
      hint: VALUATION_BASIS,
    }),
    kpi("low", "Low stock items", stock.lowStockCount, "count", {
      tone: stock.lowStockCount > 0 ? "warn" : "good",
      href: "/reports/stock-summary?stockFilter=LOW",
    }),
    kpi("out", "Out of stock", stock.outOfStockCount, "count", {
      tone: stock.outOfStockCount > 0 ? "bad" : "good",
      href: "/reports/stock-summary?stockFilter=OUT",
    }),
  ];

  const insights: Insight[] = [];

  if (stock.lowStockCount > 0 || stock.outOfStockCount > 0) {
    insights.push({
      key: "stock-alerts",
      headline: `${stock.lowStockCount} item(s) are at or below their reorder level and ${stock.outOfStockCount} ${
        stock.outOfStockCount === 1 ? "is" : "are"
      } completely out of stock.`,
      detail:
        low.length > 0
          ? `Lowest: ${low.slice(0, 3).map((i) => `${i.name} (${i.quantity} left, reorder at ${i.threshold})`).join(", ")}.`
          : "Only items with a reorder level or minimum stock configured are checked.",
      tone: stock.outOfStockCount > 0 ? "bad" : "warn",
      metrics: [
        kpi("low", "At/below reorder level", stock.lowStockCount, "count", {
          href: "/reports/stock-summary?stockFilter=LOW",
        }),
        kpi("out", "Out of stock", stock.outOfStockCount, "count", {
          href: "/reports/stock-summary?stockFilter=OUT",
        }),
        kpi("value", "Stock value", stock.totalValue, "money"),
      ],
      chart:
        low.length > 0
          ? {
              key: "low-stock",
              title: "Items needing reorder",
              type: "hbar",
              valueKind: "quantity",
              series: [
                {
                  name: "Quantity on hand",
                  color: COLORS.warn,
                  points: low.map((i) => ({ label: i.name, value: i.quantity, href: `/items/${i.id}` })),
                },
              ],
            }
          : undefined,
      action: { label: "Open stock summary", href: "/reports/stock-summary?stockFilter=LOW" },
    });
  }

  if (stock.negativeCount > 0) {
    insights.push({
      key: "negative-stock",
      headline: `${stock.negativeCount} item(s) show negative stock, which means goods were issued that the ledger never received.`,
      detail: "Check the stock ledger for those items — usually an opening balance or a goods receipt was never recorded.",
      tone: "bad",
      metrics: [kpi("neg", "Items below zero", stock.negativeCount, "count")],
      action: { label: "Open stock ledger", href: "/reports/stock-ledger" },
    });
  }

  insights.push({
    key: "stock-movement",
    headline: `${movement.inQuantity} unit(s) came in and ${movement.outQuantity} went out in this period.`,
    detail:
      movement.inQuantity === 0 && movement.outQuantity === 0
        ? "No stock moved in this period."
        : `Net change: ${(movement.inQuantity - movement.outQuantity).toFixed(3)} unit(s).`,
    tone: "neutral",
    metrics: [
      kpi("in", "Stock in", movement.inQuantity, "quantity"),
      kpi("out", "Stock out", movement.outQuantity, "quantity"),
    ],
    chart: {
      key: "movement",
      title: "Stock in vs stock out",
      type: "bar",
      valueKind: "quantity",
      series: [
        {
          name: "Quantity",
          color: COLORS.purchase,
          points: [
            { label: "Stock in", value: movement.inQuantity },
            { label: "Stock out", value: movement.outQuantity },
          ],
        },
      ],
    },
  });

  const charts: Chart[] = [
    rankChart("fast-movers", "Fast-moving products (quantity sold)", fast, "/items", COLORS.sales, "quantity"),
    rankChart("slow-movers", "Slow-moving products (quantity sold)", slow, "/items", COLORS.neutral, "quantity"),
  ];

  return {
    module: "inventory",
    title: "Inventory analysis",
    kpis,
    insights,
    charts,
    caveats: [
      "Fast/slow movers are ranked on goods actually dispatched in the period; items never dispatched do not appear at all.",
      "Stock adjustment and transfer screens are not built yet, so the only movements are purchases, sales, and returns.",
    ],
  };
}

/* ================================================================== */
/* Customers / Suppliers                                               */
/* ================================================================== */

async function partyAnalysis(
  businessId: Types.ObjectId,
  period: ResolvedPeriod,
  kind: "customer" | "vendor"
): Promise<ModuleAnalysis> {
  const isCustomer = kind === "customer";
  const label = isCustomer ? "Customer" : "Supplier";
  const basePath = isCustomer ? "/customers" : "/vendors";
  const invoicePath = isCustomer ? "/sales-invoices" : "/purchase-invoices";
  const invoiceModel = isCustomer ? SalesInvoice : PurchaseInvoice;
  const range = periodParams(period);

  const [summary, top, outstanding] = await Promise.all([
    partySummary(businessId, kind, period),
    topParties(invoiceModel, businessId, kind, period, 8),
    topOutstandingParties(businessId, kind, 8),
  ]);

  const inactive = Math.max(0, summary.total - summary.active);

  const kpis: Kpi[] = [
    kpi("total", `Total ${label.toLowerCase()}s`, summary.total, "count", { href: basePath }),
    kpi("active", "Transacted in period", summary.active, "count", {
      tone: "good",
      hint: "Had at least one posted invoice in the selected period",
    }),
    kpi("inactive", "No activity in period", inactive, "count", { tone: inactive > 0 ? "warn" : "neutral" }),
    kpi("new", "Added in period", summary.newInPeriod, "count"),
    kpi("withBalance", "Carrying a balance", summary.withOutstanding, "count", {
      tone: summary.withOutstanding > 0 ? "warn" : "good",
      href: `${invoicePath}?outstanding=true`,
    }),
    kpi(
      "balance",
      isCustomer ? "Total receivable" : "Total payable",
      summary.outstandingAmount,
      "money",
      { tone: Number(summary.outstandingAmount) > 0 ? "bad" : "good", href: `${invoicePath}?outstanding=true` }
    ),
  ];

  const insights: Insight[] = [];

  if (summary.total > 0) {
    insights.push({
      key: `${kind}-activity`,
      headline: `${summary.total} ${label.toLowerCase()}(s) are on file and ${summary.active} transacted in this period — ${pct(summary.active, summary.total)}%.`,
      detail:
        inactive > 0
          ? `${inactive} did not transact in the selected period. Widen the period before treating that as churn.`
          : undefined,
      tone: summary.active > 0 ? "neutral" : "warn",
      metrics: [
        kpi("total", "On file", summary.total, "count", { href: basePath }),
        kpi("active", "Transacted", summary.active, "count"),
        kpi("inactive", "Dormant this period", inactive, "count"),
        kpi("new", "Newly added", summary.newInPeriod, "count"),
      ],
    });
  }

  if (summary.withOutstanding > 0) {
    insights.push({
      key: `${kind}-outstanding`,
      headline: `${summary.withOutstanding} ${label.toLowerCase()}(s) carry a balance totalling ${inr(summary.outstandingAmount)}.`,
      detail: `Largest: ${outstanding.slice(0, 3).map((o) => `${o.name} (${o.value})`).join(", ")}.`,
      tone: isCustomer ? "bad" : "warn",
      metrics: outstanding
        .slice(0, 6)
        .map((o) => kpi(o.id, o.name, o.value, "money", { hint: `${o.count} open invoice(s)`, href: `${basePath}/${o.id}` })),
      chart: {
        key: `${kind}-outstanding-chart`,
        title: isCustomer ? "Customers owing the most" : "Suppliers owed the most",
        type: "hbar",
        valueKind: "money",
        series: [
          {
            name: "Balance",
            color: isCustomer ? COLORS.outstanding : COLORS.warn,
            points: outstanding.map((o) => ({ label: o.name, value: Number(o.value), href: `${basePath}/${o.id}` })),
          },
        ],
      },
      action: { label: "View open invoices", href: `${invoicePath}?outstanding=true` },
    });
  }

  const charts: Chart[] = [
    rankChart(
      `${kind}-top`,
      isCustomer ? "Top customers by sales value" : "Top suppliers by purchase value",
      top,
      basePath,
      isCustomer ? COLORS.sales : COLORS.purchase
    ),
  ];

  return {
    module: kind === "customer" ? "customers" : "vendors",
    title: `${label} analysis`,
    kpis,
    insights,
    charts,
    caveats: [`"Transacted in period" covers posted invoices only — quotations and orders do not count. Period: ${range.replace("&", ", ")}.`],
  };
}

/* ================================================================== */
/* Accounting (money actually moved)                                   */
/* ================================================================== */

async function accountingAnalysis(
  businessId: Types.ObjectId,
  period: ResolvedPeriod
): Promise<ModuleAnalysis> {
  const range = periodParams(period);

  const [receipts, payments, salesInv, purchaseInv, arAging, apAging] = await Promise.all([
    cashSummary(businessId, "RECEIPT", period),
    cashSummary(businessId, "PAYMENT", period),
    invoiceSummary(SalesInvoice, businessId, period),
    invoiceSummary(PurchaseInvoice, businessId, period),
    agingBuckets(SalesInvoice, businessId),
    agingBuckets(PurchaseInvoice, businessId),
  ]);

  const receivable = arAging.reduce((a, b) => a.plus(b.amount), new Decimal(0));
  const payable = apAging.reduce((a, b) => a.plus(b.amount), new Decimal(0));
  const net = new Decimal(receipts.total).minus(payments.total);

  const kpis: Kpi[] = [
    kpi("in", "Money received", receipts.total, "money", { tone: "good", href: `/receipts?${range}` }),
    kpi("out", "Money paid out", payments.total, "money", { href: `/payments?${range}` }),
    kpi("net", "Net cash movement", net.toFixed(2), "money", {
      tone: net.gte(0) ? "good" : "bad",
      hint: "Receipts minus payments recorded in this period",
    }),
    kpi("ar", "Total receivable", receivable.toFixed(2), "money", {
      tone: receivable.gt(0) ? "warn" : "good",
      href: "/sales-invoices?outstanding=true",
    }),
    kpi("ap", "Total payable", payable.toFixed(2), "money", {
      tone: payable.gt(0) ? "warn" : "good",
      href: "/purchase-invoices?outstanding=true",
    }),
    kpi("position", "Net position", receivable.minus(payable).toFixed(2), "money", {
      hint: "Receivable minus payable",
      tone: receivable.minus(payable).gte(0) ? "good" : "bad",
    }),
  ];

  const insights: Insight[] = [
    {
      key: "cash-flow",
      headline: `${receipts.count} receipt(s) brought in ${inr(receipts.total)} and ${payments.count} payment(s) took out ${inr(payments.total)} — a net movement of ${inr(net)}.`,
      detail:
        Number(receipts.onAccount) > 0
          ? `${receipts.onAccount} of what came in has not been matched to any invoice yet and is sitting on account.`
          : undefined,
      tone: net.gte(0) ? "good" : "bad",
      metrics: [
        kpi("receipts", "Receipts", receipts.count, "count", { href: `/receipts?${range}` }),
        kpi("received", "Received", receipts.total, "money", { tone: "good" }),
        kpi("payments", "Payments", payments.count, "count", { href: `/payments?${range}` }),
        kpi("paid", "Paid", payments.total, "money"),
        kpi("onAccount", "Unallocated receipts", receipts.onAccount, "money", {
          tone: Number(receipts.onAccount) > 0 ? "warn" : "neutral",
        }),
      ],
      chart: {
        key: "cash-in-out",
        title: "Money in vs money out",
        type: "bar",
        valueKind: "money",
        series: [
          {
            name: "Amount",
            color: COLORS.received,
            points: [
              { label: "Received", value: Number(receipts.total), href: `/receipts?${range}` },
              { label: "Paid out", value: Number(payments.total), href: `/payments?${range}` },
            ],
          },
        ],
      },
    },
    {
      key: "working-capital",
      headline: `${inr(receivable)} is owed to you and you owe ${inr(payable)} — a net position of ${inr(receivable.minus(payable))}.`,
      tone: receivable.minus(payable).gte(0) ? "good" : "bad",
      metrics: [
        kpi("ar", "Receivable", receivable.toFixed(2), "money", { href: "/sales-invoices?outstanding=true" }),
        kpi("ap", "Payable", payable.toFixed(2), "money", { href: "/purchase-invoices?outstanding=true" }),
        kpi("arOver", "Receivable over 30 days", arAging.slice(1).reduce((a, b) => a.plus(b.amount), new Decimal(0)).toFixed(2), "money", {
          tone: "bad",
        }),
      ],
      chart: {
        key: "ar-ap",
        title: "Receivable vs payable",
        type: "bar",
        valueKind: "money",
        series: [
          {
            name: "Amount",
            color: COLORS.sales,
            points: [
              { label: "Receivable", value: Number(receivable.toFixed(2)), href: "/sales-invoices?outstanding=true" },
              { label: "Payable", value: Number(payable.toFixed(2)), href: "/purchase-invoices?outstanding=true" },
            ],
          },
        ],
      },
    },
  ];

  const charts: Chart[] = [];
  if (receipts.byMode.length > 0) {
    charts.push({
      key: "receipt-modes",
      title: "Receipts by payment mode",
      type: "donut",
      valueKind: "money",
      series: [
        {
          name: "Receipts",
          color: COLORS.received,
          points: receipts.byMode.map((m) => ({ label: m.mode, value: Number(m.amount) })),
        },
      ],
    });
  }
  charts.push({
    key: "income-expense",
    title: "Invoiced vs billed",
    type: "groupedBar",
    valueKind: "money",
    series: [
      {
        name: "Sales invoiced",
        color: COLORS.sales,
        points: [{ label: "This period", value: Number(salesInv.grandTotal) }],
      },
      {
        name: "Purchases billed",
        color: COLORS.purchase,
        points: [{ label: "This period", value: Number(purchaseInv.grandTotal) }],
      },
    ],
  });

  return {
    module: "accounting",
    title: "Cash & settlement analysis",
    kpis,
    insights,
    charts,
    caveats: [
      "These figures come from invoices and from receipts/payments recorded against them. There is no Chart of Accounts or journal posting yet, so this is not a trial balance, a P&L, or a bank reconciliation.",
      "Cash and bank balances are not tracked as accounts — only the money recorded through Receipts and Payments is shown.",
    ],
  };
}

/* ================================================================== */

const MODULE_BUILDERS: Record<
  string,
  (businessId: Types.ObjectId, period: ResolvedPeriod) => Promise<ModuleAnalysis>
> = {
  sales: salesAnalysis,
  purchase: purchaseAnalysis,
  inventory: inventoryAnalysis,
  customers: (b, p) => partyAnalysis(b, p, "customer"),
  vendors: (b, p) => partyAnalysis(b, p, "vendor"),
  accounting: accountingAnalysis,
};

export const ANALYSIS_MODULES = Object.keys(MODULE_BUILDERS);

export async function runModuleAnalysis(
  module: string,
  businessId: Types.ObjectId,
  query: AnalyticsQuery
): Promise<ModuleAnalysis & { period: { key: string; label: string; fromDate: string; toDate: string } }> {
  const builder = MODULE_BUILDERS[module];
  if (!builder) throw AppError.notFound(`Unknown analysis module: ${module}`);

  const period = resolvePeriod(query);
  const result = await builder(businessId, period);

  return {
    ...result,
    period: {
      key: period.key,
      label: period.label,
      fromDate: period.from.toISOString(),
      toDate: period.to.toISOString(),
    },
  };
}

export { salesAnalysis, purchaseAnalysis, inventoryAnalysis, accountingAnalysis, partyAnalysis };
