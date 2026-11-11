import { notFound, redirect } from "next/navigation";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { getServerAuthContext } from "@/lib/auth/serverContext";
import { getDocumentUi } from "@/lib/documents/ui";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { serializeDoc } from "@/lib/resources/serialize";
import { Business } from "@/models/Business";
import DocumentPrintSheet, { type PrintDoc, type PrintBusiness } from "@/components/documents/DocumentPrintSheet";
import PrintToolbar from "@/components/documents/PrintToolbar";
import "@/models";

/**
 * Print preview for a transactional document, rendered on the server so the
 * printable sheet exists in the initial HTML. Masters have no print layout,
 * so only document types resolve here.
 */
export default async function DocumentPrintPage({
  params,
}: {
  params: Promise<{ resource: string; id: string }>;
}) {
  const { resource, id } = await params;

  const config = getDocumentUi(resource);
  const def = getDocumentDefinition(resource);
  if (!config || !def) notFound();

  const ctx = await getServerAuthContext();
  if (!ctx) redirect("/login");
  if (!Types.ObjectId.isValid(id)) notFound();

  await connectToDatabase();

  // Tenant-scoped read — a document from another business must not print here.
  const [raw, business] = await Promise.all([
    def.model.findOne({ _id: id, businessId: ctx.businessId }),
    Business.findById(ctx.businessId).lean(),
  ]);
  if (!raw || !business) notFound();

  const record = serializeDoc(raw) as Record<string, unknown>;

  const doc: PrintDoc = {
    ...(record as unknown as PrintDoc),
    // Normalise customer/vendor onto one field so the sheet stays generic.
    party: record[def.party.snapshotField] as PrintDoc["party"],
  };

  const printBusiness: PrintBusiness = {
    name: business.tradeName,
    gstin: business.gstin,
    state: business.state,
    city: business.city,
    address: business.address,
    phone: business.phone,
    email: business.email,
    currency: business.currency,
  };

  return (
    <>
      <PrintToolbar label={`${config.singular} ${doc.documentNumber}`} />
      <DocumentPrintSheet doc={doc} business={printBusiness} config={config} />
    </>
  );
}
