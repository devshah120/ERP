"use client";

import { getResourceUi } from "@/lib/resources/ui/registry";
import ResourceListView from "@/components/resource/ResourceListView";
import AccountingSetup from "@/components/accounting/AccountingSetup";

/**
 * The chart of accounts is an ordinary master, so it reuses the generic list.
 * The only thing added here is the setup/backfill panel, because an empty
 * chart is the one state where the list alone would not explain itself.
 */
export default function ChartOfAccountsPage() {
  const config = getResourceUi("chart-of-accounts")!;
  return (
    <>
      <AccountingSetup />
      <ResourceListView config={config} />
    </>
  );
}
