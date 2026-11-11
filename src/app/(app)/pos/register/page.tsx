"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../../AuthProvider";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import AccessDenied from "@/components/ui/AccessDenied";
import { SkeletonBlock } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useWarehouses } from "@/components/forms/useWarehouses";
import { loadItemOptions, variantLabel, type ItemOption } from "@/components/inventory/ItemLinesInput";
import { ReceiptBody, ReceiptPrintPortal, printReceipt, type ReceiptDoc } from "@/components/pos/Receipt";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconClose,
  IconList,
  IconMaximize,
  IconMinimize,
  IconMinus,
  IconPause,
  IconPlus,
  IconPrint,
  IconSearch,
  IconStore,
  IconTrash,
  IconUser,
  IconWallet,
} from "@/components/icons";

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

interface Category {
  id: string;
  name: string;
}

/** A bill parked on this device so the cashier can serve the next person. */
interface HeldBill {
  id: string;
  at: string;
  cart: CartLine[];
  customerId: string;
  customerLabel: string;
  walkInName: string;
  walkInPhone: string;
  appliedCoupon: string;
  total: string;
}

type Mode = "CASH" | "CARD" | "UPI";
type PosItem = ItemOption & { itemType?: string };

const MODES: Mode[] = ["CASH", "CARD", "UPI"];
const MODE_LABEL: Record<Mode, string> = { CASH: "Cash", CARD: "Card", UPI: "UPI" };
/** Item types that make sense as tiles at a shop counter. */
const SELLABLE = new Set(["FINISHED_GOODS", "SERVICE", undefined]);
const FOCUS_KEY = "nexora:pos:focus";
const PRINT_KEY = "nexora:pos:autoprint";
const heldKey = (registerId: string) => `nexora:pos:held:${registerId}`;

let nextKey = 1;
/** Keep new line keys clear of any recalled bill's keys. */
function reserveKeysAbove(keys: number[]) {
  nextKey = Math.max(nextKey, ...keys.map((k) => k + 1));
}
/** Identity + timestamp for a held bill (kept out of render for purity). */
function heldStamp() {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() };
}

