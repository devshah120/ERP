"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { formatQuantity } from "@/lib/format/number";
import { IconPlus, IconClose } from "@/components/icons";

export interface ItemLine {
  itemId: string;
  variantSku: string;
  quantity: string;
}

export interface ItemOption {
  id: string;
  itemCode: string;
  name: string;
  costPrice?: string;
  sellingPrice?: string;
  taxRatePercent?: number;
  hsnCode?: string;
  categoryId?: string;
  brandId?: string;
  hasVariants?: boolean;
  variants?: { sku: string; size?: string; color?: string; barcode?: string; isActive?: boolean }[];
}

let itemsPromise: Promise<ItemOption[]> | null = null;
/** Active items, fetched once per page load and shared by every picker. */
export function loadItemOptions(): Promise<ItemOption[]> {
  itemsPromise ??= apiFetch<{ items: ItemOption[] }>("/api/masters/items?pageSize=200&status=ACTIVE")
    .then((r) => r.items)
    .catch((err) => {
      itemsPromise = null; // let the next caller retry
      throw err;
    });
  return itemsPromise;
}

export const emptyItemLine = (): ItemLine => ({ itemId: "", variantSku: "", quantity: "1" });

export function variantLabel(v: { sku: string; size?: string; color?: string }) {
  return [v.size, v.color].filter(Boolean).join(" / ") || v.sku;
}

/**
 * Item · size/colour · quantity rows, with the on-hand quantity in the chosen
 * warehouse when `balance` is given — so a request or issue can be checked
 * against stock before it is saved.
 */
export default function ItemLinesInput({
  lines,
  onChange,
  balance,
  addLabel = "Add item",
  disabled = false,
}: {
  lines: ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  /** Shows on-hand stock: permission key for /api/stock/<key>/balance and the warehouse. */
  balance?: { kind: string; warehouseId: string };
  addLabel?: string;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<ItemOption[]>([]);
  const [onHand, setOnHand] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    loadItemOptions()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!balance?.warehouseId) return;
    let cancelled = false;
    apiFetch<{ items: { itemId: string; variantSku: string; quantity: number }[] }>(
      `/api/stock/${balance.kind}/balance?warehouseId=${balance.warehouseId}`
    )
      .then((r) => !cancelled && setOnHand(new Map(r.items.map((b) => [`${b.itemId}|${b.variantSku}`, b.quantity]))))
      .catch(() => !cancelled && setOnHand(null));
    return () => {
      cancelled = true;
    };
  }, [balance?.kind, balance?.warehouseId]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  function update(i: number, patch: Partial<ItemLine>) {
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <div style={{ display: "grid", gap: "0.625rem" }}>
      <div className="tableWrap" style={{ boxShadow: "none" }}>
        <table className="docLinesTable" style={{ border: "none" }}>
          <thead>
            <tr>
              <th style={{ width: "2.5rem" }}>#</th>
              <th>Item</th>
              <th style={{ width: "13rem" }}>Size / colour</th>
              {balance && <th style={{ width: "7rem", textAlign: "right" }}>On hand</th>}
              <th style={{ width: "7rem", textAlign: "right" }}>Qty</th>
              <th style={{ width: "2.5rem" }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const item = byId.get(l.itemId);
              const variants = (item?.variants ?? []).filter((v) => v.isActive !== false);
              const have = onHand?.get(`${l.itemId}|${l.variantSku}`) ?? 0;
              const short = balance && l.itemId && Number(l.quantity) > have;
              return (
                <tr key={i}>
                  <td className="cellMuted tabular" style={{ paddingLeft: "0.75rem" }}>
                    {i + 1}
                  </td>
                  <td>
                    <select value={l.itemId} disabled={disabled} aria-label={`Item, row ${i + 1}`} onChange={(e) => update(i, { itemId: e.target.value, variantSku: "" })}>
                      <option value="">— choose item —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.itemCode} · {it.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {variants.length > 0 ? (
                      <select value={l.variantSku} disabled={disabled} aria-label={`Variant, row ${i + 1}`} onChange={(e) => update(i, { variantSku: e.target.value })}>
                        <option value="">— choose —</option>
                        {variants.map((v) => (
                          <option key={v.sku} value={v.sku}>
                            {variantLabel(v)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="cellMuted" style={{ paddingLeft: "0.5rem" }}>
                        —
                      </span>
                    )}
                  </td>
                  {balance && (
                    <td className="tabular" style={{ textAlign: "right", paddingRight: "0.75rem", color: short ? "var(--danger)" : undefined }}>
                      {l.itemId ? formatQuantity(have) : ""}
                    </td>
                  )}
                  <td>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={disabled}
                      value={l.quantity}
                      aria-label={`Quantity, row ${i + 1}`}
                      onChange={(e) => update(i, { quantity: e.target.value })}
                      style={{ textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <button type="button" className="rowRemoveBtn" disabled={disabled} onClick={() => onChange(lines.filter((_, idx) => idx !== i))} aria-label={`Remove row ${i + 1}`}>
                      <IconClose />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <div>
          <button type="button" className="button buttonSecondary buttonSm" onClick={() => onChange([...lines, emptyItemLine()])}>
            <IconPlus /> {addLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** Lines ready for the API: blank rows dropped, quantities numeric. */
export function cleanLines(lines: ItemLine[]) {
  return lines
    .filter((l) => l.itemId)
    .map((l) => ({ itemId: l.itemId, variantSku: l.variantSku || undefined, quantity: Number(l.quantity) }));
}
