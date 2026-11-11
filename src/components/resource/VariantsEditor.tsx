"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { IconPlus, IconLayers, IconClose } from "@/components/icons";

interface CategoryRange {
  categoryId: string;
  sizes?: string;
  colours?: string;
}

/** Category size/colour ranges, fetched once per page load and shared. */
let rangesPromise: Promise<CategoryRange[]> | null = null;
function loadCategoryRanges(): Promise<CategoryRange[]> {
  rangesPromise ??= apiFetch<{ items: CategoryRange[] }>("/api/masters/category-variants?pageSize=200&status=ACTIVE")
    .then((r) => r.items)
    // Without view permission on category ranges the generator still works;
    // it just has no suggestion to offer.
    .catch(() => []);
  return rangesPromise;
}

export interface VariantRow {
  sku: string;
  color?: string;
  size?: string;
  barcode?: string;
  isActive: boolean;
}

const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: "XS–XXL", sizes: ["XS", "S", "M", "L", "XL", "XXL"] },
  { label: "Waist 28–40", sizes: ["28", "30", "32", "34", "36", "38", "40"] },
  { label: "Kids 2–12", sizes: ["2Y", "4Y", "6Y", "8Y", "10Y", "12Y"] },
  { label: "Free size", sizes: ["FS"] },
];

function splitList(s: string): string[] {
  return [...new Set(s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];
}

function key(color?: string, size?: string) {
  return `${(color ?? "").trim().toLowerCase()}|${(size ?? "").trim().toLowerCase()}`;
}

function makeSku(prefix: string, color?: string, size?: string) {
  const p = (prefix || "ITEM").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16);
  return [p, color?.replace(/[^A-Za-z0-9]/g, "").slice(0, 3), size?.replace(/\s+/g, "")]
    .filter(Boolean)
    .join("-")
    .toUpperCase();
}

/**
 * Editor for an item's size/colour matrix. Each row is a stockable SKU —
 * inventory is tracked per variant, so every row needs a SKU before save.
 *
 * Two ways in: generate the full size × colour grid in one step (the normal
 * case for garments), or add and edit individual rows.
 */
