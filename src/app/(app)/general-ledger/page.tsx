import ReportView from "@/components/reports/ReportView";

/**
 * The General Ledger is the ledger report under its own menu entry, rather
 * than a second implementation of the same query.
 */
export default function GeneralLedgerPage() {
  return <ReportView reportKey="general-ledger" />;
}
