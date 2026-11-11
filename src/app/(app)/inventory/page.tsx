"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import { EmptyState, ErrorState, SkeletonRows, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { KpiCard } from "@/components/analytics/KpiGrid";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import { humanizeStatus } from "@/components/ui/StatusBadge";
import { IconPlus, IconRefresh, IconArrowRight, IconChart } from "@/components/icons";

interface StockRow {
  itemCode: string;
  itemName: string;
  itemNameHref?: string;
  variantSku: string;
  warehouse: string;
  quantity: number;
  available: number;
  reorderLevel: number;
  stockValue: string;
}

interface LedgerRow {
  date: string;
  itemName: string;
  itemNameHref?: string;
  variantSku: string;
  warehouse?: string;
  movementType: string;
  quantity: number;
  documentNumber: string;
  documentNumberHref?: string;
}

interface ItemVariants {
  id: string;
  variants?: { sku: string; color?: string; size?: string }[];
}

type Tab = "item" | "warehouse" | "variant" | "movements";

const TABS: { key: Tab; label: string }[] = [
  { key: "item", label: "By item" },
  { key: "warehouse", label: "By warehouse" },
  { key: "variant", label: "By size & colour" },
  { key: "movements", label: "Recent movements" },
];

/** Status of one stock line, judged against the reorder level the item declared. */
function levelOf(qty: number, reorder: number): "out" | "low" | "ok" | "negative" {
  if (qty < 0) return "negative";
  if (qty === 0) return "out";
  if (reorder > 0 && qty <= reorder) return "low";
  return "ok";
}

const LEVEL_BADGE: Record<string, { cls: string; label: string }> = {
  out: { cls: "badgeDanger", label: "Out of stock" },
  negative: { cls: "badgeDanger", label: "Negative" },
  low: { cls: "badgeWarning", label: "Low" },
  ok: { cls: "badgeSuccess", label: "In stock" },
};

const STOCK_COLUMNS = "itemCode,itemName,variantSku,warehouse,quantity,available,reorderLevel,stockValue";

/**
 * Inventory at a glance, computed from the same stock-summary and
 * stock-ledger reports the Reports section uses — so the totals here always
 * agree with the exported reports.
 */
