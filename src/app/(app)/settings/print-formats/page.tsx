import PrintFormatsView from "@/components/settings/PrintFormatsView";

/** Settings · Print Formats (its own screen; the generic settings form doesn't fit a layout picker). */
export default async function PrintFormatsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { type } = await searchParams;
  return <PrintFormatsView initialType={typeof type === "string" ? type : undefined} />;
}
