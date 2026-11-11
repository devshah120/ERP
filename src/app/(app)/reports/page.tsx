import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { listReports } from "@/lib/reports/service";
import PageHeader from "@/components/ui/PageHeader";
import { IconSales, IconPurchase, IconPercent, IconBox, IconDatabase, IconBook, IconClipboard } from "@/components/icons";

const MODULE_ICON: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  Sales: IconSales,
  Purchase: IconPurchase,
  GST: IconPercent,
  Inventory: IconBox,
  Masters: IconDatabase,
  Accounting: IconBook,
};

const MODULE_BLURB: Record<string, string> = {
  Sales: "Invoices raised and what was sold",
  Purchase: "Bills received and what was bought",
  GST: "Tax summaries in return-ready shape",
  Inventory: "On-hand stock and every movement",
  Masters: "Parties and products with their activity",
  Accounting: "Ledger balances and profitability",
};

/** Reports index: step 1 of the workflow — pick a report type. Column
 *  selection and filters then happen on the report screen itself. */
export default function ReportsIndexPage() {
  const reports = listReports();

  const byModule = reports.reduce<Record<string, typeof reports>>((acc, r) => {
    (acc[r.module] ??= []).push(r);
    return acc;
  }, {});

  const moduleOrder = ["Sales", "Purchase", "GST", "Inventory", "Accounting", "Masters"];
  const modules = Object.keys(byModule).sort(
    (a, b) => (moduleOrder.indexOf(a) + 1 || 99) - (moduleOrder.indexOf(b) + 1 || 99)
  );

  return (
    <>
      <PageHeader
        title="Reports"
        count={reports.length}
        description="Pick a report, choose exactly the columns you need, filter, then export to Excel or CSV — the file matches what's on screen."
      />

      {modules.map((module) => {
        const Icon = MODULE_ICON[module] ?? IconClipboard;
        return (
          <section key={module} className="reportGroup" aria-labelledby={`rg-${module}`}>
            <h2 className="reportGroupTitle" id={`rg-${module}`}>
              {module}
              {MODULE_BLURB[module] && <span>· {MODULE_BLURB[module]}</span>}
            </h2>
            <div className="reportGrid">
              {byModule[module].map((r) => (
                <Link key={r.key} href={`/reports/${r.key}`} className="reportCard">
                  <span className="reportCardIcon" aria-hidden>
                    <Icon />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="reportCardTitle">{r.title}</div>
                    <div className="reportCardDesc">{r.description}</div>
                    <div className="reportCardMeta">{r.columnCount} columns · Excel &amp; CSV</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
