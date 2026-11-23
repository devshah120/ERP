"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconSearch } from "@/components/icons";
import type { ReferenceOption } from "./LinesEditor";

/**
 * A reference picker you type into: the box searches the options by label and
 * detail (e.g. a team member's name or email) and shows the chosen one when
 * closed. Used where a plain dropdown would be too long to scan.
 */
export default function SearchSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Search …",
  invalid,
}: {
  id: string;
  value: string;
  options: ReferenceOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(q)) : options;
    return list.slice(0, 50);
  }, [options, query]);

  // Closing on an outside click; the typed text gives way to the chosen option again.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openList() {
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = matches[active];
      if (pick) choose(pick.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const shown = open ? query : selected ? `${selected.label}${selected.detail ? ` · ${selected.detail}` : ""}` : "";

  return (
    <div ref={wrapRef} className="searchSelect">
      <div className="searchSelectBox">
        <input
          ref={inputRef}
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid ? true : undefined}
          autoComplete="off"
          placeholder={selected && open ? `${selected.label}${selected.detail ? ` · ${selected.detail}` : ""}` : placeholder}
          value={shown}
          onFocus={() => !open && openList()}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="searchSelectBtn"
          aria-label="Search"
          tabIndex={-1}
          onClick={() => {
            if (open) setOpen(false);
            else {
              openList();
              inputRef.current?.focus();
            }
          }}
        >
          <IconSearch width={16} height={16} />
        </button>
      </div>
      {open && (
        <ul id={listId} className="searchSelectList" role="listbox">
          {value && (
            <li role="option" aria-selected={false} className="searchSelectItem searchSelectClear" onMouseDown={(e) => e.preventDefault()} onClick={() => choose("")}>
              Clear selection
            </li>
          )}
          {matches.length === 0 ? (
            <li className="searchSelectEmpty">No matches</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`searchSelectItem${i === active ? " isActive" : ""}${o.value === value ? " isSelected" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o.value)}
              >
                <span>{o.label}</span>
                {o.detail && <span className="searchSelectDetail">{o.detail}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
