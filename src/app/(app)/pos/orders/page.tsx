"use client";

import Link from "next/link";
import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";
import { formatMoney } from "@/lib/format/number";

const config: SimpleListConfig = {
  title: "POS Orders",
  description: "Every counter sale. Completing a sale moved stock out and posted it to the ledger.",
  apiPath: "/api/pos/orders",
  basePath: "/pos/orders",
  urlParams: ["registerId"],
  searchPlaceholder: "Search bill number, customer, phone…",
  dateFilter: true,
  statusOptions: [
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  emptyText: "No counter sales yet",
  headerActions: (
    <Link href="/pos/register" className="button buttonPrimary">
      Open register
    </Link>
  ),
  columns: [
    { key: "orderNumber", label: "Bill No", link: true },
    { key: "orderDate", label: "Time", type: "datetime" },
    { key: "customerName", label: "Customer" },
    { key: "itemCount", label: "Qty", type: "number" },
    { key: "paymentModes", label: "Paid by" },
    { key: "totals.grandTotal", label: "Total", type: "money" },
    { key: "refundedAmount", label: "Refunded", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ],
  summary: (r) => (
    <span className="activeFilterNote">
      Sales matching these filters: <strong>{formatMoney(String(r.salesTotal ?? "0"))}</strong>
    </span>
  ),
};

export default function PosOrdersPage() {
  return <SimpleListView config={config} />;
}