/** Stable, gentle tile colour per product, so the grid is scannable without photos. */
const TILE_HUES = [204, 168, 262, 28, 340, 145, 222, 12];
function tileHue(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TILE_HUES[h % TILE_HUES.length];
}
function initials(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase() || "•";
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The billing counter. Pricing comes from the server's quote endpoint on
 * every change, so what the cashier sees is exactly what will be billed —
 * MRP-inclusive GST, automatic and member discounts, coupons and all.
 *
 * Layout: the bill on the left (customer, lines, totals, pay keys) and a
 * tappable product catalogue on the right. Full-screen mode hides the ERP
 * chrome so the counter gets the whole display.
 */
export default function PosRegisterPage() {
  const { me, hasPermission } = useAuth();
  const toast = useToast();
  const warehouses = useWarehouses();

  const [register, setRegister] = useState<Register | null | undefined>(undefined);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [items, setItems] = useState<PosItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // open-register form
  const [counterName, setCounterName] = useState("Counter 1");
  const [openWarehouse, setOpenWarehouse] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [opening, setOpening] = useState(false);

  // cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastKey, setLastKey] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("ALL");
  const [variantFor, setVariantFor] = useState<PosItem | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotedFor, setQuotedFor] = useState("");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptDoc | null>(null);
  const [printPending, setPrintPending] = useState(false);

  // split / tender dialog
  const [splitOpen, setSplitOpen] = useState(false);
  const [payments, setPayments] = useState<Record<Mode, string>>({ CASH: "", CARD: "", UPI: "" });
  const [paymentRef, setPaymentRef] = useState("");

  // held bills, full-screen, auto-print (device preferences)
  const [held, setHeld] = useState<HeldBill[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);

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
    loadItemOptions()
      .then((list) => setItems(list as PosItem[]))
      .catch(() => setItems([]))
      .finally(() => setItemsLoaded(true));
    // Categories are a nicety: a cashier without category access still gets the full grid.
    apiFetch<{ items: Category[] }>("/api/masters/categories?pageSize=200&status=ACTIVE")
      .then((r) => setCategories(r.items))
      .catch(() => setCategories([]));
    apiFetch<{ items: Customer[] }>("/api/customers?pageSize=200&status=ACTIVE")
      .then((r) => setCustomers(r.items))
      .catch(() => setCustomers([]));
    // Device preferences live in localStorage, which only exists after mount.
    setFocus(readJson(FOCUS_KEY, true));
    setAutoPrint(readJson(PRINT_KEY, false));
  }, [loadRegister]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!openWarehouse && warehouses.length) setOpenWarehouse((warehouses.find((w) => w.isDefault) ?? warehouses[0]).id);
  }, [warehouses, openWarehouse]);

  // Held bills belong to one register session on this device.
  const registerId = register?.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeld(registerId ? readJson<HeldBill[]>(heldKey(registerId), []) : []);
  }, [registerId]);

  function saveHeld(next: HeldBill[]) {
    setHeld(next);
    if (registerId) window.localStorage.setItem(heldKey(registerId), JSON.stringify(next));
  }

  // Full-screen counter: hide the ERP header, sidebar and breadcrumbs while billing.
  const fullScreen = focus && Boolean(register);
  useEffect(() => {
    document.documentElement.classList.toggle("posFocus", fullScreen);
    return () => document.documentElement.classList.remove("posFocus");
  }, [fullScreen]);

  function toggleFocus() {
    setFocus((f) => {
      window.localStorage.setItem(FOCUS_KEY, JSON.stringify(!f));
      return !f;
    });
  }

  function toggleAutoPrint() {
    setAutoPrint((p) => {
      window.localStorage.setItem(PRINT_KEY, JSON.stringify(!p));
      return !p;
    });
  }

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // --- search: name, code, SKU or barcode (Enter adds the first hit) ----
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: { item: PosItem; sku: string; exact: boolean }[] = [];
    for (const it of items) {
      const variants = (it.variants ?? []).filter((v) => v.isActive !== false);
      const itemHit = it.name.toLowerCase().includes(q) || it.itemCode.toLowerCase().includes(q);
      if (variants.length === 0) {
        if (itemHit) out.push({ item: it, sku: "", exact: it.itemCode.toLowerCase() === q });
        continue;
      }
      for (const v of variants) {
        const exact = v.sku.toLowerCase() === q || (v.barcode ?? "").toLowerCase() === q;
        if (itemHit || exact || v.sku.toLowerCase().includes(q)) out.push({ item: it, sku: v.sku, exact });
      }
      if (out.length > 60) break;
    }
    // A scanned barcode or typed SKU wins over a loose name match.
    return out.sort((a, b) => Number(b.exact) - Number(a.exact));
  }, [search, items]);

  // --- catalogue tiles ----------------------------------------------------
  const tiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (!SELLABLE.has(it.itemType)) return false;
      if (category !== "ALL" && (it.categoryId ?? "NONE") !== category) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.itemCode.toLowerCase().includes(q) ||
        (it.variants ?? []).some((v) => v.sku.toLowerCase().includes(q) || (v.barcode ?? "").toLowerCase() === q)
      );
    });
  }, [items, category, search]);

  const usedCategories = useMemo(() => {
    const ids = new Set(items.filter((i) => SELLABLE.has(i.itemType)).map((i) => i.categoryId ?? "NONE"));
    const list = categories.filter((c) => ids.has(c.id));
    return ids.has("NONE") && list.length > 0 ? [...list, { id: "NONE", name: "Uncategorised" }] : list;
  }, [items, categories]);

  const qtyInCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) m.set(l.itemId, (m.get(l.itemId) ?? 0) + (Number(l.quantity) || 0));
    return m;
  }, [cart]);

  function addToCart(item: PosItem, sku: string) {
    let key = 0;
    setCart((c) => {
      const existing = c.find((l) => l.itemId === item.id && l.variantSku === sku);
      if (existing) {
        key = existing.key;
        return c.map((l) => (l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      }
      key = nextKey++;
      return [...c, { key, itemId: item.id, variantSku: sku, quantity: "1", price: "", discount: "" }];
    });
    setLastKey(key);
  }

  function tapTile(item: PosItem) {
    const variants = (item.variants ?? []).filter((v) => v.isActive !== false);
    if (variants.length > 1) setVariantFor(item);
    else addToCart(item, variants[0]?.sku ?? "");
  }

  function updateLine(key: number, patch: Partial<CartLine>) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function stepQty(line: CartLine, by: number) {
    const next = (Number(line.quantity) || 0) + by;
    if (next <= 0) setCart((c) => c.filter((x) => x.key !== line.key));
    else updateLine(line.key, { quantity: String(next) });
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
  const quoteKey = JSON.stringify([cartPayload, customerId, appliedCoupon]);

  useEffect(() => {
    if (cartPayload.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
            setQuotedFor(quoteKey);
            setQuoteError(null);
          }
        })
        .catch((err) => !cancelled && setQuoteError(err instanceof ApiError ? err.message : "Could not price the bill"));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cartPayload, customerId, appliedCoupon, quoteKey]);

  const total = quote ? new Decimal(quote.totals.grandTotal) : new Decimal(0);
  const totalQty = cart.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  // The quote may lag a keystroke behind the cart; never bill on a stale or failed one.
  const quoteFresh = Boolean(quote) && quotedFor === quoteKey && !quoteError;
  const canPay = quoteFresh && cartPayload.length > 0 && !submitting;

  const splitPaid = MODES.reduce((s, m) => {
    try {
      return s.plus(payments[m] || "0");
    } catch {
      return s;
    }
  }, new Decimal(0));
  const splitBalance = total.minus(splitPaid);

  function resetSale() {
    setCart([]);
    setLastKey(null);
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

  async function completeSale(pays: { mode: Mode; amount: string; reference?: string }[]) {
    if (!register || !canPay) return;
    setSubmitting(true);
    setSaleError(null);
    try {
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
      setPrintPending(autoPrint);
      setSplitOpen(false);
      toast.success(`Sale ${order.orderNumber} completed`);
      resetSale();
      loadRegister();
    } catch (err) {
      setSaleError(err instanceof ApiError ? err.message : "Could not complete the sale");
    } finally {
      setSubmitting(false);
    }
  }

  /** One-tap payment: the whole bill in a single mode. */
  function quickPay(mode: Mode) {
    if (!canPay) return;
    completeSale([{ mode, amount: total.toFixed(2) }]);
  }

  function openSplit(mode?: Mode) {
    if (!canPay) return;
    setPayments({ CASH: "", CARD: "", UPI: "", [mode ?? settings?.defaultPaymentMode ?? "CASH"]: total.toFixed(2) } as Record<Mode, string>);
    setPaymentRef("");
    setSaleError(null);
    setSplitOpen(true);
  }

  function completeSplit() {
    const pays = MODES.filter((m) => Number(payments[m]) > 0).map((m) => ({
      mode: m,
      amount: payments[m],
      reference: m !== "CASH" && paymentRef ? paymentRef : undefined,
    }));
    if (pays.length === 0 || splitBalance.gt(0)) return;
    completeSale(pays);
  }

  // Print once the receipt portal has rendered.
  useEffect(() => {
    if (!receipt || !printPending) return;
    const t = setTimeout(() => {
      printReceipt();
      setPrintPending(false);
    }, 80);
    return () => clearTimeout(t);
  }, [receipt, printPending]);

  // --- hold / recall ------------------------------------------------------
  const selectedCustomer = customers.find((c) => c.id === customerId);

  function holdBill(silent = false) {
    if (cart.length === 0) {
      if (!silent) toast.error("Nothing to hold", "Add items to the bill first.");
      return;
    }
    const bill: HeldBill = {
      ...heldStamp(),
      cart,
      customerId,
      customerLabel: selectedCustomer?.name ?? walkInName ?? "",
      walkInName,
      walkInPhone,
      appliedCoupon,
      total: total.toFixed(2),
    };
    saveHeld([bill, ...held]);
    resetSale();
    if (!silent) toast.success("Bill on hold", "Press F7 to bring it back.");
    searchRef.current?.focus();
  }

  function recallBill(bill: HeldBill) {
    const rest = held.filter((h) => h.id !== bill.id);
    // Park whatever is on screen first so nothing is lost.
    if (cart.length > 0) {
      const current: HeldBill = {
        ...heldStamp(),
        cart,
        customerId,
        customerLabel: selectedCustomer?.name ?? walkInName ?? "",
        walkInName,
        walkInPhone,
        appliedCoupon,
        total: total.toFixed(2),
      };
      rest.unshift(current);
    }
    saveHeld(rest);
    reserveKeysAbove(bill.cart.map((l) => l.key));
    setCart(bill.cart);
    setLastKey(null);
    setCustomerId(bill.customerId);
    setCustomerQuery("");
    setWalkInName(bill.walkInName);
    setWalkInPhone(bill.walkInPhone);
    setAppliedCoupon(bill.appliedCoupon);
    setCoupon(bill.appliedCoupon);
    setSaleError(null);
    setHeldOpen(false);
  }

  // --- keyboard -------------------------------------------------------------
  // F2 search · F3 card · F4 cash · F5 UPI · F6 hold · F7 held bills · F8 split · F9 pay (default mode)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!register || closing || receipt) return;
      const map: Record<string, () => void> = {
        F2: () => searchRef.current?.focus(),
        F3: () => quickPay("CARD"),
        F4: () => quickPay("CASH"),
        F5: () => quickPay("UPI"),
        F6: () => holdBill(),
        F7: () => setHeldOpen(true),
        F8: () => openSplit(),
        F9: () => (splitOpen ? completeSplit() : quickPay(settings?.defaultPaymentMode ?? "CASH")),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
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
      window.localStorage.removeItem(heldKey(register.id));
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
  const customerMatches = customerQuery.trim()
    ? customers
        .filter((c) => [c.name, c.phone ?? "", c.customerCode ?? ""].some((v) => v.toLowerCase().includes(customerQuery.trim().toLowerCase())))
        .slice(0, 8)
    : [];
  const defaultMode = settings?.defaultPaymentMode ?? "CASH";
  const discountTotal = quote ? new Decimal(quote.totals.discountAmount || "0").plus(quote.totals.couponDiscount || "0") : new Decimal(0);

  return (
    <div className="posx" data-full={fullScreen}>
      {/* ------------------------------------------------------------ top bar */}
      <header className="posxBar">
        <div className="posxBarLeft">
          {fullScreen && (
            <Link href="/dashboard" className="posxIconBtn" title="Back to dashboard" aria-label="Back to dashboard">
              <IconArrowLeft />
            </Link>
          )}
          <span className="posxMark" aria-hidden>
            <IconStore />
          </span>
          <div className="posxCounter">
            <strong>
              {register.counterName} <span className="cellMono">{register.registerNumber}</span>
            </strong>
            <small>
              {register.warehouseName} · opened {new Date(register.openedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </small>
          </div>
        </div>

        <div className="posxStats" aria-label="Shift so far">
          <div>
            <small>Bills</small>
            <strong>{register.orderCount}</strong>
          </div>
          <div>
            <small>Sales</small>
            <strong>₹{formatMoney(register.salesTotal)}</strong>
          </div>
          <div>
            <small>Cash in drawer</small>
            <strong>₹{formatMoney(register.expectedCashNow)}</strong>
          </div>
        </div>

        <div className="posxBarRight">
          <Link href={`/pos/orders?registerId=${register.id}`} className="posxGhostBtn">
            <IconList /> Today&apos;s bills
          </Link>
          <button type="button" className="posxGhostBtn" onClick={() => (setClosing(true), setCloseError(null))}>
            <IconWallet /> Close register
          </button>
          <button
            type="button"
            className="posxIconBtn"
            onClick={toggleFocus}
            title={fullScreen ? "Exit full screen" : "Full screen"}
            aria-label={fullScreen ? "Exit full screen" : "Full screen"}
            aria-pressed={fullScreen}
          >
            {fullScreen ? <IconMinimize /> : <IconMaximize />}
          </button>
        </div>
      </header>

      <div className="posxBody">
        {/* ------------------------------------------------------------ bill */}
        <section className="posxBill" aria-label="Current bill">
          <div className="posxCustomer">
            <IconUser className="posxCustomerIcon" />
            {selectedCustomer ? (
              <div className="posxCustomerChosen">
                <div>
                  <strong>{selectedCustomer.name}</strong>
                  <small>
                    {selectedCustomer.phone}
                    {quote?.membership && ` · ${quote.membership.planName} member −${quote.membership.discountPercent}%`}
                  </small>
                </div>
                <button type="button" className="posxLinkBtn" onClick={() => (setCustomerId(""), setCustomerQuery(""))}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="posxCustomerSearch">
                  <input
                    className="input"
                    placeholder={settings?.requireCustomer ? "Customer (required) — name or phone" : "Find customer by name or phone"}
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    aria-label="Search customer"
                  />
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
                  <>
                    <input className="input" placeholder="Walk-in name" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} aria-label="Walk-in name" />
                    <input className="input" placeholder="Phone" inputMode="tel" value={walkInPhone} onChange={(e) => setWalkInPhone(e.target.value)} aria-label="Walk-in phone" />
                  </>
                )}
              </>
            )}
          </div>

          <div className="posxLines">
            {cart.length === 0 ? (
              <div className="posxEmpty">
                <span className="posxEmptyMark" aria-hidden>
                  <IconStore />
                </span>
                <strong>Start a new bill</strong>
                <p>Scan a barcode, search, or tap a product on the right.</p>
                {held.length > 0 && (
                  <button type="button" className="posxLinkBtn" onClick={() => setHeldOpen(true)}>
                    {held.length} bill{held.length === 1 ? "" : "s"} on hold — recall (F7)
                  </button>
                )}
              </div>
            ) : (
              <table className="posxTable">
                <thead>
                  <tr>
                    <th style={{ width: "2rem" }}>#</th>
                    <th>Item</th>
                    <th style={{ width: "8.25rem", textAlign: "center" }}>Qty</th>
                    <th style={{ width: "6.5rem", textAlign: "right" }}>Price</th>
                    <th style={{ width: "4.75rem", textAlign: "right" }}>Disc %</th>
                    <th style={{ width: "6.5rem", textAlign: "right" }}>Amount</th>
                    <th style={{ width: "2.25rem" }} />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, idx) => {
                    const item = itemById.get(l.itemId);
                    // Quote lines follow cartPayload order (zero-quantity rows are left out).
                    const qi = cartPayload.findIndex((p) => p.itemId === l.itemId && (p.variantSku ?? "") === l.variantSku);
                    const q = qi >= 0 ? quote?.lines[qi] : undefined;
                    const variant = item?.variants?.find((v) => v.sku === l.variantSku);
                    return (
                      <tr key={l.key} className={l.key === lastKey ? "posxRowNew" : undefined}>
                        <td className="cellMuted">{idx + 1}</td>
                        <td>
                          <div className="cellPrimary">{item?.name ?? "—"}</div>
                          <div className="cellSub">
                            {variant ? `${variantLabel(variant)} · ${variant.sku}` : item?.itemCode}
                            {q?.discountName && q.discountName !== "Manual" && (
                              <span className="posxDiscTag">
                                {q.discountName} −{q.discountPercent}%
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="posxStepper">
                            <button type="button" onClick={() => stepQty(l, -1)} aria-label={`One less ${item?.name ?? ""}`}>
                              <IconMinus />
                            </button>
                            <input
                              inputMode="decimal"
                              value={l.quantity}
                              onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                              aria-label="Quantity"
                            />
                            <button type="button" onClick={() => stepQty(l, 1)} aria-label={`One more ${item?.name ?? ""}`}>
                              <IconPlus />
                            </button>
                          </div>
                        </td>
                        <td>
                          <input
                            className="posxCellInput"
                            inputMode="decimal"
                            value={l.price}
                            placeholder={q?.price ?? String(item?.sellingPrice ?? "")}
                            onChange={(e) => updateLine(l.key, { price: e.target.value })}
                            aria-label="Price"
                          />
                        </td>
                        <td>
                          <input
                            className="posxCellInput"
                            type="number"
                            min="0"
                            max={settings?.maxManualDiscountPercent ?? 100}
                            step="any"
                            value={l.discount}
                            placeholder={q && q.discountPercent > 0 ? String(q.discountPercent) : "0"}
                            onChange={(e) => updateLine(l.key, { discount: e.target.value })}
                            aria-label="Discount percent"
                          />
                        </td>
                        <td className="tabular posxAmount">{q ? formatMoney(q.lineTotal) : "…"}</td>
                        <td>
                          <button type="button" className="rowRemoveBtn" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} aria-label="Remove">
                            <IconTrash />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ---------------------------------------------------- totals band */}
          <div className="posxSummary">
            <div className="posxSummaryFigures">
              <div>
                <small>Items</small>
                <strong>{cart.length}</strong>
              </div>
              <div>
                <small>Qty</small>
                <strong>{formatQuantity(totalQty)}</strong>
              </div>
              <div>
                <small>Discount</small>
                <strong>{discountTotal.gt(0) ? `−${formatMoney(discountTotal.toFixed(2))}` : "0.00"}</strong>
              </div>
              <div>
                <small>GST{settings?.pricesIncludeTax ? " (incl.)" : ""}</small>
                <strong>{formatMoney(quote?.totals.totalTax ?? "0")}</strong>
              </div>
              <div>
                <small>Round off</small>
                <strong>{formatMoney(quote?.totals.roundOff ?? "0")}</strong>
              </div>
            </div>
            <div className="posxGrand">
              <small>Total payable</small>
              <strong>₹{formatMoney(total.toFixed(2))}</strong>
            </div>
          </div>

          <div className="posxTools">
            <div className="posxCoupon">
              <input className="input cellMono" placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} aria-label="Coupon code" />
              {appliedCoupon ? (
                <button type="button" className="button buttonSecondary" onClick={() => (setAppliedCoupon(""), setCoupon(""))}>Remove</button>
              ) : (
                <button type="button" className="button buttonSecondary" disabled={!coupon.trim()} onClick={() => setAppliedCoupon(coupon.trim())}>Apply</button>
              )}
            </div>
            <label className="posxToggle">
              <input type="checkbox" checked={autoPrint} onChange={toggleAutoPrint} />
              <span aria-hidden />
              Print receipt after each sale
            </label>
          </div>

          {(quote?.coupon || (quote?.warnings.length ?? 0) > 0 || quoteError || saleError) && (
            <div className="posxNotes">
              {quote?.coupon && <div className="fieldHint">{quote.coupon.code} applied{quote.coupon.description ? ` — ${quote.coupon.description}` : ""}</div>}
              {quote?.warnings.map((w) => <div key={w} className="fieldError">{w}</div>)}
              {quoteError && <div className="fieldError">{quoteError}</div>}
              {saleError && !splitOpen && (
                <div className="banner bannerError">
                  <IconAlertCircle />
                  <span>{saleError}</span>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------ pay keys */}
          <div className="posxKeys">
            {(["CASH", "UPI", "CARD"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`posxKey posxKeyPay ${m === defaultMode ? "posxKeyDefault" : ""}`}
                onClick={() => quickPay(m)}
                disabled={!canPay}
              >
                {submitting ? <span className="spinner" /> : <span className="posxKeyLabel">{MODE_LABEL[m]}</span>}
                <kbd>{m === "CASH" ? "F4" : m === "UPI" ? "F5" : "F3"}</kbd>
              </button>
            ))}
            <button type="button" className="posxKey posxKeyPay" onClick={() => openSplit()} disabled={!canPay}>
              <span className="posxKeyLabel">Split / tender</span>
              <kbd>F8</kbd>
            </button>
            <button type="button" className="posxKey" onClick={() => holdBill()} disabled={cart.length === 0}>
              <span className="posxKeyLabel">
                <IconPause /> Hold
              </span>
              <kbd>F6</kbd>
            </button>
            <button type="button" className="posxKey" onClick={() => setHeldOpen(true)}>
              <span className="posxKeyLabel">
                Held bills {held.length > 0 && <span className="posxCount">{held.length}</span>}
              </span>
              <kbd>F7</kbd>
            </button>
            <button type="button" className="posxKey posxKeyDanger" onClick={resetSale} disabled={cart.length === 0}>
              <span className="posxKeyLabel">
                <IconClose /> Clear bill
              </span>
            </button>
            <Link href="/settings/pos" className="posxKey posxKeyMuted" title="POS settings">
              <span className="posxKeyLabel">Settings</span>
              <small>{settings ? `Disc ≤ ${settings.maxManualDiscountPercent}%` : ""}</small>
            </Link>
          </div>
        </section>

        {/* -------------------------------------------------------- catalogue */}
        <section className="posxCatalog" aria-label="Products">
          <div className="posxSearch">
            <IconSearch />
            <input
              ref={searchRef}
              autoFocus
              placeholder="Scan barcode or search name, code, SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  addToCart(matches[0].item, matches[0].sku);
                  setSearch("");
                }
                if (e.key === "Escape") setSearch("");
              }}
              aria-label="Search products"
            />
            <kbd>F2</kbd>
          </div>

          {usedCategories.length > 0 && (
            <div className="posxChips" role="tablist" aria-label="Categories">
              {[{ id: "ALL", name: "All" }, ...usedCategories].map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={category === c.id} className="posxChip" onClick={() => setCategory(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          <div className="posxGrid">
            {!itemsLoaded ? (
              Array.from({ length: 12 }, (_, i) => <div key={i} className="posxTile posxTileSkel" aria-hidden />)
            ) : tiles.length === 0 ? (
              <div className="posxGridEmpty">
                {search ? `No product matches “${search}”.` : "No sellable products in this category."}
              </div>
            ) : (
              tiles.map((it) => {
                const hue = tileHue(it.itemCode || it.name);
                const variants = (it.variants ?? []).filter((v) => v.isActive !== false);
                const inCart = qtyInCart.get(it.id) ?? 0;
                return (
                  <button key={it.id} type="button" className="posxTile" onClick={() => tapTile(it)} title={`${it.name} · ${it.itemCode}`}>
                    <span className="posxTileArt" style={{ "--h": hue } as CSSProperties} aria-hidden>
                      {initials(it.name)}
                    </span>
                    {inCart > 0 && <span className="posxTileQty">{formatQuantity(inCart)}</span>}
                    <span className="posxTileName">{it.name}</span>
                    <span className="posxTileMeta">
                      <span>₹{formatMoney(String(it.sellingPrice ?? "0"))}</span>
                      {variants.length > 1 && <small>{variants.length} sizes</small>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------------- dialogs */}
      {variantFor && (
        <Modal title={variantFor.name} subtitle="Choose size / colour" onClose={() => setVariantFor(null)} width="30rem">
          <div className="posxVariants">
            {(variantFor.variants ?? [])
              .filter((v) => v.isActive !== false)
              .map((v) => (
                <button
                  key={v.sku}
                  type="button"
                  className="posxVariant"
                  onClick={() => {
                    addToCart(variantFor, v.sku);
                    setVariantFor(null);
                  }}
                >
                  <strong>{variantLabel(v)}</strong>
                  <small className="cellMono">{v.sku}</small>
                </button>
              ))}
          </div>
        </Modal>
      )}

      {splitOpen && (
        <Modal
          title="Take payment"
          subtitle={`Bill total ₹${formatMoney(total.toFixed(2))} — split across modes or enter cash tendered for change.`}
          onClose={() => setSplitOpen(false)}
          busy={submitting}
          width="28rem"
          footer={
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <button type="button" className="button buttonSecondary" onClick={() => setSplitOpen(false)} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={completeSplit} disabled={submitting || splitBalance.gt(0) || splitPaid.lte(0)}>
                {submitting && <span className="spinner" />} Complete sale (F9)
              </button>
            </div>
          }
        >
          <div className="posxSplit">
            {MODES.map((m) => (
              <div key={m} className="posPayRow">
                <label htmlFor={`pay-${m}`}>{MODE_LABEL[m]}</label>
                <input
                  id={`pay-${m}`}
                  className="input"
                  inputMode="decimal"
                  autoFocus={m === "CASH"}
                  value={payments[m]}
                  onChange={(e) => setPayments((p) => ({ ...p, [m]: e.target.value }))}
                />
                <button type="button" className="button buttonGhost buttonSm" onClick={() => setPayments({ CASH: "", CARD: "", UPI: "", [m]: total.toFixed(2) } as Record<Mode, string>)}>
                  Full
                </button>
              </div>
            ))}
            {(Number(payments.CARD) > 0 || Number(payments.UPI) > 0) && (
              <input className="input" placeholder="Card / UPI reference (optional)" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} aria-label="Payment reference" />
            )}
            <div className={`posxSplitResult ${splitBalance.gt(0) ? "isShort" : ""}`}>
              {splitBalance.gt(0) ? (
                <>
                  <span>Still to pay</span>
                  <strong>₹{formatMoney(splitBalance.toFixed(2))}</strong>
                </>
              ) : splitBalance.lt(0) ? (
                <>
                  <span>Change to return</span>
                  <strong>₹{formatMoney(splitBalance.abs().toFixed(2))}</strong>
                </>
              ) : (
                <>
                  <span>Paid in full</span>
                  <strong>✓</strong>
                </>
              )}
            </div>
            {saleError && (
              <div className="banner bannerError">
                <IconAlertCircle />
                <span>{saleError}</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {heldOpen && (
        <Modal title="Bills on hold" subtitle="Saved on this device for this register. Recalling one parks the current bill." onClose={() => setHeldOpen(false)} width="32rem">
          {held.length === 0 ? (
            <p className="cellMuted" style={{ padding: "0.5rem 0" }}>No bills on hold. Press F6 to park the current bill.</p>
          ) : (
            <ul className="posxHeld">
              {held.map((h) => (
                <li key={h.id}>
                  <div>
                    <strong>{h.customerLabel || "Walk-in"}</strong>
                    <small>
                      {h.cart.length} item{h.cart.length === 1 ? "" : "s"} · held at {new Date(h.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </small>
                  </div>
                  <span className="tabular">₹{formatMoney(h.total)}</span>
                  <button type="button" className="button buttonPrimary buttonSm" onClick={() => recallBill(h)}>
                    Recall
                  </button>
                  <button type="button" className="rowRemoveBtn" onClick={() => saveHeld(held.filter((x) => x.id !== h.id))} aria-label="Discard held bill">
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {receipt && (
        <Modal
          title="Sale completed"
          subtitle={String(receipt.orderNumber)}
          onClose={() => (setReceipt(null), searchRef.current?.focus())}
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
          {held.length > 0 && (
            <div className="banner bannerWarning" style={{ marginBottom: "0.75rem" }}>
              <IconAlertCircle />
              <span>
                {held.length} bill{held.length === 1 ? " is" : "s are"} still on hold and will be discarded when the register closes.
              </span>
            </div>
          )}
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
    </div>
  );
}
