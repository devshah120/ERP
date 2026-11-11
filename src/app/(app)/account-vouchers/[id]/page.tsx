import VoucherFormView from "@/components/accounting/VoucherFormView";

export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoucherFormView recordId={id} />;
}
