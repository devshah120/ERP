"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../../AuthProvider";
import { formatMoney } from "@/lib/format/number";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import AccessDenied from "@/components/ui/AccessDenied";
import { SkeletonBlock } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useWarehouses } from "@/components/forms/useWarehouses";
import { loadItemOptions, variantLabel, type ItemOption } from "@/components/inventory/ItemLinesInput";
import { ReceiptBody, ReceiptPrintPortal, printReceipt, type ReceiptDoc } from "@/components/pos/Receipt";
import { IconAlertCircle, IconClose, IconSearch, IconPrint, IconStore, IconUser } from "@/components/icons";

interface Register {
  id: string;
  registerNumber: string;
  counterName: string;
  warehouseId: string;
  warehouseName: string;
  openingCash: string;
  openedAt: string;
  orderCount: number;
  salesTotal: string;
  cashSales: string;
  cardSales: string;
  upiSales: string;
  cashRefunds: string;
  expectedCashNow: string;
}

interface PosSettings {
  defaultWarehouseId: string;
  defaultPaymentMode: "CASH" | "CARD" | "UPI";
  maxManualDiscountPercent: number;
  pricesIncludeTax: boolean;
  requireCustomer: boolean;
  receiptHeader: string;
  receiptFooter: string;
}

interface CartLine {
  key: number;
  itemId: string;
  variantSku: string;
  quantity: string;
  price: string;
  discount: string;
}

interface Quote {
  warnings: string[];
  coupon: { code: string; description: string | null } | null;
  membership: { planName: string; discountPercent: number } | null;
  lines: { price: string; discountPercent: number; discountName: string | null; taxRatePercent: number; lineTotal: string }[];
  totals: Record<string, string>;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  customerCode?: string;
}

type Mode = "CASH" | "CARD" | "UPI";
const MODES: Mode[] = ["CASH", "CARD", "UPI"];

let nextKey = 1;

/**
 * The billing counter. Pricing comes from the server's quote endpoint on
 * every change, so what the cashier sees is exactly what will be billed —
 * MRP-inclusive GST, automatic and member discounts, coupons and all.
 */
