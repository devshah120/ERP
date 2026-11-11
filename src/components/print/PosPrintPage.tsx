import { notFound, redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { getServerAuthContext } from "@/lib/auth/serverContext";
import { getOrder, getCreditNote } from "@/lib/pos/service";
import { getPosSettings } from "@/lib/settings/service";
import { choosePrintLayout, loadPrintBusiness } from "@/lib/printFormats/server";
import { AppError } from "@/lib/errors/AppError";
import PrintToolbar from "@/components/documents/PrintToolbar";
import { fromPosCreditNote, fromPosOrder } from "./model";
import { PrintSheet } from "./layouts";
import { PrintArea } from "./PrintArea";
import "@/models";

/**
 * Reprint of a POS bill or POS credit note in the chosen print format.
 * Shared by /pos/orders/[id] and /pos/credit-notes/[id].
 */
export default async function PosPrintPage({
  kind,
  id,
  layout,
}: {
  kind: "order" | "credit-note";
  id: string;
  layout?: string | string[];
}) {
  const ctx = await getServerAuthContext();
  if (!ctx) redirect("/login");
  if (!ctx.permissions.includes("*") && !ctx.permissions.includes("pos.view")) redirect("/unauthorized");

  await connectToDatabase();
  const docType = kind === "order" ? "pos-orders" : "pos-credit-notes";

  let doc: Record<string, unknown>;
  try {
    doc = (kind === "order" ? await getOrder(id, ctx) : await getCreditNote(id, ctx)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }

  const [business, settings, choice] = await Promise.all([
    loadPrintBusiness(ctx.businessId),
    getPosSettings(ctx.businessId),
    choosePrintLayout(ctx.businessId, docType, layout),
  ]);
  if (!business) notFound();

  const text = { header: settings.receiptHeader, footer: settings.receiptFooter };
  const model = kind === "order" ? fromPosOrder(doc, business, text) : fromPosCreditNote(doc, business, text);

  return (
    <>
      <PrintToolbar
        label={`${kind === "order" ? "POS Bill" : "POS Credit Note"} ${model.number}`}
        choice={{ docType, layoutId: choice.layout.id, savedId: choice.savedId, options: choice.options }}
      />
      <PrintArea size={choice.layout.size}>
        <PrintSheet layoutId={choice.layout.id} model={model} />
      </PrintArea>
    </>
  );
}