export default function VariantsEditor({
  value,
  onChange,
  skuPrefix,
  categoryId,
}: {
  value: VariantRow[];
  onChange: (rows: VariantRow[]) => void;
  skuPrefix?: string;
  /** The item's category; its saved size/colour range is offered as a preset. */
  categoryId?: string;
}) {
  const [showGen, setShowGen] = useState(value.length === 0);
  const [sizesText, setSizesText] = useState("");
  const [colorsText, setColorsText] = useState("");
  const [ranges, setRanges] = useState<CategoryRange[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadCategoryRanges().then((r) => {
      if (!cancelled) setRanges(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryRange = categoryId ? ranges.find((r) => r.categoryId === categoryId) : undefined;

  const sizes = splitList(sizesText.toUpperCase());
  const colors = splitList(colorsText);
  const existing = useMemo(() => new Set(value.map((r) => key(r.color, r.size))), [value]);
  const newCombos = colors.length && sizes.length
    ? colors.flatMap((c) => sizes.map((s) => ({ c, s }))).filter(({ c, s }) => !existing.has(key(c, s)))
    : [];

  function update(index: number, patch: Partial<VariantRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    onChange([...value, { sku: "", color: "", size: "", barcode: "", isActive: true }]);
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function generate() {
    if (newCombos.length === 0) return;
    onChange([
      ...value,
      ...newCombos.map(({ c, s }) => ({ sku: makeSku(skuPrefix ?? "", c, s), color: c, size: s, barcode: "", isActive: true })),
    ]);
    setShowGen(false);
  }

  /** Builds SKUs from the colour/size pair so users don't hand-type them. */
  function autoFillSkus() {
    onChange(value.map((row) => (row.sku ? row : { ...row, sku: makeSku(skuPrefix ?? "", row.color, row.size) })));
  }

  // Coverage grid: which size × colour pairs exist.
  const gridColors = [...new Set(value.map((r) => r.color?.trim()).filter(Boolean))] as string[];
  const gridSizes = [...new Set(value.map((r) => r.size?.trim()).filter(Boolean))] as string[];
  const missingSkus = value.filter((r) => !r.sku.trim()).length;

  function toggleCell(color: string, size: string) {
    const idx = value.findIndex((r) => key(r.color, r.size) === key(color, size));
    if (idx >= 0) removeRow(idx);
    else onChange([...value, { sku: makeSku(skuPrefix ?? "", color, size), color, size, barcode: "", isActive: true }]);
  }

  return (
    <div style={{ display: "grid", gap: "0.875rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="button buttonSecondary buttonSm" onClick={() => setShowGen((s) => !s)} aria-expanded={showGen}>
          <IconLayers /> Generate size × colour matrix
        </button>
        <button type="button" className="button buttonGhost buttonSm" onClick={addRow}>
          <IconPlus /> Add single variant
        </button>
        {missingSkus > 0 && (
          <button type="button" className="button buttonGhost buttonSm" onClick={autoFillSkus}>
            Auto-fill {missingSkus} missing SKU{missingSkus === 1 ? "" : "s"}
          </button>
        )}
        {value.length > 0 && (
          <span className="activeFilterNote" style={{ marginLeft: "auto" }}>
            {value.length} variant{value.length === 1 ? "" : "s"} · {value.filter((v) => v.isActive).length} active
          </span>
        )}
      </div>

      {showGen && (
        <div className="filterBar" style={{ marginBottom: 0 }}>
          {categoryRange && (
            <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
              <span>
                This category is usually stocked in{" "}
                <strong>{[categoryRange.sizes, categoryRange.colours].filter(Boolean).join(" · ")}</strong>.
              </span>
              <button
                type="button"
                className="button buttonSecondary buttonSm"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  if (categoryRange.sizes) setSizesText(categoryRange.sizes);
                  if (categoryRange.colours) setColorsText(categoryRange.colours);
                }}
              >
                Use this range
              </button>
            </div>
          )}
          <div className="filterBarHead">
            <span>Generate variants</span>
            <button type="button" className="iconButton" onClick={() => setShowGen(false)} aria-label="Close generator">
              <IconClose />
            </button>
          </div>
          <div className="formGrid">
            <div className="field">
              <label htmlFor="gen-sizes">Sizes</label>
              <input
                id="gen-sizes"
                className="input"
                value={sizesText}
                onChange={(e) => setSizesText(e.target.value)}
                placeholder="S, M, L, XL"
              />
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                {SIZE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="analysisLink"
                    style={{ cursor: "pointer" }}
                    onClick={() => setSizesText(p.sizes.join(", "))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="gen-colors">Colours</label>
              <input
                id="gen-colors"
                className="input"
                value={colorsText}
                onChange={(e) => setColorsText(e.target.value)}
                placeholder="Black, White, Navy"
              />
              <span className="fieldHint">Separate with commas. SKUs are built as ITEM-COL-SIZE and stay editable.</span>
            </div>
          </div>
          <div className="filterActions" style={{ alignItems: "center" }}>
            <button type="button" className="button buttonPrimary" onClick={generate} disabled={newCombos.length === 0}>
              {newCombos.length > 0
                ? `Add ${newCombos.length} variant${newCombos.length === 1 ? "" : "s"}`
                : "Add variants"}
            </button>
            <span className="activeFilterNote">
              {colors.length && sizes.length
                ? `${colors.length} colour${colors.length === 1 ? "" : "s"} × ${sizes.length} size${sizes.length === 1 ? "" : "s"}` +
                  (colors.length * sizes.length - newCombos.length > 0
                    ? ` — ${colors.length * sizes.length - newCombos.length} already exist and will be skipped`
                    : "")
                : "Enter at least one size and one colour."}
            </span>
          </div>
        </div>
      )}

      {gridColors.length > 0 && gridSizes.length > 0 && (
        <div className="tableWrap" style={{ boxShadow: "none" }}>
          <table className="table" aria-label="Variant coverage — click a cell to add or remove that combination">
            <thead>
              <tr>
                <th>Colour \ Size</th>
                {gridSizes.map((s) => (
                  <th key={s} style={{ textAlign: "center" }}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridColors.map((c) => (
                <tr key={c}>
                  <td className="cellPrimary">{c}</td>
                  {gridSizes.map((s) => {
                    const has = existing.has(key(c, s));
                    return (
                      <td key={s} style={{ textAlign: "center", padding: "0 0.375rem" }}>
                        <button
                          type="button"
                          onClick={() => toggleCell(c, s)}
                          className={`badge ${has ? "badgeAccent" : "badgeNeutral"} badgePlain`}
                          style={{ cursor: "pointer", minWidth: "2.5rem", justifyContent: "center" }}
                          title={has ? `Remove ${c} / ${s}` : `Add ${c} / ${s}`}
                          aria-pressed={has}
                        >
                          {has ? "✓" : "+"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {value.length === 0 ? (
        !showGen && (
          <div className="fieldHint">No variants yet. Generate the matrix, or add a row for each colour/size you stock.</div>
        )
      ) : (
        <div className="tableWrap" style={{ boxShadow: "none" }}>
          <table className="docLinesTable" style={{ border: "none" }}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Colour</th>
                <th>Size</th>
                <th>Barcode</th>
                <th style={{ width: "4rem", textAlign: "center" }}>Active</th>
                <th style={{ width: "2.5rem" }} />
              </tr>
            </thead>
            <tbody>
              {value.map((row, index) => (
                <tr key={index}>
                  <td>
                    <input
                      className="cellMono"
                      value={row.sku}
                      onChange={(e) => update(index, { sku: e.target.value.toUpperCase() })}
                      placeholder="TSHIRT-BLK-M"
                      aria-label={`SKU, row ${index + 1}`}
                      aria-invalid={!row.sku.trim() || undefined}
                      style={!row.sku.trim() ? { borderColor: "var(--warning-solid)" } : undefined}
                    />
                  </td>
                  <td>
                    <input
                      value={row.color ?? ""}
                      onChange={(e) => update(index, { color: e.target.value })}
                      placeholder="Black"
                      aria-label={`Colour, row ${index + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      value={row.size ?? ""}
                      onChange={(e) => update(index, { size: e.target.value.toUpperCase() })}
                      placeholder="M"
                      aria-label={`Size, row ${index + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      value={row.barcode ?? ""}
                      onChange={(e) => update(index, { barcode: e.target.value })}
                      placeholder="Optional"
                      aria-label={`Barcode, row ${index + 1}`}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => update(index, { isActive: e.target.checked })}
                      aria-label={`Active, row ${index + 1}`}
                      style={{ width: "0.95rem", height: "0.95rem" }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      title="Remove variant"
                      aria-label={`Remove variant ${row.sku || index + 1}`}
                      className="rowRemoveBtn"
                    >
                      <IconClose />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
