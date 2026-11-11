"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { IconChevronDown, IconLayers } from "@/components/icons";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

export interface ColumnOption {
  key: string;
  label: string;
  /** Can't be hidden (shown as "Required"). Defaults to the first column. */
  required?: boolean;
}

const PANEL_WIDTH = 288; // px, matches .colPanel width

/**
 * "Columns" picker shared by every listing screen: a checklist with Select all,
 * Reset and Save. Changes are a draft until Save, so Close (or Esc, or clicking
 * away) leaves the table as it was. The first column — the record's number or
 * name — is required so a row can always be identified and opened.
 */
export default function ColumnPicker({
  options,
  hidden,
  onApply,
  buttonRef,
}: {
  options: ColumnOption[];
  hidden: string[];
  /** Saves the new set of hidden column keys. */
  onApply: (hidden: string[]) => void;
  /** Lets the Ctrl + Shift + K shortcut open this picker from the page above. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [alignRight, setAlignRight] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const isRequired = (o: ColumnOption, i: number) => o.required ?? i === 0;
  const optional = options.filter((o, i) => !isRequired(o, i));

  function openPanel() {
    setDraft(hidden.filter((k) => options.some((o, i) => o.key === k && !isRequired(o, i))));
    // Open towards whichever side has room, so the panel never runs off-screen.
    const rect = (buttonRef?.current ?? triggerRef.current)?.getBoundingClientRect();
    if (rect) setAlignRight(rect.left + PANEL_WIDTH > window.innerWidth - 12);
    setOpen(true);
  }

  const close = () => setOpen(false);
  useEscapeHandler(close, open);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const shownOptional = optional.filter((o) => !draft.includes(o.key)).length;
  const allShown = shownOptional === optional.length;
  const noneShown = shownOptional === 0;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = !allShown && !noneShown;
  }, [allShown, noneShown, open]);

  function toggle(key: string) {
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  }

  function save() {
    onApply(draft);
    setOpen(false);
  }

  const visibleCount = options.length - hidden.length;

  return (
    <div className="columnPicker" ref={ref}>
      <button
        ref={(el) => {
          triggerRef.current = el;
          if (buttonRef) buttonRef.current = el;
        }}
        type="button"
        className="button buttonSecondary"
        onClick={() => (open ? close() : openPanel())}
        title="Choose columns (Ctrl + Shift + K)"
        aria-expanded={open}
        aria-haspopup="dialog"
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
        <div className={`colPanel ${alignRight ? "colPanelRight" : ""}`} role="dialog" aria-label="Choose visible columns">
          <div className="colPanelHead">
            <strong>Columns</strong>
            <button type="button" className="colLink" onClick={() => setDraft([])} disabled={draft.length === 0}>
              Reset
            </button>
          </div>

          <label className="colRow colSelectAll">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allShown}
              onChange={() => setDraft(allShown ? optional.map((o) => o.key) : [])}
              disabled={optional.length === 0}
            />
            <span className="colLabel">Select all</span>
            <span className="colMeta">
              {options.length - draft.length}/{options.length}
            </span>
          </label>

          <div className="colList">
            {options.map((o, i) => {
              const req = isRequired(o, i);
              return (
                <label key={o.key} className={`colRow ${req ? "colRowLocked" : ""}`} title={req ? "Always shown" : undefined}>
                  <input type="checkbox" checked={req || !draft.includes(o.key)} disabled={req} onChange={() => toggle(o.key)} />
                  <span className="colLabel">{o.label}</span>
                  {req && <span className="colReq">Required</span>}
                </label>
              );
            })}
          </div>

          <div className="colPanelFoot">
            <span className="colHint">Applies to export too</span>
            <button type="button" className="button buttonSecondary buttonSm" onClick={close}>
              Close
            </button>
            <button type="button" className="button buttonPrimary buttonSm" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
