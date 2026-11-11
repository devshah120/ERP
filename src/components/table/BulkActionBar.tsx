"use client";

import type { ReactNode } from "react";

export interface BulkAction {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: () => void;
  disabledReason?: string;
}

/**
 * Appears only once rows are selected. Bulk operations report per-row
 * outcomes rather than a single "done" — with 40 selected rows, "37 deleted,
 * 3 skipped because they are not drafts" is the only useful answer.
 */
export default function BulkActionBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="bulkBar" role="region" aria-label="Bulk actions">
      <span className="bulkCount">
        {count} row{count === 1 ? "" : "s"} selected
      </span>

      <div className="bulkActions">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`button buttonSm ${a.tone === "danger" ? "buttonDanger" : "buttonSecondary"}`}
            onClick={a.onSelect}
            disabled={Boolean(a.disabledReason)}
            title={a.disabledReason ?? a.label}
          >
            {a.icon} {a.label}
          </button>
        ))}
      </div>

      <button type="button" className="buttonLink bulkClear" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
