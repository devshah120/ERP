"use client";

import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";

const config: SimpleListConfig = {
  title: "Stock Transfer Requests",
  description: "A store asks another warehouse for stock. Once approved, fulfilling it raises the stock transfer.",
  apiPath: "/api/stock-transfer-requests",
  basePath: "/stock-transfer-requests",
  create: { label: "New request", href: "/stock-transfer-requests/new", permission: "stock-transfer-requests.create" },
  searchPlaceholder: "Search request number…",
  dateFilter: true,
  statusOptions: [
    { value: "REQUESTED", label: "Requested" },
    { value: "APPROVED", label: "Approved" },
    { value: "FULFILLED", label: "Fulfilled" },
    { value: "REJECTED", label: "Rejected" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  emptyText: "No transfer requests yet",
  columns: [
    { key: "requestNumber", label: "Request No", link: true },
    { key: "requestDate", label: "Date", type: "date" },
    { key: "toWarehouseName", label: "Needed at" },
    { key: "fromWarehouseName", label: "Requested from" },
    { key: "requiredBy", label: "Needed by", type: "date" },
    { key: "lines", label: "Items", type: "count" },
    { key: "totalQuantity", label: "Quantity", type: "number" },
    { key: "transferNumber", label: "Transfer", type: "mono" },
    { key: "status", label: "Status", type: "status" },
  ],
};

export default function StockTransferRequestsPage() {
  return <SimpleListView config={config} />;
}
