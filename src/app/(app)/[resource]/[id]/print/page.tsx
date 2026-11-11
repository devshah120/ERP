import { notFound, redirect } from "next/navigation";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { getServerAuthContext } from "@/lib/auth/serverContext";
import { getDocumentUi } from "@/lib/documents/ui";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { serializeDoc } from "@/lib/resources/serialize";
import { choosePrintLayout, loadPrintBusiness } from "@/lib/printFormats/server";
import { fromDocument } from "@/components/print/model";
import { PrintSheet } from "@/components/print/layouts";
import { PrintArea } from "@/components/print/PrintArea";
import PrintToolbar from "@/components/documents/PrintToolbar";
import "@/models";

/**
 * Print preview for a transactional document, rendered on the server so the
 * printable sheet exists in the initial HTML. The layout comes from
 * Settings · Print Formats, or `?layout=` for a one-off. Masters have no
 * print layout, so only document types resolve here.
 */
export default async function DocumentPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ resource: string; id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ resource, id }, query] = await Promise.all([params, searchParams]);

  const config = getDocumentUi(resource);
  const def = getDocumentDefinition(resource);
  if (!config || !def) notFound();

  const ctx = await getServerAuthContext();
  if (!ctx) redirect("/login");
  if (!Types.ObjectId.isValid(id)) notFound();

  await connectToDatabase();

  // Tenant-scoped read — a document from another business must not print here.
  const [raw, business, choice] = await Promise.all([
    def.model.findOne({ _id: id, businessId: ctx.businessId }),
    loadPrintBusiness(ctx.businessId),
    choosePrintLayout(ctx.businessId, resource, query.layout),
  ]);
  if (!raw || !business) notFound();

  const record = serializeDoc(raw) as Record<string, unknown>;
  // A GST sale is legally a "Tax Invoice"; every other type prints its own name.
  const title = resource === "sales-invoices" ? "Tax Invoice" : config.singular;
  const model = fromDocument(record, business, { title, partyField: config.partyField });

  return (
    <>
      <PrintToolbar
        label={`${config.singular} ${model.number}`}
        choice={{ docType: resource, layoutId: choice.layout.id, savedId: choice.savedId, options: choice.options }}
      />
      <PrintArea size={choice.layout.size}>
        <PrintSheet layoutId={choice.layout.id} model={model} />
      </PrintArea>
    </>
  );
}
