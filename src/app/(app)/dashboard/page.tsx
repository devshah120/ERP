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
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { formatCompact, formatCount, formatMoney, formatQuantity } from "@/lib/format/number";
import { DateRangePill, fmtDay } from "@/components/dashboard/Widgets";
import { AgingBars, AGE_BANDS, CategoryTreemap, InOutChart, ProductMap, Sparkline } from "@/components/pulse/PulseCharts";
import {
  AttentionFeed,
  Card,
  CustomerMix,
  MeterList,
  ModeSplit,
  RankList,
  RunningLow,
  SpotlightTile,
  Toggle,
  type LowStockRow,
  type MeterSpec,
  type Severity,
} from "@/components/pulse/PulseBlocks";
import { IconRefresh, IconSales, IconWallet, IconPurchase, IconFile } from "@/components/icons";

function grade(value: number | null, ok: number, warn: number, lowerIsBetter = false): Severity {
  if (value === null) return "none";
  if (lowerIsBetter) return value <= ok ? "ok" : value <= warn ? "warn" : "bad";
  return value >= ok ? "ok" : value >= warn ? "warn" : "bad";
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

/** The four "Health check" ratios, each graded against its own threshold. */
function healthMeters(dash: DashboardResult, ov: OverviewResult): MeterSpec[] {
  const kpiValue = (key: string) => Number(dash.kpis.find((k) => k.key === key)?.value ?? 0);
  const status = dash.charts.find((c) => c.key === "invoice-status")?.series[0]?.points ?? [];
  const count = (label: string) => status.find((p) => p.label === label)?.value ?? 0;
  const bills = count("Paid") + count("Partly paid") + count("Unpaid");
  const paidShare = pct(count("Paid"), bills);
  const collected = kpiValue("collection");
  const billed = Number(ov.metrics.sales.current);
  const returnRate = pct(Number(ov.metrics.salesReturns.current), billed);
  const items = kpiValue("items");
  const low = kpiValue("lowStock");
  const stocked = pct(items - low, items);
  const range = `fromDate=${ov.period.fromDate.slice(0, 10)}&toDate=${ov.period.toDate.slice(0, 10)}`;
  return [
    {
      key: "collected",
      label: "Billing turned into cash",
      percent: billed > 0 ? collected : null,
      severity: billed > 0 ? grade(collected, 80, 40) : "none",
      note: "of this period's bills",
      href: `/receipts?${range}`,
    },
    {
      key: "paid",
      label: "Bills settled in full",
      percent: paidShare,
      severity: grade(paidShare, 70, 40),
      note: bills > 0 ? `${formatCount(count("Paid"))} of ${formatCount(bills)} bills` : "no bills yet",
      href: `/sales-invoices?paymentStatus=PAID&${range}`,
    },
    {
      key: "returns",
      label: "Goods sent back",
      percent: returnRate,
      severity: grade(returnRate, 5, 15, true),
      note: `₹${formatCompact(ov.metrics.salesReturns.current)} returned`,
      href: `/sales-returns?${range}`,
    },
    {
      key: "stocked",
      label: "Shelves above reorder level",
      percent: stocked,
      severity: grade(stocked, 90, 70),
      note: low > 0 ? `${formatCount(low)} item${low === 1 ? "" : "s"} running low` : "nothing running low",
      href: "/reports/stock-summary?stockFilter=LOW",
    },
  ];
}

export default function DashboardPage() {
  const { me } = useAuth();
  const [period, setPeriod] = useState<PeriodState>({ period: "month", fromDate: "", toDate: "" });
  const [dash, setDash] = useState<DashboardResult | null>(null);
  const [ov, setOv] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [invoices, setInvoices] = useState<MiniListState | null>(null);
  const [toShip, setToShip] = useState<MiniListState | null>(null);
  const [lowStock, setLowStock] = useState<{ rows: LowStockRow[]; total: number } | null>(null);
  const [owedSide, setOwedSide] = useState<"receivable" | "payable">("receivable");
  const [modeSource, setModeSource] = useState<"receipts" | "sales">("receipts");

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

  // Lists that describe "right now" and ignore the selected period.
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
    setToShip(c.status === "fulfilled" ? c.value : { items: [], total: 0 });
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

  const chart = useCallback((key: string) => dash?.charts.find((c) => c.key === key), [dash]);

  const meters: MeterSpec[] = dash && ov ? healthMeters(dash, ov) : [];

  if (!me) return null;
  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const business = me.business?.name ?? "Your business";
  const range = ov ? { fromDate: ov.period.fromDate, toDate: ov.period.toDate } : undefined;
  const synced = dash ? new Date(dash.generatedAt) : null;
  const flow = chart("sales-vs-purchase");
  const salesPts = flow?.series[0]?.points ?? [];
  const purchasePts = flow?.series[1]?.points ?? [];
  const topBuyers = chart("top-customers")?.series[0]?.points ?? [];
  const m = ov?.metrics;
  const owed = ov ? (owedSide === "payable" && ov.aging.payable ? ov.aging.payable : ov.aging.receivable) : null;
  const dim = loading ? { opacity: 0.6, transition: "opacity 160ms" } : { transition: "opacity 160ms" };

  const rightNow = [
    { label: "Customers owe you", value: `₹${formatCompact(kpi("receivable")?.value ?? "0")}`, href: kpi("receivable")?.href },
    { label: "You owe suppliers", value: `₹${formatCompact(kpi("payable")?.value ?? "0")}`, href: kpi("payable")?.href },
    { label: "Stock on hand worth", value: `₹${formatCompact(kpi("stockValue")?.value ?? "0")}`, href: "/reports/stock-summary" },
    { label: "Orders not yet billed", value: formatCount(kpi("pendingSo")?.value ?? "0"), href: kpi("pendingSo")?.href },
  ];

  return (
    <div className="pulse">
      {/* ------------------------------------------------------- header */}
      <header className="plHead">
        <div className="plHeadText">
          <p className="plEyebrow">
            {business}
            {synced && <> · {synced.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</>}
          </p>
          <h1>Business pulse</h1>
          <p className="plSub">
            {range
              ? <>How things moved between {fmtDay(range.fromDate)} and {fmtDay(range.toDate)}, set against the same stretch of time just before it.</>
              : "Pulling together your latest numbers…"}
          </p>
        </div>
        <div className="plControls">
          {synced && (
            <span className="plSynced" title="When these figures were calculated">
              Updated {synced.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <DateRangePill value={period} onChange={setPeriod} range={range} />
          <button type="button" className="plRefresh" onClick={refreshAll} disabled={loading} aria-label="Refresh figures" title="Refresh (Ctrl + R)">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </header>

      {error !== null && !dash && (
        <div className="plCard" style={{ marginBottom: "1.25rem" }}>
          <ErrorState
            title="We couldn't pull your numbers"
            message={error instanceof ApiError ? error.message : "Check your connection and try again."}
            onRetry={load}
          />
        </div>
      )}

      {/* ------------------------------------------------- right now */}
      <nav className="plNow" aria-label="Right now">
        <span className="plNowTag">Right now</span>
        {rightNow.map((r) => (
          <Link key={r.label} href={r.href ?? "#"} className="plNowItem">
            <small>{r.label}</small>
            <strong>{dash ? r.value : "—"}</strong>
          </Link>
        ))}
      </nav>

      <div className="plGrid" style={dim}>
        {/* ------------------------------------------- spotlight tiles */}
        {m ? (
          <>
            <div className="plSpan3">
              <SpotlightTile
                icon={<IconSales />}
                label="Revenue billed"
                value={m.sales.current}
                previous={m.sales.previous}
                caption={`${formatCount(m.salesCount.current)} bills`}
                href={kpi("totalSales")?.href}
              >
                <Sparkline points={salesPts} slot={0} name="Billed" />
              </SpotlightTile>
            </div>
            <div className="plSpan3">
              <SpotlightTile
                icon={<IconWallet />}
                label="Cash collected"
                value={m.received.current}
                previous={m.received.previous}
                caption="from customers"
                href={kpi("received")?.href}
              >
                <div className="plSpotMeter" title="Share of this period's billing already collected">
                  <span className="plMeterTrack sev-ok">
                    <span className="plMeterFill" style={{ width: `${Math.min(100, Number(kpi("collection")?.value ?? 0))}%` }} />
                  </span>
                  <small>{Number(kpi("collection")?.value ?? 0).toFixed(0)}% of billing collected</small>
                </div>
              </SpotlightTile>
            </div>
            <div className="plSpan3">
              <SpotlightTile
                icon={<IconPurchase />}
                label="Spend on stock"
                value={m.purchase.current}
                previous={m.purchase.previous}
                goodWhen="down"
                caption={`${formatCount(m.purchaseCount.current)} supplier bills`}
                href={kpi("totalPurchase")?.href}
              >
                <Sparkline points={purchasePts} slot={1} name="Bought" />
              </SpotlightTile>
            </div>
            <div className="plSpan3">
              <SpotlightTile icon={<IconFile />} label="Average bill" value={m.avgInvoice.current} previous={m.avgInvoice.previous} caption="per sale">
                <div className="plSpotPairs">
                  <div>
                    <small>Units sold</small>
                    <strong>{formatQuantity(m.soldQty.current)}</strong>
                  </div>
                  <div>
                    <small>Buying customers</small>
                    <strong>{formatCount(ov?.segments.customers ?? 0)}</strong>
                  </div>
                </div>
              </SpotlightTile>
            </div>
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="plSpan3">
              <div className="plSpot" aria-busy="true">
                <SkeletonBlock height="8.5rem" />
              </div>
            </div>
          ))
        )}

        {/* ----------------------------------------- money in vs out */}
        <Card
          className="plSpan8"
          title="Money in vs money out"
          kicker="What you billed customers (above the line) against what you bought from suppliers (below it). The dark line is the gap between them."
        >
          {flow ? <InOutChart sales={salesPts} purchase={purchasePts} /> : <SkeletonBlock height="300px" />}
        </Card>

        <Card className="plSpan4" title="Health check" kicker="Four quick signals for this period">
          {meters.length ? <MeterList meters={meters} /> : <SkeletonBlock lines={4} />}
        </Card>

        {/* ------------------------------------- attention + who owes */}
        <Card className="plSpan4" title="Needs your attention" kicker="Most urgent first">
          {dash ? <AttentionFeed insights={dash.insights} /> : <SkeletonBlock lines={4} />}
        </Card>

        <Card
          className="plSpan8"
          title={owedSide === "receivable" ? "Who owes you, and for how long" : "Who you owe, and for how long"}
          kicker="As of today. The darker the blue, the older the debt."
          actions={
            ov?.aging.payable ? (
              <Toggle
                label="Whose balances to show"
                value={owedSide}
                onChange={setOwedSide}
                options={[
                  { key: "receivable", label: "Customers" },
                  { key: "payable", label: "Suppliers" },
                ]}
              />
            ) : undefined
          }
          footnote={
            owed && owed.partyCount > 8
              ? `Showing the 8 largest of ${owed.partyCount} ${owedSide === "receivable" ? "customers" : "suppliers"}. Click a bar to open those bills.`
              : "Click a bar to open those bills."
          }
        >
          {owed ? (
            <>
              <div className="plBands">
                <div className="plBandTotal">
                  <small>Total {owedSide === "receivable" ? "to collect" : "to pay"}</small>
                  <strong title={`₹${formatMoney(owed.totals.total)}`}>₹{formatCompact(owed.totals.total)}</strong>
                </div>
                {AGE_BANDS.map((b) => (
                  <div key={b.key} className="plBand">
                    <span className="plSwatch" style={{ background: `var(--chart-ramp-${b.ramp + 1})` }} aria-hidden />
                    <small>{b.label}</small>
                    <strong title={`₹${formatMoney(owed.totals[b.key])}`}>₹{formatCompact(owed.totals[b.key])}</strong>
                  </div>
                ))}
              </div>
              <AgingBars rows={owed.rows} side={owedSide} />
            </>
          ) : (
            <SkeletonBlock height="260px" />
          )}
        </Card>

        {/* -------------------------------------- products + buyers */}
        <Card
          className="plSpan7"
          title="Product map"
          kicker="Each bubble is a product: further right sells more units, higher up earns more. Bigger bubbles appear on more bills."
          actions={
            <Link href="/reports/item-report" className="plLink">
              Item report
            </Link>
          }
        >
          {ov ? <ProductMap items={ov.items} /> : <SkeletonBlock height="300px" />}
        </Card>

        <Card
          className="plSpan5"
          title="Top buyers"
          kicker="Customers who spent the most this period"
          actions={
            <Link href="/customers" className="plLink">
              All customers
            </Link>
          }
        >
          {dash && m ? <RankList rows={topBuyers} total={Number(m.sales.current)} empty="No sales in this period yet" /> : <SkeletonBlock lines={5} />}
        </Card>

        {/* ----------------------------------- categories + mix + pay */}
        <Card className="plSpan5" title="Where revenue comes from" kicker="Sales by category. Bigger tiles bring in more.">
          {ov ? <CategoryTreemap categories={ov.categories} /> : <SkeletonBlock height="260px" />}
        </Card>

        <Card
          className="plSpan7"
          title="Your customer mix"
          kicker="Buyers this period, grouped by how recently, how often and how much they bought"
          actions={
            <Link href="/analysis/customers" className="plLink">
              Customer analysis
            </Link>
          }
        >
          {ov ? <CustomerMix segments={ov.segments} /> : <SkeletonBlock lines={5} />}
        </Card>

        <Card
          className="plSpan5"
          title="How you get paid"
          kicker={modeSource === "receipts" ? "Money received, by payment method" : "Bills raised, by payment terms"}
          actions={
            <Toggle
              label="What to split"
              value={modeSource}
              onChange={setModeSource}
              options={[
                { key: "receipts", label: "Received" },
                { key: "sales", label: "Billed" },
              ]}
            />
          }
        >
          {ov ? <ModeSplit rows={ov.paymentModes[modeSource]} /> : <SkeletonBlock lines={4} />}
        </Card>

        <Card
          className="plSpan7"
          title={
            <>
              Running low
              {lowStock && lowStock.total > 0 && <span className="plCount">{lowStock.total}</span>}
            </>
          }
          kicker="Items at or below their reorder level"
          actions={
            <Link href="/reports/stock-summary?stockFilter=LOW" className="plLink">
              Full list
            </Link>
          }
        >
          {lowStock ? <RunningLow rows={lowStock.rows} /> : <SkeletonBlock lines={4} />}
        </Card>

        {/* --------------------------------------------- live lists */}
        <div className="plSpan6">
          <DocMiniList
            title="Waiting to ship"
            subtitle="Confirmed orders not yet delivered, oldest first"
            basePath="/sales-orders"
            viewAllHref="/sales-orders?pendingDelivery=true"
            state={toShip}
            emptyText="Every confirmed order is on its way."
          />
        </div>
        <div className="plSpan6">
          <DocMiniList
            title="Latest bills"
            subtitle="The most recent invoices you raised"
            basePath="/sales-invoices"
            viewAllHref="/sales-invoices"
            state={invoices}
            status="payment"
            emptyText="No bills raised yet."
          />
        </div>
      </div>

      {ov && (
        <p className="plFootnote">
          Changes compare with {fmtDay(ov.previous.fromDate)} – {fmtDay(ov.previous.toDate)}. Balances, stock and order counts are as of now. Draft
          and cancelled documents are never counted.
        </p>
      )}
    </div>
  );
}
