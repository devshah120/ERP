import StockDocumentFormView from "@/components/inventory/StockDocumentFormView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StockDocumentFormView kind="stock-transfers" recordId={id} />;
}