export default function PosRegisterPage() {
  const { me, hasPermission } = useAuth();
  const toast = useToast();
  const warehouses = useWarehouses();

  const [register, setRegister] = useState<Register | null | undefined>(undefined);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // open-register form
  const [counterName, setCounterName] = useState("Counter 1");
  const [openWarehouse, setOpenWarehouse] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [opening, setOpening] = useState(false);

  // cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [payments, setPayments] = useState<Record<Mode, string>>({ CASH: "", CARD: "", UPI: "" });
  const [paymentRef, setPaymentRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptDoc | null>(null);

  // close register
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const loadRegister = useCallback(async () => {
    try {
      setRegister(await apiFetch<Register | null>("/api/pos/registers/current"));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load the register");
      setRegister(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRegister();
    apiFetch<PosSettings>("/api/settings/pos")
      .then((s) => {
        setSettings(s);
        setOpenWarehouse((w) => w || s.defaultWarehouseId);
      })
      .catch(() => setSettings(null));
    loadItemOptions().then(setItems).catch(() => setItems([]));
    apiFetch<{ items: Customer[] }>("/api/customers?pageSize=200&status=ACTIVE")
      .then((r) => setCustomers(r.items))
      .catch(() => setCustomers([]));
  }, [loadRegister]);

  useEffect(() => {
    if (!openWarehouse && warehouses.length) setOpenWarehouse((warehouses.find((w) => w.isDefault) ?? warehouses[0]).id);
  }, [warehouses, openWarehouse]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // --- search: name, code, SKU or barcode -----------------------------
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: { item: ItemOption; sku: string; label: string }[] = [];
    for (const it of items) {
      const variants = (it.variants ?? []).filter((v) => v.isActive !== false);
      const itemHit = it.name.toLowerCase().includes(q) || it.itemCode.toLowerCase().includes(q);
      if (variants.length === 0) {
        if (itemHit) out.push({ item: it, sku: "", label: `${it.itemCode} · ${it.name}` });
        continue;
      }
      for (const v of variants) {
        if (itemHit || v.sku.toLowerCase().includes(q) || (v.barcode ?? "").toLowerCase() === q) {
          out.push({ item: it, sku: v.sku, label: `${it.name} — ${variantLabel(v)}` });
        }
      }
      if (out.length > 30) break;
    }
    return out.slice(0, 30);
  }, [search, items]);

  function addToCart(item: ItemOption, sku: string) {
    setCart((c) => {
      const existing = c.find((l) => l.itemId === item.id && l.variantSku === sku);
      if (existing) return c.map((l) => (l === existing ? { ...l, quantity: String(Number(l.quantity) + 1) } : l));
      return [...c, { key: nextKey++, itemId: item.id, variantSku: sku, quantity: "1", price: "", discount: "" }];
    });
    setSearch("");
    searchRef.current?.focus();
  }

  function updateLine(key: number, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // --- live quote -------------------------------------------------------
  const cartPayload = useMemo(
    () =>
      cart
        .filter((l) => Number(l.quantity) > 0)
        .map((l) => ({
          itemId: l.itemId,
          variantSku: l.variantSku || undefined,
          quantity: Number(l.quantity),
          price: l.price.trim() || undefined,
          discountPercent: l.discount.trim() ? Number(l.discount) : undefined,
        })),
    [cart]
  );

  useEffect(() => {
    if (cartPayload.length === 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch<Quote>("/api/pos/quote", {
        method: "POST",
        body: JSON.stringify({ lines: cartPayload, customerId: customerId || undefined, couponCode: appliedCoupon || undefined }),
      })
        .then((q) => {
          if (!cancelled) {
            setQuote(q);
            setQuoteError(null);
          }
        })
        .catch((err) => !cancelled && setQuoteError(err instanceof ApiError ? err.message : "Could not price the bill"));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cartPayload, customerId, appliedCoupon]);

  const total = quote ? new Decimal(quote.totals.grandTotal) : new Decimal(0);
  const paid = MODES.reduce((s, m) => {
    try {
      return s.plus(payments[m] || "0");
    } catch {
      return s;
    }
  }, new Decimal(0));
  const balance = total.minus(paid);

  // When the total changes and nothing has been keyed in, default the payment
  // to the full amount in the default mode.
  const untouched = MODES.every((m) => !payments[m]);
  const effectivePayments: Record<Mode, string> = untouched && total.gt(0) ? { ...payments, [settings?.defaultPaymentMode ?? "CASH"]: total.toFixed(2) } : payments;
  const effectivePaid = untouched ? total : paid;
  const change = effectivePaid.minus(total);

  function resetSale() {
    setCart([]);
    setCustomerId("");
    setCustomerQuery("");
    setWalkInName("");
    setWalkInPhone("");
    setCoupon("");
    setAppliedCoupon("");
    setPayments({ CASH: "", CARD: "", UPI: "" });
    setPaymentRef("");
    setSaleError(null);
    setQuote(null);
  }

  async function completeSale() {
    if (!register || !quote || cartPayload.length === 0 || submitting) return;
    setSubmitting(true);
    setSaleError(null);
    try {
      const pays = MODES.filter((m) => Number(effectivePayments[m]) > 0).map((m) => ({
        mode: m,
        amount: effectivePayments[m],
        reference: m !== "CASH" && paymentRef ? paymentRef : undefined,
      }));
      const order = await apiFetch<ReceiptDoc & { id: string; orderNumber: string }>("/api/pos/orders", {
        method: "POST",
        body: JSON.stringify({
          registerId: register.id,
          lines: cartPayload,
          customerId: customerId || undefined,
          customerName: walkInName || undefined,
          customerPhone: walkInPhone || undefined,
          couponCode: appliedCoupon || undefined,
          payments: pays,
        }),
      });
      setReceipt(order);
      toast.success(`Sale ${order.orderNumber} completed`);
      resetSale();
      loadRegister();
    } catch (err) {
      setSaleError(err instanceof ApiError ? err.message : "Could not complete the sale");
    } finally {
      setSubmitting(false);
    }
  }

  // F2 search · F9 complete sale
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F9") {
        e.preventDefault();
        completeSale();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function openRegister() {
    setOpening(true);
    try {
      setRegister(
        await apiFetch<Register>("/api/pos/registers", {
          method: "POST",
          body: JSON.stringify({ counterName, warehouseId: openWarehouse, openingCash }),
        })
      );
      toast.success("Register opened");
    } catch (err) {
      toast.error("Couldn't open the register", err instanceof ApiError ? err.message : undefined);
    } finally {
      setOpening(false);
    }
  }

  async function closeRegister() {
    if (!register) return;
    setCloseBusy(true);
    setCloseError(null);
    try {
      const closed = await apiFetch<Register & { cashDifference: string }>(`/api/pos/registers/${register.id}`, {
        method: "POST",
        body: JSON.stringify({ countedCash: counted, closingNotes: closeNotes || undefined }),
      });
      const diff = Number(closed.cashDifference);
      toast.success(
        "Register closed",
        diff === 0 ? "Cash matched exactly." : diff > 0 ? `Cash over by ${formatMoney(String(diff))}.` : `Cash short by ${formatMoney(String(-diff))}.`
      );
      setClosing(false);
      setCounted("");
      resetSale();
      setRegister(null);
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : "Could not close the register");
    } finally {
      setCloseBusy(false);
    }
  }

  if (!hasPermission("pos.sell")) return <AccessDenied detail="Billing at the counter needs the POS · sell permission." />;
  if (register === undefined) return <SkeletonBlock lines={6} />;

  // ---------------------------------------------------------------- open
  if (!register) {
    return (
      <>
        <PageHeader title="Open Register" description="Start a shift: choose the counter and count the cash float in the drawer." />
        {loadError && <div className="banner bannerError" style={{ marginBottom: "1rem" }}>{loadError}</div>}
        <section className="formSection" style={{ maxWidth: "40rem" }}>
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="o-counter">Counter</label>
                <input id="o-counter" className="input" value={counterName} onChange={(e) => setCounterName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="o-wh">Sell from warehouse</label>
                <select id="o-wh" className="select" value={openWarehouse} onChange={(e) => setOpenWarehouse(e.target.value)}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="o-cash">Opening cash float</label>
                <input id="o-cash" className="input" inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
              </div>
            </div>
          </div>
        </section>
        <div style={{ display: "flex", gap: "0.5rem", maxWidth: "40rem" }}>
          <button type="button" className="button buttonPrimary" onClick={openRegister} disabled={opening || !openWarehouse}>
            {opening && <span className="spinner" />} <IconStore /> Open register
          </button>
          <Link href="/pos/registers" className="button buttonSecondary">All registers</Link>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------- bill
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerMatches = customerQuery.trim()
    ? customers
        .filter((c) => [c.name, c.phone ?? "", c.customerCode ?? ""].some((v) => v.toLowerCase().includes(customerQuery.trim().toLowerCase())))
        .slice(0, 8)
    : [];

  return (
    <>
      <PageHeader
        title={
          <>
            {register.counterName} <span className="pageTitleCount cellMono">{register.registerNumber}</span>
          </>
        }
        description={`${register.warehouseName} · opened ${new Date(register.openedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · ${register.orderCount} sale${register.orderCount === 1 ? "" : "s"}, ${formatMoney(register.salesTotal)} · F2 search, F9 complete sale`}
        actions={
          <>
            <Link href={`/pos/orders?registerId=${register.id}`} className="button buttonSecondary">Today&apos;s bills</Link>
            <button type="button" className="button buttonSecondary" onClick={() => (setClosing(true), setCloseError(null))}>
              Close register
            </button>
          </>
        }
      />

      <div className="posLayout">
        <div className="posMain">
          <div className="posSearch">
            <IconSearch />
            <input
              ref={searchRef}
              autoFocus
              className="input"
              placeholder="Scan barcode or search product, code, SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  addToCart(matches[0].item, matches[0].sku);
                }
                if (e.key === "Escape") setSearch("");
              }}
              aria-label="Search products"
            />
            {matches.length > 0 && (
              <div className="posResults" role="listbox">
                {matches.map((m) => (
                  <button key={`${m.item.id}-${m.sku}`} type="button" className="posResult" onClick={() => addToCart(m.item, m.sku)}>
                    <span>{m.label}</span>
                    <span className="cellMuted">{formatMoney(String(m.item.sellingPrice ?? "0"))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="tableWrap">
            <table className="docLinesTable" style={{ border: "none" }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: "6rem", textAlign: "right" }}>Qty</th>
                  <th style={{ width: "8rem", textAlign: "right" }}>Price</th>
                  <th style={{ width: "6rem", textAlign: "right" }}>Disc %</th>
                  <th style={{ width: "8rem", textAlign: "right" }}>Amount</th>
                  <th style={{ width: "2.5rem" }} />
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="tableEmpty">Scan or search a product to start the bill.</div>
                    </td>
                  </tr>
                )}
                {cart.map((l) => {
                  const item = itemById.get(l.itemId);
                  // Quote lines follow cartPayload order (zero-quantity rows are left out).
                  const qi = cartPayload.findIndex((p) => p.itemId === l.itemId && (p.variantSku ?? "") === l.variantSku);
                  const q = qi >= 0 ? quote?.lines[qi] : undefined;
                  const variant = item?.variants?.find((v) => v.sku === l.variantSku);
                  return (
                    <tr key={l.key}>
                      <td style={{ paddingLeft: "0.75rem" }}>
                        <div className="cellPrimary">{item?.name ?? "—"}</div>
                        <div className="cellSub">
                          {variant ? variantLabel(variant) : item?.itemCode}
                          {q?.discountName && q.discountName !== "Manual" && ` · ${q.discountName} −${q.discountPercent}%`}
                        </div>
                      </td>
                      <td>
                        <input type="number" min="0" step="any" style={{ textAlign: "right" }} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                      </td>
                      <td>
                        <input inputMode="decimal" style={{ textAlign: "right" }} value={l.price} placeholder={q?.price ?? String(item?.sellingPrice ?? "")} onChange={(e) => updateLine(l.key, { price: e.target.value })} aria-label="Price" />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={settings?.maxManualDiscountPercent ?? 100}
                          step="any"
                          style={{ textAlign: "right" }}
                          value={l.discount}
                          placeholder={q && q.discountPercent > 0 ? String(q.discountPercent) : "0"}
                          onChange={(e) => updateLine(l.key, { discount: e.target.value })}
                          aria-label="Discount percent"
                        />
                      </td>
                      <td className="tabular" style={{ textAlign: "right", paddingRight: "0.75rem", fontWeight: 600 }}>
                        {q ? formatMoney(q.lineTotal) : "…"}
                      </td>
                      <td>
                        <button type="button" className="rowRemoveBtn" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} aria-label="Remove">
                          <IconClose />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {settings && (
            <p className="fieldHint" style={{ marginTop: "0.5rem" }}>
              Prices {settings.pricesIncludeTax ? "include" : "exclude"} GST · manual discount up to {settings.maxManualDiscountPercent}% ·{" "}
              <Link href="/settings/pos" className="textLink">POS settings</Link>
            </p>
          )}
        </div>

        <aside className="posSide">
          <section className="posPanel">
            <div className="posPanelTitle">
              <IconUser /> Customer
            </div>
            {selectedCustomer ? (
              <div className="posCustomer">
                <div>
                  <div className="cellPrimary">{selectedCustomer.name}</div>
                  <div className="cellSub">{selectedCustomer.phone}</div>
                  {quote?.membership && <span className="badge badgeAccent badgePlain">{quote.membership.planName} member · {quote.membership.discountPercent}%</span>}
                </div>
                <button type="button" className="button buttonGhost buttonSm" onClick={() => (setCustomerId(""), setCustomerQuery(""))}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <div style={{ position: "relative" }}>
                  <input className="input" placeholder="Search customer by name or phone" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} aria-label="Search customer" />
                  {customerMatches.length > 0 && (
                    <div className="posResults">
                      {customerMatches.map((c) => (
                        <button key={c.id} type="button" className="posResult" onClick={() => (setCustomerId(c.id), setCustomerQuery(""))}>
                          <span>{c.name}</span>
                          <span className="cellMuted">{c.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!settings?.requireCustomer && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.375rem", marginTop: "0.375rem" }}>
                    <input className="input" placeholder="Walk-in name" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} aria-label="Walk-in name" />
                    <input className="input" placeholder="Phone" value={walkInPhone} onChange={(e) => setWalkInPhone(e.target.value)} aria-label="Walk-in phone" />
                  </div>
                )}
              </>
            )}
          </section>

          <section className="posPanel">
            <div className="posPanelTitle">Coupon</div>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              <input className="input cellMono" placeholder="Code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} aria-label="Coupon code" />
              {appliedCoupon ? (
                <button type="button" className="button buttonSecondary" onClick={() => (setAppliedCoupon(""), setCoupon(""))}>Remove</button>
              ) : (
                <button type="button" className="button buttonSecondary" disabled={!coupon.trim()} onClick={() => setAppliedCoupon(coupon.trim())}>Apply</button>
              )}
            </div>
            {quote?.coupon && <div className="fieldHint">{quote.coupon.code} applied{quote.coupon.description ? ` — ${quote.coupon.description}` : ""}</div>}
            {quote?.warnings.map((w) => <div key={w} className="fieldError">{w}</div>)}
          </section>

          <section className="posPanel">
            <dl className="posTotals">
              <div><dt>Items value</dt><dd>{formatMoney(quote?.totals.grossAmount ?? "0")}</dd></div>
              {quote && Number(quote.totals.discountAmount) > 0 && <div><dt>Discounts</dt><dd>−{formatMoney(quote.totals.discountAmount)}</dd></div>}
              {quote && Number(quote.totals.couponDiscount) > 0 && <div><dt>Coupon</dt><dd>−{formatMoney(quote.totals.couponDiscount)}</dd></div>}
              <div><dt>Taxable</dt><dd>{formatMoney(quote?.totals.taxableAmount ?? "0")}</dd></div>
              <div><dt>GST</dt><dd>{formatMoney(quote?.totals.totalTax ?? "0")}</dd></div>
              {quote && Number(quote.totals.roundOff) !== 0 && <div><dt>Round off</dt><dd>{formatMoney(quote.totals.roundOff)}</dd></div>}
              <div className="posGrand"><dt>Total</dt><dd>{formatMoney(total.toFixed(2))}</dd></div>
            </dl>
            {quoteError && <div className="fieldError">{quoteError}</div>}
          </section>

          <section className="posPanel">
            <div className="posPanelTitle">Payment</div>
            {MODES.map((m) => (
              <div key={m} className="posPayRow">
                <label htmlFor={`pay-${m}`}>{m === "CASH" ? "Cash" : m === "CARD" ? "Card" : "UPI"}</label>
                <input
                  id={`pay-${m}`}
                  className="input"
                  inputMode="decimal"
                  value={untouched ? effectivePayments[m] : payments[m]}
                  onChange={(e) => setPayments((p) => ({ ...(untouched ? effectivePayments : p), [m]: e.target.value }))}
                />
                <button
                  type="button"
                  className="button buttonGhost buttonSm"
                  onClick={() => setPayments({ CASH: "", CARD: "", UPI: "", [m]: total.toFixed(2) } as Record<Mode, string>)}
                  disabled={total.lte(0)}
                >
                  Full
                </button>
              </div>
            ))}
            {(Number(effectivePayments.CARD) > 0 || Number(effectivePayments.UPI) > 0) && (
              <input className="input" placeholder="Card / UPI reference" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} aria-label="Payment reference" style={{ marginTop: "0.375rem" }} />
            )}
            <div className="posChange">
              {untouched ? null : balance.gt(0) ? (
                <span style={{ color: "var(--danger)" }}>Still to pay {formatMoney(balance.toFixed(2))}</span>
              ) : change.gt(0) ? (
                <span>Change to return <strong>{formatMoney(change.toFixed(2))}</strong></span>
              ) : (
                <span>Paid in full</span>
              )}
            </div>
            {saleError && (
              <div className="banner bannerError" style={{ marginTop: "0.5rem" }}>
                <IconAlertCircle />
                <span>{saleError}</span>
              </div>
            )}
            <button
              type="button"
              className="button buttonPrimary posComplete"
              onClick={completeSale}
              disabled={submitting || !quote || cartPayload.length === 0 || (!untouched && balance.gt(0)) || Boolean(quoteError)}
            >
              {submitting && <span className="spinner" />} Complete sale · {formatMoney(total.toFixed(2))}
            </button>
            {cart.length > 0 && (
              <button type="button" className="button buttonGhost" style={{ width: "100%", marginTop: "0.375rem" }} onClick={resetSale}>
                Clear bill
              </button>
            )}
          </section>
        </aside>
      </div>

      {receipt && (
        <Modal
          title="Sale completed"
          subtitle={String(receipt.orderNumber)}
          onClose={() => setReceipt(null)}
          width="26rem"
          footer={
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <button type="button" className="button buttonSecondary" onClick={printReceipt}>
                <IconPrint /> Print receipt
              </button>
              <button type="button" className="button buttonPrimary" autoFocus onClick={() => (setReceipt(null), searchRef.current?.focus())}>
                New sale
              </button>
            </div>
          }
        >
          <ReceiptBody doc={receipt} businessName={me?.business?.name ?? ""} header={settings?.receiptHeader} footer={settings?.receiptFooter} />
        </Modal>
      )}
      {receipt && <ReceiptPrintPortal doc={receipt} businessName={me?.business?.name ?? ""} header={settings?.receiptHeader} footer={settings?.receiptFooter} />}

      {closing && (
        <Modal
          title={`Close ${register.counterName}`}
          subtitle="Count the cash in the drawer. The difference from what the system expects is recorded."
          onClose={() => setClosing(false)}
          busy={closeBusy}
          footer={
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <button type="button" className="button buttonSecondary" onClick={() => setClosing(false)} disabled={closeBusy}>Cancel</button>
              <button type="button" className="button buttonPrimary" onClick={closeRegister} disabled={closeBusy || !counted.trim()}>
                {closeBusy && <span className="spinner" />} Close register
              </button>
            </div>
          }
        >
          <dl className="posTotals" style={{ marginBottom: "0.75rem" }}>
            <div><dt>Opening float</dt><dd>{formatMoney(register.openingCash)}</dd></div>
            <div><dt>Cash sales (after change)</dt><dd>{formatMoney(register.cashSales)}</dd></div>
            <div><dt>Cash refunds</dt><dd>−{formatMoney(register.cashRefunds)}</dd></div>
            <div className="posGrand"><dt>Expected in drawer</dt><dd>{formatMoney(register.expectedCashNow)}</dd></div>
            <div><dt>Card</dt><dd>{formatMoney(register.cardSales)}</dd></div>
            <div><dt>UPI</dt><dd>{formatMoney(register.upiSales)}</dd></div>
          </dl>
          {closeError && <div className="banner bannerError" style={{ marginBottom: "0.5rem" }}>{closeError}</div>}
          <div className="formGrid">
            <div className="field">
              <label htmlFor="c-counted">Cash counted</label>
              <input id="c-counted" className="input" inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
            </div>
            <div className="field">
              <label>Difference</label>
              <div className="input" style={{ display: "flex", alignItems: "center", background: "transparent" }}>
                {(() => {
                  try {
                    if (!counted.trim()) return "—";
                    const d = new Decimal(counted).minus(register.expectedCashNow);
                    return d.isZero() ? "Matches" : d.gt(0) ? `Over ${formatMoney(d.toFixed(2))}` : `Short ${formatMoney(d.abs().toFixed(2))}`;
                  } catch {
                    return "—";
                  }
                })()}
              </div>
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="c-notes">Notes</label>
              <textarea id="c-notes" className="input" rows={2} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
