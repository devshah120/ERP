import ReportView from "@/components/reports/ReportView";

/**
 * Stock Ledger under its own menu entry. It is the same report as
 * /reports/stock-ledger — one query, two ways in, rather than two screens
 * that could drift apart.
 */
export default function StockLedgerPage() {
  return <ReportView reportKey="stock-ledger" />;
}
