"use client";

import { use } from "react";
import Link from "next/link";
import DetailShell, { DetailGrid, Panel, fmtDate } from "@/components/detail/DetailShell";
import { formatMoney } from "@/lib/format/number";

export default function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <DetailShell
      apiPath={`/api/expenses/${id}`}
      backHref="/expenses"
      backLabel="Expenses"
      title={(r) => <span className="cellMono">{String(r.expenseNumber)}</span>}
      description={(r) => `${String(r.expenseAccountName)} · ${fmtDate(r.expenseDate)}`}
      cancel={{
        permission: "expenses.cancel",
        when: (r) => r.status === "POSTED",
        label: "Cancel expense",
        message: "The journal entry is reversed with an opposite entry. The expense stays on record as cancelled.",
      }}
    >
      {(r) => (
        <>
          <Panel title="Expense">
            <DetailGrid
              items={[
                { label: "Date", value: fmtDate(r.expenseDate) },
                { label: "Expense head", value: String(r.expenseAccountName) },
                { label: "Paid to", value: r.payee as string },
                { label: "Paid from", value: String(r.paidFromAccountName) },
                { label: "Mode", value: r.paymentMode as string },
                { label: "Reference", value: r.reference as string },
              ]}
            />
          </Panel>
          <Panel title="Amount">
            <DetailGrid
              items={[
                { label: "Amount", value: formatMoney(String(r.amount)) },
                { label: `GST ${r.taxRatePercent}%`, value: r.interState ? `IGST ${formatMoney(String(r.igstAmount))}` : `CGST ${formatMoney(String(r.cgstAmount))} + SGST ${formatMoney(String(r.sgstAmount))}` },
                { label: "Total paid", value: <strong>{formatMoney(String(r.totalAmount))}</strong> },
                {
                  label: "Journal entry",
                  value: (
                    <Link href={`/account-vouchers?query=${encodeURIComponent(String(r.expenseNumber))}`} className="textLink">
                      View in Journal Vouchers
                    </Link>
                  ),
                },
              ]}
            />
            {typeof r.notes === "string" && r.notes && <p className="fieldHint" style={{ marginTop: "0.75rem" }}>{r.notes}</p>}
            {r.status === "CANCELLED" && (
              <div className="banner bannerWarning" style={{ marginTop: "0.75rem" }}>
                <span>Cancelled {fmtDate(r.cancelledAt, true)} — {String(r.cancellationReason ?? "")}</span>
              </div>
            )}
          </Panel>
        </>
      )}
    </DetailShell>
  );
}
