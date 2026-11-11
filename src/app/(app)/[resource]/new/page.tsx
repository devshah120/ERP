import { notFound } from "next/navigation";
import { getResourceUi } from "@/lib/resources/ui/registry";
import { getDocumentUi } from "@/lib/documents/ui";
import ResourceFormView from "@/components/resource/ResourceFormView";
import DocumentFormView from "@/components/documents/DocumentFormView";
import PaymentFormView from "@/components/payments/PaymentFormView";
import { getPaymentUi } from "@/lib/payments/ui";

export default async function ResourceCreatePage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;

  const masterConfig = getResourceUi(resource);
  if (masterConfig) return <ResourceFormView config={masterConfig} />;

  const documentConfig = getDocumentUi(resource);
  if (documentConfig) return <DocumentFormView config={documentConfig} />;

  const paymentConfig = getPaymentUi(resource);
  if (paymentConfig) return <PaymentFormView config={paymentConfig} />;

  notFound();
}
