import { notFound } from "next/navigation";
import AnalysisView from "./AnalysisView";

/** Modules that have an analysis screen, with their page titles. */
const MODULES: Record<string, string> = {
  sales: "Sales analysis",
  purchase: "Purchase analysis",
  inventory: "Inventory analysis",
  customers: "Customer analysis",
  vendors: "Supplier analysis",
  accounting: "Cash & settlement analysis",
};

export default async function AnalysisPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const title = MODULES[module];
  // Resolved on the server so an unknown module is a real 404, not an
  // empty screen that looks like a loading failure.
  if (!title) notFound();

  return <AnalysisView module={module} title={title} />;
}
