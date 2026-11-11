"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AgingTable, ItemPerformance, OverviewResult, Segment } from "@/lib/analytics/overview";
import { formatMoney, formatCompact, formatQuantity } from "@/lib/format/number";
import { EmptyState } from "@/components/ui/States";
import { Donut, Panel, RangeTag, Tabs } from "./Widgets";

const MODE_LABEL: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  UPI: "UPI",
  BANK: "Bank transfer",
  CHEQUE: "Cheque",
  CREDIT: "Credit",
  MIXED: "Mixed",
  ADJUSTMENT: "Adjustment",
};

type Range = { fromDate: string; toDate: string };

/* ------------------------------------------------------------------ */

export function PaymentModePanel({ data, range }: { data: OverviewResult["paymentModes"]; range: Range }) {
  // Start on whichever view has something to show.
  const [source, setSource] = useState<"sales" | "receipts">(data.receipts.length > 0 ? "receipts" : "sales");
  const rows = data[source];
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  return (
    <Panel
      title="Payment Mode Distribution"
      actions={<RangeTag range={range} />}
      className="span5"
    >
      <select className="select dSelect" value={source} onChange={(e) => setSource(e.target.value as "sales" | "receipts")} aria-label="What to break down">
        <option value="receipts">Money received</option>
        <option value="sales">Sales invoices</option>
      </select>
      <Donut
        centerLabel={source === "receipts" ? "TOTAL RECEIVED" : "TOTAL SALES"}
        centerValue={`₹${formatCompact(total)}`}
        slices={rows.map((r) => ({
          label: MODE_LABEL[r.mode] ?? r.mode,
          value: Number(r.amount),
          display: `₹${formatMoney(r.amount)}`,
        }))}
      />
      <p className="dFootnote">
        {source === "receipts"
          ? "Receipts recorded in the period, by how the money came in."
          : "Invoices raised in the period, by the payment terms on the invoice."}
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

const BUCKETS: { key: keyof Pick<AgingTable["totals"], "b0_30" | "b31_60" | "b61_90" | "b90">; label: string; tone: string; min: number; max?: number }[] = [
  { key: "b0_30", label: "< 30", tone: "blue", min: 0, max: 30 },
  { key: "b31_60", label: "31–60", tone: "green", min: 31, max: 60 },
  { key: "b61_90", label: "61–90", tone: "amber", min: 61, max: 90 },
  { key: "b90", label: "> 90", tone: "rose", min: 91 },
];

export function AgingPanel({ aging }: { aging: OverviewResult["aging"] }) {
  const [side, setSide] = useState<"receivable" | "payable">("receivable");
  const table = side === "receivable" ? aging.receivable : aging.payable;
  const isAR = side === "receivable";

  return (
    <Panel
      title={
        <>
          Receivables and Payables
          <span className="dChip">Total receivable: ₹{formatMoney(aging.receivable.totals.total)}</span>
          {aging.payable && <span className="dChip">Total payable: ₹{formatMoney(aging.payable.totals.total)}</span>}
        </>
      }
      actions={
        <>
          <span className="dateRangePill dateRangeTag" title="Aging is always measured as of today">
            As of today
          </span>
          <Link href="/analysis/accounting" className="dLink">
            View detailed report
          </Link>
        </>
      }
      className="span12"
    >
      <Tabs
        tabs={[{ key: "receivable", label: "Receivable" }, ...(aging.payable ? [{ key: "payable" as const, label: "Payable" }] : [])]}
        value={side}
        onChange={setSide}
      />
      {!table || table.rows.length === 0 ? (
        <EmptyState compact title={isAR ? "No money owed to you" : "Nothing owed to suppliers"} description="Every posted invoice is fully settled." />
      ) : (
        <div className="dTableWrap">
          <table className="dTable">
            <thead>
              <tr>
                <th style={{ width: "3rem" }}>#</th>
                <th>{isAR ? "Customer name" : "Supplier name"}</th>
                <th>Mobile number</th>
                <th className="numCell">Total outstanding</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} className="numCell">
                    <span className={`agingHead agingHead-${b.tone}`}>{b.label}</span>
                  </th>
                ))}
                <th className="numCell">Action</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={r.partyId}>
                  <td className="cellMuted">{i + 1}</td>
                  <td>
                    <Link href={`${isAR ? "/customers" : "/vendors"}/${r.partyId}`} className="cellLink">
                      {r.name}
                    </Link>
                  </td>
                  <td className="cellMuted tabular">{r.phone ?? "—"}</td>
                  <td className="numCell" style={{ fontWeight: 600 }}>
                    ₹{formatMoney(r.total)}
                  </td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="numCell">
                      <Link
                        href={`${isAR ? "/sales-invoices" : "/purchase-invoices"}?outstanding=true${b.min > 0 ? `&minAgeDays=${b.min}` : ""}${b.max !== undefined ? `&maxAgeDays=${b.max}` : ""}&partyName=${encodeURIComponent(r.name)}`}
                        className={`agingCell agingCell-${b.tone} ${Number(r[b.key]) === 0 ? "agingZero" : ""}`}
                        title={`Open ${isAR ? "invoices" : "bills"} in this age band`}
                      >
                        {formatMoney(r[b.key])}
                      </Link>
                    </td>
                  ))}
                  <td className="numCell">
                    <Link href={`${isAR ? "/receipts" : "/payments"}/new?partyId=${r.partyId}`} className="dActionBtn">
                      {isAR ? "Record receipt" : "Record payment"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  Total
                  {table.partyCount > table.rows.length && (
                    <span className="cellMuted" style={{ fontWeight: 400 }}>
                      {" "}
                      · all {table.partyCount} {isAR ? "customers" : "suppliers"}, top {table.rows.length} shown
                    </span>
                  )}
                </td>
                <td className="numCell">₹{formatMoney(table.totals.total)}</td>
                {BUCKETS.map((b) => (
                  <td key={b.key} className="numCell">
                    {formatMoney(table.totals[b.key])}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

const SEG_LAYOUT: Record<string, { area: string; tone: string }> = {
  cantLose: { area: "1 / 1 / 2 / 2", tone: "green" },
  loyal: { area: "1 / 2 / 3 / 3", tone: "amber" },
  champions: { area: "1 / 3 / 2 / 4", tone: "violet" },
  atRisk: { area: "2 / 1 / 3 / 2", tone: "rose" },
  potential: { area: "2 / 3 / 3 / 4", tone: "sky" },
  hibernating: { area: "3 / 1 / 4 / 2", tone: "blue" },
  needsAttention: { area: "3 / 2 / 4 / 3", tone: "yellow" },
  promising: { area: "3 / 3 / 4 / 4", tone: "teal" },
};

const SEG_HELP: Record<string, string> = {
  cantLose: "Valuable customers who haven't bought recently",
  loyal: "Buy regularly with steady value",
  champions: "Bought recently, often and for high value",
  atRisk: "Used to buy well but have gone quiet",
  potential: "Recent buyers with growing value",
  hibernating: "Low value and not seen recently",
  needsAttention: "Middling recency, low value",
  promising: "Recent but small purchases so far",
};

export function CustomerInsightPanel({ segments, range }: { segments: OverviewResult["segments"]; range: Range }) {
  return (
    <Panel
      title="Customer Insight"
      actions={
        <>
          <RangeTag range={range} />
          <Link href="/analysis/customers" className="dLink">
            View detailed report
          </Link>
        </>
      }
      className="span7"
    >
      {segments.customers === 0 ? (
        <EmptyState compact title="No customer purchases in this period" description="Segments appear once invoices are raised." />
      ) : (
        <div className="rfm">
          <div className="rfmY">
            <span>Very high</span>
            <span>High</span>
            <span>Medium</span>
            <span>Low</span>
            <span>Very low</span>
            <em>Frequency &amp; monetary value</em>
          </div>
          <div className="rfmGrid">
            {segments.items.map((s: Segment) => (
              <div
                key={s.key}
                className={`rfmCell rfm-${SEG_LAYOUT[s.key].tone}`}
                style={{ gridArea: SEG_LAYOUT[s.key].area }}
                title={`${SEG_HELP[s.key]} · ₹${formatMoney(s.value)} sales`}
              >
                <div className="rfmLabel">{s.label}</div>
                <div className="rfmPct">{Number(s.percent).toFixed(2)}%</div>
                <div className="rfmCount">
                  {s.customers} customer{s.customers === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
          <div className="rfmX">
            <span>Low</span>
            <span>Medium</span>
            <span>High</span>
            <em>Recency</em>
          </div>
        </div>
      )}
      <p className="dFootnote">
        {segments.customers} customer{segments.customers === 1 ? "" : "s"} who bought in this period, scored against each
        other on how recently, how often and how much they bought.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function SalesBreakdownPanel({ categories, range }: { categories: OverviewResult["categories"]; range: Range }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const total = categories.reduce((a, c) => a + Number(c.value), 0);
  return (
    <Panel title="Sales Breakdown" actions={<RangeTag range={range} />} className="span5">
      <div className="dTabsRow">
        <Tabs
          tabs={[
            { key: "chart", label: "Chart" },
            { key: "table", label: "Table" },
          ]}
          value={view}
          onChange={setView}
        />
        <span className="dTabsNote">Category wise</span>
      </div>
      {categories.length === 0 ? (
        <EmptyState compact title="No sales in this period" />
      ) : view === "chart" ? (
        <Donut
          centerLabel="NET SALES"
          centerValue={`₹${formatCompact(total)}`}
          slices={categories.map((c) => ({ label: c.name, value: Number(c.value), display: `₹${formatMoney(c.value)}`, percent: c.percent }))}
        />
      ) : (
        <table className="dTable">
          <thead>
            <tr>
              <th>Category</th>
              <th className="numCell">Sales</th>
              <th className="numCell">Share</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="numCell">₹{formatMoney(c.value)}</td>
                <td className="numCell cellMuted">{c.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function ItemPerformancePanel({ items, range }: { items: ItemPerformance[]; range: Range }) {
  const [which, setWhich] = useState<"best" | "least">("best");
  const [metric, setMetric] = useState<"quantity" | "amount">("quantity");

  const rows = useMemo(() => {
    const val = (i: ItemPerformance) => (metric === "quantity" ? i.quantity : Number(i.amount));
    const sorted = [...items].sort((a, b) => (which === "best" ? val(b) - val(a) : val(a) - val(b)));
    return sorted.slice(0, 10);
  }, [items, which, metric]);

  const max = Math.max(1, ...rows.map((r) => (metric === "quantity" ? r.quantity : Number(r.amount))));

  return (
    <Panel
      title={
        <Tabs
          tabs={[
            { key: "best", label: "Best Selling" },
            { key: "least", label: "Least Selling" },
          ]}
          value={which}
          onChange={setWhich}
        />
      }
      actions={
        <>
          <RangeTag range={range} />
          <select className="select dSelect" value={metric} onChange={(e) => setMetric(e.target.value as "quantity" | "amount")} aria-label="Rank by">
            <option value="quantity">Sold Qty</option>
            <option value="amount">Sales Amount</option>
          </select>
        </>
      }
      className="span7"
    >
      <div style={{ textAlign: "right", marginTop: "-0.25rem" }}>
        <Link href="/reports/item-report" className="dLink">
          View detailed report
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact title="Nothing sold in this period" />
      ) : (
        <>
          <div className="hbars" role="img" aria-label={`${which === "best" ? "Best" : "Least"} selling items by ${metric === "quantity" ? "quantity" : "amount"}`}>
            {rows.map((r) => {
              const v = metric === "quantity" ? r.quantity : Number(r.amount);
              return (
                <Link key={r.itemId} href={`/items/${r.itemId}`} className="hbar" title={`${r.name}: ${metric === "quantity" ? formatQuantity(v) : `₹${formatMoney(v)}`}`}>
                  <span className="hbarLabel">{r.name}</span>
                  <span className="hbarTrack">
                    <span className="hbarFill" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
                  </span>
                  <span className="hbarValue">{metric === "quantity" ? formatQuantity(v) : `₹${formatCompact(v)}`}</span>
                </Link>
              );
            })}
          </div>
          <div className="dTableWrap" style={{ marginTop: "1rem" }}>
            <table className="dTable">
              <thead>
                <tr>
                  <th style={{ width: "3rem" }}>#</th>
                  <th>Item name</th>
                  <th className="numCell">No. of bills</th>
                  <th className="numCell">Qty</th>
                  <th className="numCell">Amount</th>
                  <th className="numCell" title="Taxable value minus quantity × the item's current cost price">
                    Est. margin
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.itemId}>
                    <td className="cellMuted">{i + 1}</td>
                    <td>
                      <Link href={`/items/${r.itemId}`} className="cellLink">
                        {r.name}
                      </Link>
                    </td>
                    <td className="numCell">{r.bills}</td>
                    <td className="numCell">{formatQuantity(r.quantity)}</td>
                    <td className="numCell">₹{formatMoney(r.amount)}</td>
                    <td className="numCell" style={r.margin && Number(r.margin) < 0 ? { color: "var(--danger)" } : undefined}>
                      {r.margin === null ? <span className="cellMuted" title="No cost price on the item">—</span> : `₹${formatMoney(r.margin)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
