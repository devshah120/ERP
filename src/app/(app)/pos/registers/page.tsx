"use client";

import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";

const config: SimpleListConfig = {
  title: "All Registers",
  description: "Every shift at every counter, with its takings and whether the cash count matched.",
  apiPath: "/api/pos/registers",
  basePath: "/pos/registers",
  searchPlaceholder: "Search register number or counter…",
  dateFilter: true,
  statusOptions: [
    { value: "OPEN", label: "Open" },
    { value: "CLOSED", label: "Closed" },
  ],
  emptyText: "No registers opened yet",
  columns: [
    { key: "registerNumber", label: "Register", link: true },
    { key: "counterName", label: "Counter" },
    { key: "openedByName", label: "Cashier" },
    { key: "openedAt", label: "Opened", type: "datetime" },
    { key: "closedAt", label: "Closed", type: "datetime" },
    { key: "orderCount", label: "Sales", type: "number" },
    { key: "salesTotal", label: "Takings", type: "money" },
    { key: "cashDifference", label: "Cash over / short", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ],
};

export default function PosRegistersPage() {
  return <SimpleListView config={config} />;
}