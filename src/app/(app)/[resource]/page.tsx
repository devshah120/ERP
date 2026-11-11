import { notFound } from "next/navigation";
import { getResourceUi } from "@/lib/resources/ui/registry";
import { getDocumentUi } from "@/lib/documents/ui";
import ResourceListView from "@/components/resource/ResourceListView";
import DocumentListView from "@/components/documents/DocumentListView";
import PaymentListView from "@/components/payments/PaymentListView";
import { getPaymentUi } from "@/lib/payments/ui";

/**
 * One dynamic segment serving both master-data lists (/vendors, /items) and
 * transactional document lists (/sales-orders, /sales-invoices). Static
 * routes such as /dashboard and /customers take precedence in Next.js.
 *
 * Resolved on the server so an unknown slug returns a real HTTP 404.
 */
export default async function ResourceListPage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;

  const masterConfig = getResourceUi(resource);
  if (masterConfig) return <ResourceListView config={masterConfig} />;

  const documentConfig = getDocumentUi(resource);
  if (documentConfig) return <DocumentListView config={documentConfig} />;

  const paymentConfig = getPaymentUi(resource);
  if (paymentConfig) return <PaymentListView config={paymentConfig} />;

  notFound();
}
