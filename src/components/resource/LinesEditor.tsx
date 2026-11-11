"use client";

import type { LineColumnConfig } from "@/lib/resources/ui/types";
import { IconPlus, IconClose } from "@/components/icons";

export type LineRow = Record<string, unknown>;

export interface ReferenceOption {
  value: string;
  label: string;
  /** Item SKUs, when the reference is to items — feeds "variant" columns. */
  variants?: { sku: string; label: string }[];
}

export function emptyLine(columns: LineColumnConfig[]): LineRow {
  const row: LineRow = {};
  for (const c of columns) row[c.name] = c.defaultValue ?? (c.type === "number" ? 1 : "");
  return row;
}

/**
 * Inline table for a list of sub-rows — the components of a BOM or a combo.
 * Columns come from the field config, so every "lines" field looks and
 * behaves the same.
 */
export default function LinesEditor({
  fieldName,
  columns,
  value,
  onChange,
  options,
  errors,
  addLabel = "Add line",
}: {
  fieldName: string;
  columns: LineColumnConfig[];
  value: LineRow[];
  onChange: (rows: LineRow[]) => void;
  /** Reference options keyed by `${fieldName}.${column.name}`. */
  options: Record<string, ReferenceOption[]>;
  /** Field errors keyed by dot path, e.g. "components.0.quantity". */
  errors: Record<string, string>;
  addLabel?: string;
}) {
  function update(index: number, name: string, v: unknown) {
    onChange(
      value.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, [name]: v };
        // A new item invalidates the variant chosen for the old one.
        for (const c of columns) if (c.type === "variant" && c.itemColumn === name) next[c.name] = "";
        return next;
      })
    );
  }

  function cell(row: LineRow, index: number, col: LineColumnConfig) {
    const v = row[col.name];
    const label = `${col.label}, row ${index + 1}`;
    const err = errors[`${fieldName}.${index}.${col.name}`];
    const style = err ? { borderColor: "var(--danger)" } : undefined;

    if (col.type === "reference") {
      return (
        <select aria-label={label} value={String(v ?? "")} onChange={(e) => update(index, col.name, e.target.value)} style={style}>
          <option value="">— choose —</option>
          {(options[`${fieldName}.${col.name}`] ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    if (col.type === "variant") {
      const itemId = String(row[col.itemColumn ?? ""] ?? "");
      const itemOpts = options[`${fieldName}.${col.itemColumn}`] ?? [];
      const variants = itemOpts.find((o) => o.value === itemId)?.variants ?? [];
      if (variants.length === 0) return <span className="cellMuted" style={{ paddingLeft: "0.5rem" }}>—</span>;
      return (
        <select aria-label={label} value={String(v ?? "")} onChange={(e) => update(index, col.name, e.target.value)} style={style}>
          <option value="">— size / colour —</option>
          {variants.map((o) => (
            <option key={o.sku} value={o.sku}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        aria-label={label}
        type={col.type === "number" ? "number" : "text"}
        step={col.type === "number" ? "any" : undefined}
        inputMode={col.type === "money" ? "decimal" : undefined}
        value={v === undefined || v === null ? "" : String(v)}
        placeholder={col.placeholder}
        onChange={(e) => update(index, col.name, e.target.value)}
        style={{ ...style, textAlign: col.type === "number" || col.type === "money" ? "right" : undefined }}
      />
    );
  }

  const listError = errors[fieldName];

  return (
    <div style={{ display: "grid", gap: "0.625rem" }}>
      {value.length > 0 && (
        <div className="tableWrap" style={{ boxShadow: "none" }}>
          <table className="docLinesTable" style={{ border: "none" }}>
            <thead>
              <tr>
                <th style={{ width: "2.5rem" }}>#</th>
                {columns.map((c) => (
                  <th key={c.name} style={{ width: c.width, textAlign: c.type === "number" || c.type === "money" ? "right" : undefined }}>
                    {c.label}
                    {c.required && <span className="req" aria-hidden>*</span>}
                  </th>
                ))}
                <th style={{ width: "2.5rem" }} />
              </tr>
            </thead>
            <tbody>
              {value.map((row, index) => (
                <tr key={index}>
                  <td className="cellMuted tabular" style={{ paddingLeft: "0.75rem" }}>
                    {index + 1}
                  </td>
                  {columns.map((c) => (
                    <td key={c.name}>{cell(row, index, c)}</td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="rowRemoveBtn"
                      onClick={() => onChange(value.filter((_, i) => i !== index))}
                      aria-label={`Remove row ${index + 1}`}
                      title="Remove row"
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
      <div>
        <button type="button" className="button buttonSecondary buttonSm" onClick={() => onChange([...value, emptyLine(columns)])}>
          <IconPlus /> {addLabel}
        </button>
      </div>
      {listError && <span className="fieldError">{listError}</span>}
    </div>
  );
}
