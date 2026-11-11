"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "../AuthProvider";
import { apiFetch } from "@/lib/api/client";
import { formatMoney } from "@/lib/format/number";
import { canEncodeCode128 } from "@/lib/barcode/code128";
import { buildLabelPdf } from "@/lib/barcode/labelPdf";
import { loadItemOptions, variantLabel, type ItemOption } from "@/components/inventory/ItemLinesInput";
import PageHeader from "@/components/ui/PageHeader";
import AccessDenied from "@/components/ui/AccessDenied";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import BarcodeSvg from "@/components/labels/BarcodeSvg";
import { IconClose, IconDownload, IconMinus, IconPlus, IconPrint, IconSearch, IconTrash } from "@/components/icons";

/* ------------------------------------------------------------------ */
/* Label settings                                                      */
/* ------------------------------------------------------------------ */

interface Template {
  key: string;
  label: string;
  w: number; // mm
  h: number; // mm
}

/** Common roll-label sizes (width × height in mm). */
const TEMPLATES: Template[] = [
  { key: "50x25", label: "50 × 25 mm", w: 50, h: 25 },
  { key: "38x25", label: "38 × 25 mm", w: 38, h: 25 },
  { key: "40x30", label: "40 × 30 mm", w: 40, h: 30 },
  { key: "75x50", label: "75 × 50 mm", w: 75, h: 50 },
  { key: "100x50", label: "100 × 50 mm", w: 100, h: 50 },
];

/** Labels across the roll ("UPS"). */
const ACROSS = [1, 2, 3, 4];
const GAP_MM = 2;

type DateFormat = "MM/YYYY" | "DD/MM/YYYY";

interface LabelRow {
  key: number;
  itemId: string;
  name: string;
  variant: string;
  code: string; // what the barcode encodes
  qty: number;
  mrp: string;
  packedOn: string; // yyyy-mm-dd
}

interface Option {
  id: string;
  name: string;
}

type Item = ItemOption & { itemType?: string };

const SELLABLE = new Set(["FINISHED_GOODS", "SERVICE", undefined]);
const SETTINGS_KEY = "nexora:labels:settings";

let nextKey = 1;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatPacked(iso: string, fmt: DateFormat) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return fmt === "MM/YYYY" ? `${m}/${y}` : `${d}/${m}/${y}`;
}

