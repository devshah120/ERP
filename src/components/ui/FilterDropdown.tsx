"use client";

import { useMemo, useState, type MouseEvent } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { IconCheck, IconChevronDown } from "@/components/icons";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A labelled filter cell ("DEPARTMENT / Human Resources") that opens a styled
 * menu instead of the browser's native list. "" is the "all" choice. Long
 * lists get a search box at the top.
 */
export default function FilterDropdown({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Text for the "" choice; null leaves it out (a required choice such as Current / Former). */
  allLabel?: string | null;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const searchable = options.length > 8;

  const choices = useMemo(() => {
    const all = allLabel === null ? [] : [{ value: "", label: allLabel }];
    const q = query.trim().toLowerCase();
    return [...all, ...(q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options)];
  }, [options, allLabel, query]);

  const current = options.find((o) => o.value === value)?.label ?? (value ? value : allLabel ?? "");

  function open(e: MouseEvent<HTMLElement>) {
    setQuery("");
    setAnchor(e.currentTarget);
  }

  function pick(next: string) {
    setAnchor(null);
    if (next !== value) onChange(next);
  }

  return (
    <>
      <button type="button" className="filterDropdown" data-active={value ? true : undefined} aria-haspopup="listbox" aria-expanded={Boolean(anchor)} onClick={open}>
        <span className="filterDropdownLabel">{label}</span>
        <span className="filterDropdownValue">
          <span>{current}</span>
          <IconChevronDown width={16} height={16} aria-hidden />
        </span>
      </button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        autoFocus={!searchable}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              mt: 0.5,
              minWidth: anchor ? anchor.offsetWidth : 200,
              maxHeight: "20rem",
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
            },
          },
          list: { "aria-label": label, sx: { py: 0.5 } },
        }}
      >
        {searchable && (
          <li className="filterDropdownSearch" onKeyDown={(e) => e.stopPropagation()}>
            <input className="input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label.toLowerCase()}`} />
          </li>
        )}
        {choices.length === 0 && (
          <MenuItem disabled sx={{ fontSize: "0.875rem" }}>
            No matches
          </MenuItem>
        )}
        {choices.map((o) => {
          const selected = o.value === value;
          return (
            <MenuItem
              key={o.value || "__all"}
              selected={selected}
              onClick={() => pick(o.value)}
              sx={{ fontSize: "0.875rem", py: 0.875, px: 1.5, gap: 1.5, justifyContent: "space-between", fontWeight: selected ? 600 : 400 }}
            >
              <span>{o.label}</span>
              {selected && <IconCheck width={16} height={16} aria-hidden />}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
