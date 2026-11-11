"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../AuthProvider";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { DashboardResult, Kpi } from "@/lib/analytics/types";
import type { OverviewResult } from "@/lib/analytics/overview";
import { periodQuery, isPeriodReady, type PeriodState } from "@/components/analytics/PeriodPicker";
import DocMiniList, { type MiniListState } from "@/components/analytics/DocMiniList";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import { ErrorState, EmptyState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { formatMoney, formatCompact, formatQuantity } from "@/lib/format/number";
import { COLORS } from "@/lib/analytics/types";
import {
  DateRangePill,
  Delta,
  Gauge,
  OverviewTile,
  Panel,
  RangeTag,
  TrendChart,
  type TileSpec,
} from "@/components/dashboard/Widgets";
import {
  AgingPanel,
  CustomerInsightPanel,
  ItemPerformancePanel,
  PaymentModePanel,
  SalesBreakdownPanel,
} from "@/components/dashboard/Panels";
import { IconRefresh, IconCheckCircle, IconChevronRight } from "@/components/icons";

interface LowStockRow {
  itemName?: string;
  itemNameHref?: string;
  variantSku?: string;
  warehouse?: string;
  quantity?: number;
  reorderLevel?: number;
}

export default function DashboardPage() {
  const { me } = useAuth();
  const [period, setPeriod] = useState<PeriodState>({ period: "month", fromDate: "", toDate: "" });
  const [dash, setDash] = useState<DashboardResult | null>(null);
  const [ov, setOv] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [invoices, setInvoices] = useState<MiniListState | null>(null);
  const [pendingDelivery, setPendingDelivery] = useState<MiniListState | null>(null);
  const [lowStock, setLowStock] = useState<{ rows: LowStockRow[]; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!isPeriodReady(period)) return;
    setLoading(true);
    setError(null);
    try {
      const qs = periodQuery(period);
      const [d, o] = await Promise.all([
        apiFetch<DashboardResult>(`/api/analytics/dashboard?${qs}`),
        apiFetch<OverviewResult>(`/api/analytics/overview?${qs}`),
      ]);
      setDash(d);
      setOv(o);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  // "Right now" panels don't depend on the period.
  const loadLive = useCallback(async () => {
    const q = (o: Record<string, string>) => new URLSearchParams({ page: "1", pageSize: "6", ...o }).toString();
    const [b, c, d] = await Promise.allSettled([
      apiFetch<MiniListState>(`/api/documents/sales-invoices?${q({ sortBy: "createdAt", sortDir: "desc" })}`),
      apiFetch<MiniListState>(`/api/documents/sales-orders?${q({ pendingDelivery: "true", sortBy: "documentDate", sortDir: "asc" })}`),
      apiFetch<{ rows: LowStockRow[]; total: number }>(
        `/api/reports/stock-summary?${q({ stockFilter: "LOW", columns: "itemName,variantSku,warehouse,quantity,reorderLevel" })}`
      ),
    ]);
    setInvoices(b.status === "fulfilled" ? b.value : { items: [], total: 0 });
    setPendingDelivery(c.status === "fulfilled" ? c.value : { items: [], total: 0 });
    setLowStock(d.status === "fulfilled" ? d.value : { rows: [], total: 0 });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLive();
  }, [loadLive]);

  const refreshAll = useCallback(() => {
    load();
    loadLive();
  }, [load, loadLive]);

  useShortcutScope({ onRefresh: refreshAll });

  const kpi = useMemo(() => {
    const m = new Map<string, Kpi>((dash?.kpis ?? []).map((k) => [k.key, k]));
    return (key: string) => m.get(key);
  }, [dash]);

  const tiles: TileSpec[] = useMemo(() => {
    if (!dash || !ov) return [];
    const m = ov.metrics;
    const v = (key: string) => kpi(key)?.value ?? "0";
    const h = (key: string) => kpi(key)?.href;
    const range = `fromDate=${ov.period.fromDate.slice(0, 10)}&toDate=${ov.period.toDate.slice(0, 10)}`;
    const list: (TileSpec | null)[] = [
      // row 1
      { key: "sales", label: "Total Sales", value: m.sales.current, previous: m.sales.previous, kind: "money", tint: "green", href: h("totalSales") },
      { key: "inv", label: "Total Invoices", value: m.salesCount.current, previous: m.salesCount.previous, kind: "count", tint: "violet", href: h("invoiceCount") },
      { key: "qty", label: "Sold Qty", value: m.soldQty.current, previous: m.soldQty.previous, kind: "quantity", tint: "amber", href: "/reports/sales-detail" },
      { key: "cust", label: "Total Customers", value: v("customers"), kind: "count", tint: "rose", href: "/customers" },
      { key: "sret", label: "Total Sales Return", value: m.salesReturns.current, previous: m.salesReturns.previous, kind: "money", tint: "blue", goodWhen: "down", href: `/sales-returns?${range}` },
      // row 2
      { key: "pur", label: "Total Purchase", value: m.purchase.current, previous: m.purchase.previous, kind: "money", tint: "green", goodWhen: "down", href: h("totalPurchase") },
      { key: "bills", label: "Total Bills", value: m.purchaseCount.current, previous: m.purchaseCount.previous, kind: "count", tint: "violet", href: h("billCount") },
      { key: "sup", label: "Total Suppliers", value: v("vendors"), kind: "count", tint: "amber", href: "/vendors" },
      m.purchaseReturns
        ? { key: "pret", label: "Total Purchase Return", value: m.purchaseReturns.current, previous: m.purchaseReturns.previous, kind: "money", tint: "rose", goodWhen: "down", href: `/purchase-returns?${range}` }
        : null,
      m.paidOut
        ? { key: "paid", label: "Total Paid", value: m.paidOut.current, previous: m.paidOut.previous, kind: "money", tint: "blue", goodWhen: "down", href: `/payments?${range}` }
        : null,
      // row 3
      { key: "rec", label: "Total Received", value: m.received.current, previous: m.received.previous, kind: "money", tint: "green", href: `/receipts?${range}` },
      { key: "coll", label: "Collection Rate", value: v("collection"), kind: "percent", tint: "violet", hint: "Share of this period's invoiced value already collected" },
      { key: "stockQty", label: "Stock Qty", value: v("stockQty"), kind: "quantity", tint: "amber", href: "/inventory" },
      { key: "stockVal", label: "Stock Value", value: v("stockValue"), kind: "money", tint: "rose", href: "/inventory", hint: kpi("stockValue")?.hint },
      { key: "ar", label: "To Receive", value: v("receivable"), kind: "money", tint: "blue", href: h("receivable"), hint: "All open invoices, not just this period" },
      // row 4
      { key: "avg", label: "Avg Invoice Value", value: m.avgInvoice.current, previous: m.avgInvoice.previous, kind: "money", tint: "green" },
      { key: "pso", label: "Pending Sales Orders", value: v("pendingSo"), kind: "count", tint: "violet", href: h("pendingSo") },
      { key: "items", label: "Total Products", value: v("items"), kind: "count", tint: "amber", href: "/items" },
      { key: "low", label: "Low Stock Items", value: v("lowStock"), kind: "count", tint: "rose", href: h("lowStock") },
      { key: "ap", label: "To Pay", value: v("payable"), kind: "money", tint: "blue", href: h("payable"), hint: "All open bills, not just this period" },
    ];
    return list.filter((t): t is TileSpec => t !== null);
  }, [dash, ov, kpi]);

  if (!me) return null;
  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const range = ov ? { fromDate: ov.period.fromDate, toDate: ov.period.toDate } : undefined;
  const trend = dash?.charts.find((c) => c.key === "sales-vs-purchase");
  const collection = kpi("collection");
  const synced = dash ? new Date(dash.generatedAt) : null;

  return (
    <div className="dash">
      {error !== null && !dash && (
        <div className="dPanel" style={{ marginBottom: "1rem" }}>
          <ErrorState
            title="The dashboard couldn't load"
            message={error instanceof ApiError ? error.message : "Check your connection and try again."}
            onRetry={load}
          />
        </div>
      )}

      <div className="dashGrid">
        {/* ---------------------------------------------------- overview */}
        <Panel
          className="span9"
          title="Overview"
          actions={
            <>
              <DateRangePill value={period} onChange={setPeriod} range={range} />
              {synced && (
                <span className="dSynced">
                  <small>Last synced</small>
                  {synced.toLocaleDateString("en-GB")}, {synced.toLocaleTimeString("en-GB")}
                </span>
              )}
              <button type="button" className="dRefresh" onClick={refreshAll} disabled={loading} aria-label="Refresh dashboard" title="Refresh (Ctrl + R)">
                {loading ? <span className="spinner" /> : <IconRefresh />}
              </button>
            </>
          }
        >
          {tiles.length === 0 ? (
            <div className="ovGrid" aria-busy="true">
              {Array.from({ length: 20 }, (_, i) => (
                <div key={i} className="ovTile ovTileSkeleton">
                  <span className="skeleton" style={{ width: "55%", height: "1rem" }} />
                  <span className="skeleton" style={{ width: "70%" }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="ovGrid" style={{ opacity: loading ? 0.6 : 1 }}>
              {tiles.map((t) => (
                <OverviewTile key={t.key} t={t} />
              ))}
            </div>
          )}
          {ov && (
            <p className="dFootnote">
              Changes compare with {new Date(ov.previous.fromDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} –{" "}
              {new Date(ov.previous.toDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}, the same
              length of time just before. Stock, balances and counts of records are as of now.
            </p>
          )}
        </Panel>

        {/* --------------------------------------------------- right rail */}
        <div className="span3 dRail">
          <Panel title="Collection Health">
            <Gauge
              percent={collection ? Number(collection.value) : null}
              label="collected"
              caption={
                ov ? (
                  <>
                    ₹{formatCompact(ov.metrics.received.current)} received against ₹{formatCompact(ov.metrics.sales.current)} invoiced
                  </>
                ) : undefined
              }
            />
            <Link href="/analysis/accounting" className="dLink" style={{ display: "block", textAlign: "center", marginTop: "0.5rem" }}>
              Cash &amp; settlement analysis
            </Link>
          </Panel>

          <Panel title="Cash Position">
            {ov ? (
              <div className="cashList">
                <div>
                  <span>Money in</span>
                  <strong>₹{formatMoney(ov.metrics.received.current)}</strong>
                  <Delta current={ov.metrics.received.current} previous={ov.metrics.received.previous} />
                </div>
                {ov.metrics.paidOut && (
                  <div>
                    <span>Money out</span>
                    <strong>₹{formatMoney(ov.metrics.paidOut.current)}</strong>
                    <Delta current={ov.metrics.paidOut.current} previous={ov.metrics.paidOut.previous} goodWhen="down" />
                  </div>
                )}
                {ov.metrics.paidOut && (
                  <div className="cashNet">
                    <span>Net movement</span>
                    <strong style={{ color: Number(ov.metrics.received.current) - Number(ov.metrics.paidOut.current) < 0 ? "var(--danger)" : "var(--success)" }}>
                      ₹{formatMoney(Number(ov.metrics.received.current) - Number(ov.metrics.paidOut.current))}
                    </strong>
                  </div>
                )}
              </div>
            ) : (
              <SkeletonBlock lines={3} />
            )}
          </Panel>
        </div>

        {/* ------------------------------------------------------ trend */}
        <Panel className="span7" title="Sales & Purchase Trend" actions={<RangeTag range={range} />}>
          <div className="trendWrap">
            <div className="trendMain">
              {trend ? (
                <TrendChart
                  series={trend.series.map((s, i) => ({
                    name: s.name,
                    color: i === 0 ? COLORS.sales : COLORS.purchase,
                    points: s.points,
                  }))}
                />
              ) : (
                <SkeletonBlock height="12rem" />
              )}
            </div>
            {ov && (
              <div className="trendStats">
                {[
                  { label: "Sales", c: ov.metrics.sales, good: "up" as const },
                  { label: "Sales Return", c: ov.metrics.salesReturns, good: "down" as const },
                  { label: "Purchase", c: ov.metrics.purchase, good: "down" as const },
                  ...(ov.metrics.purchaseReturns ? [{ label: "Purchase Return", c: ov.metrics.purchaseReturns, good: "down" as const }] : []),
                ].map((s) => (
                  <div key={s.label} className="trendStat">
                    <div>
                      <strong title={`₹${formatMoney(s.c.current)}`}>₹{formatCompact(s.c.current)}</strong>
                      <Delta current={s.c.current} previous={s.c.previous} goodWhen={s.good} />
                    </div>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {ov ? <PaymentModePanel data={ov.paymentModes} range={range!} /> : <div className="span5"><SkeletonBlock height="16rem" /></div>}

        {/* ---------------------------------------------------- aging */}
        {ov && <AgingPanel aging={ov.aging} />}

        {/* --------------------------------------- insight + breakdown */}
        {ov && <CustomerInsightPanel segments={ov.segments} range={range!} />}
        {ov && <SalesBreakdownPanel categories={ov.categories} range={range!} />}

        {/* -------------------------------------- items + attention */}
        {ov && <ItemPerformancePanel items={ov.items} range={range!} />}

        <div className="span5 dRail">
          <Panel title="Needs Attention" actions={<RangeTag range={range} />}>
            {!dash ? (
              <SkeletonBlock lines={3} />
            ) : dash.insights.length === 0 ? (
              <EmptyState compact icon={<IconCheckCircle style={{ color: "var(--success-solid)" }} />} title="Nothing flagged" description="No overdue money, stuck orders or stock problems in this period." />
            ) : (
              <div className="attentionList">
                {dash.insights.map((i) => (
                  <div key={i.key} className="attentionItem" style={{ padding: "0.75rem 0" }}>
                    <span className={`notifTone notifTone-${i.tone}`} aria-label={i.tone} />
                    <div className="attentionText">
                      {i.headline}
                      {i.action && (
                        <div>
                          <Link href={i.action.href}>
                            {i.action.label} <IconChevronRight style={{ verticalAlign: "-2px" }} />
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={
              <>
                Low Stock
                {lowStock && lowStock.total > 0 && <span className="dChip">{lowStock.total}</span>}
              </>
            }
            actions={
              <Link href="/reports/stock-summary?stockFilter=LOW" className="dLink">
                View all
              </Link>
            }
          >
            {!lowStock ? (
              <SkeletonBlock lines={3} />
            ) : lowStock.rows.length === 0 ? (
              <EmptyState compact icon={<IconCheckCircle style={{ color: "var(--success-solid)" }} />} title="Stock levels are healthy" description="No item with a reorder level has fallen to it." />
            ) : (
              <ul className="lowList">
                {lowStock.rows.map((r, i) => {
                  const pct = r.reorderLevel ? Math.min(100, ((r.quantity ?? 0) / r.reorderLevel) * 100) : 0;
                  return (
                    <li key={`${r.itemName}-${r.variantSku}-${i}`}>
                      <div>
                        {r.itemNameHref ? (
                          <Link href={r.itemNameHref} className="cellLink">
                            {r.itemName}
                          </Link>
                        ) : (
                          r.itemName
                        )}
                        <small>
                          {[r.variantSku && r.variantSku !== "—" ? r.variantSku : null, r.warehouse].filter(Boolean).join(" · ")}
                        </small>
                      </div>
                      <span className="stockLevelTrack" style={{ width: "4.5rem", flex: "none" }}>
                        <span className="stockLevelFill low" style={{ width: `${Math.max(4, pct)}%` }} />
                      </span>
                      <span className="lowQty">
                        {formatQuantity(r.quantity ?? 0)} / {formatQuantity(r.reorderLevel ?? 0)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* --------------------------------------------- live lists */}
        <div className="span6">
          <DocMiniList title="Pending deliveries" subtitle="Oldest orders first" basePath="/sales-orders" viewAllHref="/sales-orders?pendingDelivery=true" state={pendingDelivery} emptyText="Every confirmed order has been dispatched." />
        </div>
        <div className="span6">
          <DocMiniList title="Recent invoices" basePath="/sales-invoices" viewAllHref="/sales-invoices" state={invoices} status="payment" emptyText="No invoices yet." />
        </div>
      </div>
    </div>
  );
}
