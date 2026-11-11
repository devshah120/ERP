import PosPrintPage from "@/components/print/PosPrintPage";

/** A POS bill, shown and reprinted in the chosen print format. */
export default async function PosOrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <PosPrintPage kind="order" id={id} layout={query.layout} />;
}
