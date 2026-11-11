"use client";

import Link from "next/link";
import { formatMoney } from "@/lib/format/number";
import StatusBadge from "@/components/ui/StatusBadge";
import { EmptyState, ErrorState } from "@/components/ui/States";

export interface MiniDoc {
  id: string;
  documentNumber?: string;
  documentDate?: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  dueAmount?: string;
  customer?: { name?: string };
  vendor?: { name?: string };
  totals?: { grandTotal?: string };
}

export interface MiniListState {
  items: MiniDoc[];
  total: number;
}

function date(v?: string) {
  return v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—";
}

/** Days past due — undefined when there is no due date or it hasn't passed. */
function overdueDays(due?: string): number | undefined {
  if (!due) return undefined;
  const d = Math.floor((Date.now() - new Date(due).getTime()) / 86_400_000);
  return d > 0 ? d : undefined;
}

/**
 * A compact document table for dashboard panels. "amount" shows the grand
 * total; "due" shows what is still owed plus how late it is.
 */
export default function DocMiniList({
  title,
  subtitle,
  basePath,
  viewAllHref,
  state,
  error,
  amount = "total",
  status = "document",
  emptyText,
}: {
  title: string;
  subtitle?: string;
  basePath: string;
  viewAllHref: string;
  state: MiniListState | null;
  error?: string | null;
  amount?: "total" | "due";
  status?: "document" | "payment";
  emptyText: string;
}) {
  return (
    <section className="card" aria-label={title}>
      <div className="cardHeader">
        <div>
          <div className="cardTitle">
            {title}
            {state && state.total > 0 && (
              <span className="pageTitleCount" style={{ marginLeft: "0.5rem", fontSize: "0.7rem" }}>
                {state.total}
              </span>
            )}
          </div>
          {subtitle && <div className="cardSubtitle">{subtitle}</div>}
        </div>
        <Link href={viewAllHref}>View all →</Link>
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : !state ? (
        <div style={{ padding: "0.75rem 1.125rem", display: "grid", gap: "0.75rem" }} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skeleton" style={{ width: `${85 - i * 12}%` }} />
          ))}
        </div>
      ) : state.items.length === 0 ? (
        <EmptyState compact title="All clear" description={emptyText} />
      ) : (
        <div className="miniTableWrap">
          <table className="miniTable">
            <thead>
              <tr>
                <th>Number</th>
                <th>Party</th>
                <th>{amount === "due" ? "Due date" : "Date"}</th>
                <th className="numCell">{amount === "due" ? "Outstanding" : "Amount"}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((d) => {
                const late = amount === "due" ? overdueDays(d.dueDate ?? d.documentDate) : undefined;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`${basePath}/${d.id}`} className="cellLink">
                        {d.documentNumber || "Draft"}
                      </Link>
                    </td>
                    <td
                      className="miniTableParty"
                      style={{ maxWidth: "11rem", overflow: "hidden", textOverflow: "ellipsis" }}
                      title={d.customer?.name ?? d.vendor?.name ?? undefined}
                    >
                      {d.customer?.name ?? d.vendor?.name ?? "—"}
                    </td>
                    <td className="cellMuted">
                      {amount === "due" ? date(d.dueDate ?? d.documentDate) : date(d.documentDate)}
                      {late !== undefined && (
                        <span className="cellSub" style={{ color: "var(--danger)" }}>
                          {late} day{late === 1 ? "" : "s"} late
                        </span>
                      )}
                    </td>
                    <td className="numCell">
                      ₹{formatMoney(amount === "due" ? d.dueAmount ?? "0" : d.totals?.grandTotal ?? "0")}
                    </td>
                    <td>
                      <StatusBadge
                        status={status === "payment" ? d.paymentStatus ?? "UNPAID" : d.status}
                        kind={status}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
