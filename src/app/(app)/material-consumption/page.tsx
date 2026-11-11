"use client";

import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";

const config: SimpleListConfig = {
  title: "Material Consumption",
  description: "Materials issued out of stock and used up. Their value is written off to Materials Consumed.",
  apiPath: "/api/production/material-consumption",
  basePath: "/material-consumption",
  create: { label: "Issue materials", href: "/material-consumption/new", permission: "material-consumption.create" },
  searchPlaceholder: "Search entry number or purpose…",
  dateFilter: true,
  statusOptions: [
    { value: "POSTED", label: "Posted" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  emptyText: "No materials issued yet",
  columns: [
    { key: "entryNumber", label: "Entry No", link: true },
    { key: "entryDate", label: "Date", type: "date" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "purpose", label: "Purpose" },
    { key: "components", label: "Items", type: "count" },
    { key: "totalValue", label: "Value", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ],
};

export default function MaterialConsumptionPage() {
  return <SimpleListView config={config} />;
}
