import { Types } from "mongoose";
import Decimal from "decimal.js";
import { SalesInvoice, SalesOrder } from "@/models/salesDocuments";
import { PurchaseInvoice, PurchaseOrder } from "@/models/purchaseDocuments";
import type { AnalyticsQuery, Chart, DashboardResult, Insight, Kpi } from "./types";
import { COLORS } from "./types";
import { resolvePeriod, periodParams } from "./period";
import { agingBuckets, conversionSummary, invoiceSummary, topItems, topParties, trend } from "./queries";
import { cashSummary, partySummary } from "./cash";
import { VALUATION_BASIS } from "@/lib/inventory/valuation";
import { stockSummary } from "./stock";
import { salesAnalysis, purchaseAnalysis, accountingAnalysis } from "./modules";

function kpi(
  key: string,
  label: string,
  value: string | number,
  kind: Kpi["kind"],
  extra: Partial<Kpi> = {}
): Kpi {
  return { key, label, value: String(value), kind, tone: "neutral", ...extra };
}

/**
 * The single screen a business owner opens first.
 *
 * Every figure is computed from live documents for the selected period, and
 * every figure that can be acted on carries the drill-through link that
 * reproduces it as a filtered list — so a number on this page and the rows
 * behind it can never disagree.
 */
export async function buildDashboard(
  businessId: Types.ObjectId,
  query: AnalyticsQuery
): Promise<DashboardResult> {
  const period = resolvePeriod(query);
  const range = periodParams(period);

  const [
    sales,
    purchase,
    salesOrders,
    purchaseOrders,
    arAging,
    apAging,
    receipts,
    payments,
    customers,
    vendors,
    stock,
    salesTrend,
    purchaseTrend,
    topCustomers,
    topProducts,
  ] = await Promise.all([
    invoiceSummary(SalesInvoice, businessId, period),
    invoiceSummary(PurchaseInvoice, businessId, period),
    conversionSummary(SalesOrder, businessId, "invoicedQty", period),
    conversionSummary(PurchaseOrder, businessId, "invoicedQty", period),
    agingBuckets(SalesInvoice, businessId),
    agingBuckets(PurchaseInvoice, businessId),
    cashSummary(businessId, "RECEIPT", period),
    cashSummary(businessId, "PAYMENT", period),
    partySummary(businessId, "customer", period),
    partySummary(businessId, "vendor", period),
    stockSummary(businessId),
    trend(SalesInvoice, businessId, period, { excludeDraft: true }),
    trend(PurchaseInvoice, businessId, period, { excludeDraft: true }),
    topParties(SalesInvoice, businessId, "customer", period, 6),
    topItems(SalesInvoice, businessId, period, 6),
  ]);

  const receivable = arAging.reduce((a, b) => a.plus(b.amount), new Decimal(0));
  const payable = apAging.reduce((a, b) => a.plus(b.amount), new Decimal(0));

  const kpis: Kpi[] = [
    kpi("totalSales", "Total Sales", sales.grandTotal, "money", {
      href: `/sales-invoices?${range}`,
      tone: "good",
    }),
    kpi("invoiceCount", "Total Invoices", sales.count, "count", { href: `/sales-invoices?${range}` }),
    kpi("totalPurchase", "Total Purchases", purchase.grandTotal, "money", {
      href: `/purchase-invoices?${range}`,
    }),
    kpi("billCount", "Total Bills", purchase.count, "count", { href: `/purchase-invoices?${range}` }),
    kpi("received", "Payments Received", receipts.total, "money", {
      tone: "good",
      href: `/receipts?${range}`,
    }),
    kpi("paidOut", "Payments Made", payments.total, "money", { href: `/payments?${range}` }),
    kpi("receivable", "To Receive", receivable.toFixed(2), "money", {
      tone: receivable.gt(0) ? "bad" : "good",
      href: "/sales-invoices?outstanding=true",
      hint: "All open invoices, not just this period",
    }),
    kpi("payable", "To Pay", payable.toFixed(2), "money", {
      tone: payable.gt(0) ? "warn" : "good",
      href: "/purchase-invoices?outstanding=true",
      hint: "All open bills, not just this period",
    }),
    kpi("pendingSo", "Pending Sales Orders", salesOrders.pending, "count", {
      tone: salesOrders.pending > 0 ? "warn" : "good",
      href: `/sales-orders?pendingInvoice=true&${range}`,
    }),
    kpi("pendingPo", "Pending Purchase Orders", purchaseOrders.pending, "count", {
      tone: purchaseOrders.pending > 0 ? "warn" : "good",
      href: `/purchase-orders?pendingInvoice=true&${range}`,
    }),
    kpi("unpaidInvoices", "Unpaid Invoices", sales.unpaidCount + sales.partiallyPaidCount, "count", {
      tone: sales.unpaidCount > 0 ? "bad" : "good",
      href: `/sales-invoices?outstanding=true&${range}`,
    }),
    kpi("customers", "Total Customers", customers.total, "count", { href: "/customers" }),
    kpi("vendors", "Total Suppliers", vendors.total, "count", { href: "/vendors" }),
    kpi("items", "Total Products", stock.trackedItems, "count", { href: "/items" }),
    kpi("stockQty", "Stock Quantity", stock.totalQuantity, "quantity", {
      href: "/reports/stock-summary",
    }),
    kpi("stockValue", "Stock Value", stock.totalValue, "money", {
      href: "/reports/stock-summary",
      hint: VALUATION_BASIS,
    }),
    kpi("lowStock", "Low Stock Items", stock.lowStockCount, "count", {
      tone: stock.lowStockCount > 0 ? "warn" : "good",
      href: "/reports/stock-summary?stockFilter=LOW",
    }),
    kpi("collection", "Collection Rate", sales.collectionPercent, "percent", {
      tone:
        Number(sales.collectionPercent) >= 80
          ? "good"
          : Number(sales.collectionPercent) >= 40
            ? "warn"
            : "bad",
    }),
  ];

  // Sales and purchase share one axis so the bars are directly comparable.
  const comparison: Chart = {
    key: "sales-vs-purchase",
    title: "Sales vs Purchase",
    type: "groupedBar",
    valueKind: "money",
    emptyMessage: "No invoices or bills in this period.",
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
      {
        name: "Purchase",
        color: COLORS.purchase,
        points: purchaseTrend.map((p) => ({
          label: p.label,
          value: p.value,
          href: `/purchase-invoices?fromDate=${p.from}&toDate=${p.to}`,
        })),
      },
    ],
  };

  const charts: Chart[] = [
    comparison,
    {
      key: "revenue-trend",
      title: "Sales revenue trend",
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
    {
      key: "collection",
      title: "Received vs outstanding",
      type: "bar",
      valueKind: "money",
      series: [
        {
          name: "Amount",
          color: COLORS.received,
          points: [
            { label: "Received", value: Number(receipts.total), href: `/receipts?${range}` },
            {
              label: "Outstanding",
              value: Number(receivable.toFixed(2)),
              href: "/sales-invoices?outstanding=true",
            },
          ],
        },
      ],
    },
    {
      key: "invoice-status",
      title: "Invoice status",
      type: "donut",
      valueKind: "count",
      emptyMessage: "No invoices in this period.",
      series: [
        {
          name: "Invoices",
          color: COLORS.sales,
          points: [
            { label: "Paid", value: sales.paidCount, href: `/sales-invoices?paymentStatus=PAID&${range}` },
            {
              label: "Partly paid",
              value: sales.partiallyPaidCount,
              href: `/sales-invoices?paymentStatus=PARTIALLY_PAID&${range}`,
            },
            { label: "Unpaid", value: sales.unpaidCount, href: `/sales-invoices?paymentStatus=UNPAID&${range}` },
          ],
        },
      ],
    },
    {
      key: "receivables-aging",
      title: "Receivables aging",
      type: "bar",
      valueKind: "money",
      emptyMessage: "Nothing outstanding.",
      series: [
        {
          name: "Outstanding",
          color: COLORS.outstanding,
          points: arAging.map((b) => ({
            label: b.label,
            value: Number(b.amount),
            href: `/sales-invoices?outstanding=true&minAgeDays=${b.minDays}${
              b.maxDays === null ? "" : `&maxAgeDays=${b.maxDays}`
            }`,
          })),
        },
      ],
    },
    {
      key: "pending-orders",
      title: "Pending orders",
      type: "groupedBar",
      valueKind: "count",
      emptyMessage: "No open orders.",
      series: [
        {
          name: "Sales orders",
          color: COLORS.sales,
          points: [
            {
              label: "Awaiting invoice",
              value: salesOrders.pending,
              href: `/sales-orders?pendingInvoice=true&${range}`,
            },
          ],
        },
        {
          name: "Purchase orders",
          color: COLORS.purchase,
          points: [
            {
              label: "Awaiting invoice",
              value: purchaseOrders.pending,
              href: `/purchase-orders?pendingInvoice=true&${range}`,
            },
          ],
        },
      ],
    },
    {
      key: "top-customers",
      title: "Top customers by sales value",
      type: "hbar",
      valueKind: "money",
      emptyMessage: "No sales in this period.",
      series: [
        {
          name: "Sales",
          color: COLORS.sales,
          points: topCustomers.map((c) => ({
            label: c.name,
            value: Number(c.value),
            href: c.id ? `/customers/${c.id}` : undefined,
          })),
        },
      ],
    },
    {
      key: "top-products",
      title: "Top-selling products",
      type: "hbar",
      valueKind: "money",
      emptyMessage: "No sales in this period.",
      series: [
        {
          name: "Sales",
          color: COLORS.accent,
          points: topProducts.map((p) => ({
            label: p.name,
            value: Number(p.value),
            href: p.id ? `/items/${p.id}` : undefined,
          })),
        },
      ],
    },
  ];

  // The headline insights are the same ones the module pages show, so the
  // dashboard never states a different conclusion from the module it links to.
  const [salesModule, purchaseModule, accountingModule] = await Promise.all([
    salesAnalysis(businessId, period),
    purchaseAnalysis(businessId, period),
    accountingAnalysis(businessId, period),
  ]);

  const insights: Insight[] = [
    ...salesModule.insights.filter((i) =>
      ["sales-order-conversion", "sales-collection", "sales-aging"].includes(i.key)
    ),
    ...purchaseModule.insights.filter((i) => ["purchase-order-conversion", "purchase-payment"].includes(i.key)),
    ...accountingModule.insights.filter((i) => i.key === "cash-flow"),
  ];

  const caveats: string[] = [
    "Money figures come from posted invoices and from receipts/payments recorded against them. Draft and cancelled documents are excluded.",
    "There is no Chart of Accounts or journal posting yet, so this is not a P&L or a bank balance — gross profit and expense figures are deliberately absent rather than estimated.",
  ];
  if (stock.negativeCount > 0) {
    caveats.push(
      `${stock.negativeCount} item(s) currently show negative stock, which will understate stock value until corrected.`
    );
  }

  return {
    period: {
      key: period.key,
      label: period.label,
      fromDate: period.from.toISOString(),
      toDate: period.to.toISOString(),
    },
    kpis,
    charts,
    insights,
    caveats,
    generatedAt: new Date().toISOString(),
  };
}
