"use client";

import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";

const config: SimpleListConfig = {
  title: "POS Credit Notes",
  description: "Goods returned at the counter. Each return brings stock back in and refunds what was charged for those items.",
  apiPath: "/api/pos/credit-notes",
  basePath: "/pos/credit-notes",
  searchPlaceholder: "Search credit note, bill number, customer…",
  dateFilter: true,
  statusOptions: [
    { value: "ISSUED", label: "Issued" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  emptyText: "No returns yet. Start a return from the POS order.",
  columns: [
    { key: "creditNoteNumber", label: "Credit Note", link: true },
    { key: "creditNoteDate", label: "Date", type: "datetime" },
    { key: "orderNumber", label: "Against bill", type: "mono" },
    { key: "customerName", label: "Customer" },
    { key: "lines", label: "Items", type: "count" },
    { key: "refundMode", label: "Refund by" },
    { key: "totals.grandTotal", label: "Refund", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ],
};

export default function PosCreditNotesPage() {
  return <SimpleListView config={config} />;
}