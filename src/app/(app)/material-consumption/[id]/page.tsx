"use client";

import { use } from "react";
import ProductionEntryDetail from "@/components/inventory/ProductionEntryDetail";

export default function MaterialConsumptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProductionEntryDetail kind="material-consumption" id={id} />;
}
