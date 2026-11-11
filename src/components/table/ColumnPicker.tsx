"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { IconChevronDown, IconLayers } from "@/components/icons";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

export interface ColumnOption {
  key: string;
  label: string;
}

/**
 * "Columns" dropdown shared by every listing screen. Each column is a toggle:
 * ticked = shown. At least one column always stays visible so the table can
 * never collapse to nothing.
 */
export default function ColumnPicker({
  options,
  hidden,
  onToggle,
  onReset,
  buttonRef,
}: {
  options: ColumnOption[];
  hidden: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
  /** Lets the Ctrl + Shift + K shortcut open this picker from the page above. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEscapeHandler(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const visibleCount = options.length - hidden.length;

  return (
    <div className="columnPicker" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="button buttonSecondary"
        onClick={() => setOpen((o) => !o)}
        title="Choose columns (Ctrl + Shift + K)"
        aria-expanded={open}
      >
        <IconLayers />
        Columns
        {hidden.length > 0 && (
          <span className="columnPickerCount">
            {visibleCount}/{options.length}
          </span>
        )}
        <IconChevronDown style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }} />
      </button>

      {open && (
        <div className="columnPickerPanel" role="dialog" aria-label="Choose visible columns">
          <div className="filterBarHead" style={{ marginBottom: "0.625rem" }}>
            <span>Visible columns</span>
            <span className="activeFilterNote">
              {visibleCount} of {options.length} shown · applies to export too
            </span>
          </div>
          <div className="columnPickerGrid">
            {options.map((col) => {
              const isHidden = hidden.includes(col.key);
              // Guard against hiding the final column.
              const isLastVisible = !isHidden && visibleCount === 1;
              return (
                <button
                  key={col.key}
                  type="button"
                  className={`columnChip ${isHidden ? "columnChipOff" : ""}`}
                  onClick={() => !isLastVisible && onToggle(col.key)}
                  disabled={isLastVisible}
                  aria-pressed={!isHidden}
                  title={isLastVisible ? "At least one column must stay visible" : col.label}
                >
                  {col.label}
                </button>
              );
            })}
            <button type="button" className="columnChip columnChipReset" onClick={onReset}>
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
