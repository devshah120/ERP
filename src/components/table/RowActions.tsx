"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { IconDots } from "@/components/icons";

export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Either navigate… */
  href?: string;
  /** …or run something. */
  onSelect?: () => void;
  /** Set to explain *why* the action is unavailable, rather than hiding it. */
  disabledReason?: string;
  tone?: "default" | "danger";
  /** Shown as an icon button on the row instead of inside the menu. */
  primary?: boolean;
}

/**
 * The per-row action cluster: a few primary actions as icon buttons, the
 * rest behind a kebab menu.
 *
 * Actions that do not apply are shown disabled with the reason on hover
 * rather than removed. A user who cannot find "Delete" assumes the software
 * is broken; one who reads "Only drafts can be deleted" has learnt the rule.
 */
export default function RowActions({ actions }: { actions: RowAction[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function run(action: RowAction) {
    setOpen(false);
    if (action.disabledReason) return;
    if (action.href) router.push(action.href);
    else action.onSelect?.();
  }

  // Open upward when the row sits near the bottom of its scrolling table,
  // so the menu is never clipped by the table's own overflow.
  function toggleMenu() {
    if (!open && wrapRef.current) {
      const own = wrapRef.current.getBoundingClientRect();
      const box = wrapRef.current.closest(".tableWrap")?.getBoundingClientRect();
      const limit = Math.min(box?.bottom ?? window.innerHeight, window.innerHeight);
      setDropUp(limit - own.bottom < 240 && own.top - (box?.top ?? 0) > 240);
    }
    setOpen((o) => !o);
  }

  const primary = actions.filter((a) => a.primary);
  const menu = actions.filter((a) => !a.primary);

  return (
    <div className="rowActions" ref={wrapRef}>
      {primary.map((a) => (
        <button
          key={a.key}
          type="button"
          className="rowActionIcon"
          title={a.disabledReason ?? a.label}
          aria-label={a.label}
          disabled={Boolean(a.disabledReason)}
          onClick={() => run(a)}
        >
          {a.icon}
        </button>
      ))}

      {menu.length > 0 && (
        <>
          <button
            type="button"
            className={`rowActionIcon ${open ? "rowActionIconOpen" : ""}`}
            title="More actions"
            aria-label="More actions"
            aria-expanded={open}
            onClick={toggleMenu}
          >
            <IconDots />
          </button>

          {open && (
            <div className="rowActionMenu" role="menu" style={dropUp ? { top: "auto", bottom: "calc(100% + 0.25rem)" } : undefined}>
              {menu.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  className={`rowActionItem ${a.tone === "danger" ? "rowActionDanger" : ""}`}
                  disabled={Boolean(a.disabledReason)}
                  title={a.disabledReason}
                  onClick={() => run(a)}
                >
                  <span className="rowActionItemIcon">{a.icon}</span>
                  <span>{a.label}</span>
                  {a.disabledReason && <span className="rowActionWhy">{a.disabledReason}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
