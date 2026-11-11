"use client";

import { useState } from "react";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

/**
 * Applies one discount percentage across every line at once.
 *
 * It overwrites each line's own discount rather than stacking on top of it,
 * because "20% off the order" is a single decision — compounding it with a
 * line's existing 10% would quietly give away 28%.
 */
export default function MassDiscountDialog({
  lineCount,
  onApply,
  onClose,
}: {
  lineCount: number;
  onApply: (percent: number) => void;
  onClose: () => void;
}) {
  const [percent, setPercent] = useState("");
  useEscapeHandler(onClose);

  const value = Number(percent);
  const valid = percent.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modalCard confirmCard" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Mass discount">
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Apply discount to all lines</div>
            <div className="modalSubtitle">
              Sets the same discount on all {lineCount} line{lineCount === 1 ? "" : "s"}, replacing any discount
              already entered on them.
            </div>
          </div>
        </div>

        <div className="modalBody">
          <div className="field">
            <label htmlFor="mass-discount">Discount %</label>
            <input
              id="mass-discount"
              className="input"
              inputMode="decimal"
              autoFocus
              value={percent}
              placeholder="e.g. 10"
              onChange={(e) => setPercent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid) {
                  e.preventDefault();
                  onApply(value);
                }
              }}
            />
            <span className="hint">Between 0 and 100. Totals are still recalculated by the server on save.</span>
          </div>
        </div>

        <div className="modalFooter">
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="button buttonSecondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="button buttonPrimary" disabled={!valid} onClick={() => onApply(value)}>
              Apply to all lines
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
