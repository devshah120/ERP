import PosPrintPage from "@/components/print/PosPrintPage";

/** A POS credit note (counter return), shown and reprinted in the chosen print format. */
export default async function PosCreditNotePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <PosPrintPage kind="credit-note" id={id} layout={query.layout} />;
}
