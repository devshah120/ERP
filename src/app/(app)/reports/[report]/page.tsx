import { notFound } from "next/navigation";
import { REPORTS } from "@/lib/reports/service";
import ReportView from "@/components/reports/ReportView";

export default async function ReportPage({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  if (!REPORTS[report]) notFound();

  return <ReportView reportKey={report} />;
}