/** One queue row per sellable unit: each active variant, or the item itself. */
function rowsFor(item: Item, packedOn: string): LabelRow[] {
  const variants = (item.variants ?? []).filter((v) => v.isActive !== false);
  const mrp = String(item.sellingPrice ?? "0");
  if (variants.length === 0) {
    return [{ key: nextKey++, itemId: item.id, name: item.name, variant: "", code: item.itemCode, qty: 1, mrp, packedOn }];
  }
  return variants.map((v) => ({
    key: nextKey++,
    itemId: item.id,
    name: item.name,
    variant: variantLabel(v),
    code: v.barcode || v.sku,
    qty: 1,
    mrp,
    packedOn,
  }));
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * Utilities → Barcode / Labels. Queue products (by category/brand or by
 * scanning), choose a label size and how many across the roll, check the
 * live preview, then print. Barcodes are Code 128 of the variant barcode,
 * SKU or item code, so the POS scanner finds the product straight away.
 */
export default function BarcodeLabelsPage() {
  const { me, hasPermission } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [loaded, setLoaded] = useState(false);

  // pickers
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // label settings (remembered on this device)
  const [templateKey, setTemplateKey] = useState("50x25");
  const [across, setAcross] = useState(1);
  const [showBusiness, setShowBusiness] = useState(true);
  const [showMrp, setShowMrp] = useState(true);
  const [showDate, setShowDate] = useState(false);
  const [dateFormat, setDateFormat] = useState<DateFormat>("MM/YYYY");

  const [rows, setRows] = useState<LabelRow[]>([]);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    loadItemOptions()
      .then((list) => setItems(list as Item[]))
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
    apiFetch<{ items: Option[] }>("/api/masters/categories?pageSize=200&status=ACTIVE").then((r) => setCategories(r.items)).catch(() => setCategories([]));
    apiFetch<{ items: Option[] }>("/api/masters/brands?pageSize=200&status=ACTIVE").then((r) => setBrands(r.items)).catch(() => setBrands([]));
    try {
      const s = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null");
      if (s) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (TEMPLATES.some((t) => t.key === s.templateKey)) setTemplateKey(s.templateKey);
        if (ACROSS.includes(s.across)) setAcross(s.across);
        if (typeof s.showBusiness === "boolean") setShowBusiness(s.showBusiness);
        if (typeof s.showMrp === "boolean") setShowMrp(s.showMrp);
        if (typeof s.showDate === "boolean") setShowDate(s.showDate);
        if (s.dateFormat === "MM/YYYY" || s.dateFormat === "DD/MM/YYYY") setDateFormat(s.dateFormat);
      }
    } catch {
      /* defaults */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ templateKey, across, showBusiness, showMrp, showDate, dateFormat }));
    } catch {
      /* ignore */
    }
  }, [templateKey, across, showBusiness, showMrp, showDate, dateFormat]);

  const template = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0];
  const sellable = useMemo(() => items.filter((i) => SELLABLE.has(i.itemType)), [items]);

  // scan / search: exact barcode, SKU or item code first, then name matches
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: { item: Item; code: string; label: string; exact: boolean }[] = [];
    for (const it of sellable) {
      const variants = (it.variants ?? []).filter((v) => v.isActive !== false);
      const nameHit = it.name.toLowerCase().includes(q) || it.itemCode.toLowerCase().includes(q);
      if (variants.length === 0) {
        if (nameHit) out.push({ item: it, code: it.itemCode, label: it.name, exact: it.itemCode.toLowerCase() === q });
        continue;
      }
      for (const v of variants) {
        const code = v.barcode || v.sku;
        const exact = v.sku.toLowerCase() === q || (v.barcode ?? "").toLowerCase() === q;
        if (nameHit || exact || v.sku.toLowerCase().includes(q)) out.push({ item: it, code, label: `${it.name} — ${variantLabel(v)}`, exact });
      }
      if (out.length > 40) break;
    }
    return out.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 12);
  }, [search, sellable]);

  function addRows(newRows: LabelRow[]) {
    setRows((current) => {
      const next = [...current];
      for (const r of newRows) {
        const existing = next.find((x) => x.code === r.code);
        if (existing) existing.qty += r.qty;
        else next.push(r);
      }
      return next.map((x) => ({ ...x }));
    });
  }

  function addMatch(m: (typeof matches)[number]) {
    const all = rowsFor(m.item, today());
    const one = all.find((r) => r.code === m.code) ?? all[0];
    addRows([one]);
    setSearch("");
    searchRef.current?.focus();
  }

  function applyFilters() {
    const picked = sellable.filter((i) => (!categoryId || i.categoryId === categoryId) && (!brandId || i.brandId === brandId));
    if (picked.length === 0) {
      toast.error("No products match", "Try another category or brand.");
      return;
    }
    const newRows = picked.flatMap((i) => rowsFor(i, today()));
    addRows(newRows.map((r) => ({ ...r, qty: 1 })));
    toast.success(`${newRows.length} label row${newRows.length === 1 ? "" : "s"} added`);
  }

  function update(key: number, patch: Partial<LabelRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Step from the latest count, so quick repeated clicks all register. */
  function stepQty(key: number, by: number) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, qty: Math.max(0, Math.min(999, r.qty + by)) } : r)));
  }

  const printable = rows.filter((r) => r.qty > 0 && canEncodeCode128(r.code));
  const labelCount = printable.reduce((s, r) => s + r.qty, 0);
  const skipped = rows.filter((r) => !canEncodeCode128(r.code)).length;

  function exportCsv() {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ["Code", "Product", "Variant", "MRP", "Labels", "Packed on"].map(esc).join(","),
      ...rows.map((r) => [r.code, r.name, r.variant, r.mrp, r.qty, r.packedOn].map(esc).join(",")),
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `labels-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * Builds a PDF where every page is one row of labels at true size and opens
   * it in a new tab to print — printers can't shrink or re-scale it the way
   * they do with browser printing.
   */
  async function generatePdf() {
    if (labelCount === 0 || printing) return;
    // Open the tab now, inside the click, so pop-up blockers allow it.
    const tab = window.open("", "_blank");
    setPrinting(true);
    try {
      const bytes = await buildLabelPdf(
        printable.map((r) => ({
          name: r.name,
          variant: r.variant,
          code: r.code,
          mrp: r.mrp,
          packedOn: formatPacked(r.packedOn, dateFormat),
          copies: r.qty,
        })),
        {
          width: template.w,
          height: template.h,
          across,
          gap: GAP_MM,
          showBusiness,
          showMrp,
          showDate,
          business: { name: me?.business?.name ?? "", city: me?.business?.city, phone: me?.business?.phone, email: me?.business?.email },
        }
      );
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      if (tab) tab.location.href = url;
      else {
        // Pop-ups blocked: download the file instead.
        const a = document.createElement("a");
        a.href = url;
        a.download = `labels-${today()}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Labels ready", `${labelCount} label${labelCount === 1 ? "" : "s"} · ${template.label}`);
    } catch {
      tab?.close();
      toast.error("Couldn't create the labels", "Please try again.");
    } finally {
      setPrinting(false);
    }
  }

  if (!hasPermission("items.view")) return <AccessDenied detail="Printing labels needs the Products · view permission." />;

  const business = me?.business ?? null;
  const sample: LabelRow = rows[0] ?? { key: 0, itemId: "", name: "Product name", variant: "M / Black", code: "SAMPLE-001", qty: 1, mrp: "499", packedOn: today() };
  const labelProps = { template, business, showBusiness, showMrp, showDate, dateFormat };

  return (
    <div className="lblPage">
      <PageHeader title="Barcode / Labels" description="Print barcode price tags for products — scan them at the POS to add the item to a bill." />

      <div className="lblTop">
        {/* ------------------------------------------------- settings card */}
        <section className="lblCard lblSettings">
          <div className="lblGrid">
            <div className="field">
              <label htmlFor="lb-cat">Category</label>
              <select id="lb-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lb-brand">Brand</label>
              <select id="lb-brand" className="select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field lblApplyField">
              <span className="lblFieldSpacer" aria-hidden>
                &nbsp;
              </span>
              <button type="button" className="button buttonPrimary" onClick={applyFilters} disabled={!loaded}>
                <IconPlus /> Add products
              </button>
            </div>

            <div className="field lblSpan2">
              <label htmlFor="lb-scan">Scan barcode / product name</label>
              <div className="lblScan">
                <IconSearch />
                <input
                  id="lb-scan"
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches[0]) {
                      e.preventDefault();
                      addMatch(matches[0]);
                    }
                    if (e.key === "Escape") setSearch("");
                  }}
                  placeholder="Scan a barcode or type a product name, code or SKU…"
                  autoComplete="off"
                />
                {matches.length > 0 && (
                  <div className="posResults" role="listbox">
                    {matches.map((m) => (
                      <button key={`${m.item.id}-${m.code}`} type="button" className="posResult" onClick={() => addMatch(m)}>
                        <span>{m.label}</span>
                        <span className="cellMuted cellMono">{m.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="lb-across">Print type</label>
              <select id="lb-across" className="select" value={across} onChange={(e) => setAcross(Number(e.target.value))}>
                {ACROSS.map((n) => (
                  <option key={n} value={n}>
                    {n} UPS · {n} label{n === 1 ? "" : "s"} across
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="lb-template">Label size</label>
              <select id="lb-template" className="select" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                {TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field lblSpan2">
              <span className="lblLabel">Show on label</span>
              <div className="lblChecks">
                <label className="checkboxRow">
                  <input type="checkbox" checked={showBusiness} onChange={(e) => setShowBusiness(e.target.checked)} /> Business name
                </label>
                <label className="checkboxRow">
                  <input type="checkbox" checked={showMrp} onChange={(e) => setShowMrp(e.target.checked)} /> MRP
                </label>
                <label className="checkboxRow">
                  <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} /> Packing date
                </label>
                {showDate && (
                  <select className="select lblDateFormat" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)} aria-label="Date format">
                    <option value="MM/YYYY">MM/YYYY</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  </select>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- live preview */}
        <section className="lblCard lblPreviewCard">
          <div className="lblPreviewTitle">Live preview</div>
          <div className="lblPreviewStage">
            <Label row={sample} {...labelProps} />
          </div>
          <div className="lblPreviewSize">
            {template.label} · {across} across
          </div>
        </section>
      </div>

      {/* ----------------------------------------------------------- queue */}
      <section className="lblCard lblQueue">
        {rows.length === 0 ? (
          <EmptyState title="Nothing queued yet" description="Scan a barcode or add products by category or brand to build your label batch." />
        ) : (
          <div className="tableWrap" style={{ border: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Product</th>
                  <th style={{ width: "8.5rem", textAlign: "center" }}>Labels</th>
                  <th style={{ width: "8rem" }}>MRP</th>
                  <th style={{ width: "10rem" }}>Packing date</th>
                  <th className="actionCell">
                    <span className="srOnly">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ok = canEncodeCode128(r.code);
                  return (
                    <tr key={r.key}>
                      <td className="cellMono">
                        {r.code}
                        {!ok && <div className="fieldError">Can&apos;t print as a barcode</div>}
                      </td>
                      <td>
                        <div className="cellPrimary">{r.name}</div>
                        {r.variant && <div className="cellSub">{r.variant}</div>}
                      </td>
                      <td>
                        <div className="posxStepper">
                          <button type="button" onClick={() => stepQty(r.key, -1)} aria-label="Fewer labels">
                            <IconMinus />
                          </button>
                          <input inputMode="numeric" value={r.qty} onChange={(e) => update(r.key, { qty: Math.max(0, Math.min(999, Number(e.target.value.replace(/\D/g, "")) || 0)) })} aria-label="Number of labels" />
                          <button type="button" onClick={() => stepQty(r.key, 1)} aria-label="More labels">
                            <IconPlus />
                          </button>
                        </div>
                      </td>
                      <td>
                        <input className="input" inputMode="decimal" value={r.mrp} onChange={(e) => update(r.key, { mrp: e.target.value })} aria-label="MRP" />
                      </td>
                      <td>
                        <input className="input" type="date" value={r.packedOn} onChange={(e) => update(r.key, { packedOn: e.target.value })} aria-label="Packing date" />
                      </td>
                      <td className="actionCell">
                        <button type="button" className="rowRemoveBtn" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.name}`}>
                          <IconTrash />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- footer */}
      <div className="lblFooter">
        <div className="lblCount">
          <strong>{labelCount}</strong> label{labelCount === 1 ? "" : "s"} ready · {across} UPS · {template.label}
          {skipped > 0 && <span className="fieldError"> · {skipped} code{skipped === 1 ? "" : "s"} can&apos;t be printed</span>}
        </div>
        <button type="button" className="button buttonGhost" onClick={() => setRows([])} disabled={rows.length === 0}>
          <IconClose /> Clear
        </button>
        <button type="button" className="button buttonSecondary" onClick={exportCsv} disabled={rows.length === 0}>
          <IconDownload /> Get CSV
        </button>
        <button type="button" className="button buttonPrimary" onClick={generatePdf} disabled={labelCount === 0 || printing}>
          {printing ? <span className="spinner" /> : <IconPrint />} Generate barcode
        </button>
      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One label                                                           */
/* ------------------------------------------------------------------ */

function Label({
  row,
  template,
  business,
  showBusiness,
  showMrp,
  showDate,
  dateFormat,
}: {
  row: LabelRow;
  template: Template;
  business: { name: string; city?: string; phone?: string; email?: string } | null;
  showBusiness: boolean;
  showMrp: boolean;
  showDate: boolean;
  dateFormat: DateFormat;
}) {
  const style = { width: `${template.w}mm`, height: `${template.h}mm`, "--lh": template.h, "--lw": template.w } as CSSProperties;
  const packed = showDate && row.packedOn ? formatPacked(row.packedOn, dateFormat) : "";

  if (template.h >= 40) {
    const contact = [business?.email ? `Email : ${business.email}` : "", business?.phone ? `Cust. Care No : ${business.phone}` : ""].filter(Boolean).join("    ");
    return (
      <div className="lbl lblDetailed" style={style}>
        <div className="lblTitle">{row.name}</div>
        {row.variant && <div className="lblSub">{row.variant}</div>}
        <div className="lblLine">
          {showMrp ? (
            <span>
              <b>MRP : Rs. {formatMoney(row.mrp || "0")}/-</b> <small>(Incl. of all taxes)</small>
            </span>
          ) : (
            <span />
          )}
          {packed && <b>Mfg : {packed}</b>}
        </div>
        <div className="lblBarBlock">
          <BarcodeSvg value={row.code} className="lblBars" />
          <div className="lblCode">{row.code}</div>
        </div>
        {showBusiness && business?.name && (
          <div className="lblFine">
            Mfg. &amp; Pkd. by : {business.name}
            {business.city ? `, ${business.city}` : ""}
          </div>
        )}
        {contact && <div className="lblFine">{contact}</div>}
      </div>
    );
  }

  return (
    <div className="lbl" style={style}>
      {showBusiness && business?.name && <div className="lblBiz">{business.name}</div>}
      <div className="lblName">
        {row.name}
        {row.variant && <span className="lblVariant"> - {row.variant}</span>}
      </div>
      {(showMrp || packed) && (
        <div className="lblInfo">
          {showMrp && <span className="lblMrp">MRP : Rs. {formatMoney(row.mrp || "0")}</span>}
          {packed && <span>Pkd {packed}</span>}
        </div>
      )}
      <BarcodeSvg value={row.code} className="lblBars" />
      <div className="lblCode">{row.code}</div>
    </div>
  );
}
