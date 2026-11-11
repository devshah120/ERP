"use client";

import Link from "next/link";
import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";

const config: SimpleListConfig = {
  title: "Material Creation",
  description: "Components go out of stock and the finished product comes in at their combined cost.",
  apiPath: "/api/production/material-creation",
  basePath: "/material-creation",
  create: { label: "New production", href: "/material-creation/new", permission: "material-creation.create" },
  searchPlaceholder: "Search entry, product or formula…",
  dateFilter: true,
  statusOptions: [
    { value: "POSTED", label: "Posted" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  emptyText: "Nothing produced yet",
  headerActions: (
    <Link href="/bill-of-materials" className="button buttonSecondary">
      Bills of materials
    </Link>
  ),
  columns: [
    { key: "entryNumber", label: "Entry No", link: true },
    { key: "entryDate", label: "Date", type: "date" },
    { key: "output.itemName", label: "Product made" },
    { key: "output.variantSku", label: "Variant", type: "mono" },
    { key: "output.quantity", label: "Quantity", type: "number" },
    { key: "formulaName", label: "Formula" },
    { key: "totalValue", label: "Cost", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ],
};

export default function MaterialCreationPage() {
  return <SimpleListView config={config} />;
}