export default function InventoryOverviewPage() {
  const { hasPermission } = useAuth();
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [variantMap, setVariantMap] = useState<Map<string, { color?: string; size?: string }>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("item");
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, l, items] = await Promise.all([
        apiFetch<{ rows: StockRow[] }>(`/api/reports/stock-summary?pageSize=1000&columns=${STOCK_COLUMNS}`),
        apiFetch<{ rows: LedgerRow[] }>(
          "/api/reports/stock-ledger?pageSize=15&columns=date,itemName,variantSku,warehouse,movementType,quantity,documentNumber"
        ),
        // Variant attributes are optional context; a failure here must not hide the stock.
        apiFetch<{ items: ItemVariants[] }>("/api/masters/items?pageSize=200").catch(() => ({ items: [] })),
      ]);
      setStock(s.rows);
      setLedger(l.rows);
      const m = new Map<string, { color?: string; size?: string }>();
      for (const it of items.items) for (const v of it.variants ?? []) m.set(v.sku, { color: v.color, size: v.size });
      setVariantMap(m);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  const warehouses = useMemo(() => [...new Set((stock ?? []).map((r) => r.warehouse))].sort(), [stock]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (stock ?? []).filter((r) => {
      if (warehouse && r.warehouse !== warehouse) return false;
      if (onlyAttention && levelOf(r.quantity, r.reorderLevel) === "ok") return false;
      if (!q) return true;
      return (
        r.itemName.toLowerCase().includes(q) ||
        r.itemCode.toLowerCase().includes(q) ||
        r.variantSku.toLowerCase().includes(q)
      );
    });
  }, [stock, query, warehouse, onlyAttention]);

  const totals = useMemo(() => {
    const rows = stock ?? [];
    return {
      qty: rows.reduce((a, r) => a + r.quantity, 0),
      value: rows.reduce((a, r) => a + Number(r.stockValue), 0),
      items: new Set(rows.map((r) => r.itemCode)).size,
      low: rows.filter((r) => levelOf(r.quantity, r.reorderLevel) === "low").length,
      out: rows.filter((r) => ["out", "negative"].includes(levelOf(r.quantity, r.reorderLevel))).length,
    };
  }, [stock]);

  const byItem = useMemo(() => {
    const m = new Map<string, { name: string; code: string; href?: string; qty: number; value: number; variants: Set<string>; whs: Set<string>; worst: string }>();
    const rank = { negative: 3, out: 2, low: 1, ok: 0 } as const;
    for (const r of filtered) {
      const e = m.get(r.itemCode) ?? { name: r.itemName, code: r.itemCode, href: r.itemNameHref, qty: 0, value: 0, variants: new Set(), whs: new Set(), worst: "ok" };
      e.qty += r.quantity;
      e.value += Number(r.stockValue);
      if (r.variantSku && r.variantSku !== "—") e.variants.add(r.variantSku);
      e.whs.add(r.warehouse);
      const lv = levelOf(r.quantity, r.reorderLevel);
      if (rank[lv] > rank[e.worst as keyof typeof rank]) e.worst = lv;
      m.set(r.itemCode, e);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [filtered]);

  const byWarehouse = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; value: number; lines: number; attention: number }>();
    for (const r of filtered) {
      const e = m.get(r.warehouse) ?? { name: r.warehouse, qty: 0, value: 0, lines: 0, attention: 0 };
      e.qty += r.quantity;
      e.value += Number(r.stockValue);
      e.lines += 1;
      if (levelOf(r.quantity, r.reorderLevel) !== "ok") e.attention += 1;
      m.set(r.warehouse, e);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [filtered]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const maxWhValue = Math.max(1, ...byWarehouse.map((w) => w.value));

  return (
    <>
      <PageHeader
        title="Stock overview"
        description="What's on hand, where it is, and what needs reordering — across every warehouse and variant."
        actions={
          <>
            <Link href="/analysis/inventory" className="button buttonGhost">
              <IconChart /> Analysis
            </Link>
            <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh (Ctrl + R)">
              {loading ? <span className="spinner" /> : <IconRefresh />}
            </button>
            {hasPermission("stock-transfers.create") && (
              <Link href="/stock-transfers/new" className="button buttonSecondary">
                New transfer
              </Link>
            )}
            {hasPermission("stock-adjustments.create") && (
              <Link href="/stock-adjustments/new" className="button buttonPrimary">
                <IconPlus /> New adjustment
              </Link>
            )}
          </>
        }
      />

      {error !== null && !stock ? (
        <div className="card">
          <ErrorState message={error instanceof ApiError ? error.message : "Could not load stock."} onRetry={load} />
        </div>
      ) : !stock ? (
        <div className="kpiGrid kpiGrid4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} lines={2} />
          ))}
        </div>
      ) : (
        <div className="kpiGrid kpiGrid4">
          <KpiCard kpi={{ key: "value", label: "Stock value", value: totals.value.toFixed(2), kind: "money", href: "/reports/stock-summary", hint: "At moving-average cost" }} />
          <KpiCard kpi={{ key: "qty", label: "Quantity on hand", value: String(totals.qty), kind: "quantity", hint: `${totals.items} item${totals.items === 1 ? "" : "s"} across ${warehouses.length} warehouse${warehouses.length === 1 ? "" : "s"}` }} />
          <KpiCard kpi={{ key: "low", label: "Low stock lines", value: String(totals.low), kind: "count", tone: totals.low > 0 ? "warn" : "good", href: "/reports/stock-summary?stockFilter=LOW", hint: "At or below reorder level" }} />
          <KpiCard kpi={{ key: "out", label: "Out of stock lines", value: String(totals.out), kind: "count", tone: totals.out > 0 ? "bad" : "good", href: "/reports/stock-summary?stockFilter=OUT", hint: "Nothing (or less than nothing) on hand" }} />
        </div>
      )}

      <div className="tabBar" role="tablist" style={{ marginTop: "1.5rem" }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" className="tabBarItem" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "movements" && (
        <div className="toolbar">
          <SearchBox value={query} onChange={setQuery} placeholder="Search item, code or SKU…" width="18rem" />
          <select className="select" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <label className="checkboxRow" style={{ marginLeft: "0.25rem" }}>
            <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
            Only low or out of stock
          </label>
          <div className="toolbarRight">
            <Link href="/reports/stock-summary" className="textLink" style={{ fontSize: "0.8125rem" }}>
              Full stock summary report <IconArrowRight style={{ verticalAlign: "-2px" }} />
            </Link>
          </div>
        </div>
      )}

      {tab === "item" && (
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Code</th>
                <th className="numCell">Variants</th>
                <th className="numCell">Warehouses</th>
                <th className="numCell">On hand</th>
                <th className="numCell">Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!stock && <SkeletonRows columns={7} />}
              {stock && byItem.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState variant={query || warehouse || onlyAttention ? "search" : "empty"} title={query || warehouse || onlyAttention ? "No matching stock" : "No stock yet"} description={query || warehouse || onlyAttention ? "Try a different search or filter." : "Stock appears here once goods are received or an opening adjustment is posted."} />
                  </td>
                </tr>
              )}
              {byItem.map((i) => (
                <tr key={i.code}>
                  <td>{i.href ? <Link href={i.href} className="cellPrimary">{i.name}</Link> : <span className="cellPrimary">{i.name}</span>}</td>
                  <td className="cellMono cellMuted">{i.code}</td>
                  <td className="numCell">{i.variants.size || "—"}</td>
                  <td className="numCell">{i.whs.size}</td>
                  <td className="numCell">{formatQuantity(i.qty)}</td>
                  <td className="numCell">₹{formatMoney(i.value)}</td>
                  <td>
                    <ItemStatus qty={i.qty} worst={i.worst} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "warehouse" && (
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th className="numCell">Stock lines</th>
                <th className="numCell">On hand</th>
                <th className="numCell">Value</th>
                <th style={{ width: "28%" }}>Share of value</th>
                <th className="numCell">Need attention</th>
              </tr>
            </thead>
            <tbody>
              {!stock && <SkeletonRows columns={6} />}
              {stock && byWarehouse.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState variant="search" title="No matching stock" />
                  </td>
                </tr>
              )}
              {byWarehouse.map((w) => (
                <tr key={w.name}>
                  <td className="cellPrimary">{w.name}</td>
                  <td className="numCell">{w.lines}</td>
                  <td className="numCell">{formatQuantity(w.qty)}</td>
                  <td className="numCell">₹{formatMoney(w.value)}</td>
                  <td>
                    <span className="stockLevel" style={{ width: "100%" }}>
                      <span className="stockLevelTrack">
                        <span className="stockLevelFill" style={{ width: `${Math.max(2, (w.value / maxWhValue) * 100)}%` }} />
                      </span>
                      <span className="cellMuted tabular" style={{ minWidth: "3rem", textAlign: "right" }}>
                        {totals.value > 0 ? `${((w.value / totals.value) * 100).toFixed(0)}%` : "—"}
                      </span>
                    </span>
                  </td>
                  <td className="numCell">
                    {w.attention > 0 ? <span className="badge badgeWarning">{w.attention}</span> : <span className="cellMuted">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "variant" && (
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Colour</th>
                <th>Size</th>
                <th>Warehouse</th>
                <th className="numCell">On hand</th>
                <th className="numCell">Available</th>
                <th className="numCell">Reorder at</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody>
              {!stock && <SkeletonRows columns={9} />}
              {stock && filtered.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState variant="search" title="No matching stock" />
                  </td>
                </tr>
              )}
              {filtered.map((r, idx) => {
                const v = variantMap.get(r.variantSku);
                const lv = levelOf(r.quantity, r.reorderLevel);
                const pct = r.reorderLevel > 0 ? Math.min(100, (r.quantity / (r.reorderLevel * 2)) * 100) : r.quantity > 0 ? 100 : 0;
                return (
                  <tr key={`${r.itemCode}-${r.variantSku}-${r.warehouse}-${idx}`}>
                    <td>{r.itemNameHref ? <Link href={r.itemNameHref} className="cellPrimary">{r.itemName}</Link> : r.itemName}</td>
                    <td className="cellMono cellMuted">{r.variantSku}</td>
                    <td>{v?.color || <span className="cellMuted">—</span>}</td>
                    <td>{v?.size || <span className="cellMuted">—</span>}</td>
                    <td className="cellMuted">{r.warehouse}</td>
                    <td className="numCell">{formatQuantity(r.quantity)}</td>
                    <td className="numCell">{formatQuantity(r.available)}</td>
                    <td className="numCell cellMuted">{r.reorderLevel > 0 ? formatQuantity(r.reorderLevel) : "—"}</td>
                    <td>
                      <span className="stockLevel" title={LEVEL_BADGE[lv].label}>
                        <span className="stockLevelTrack">
                          <span className={`stockLevelFill ${lv === "low" ? "low" : lv === "ok" ? "" : "out"}`} style={{ width: `${Math.max(3, pct)}%` }} />
                        </span>
                        <span className={`badge ${LEVEL_BADGE[lv].cls}`}>{LEVEL_BADGE[lv].label}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "movements" && (
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>SKU</th>
                <th>Movement</th>
                <th className="numCell">Quantity</th>
                <th>Document</th>
              </tr>
            </thead>
            <tbody>
              {!ledger && <SkeletonRows columns={6} />}
              {ledger && ledger.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="No stock movements yet" description="Receipts, dispatches, returns, adjustments and transfers all appear here." />
                  </td>
                </tr>
              )}
              {ledger?.map((m, i) => (
                <tr key={i}>
                  <td className="cellMuted">
                    {new Date(m.date).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td>{m.itemNameHref ? <Link href={m.itemNameHref} className="cellPrimary">{m.itemName}</Link> : m.itemName}</td>
                  <td className="cellMono cellMuted">{m.variantSku}</td>
                  <td>
                    <span className={`badge badgePlain ${m.quantity >= 0 ? "badgeSuccess" : "badgeNeutral"}`}>{humanizeStatus(m.movementType)}</span>
                  </td>
                  <td className={`numCell ${m.quantity >= 0 ? "stockGain" : "stockLoss"}`}>
                    {m.quantity > 0 ? "+" : ""}
                    {formatQuantity(m.quantity)}
                  </td>
                  <td>
                    {m.documentNumberHref ? (
                      <Link href={m.documentNumberHref} className="cellLink cellMono">
                        {m.documentNumber}
                      </Link>
                    ) : (
                      m.documentNumber
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tableFooter">
            <span>Latest 15 movements</span>
            <Link href="/stock-ledger" className="textLink">
              Full stock ledger <IconArrowRight style={{ verticalAlign: "-2px" }} />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Item-level status. An item with plenty on hand but one empty size or
 * warehouse is "partly out", not "out of stock" — the line-level detail is
 * on the size & colour tab.
 */
function ItemStatus({ qty, worst }: { qty: number; worst: string }) {
  if (qty <= 0) return <span className="badge badgeDanger">{qty < 0 ? "Negative" : "Out of stock"}</span>;
  if (worst === "out" || worst === "negative")
    return (
      <span className="badge badgeWarning" title="At least one variant or warehouse has nothing on hand">
        Partly out
      </span>
    );
  if (worst === "low") return <span className="badge badgeWarning">Low</span>;
  return <span className="badge badgeSuccess">In stock</span>;
}
