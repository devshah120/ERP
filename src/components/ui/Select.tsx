"use client";

import { Children, Fragment, isValidElement, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import { IconCheck } from "@/components/icons";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

/**
 * The app's standard dropdown. A drop-in for a native <select>: the same
 * props and <option> / <optgroup> children, and onChange receives
 * `{ target: { value } }`, so `onChange={(e) => set(e.target.value)}` keeps
 * working. It opens a styled menu (the same one FilterDropdown uses) instead
 * of the browser's list, with a search box for long lists, full keyboard
 * support, and a bottom-sheet style list on phones.
 */

interface Opt {
  value: string;
  label: ReactNode;
  text: string;
  disabled?: boolean;
  group?: string;
}

export interface SelectChangeLike {
  target: { value: string; name?: string };
  currentTarget: { value: string; name?: string };
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Flattens <option>, <optgroup>, fragments and arrays into a list of choices. */
function readOptions(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean; label?: string; hidden?: boolean };
    if (child.type === Fragment) {
      readOptions(props.children, group, out);
    } else if (child.type === "optgroup") {
      readOptions(props.children, props.label ?? "", out);
    } else if (child.type === "option") {
      if (props.hidden) return;
      const text = textOf(props.children);
      out.push({ value: props.value === undefined || props.value === null ? text : String(props.value), label: props.children ?? text, text, disabled: props.disabled, group });
    }
  });
  return out;
}

export default function Select({
  value,
  defaultValue,
  onChange,
  children,
  id,
  name,
  className = "select",
  style,
  disabled,
  title,
  placeholder,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  required,
}: {
  value?: string | number | null;
  defaultValue?: string | number;
  onChange?: (e: SelectChangeLike) => void;
  children?: ReactNode;
  id?: string;
  name?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  /** Shown when the value matches no option. */
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  required?: boolean;
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const [inner, setInner] = useState(defaultValue === undefined ? undefined : String(defaultValue));
  const current = value === undefined ? inner ?? options[0]?.value ?? "" : value === null ? "" : String(value);
  const selected = options.find((o) => o.value === current);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const searchable = options.length > 10;
  const open = Boolean(anchor);

  const close = () => {
    setAnchor(null);
    // Give focus back to the field, as a native select does.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  useEscapeHandler(close, open);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.text.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function openMenu(el: HTMLElement) {
    if (disabled) return;
    setQuery("");
    setAnchor(el);
  }

  function pick(next: string) {
    close();
    if (next === current) return;
    if (value === undefined) setInner(next);
    onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } });
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Like a native select: arrows step through the choices without opening the list.
      e.preventDefault();
      const enabled = options.filter((o) => !o.disabled);
      const at = enabled.findIndex((o) => o.value === current);
      const next = enabled[Math.min(enabled.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) pick(next.value);
    } else if (e.key === "Enter" || e.key === " " || (e.altKey && e.key === "ArrowDown")) {
      e.preventDefault();
      openMenu(e.currentTarget);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      // Typing a letter jumps to the next choice starting with it.
      const k = e.key.toLowerCase();
      const at = options.findIndex((o) => o.value === current);
      const order = [...options.slice(at + 1), ...options.slice(0, at + 1)];
      const hit = order.find((o) => !o.disabled && o.text.trim().toLowerCase().startsWith(k));
      if (hit) pick(hit.value);
    }
  }

  let lastGroup: string | undefined;
  const items: ReactNode[] = [];
  for (const o of shown) {
    if (o.group !== undefined && o.group !== lastGroup) {
      items.push(
        <ListSubheader key={`g-${o.group}-${items.length}`} sx={{ fontSize: "0.75rem", lineHeight: "2rem", color: "text.secondary", fontWeight: 600 }}>
          {o.group}
        </ListSubheader>
      );
    }
    lastGroup = o.group;
    const isSel = o.value === current;
    items.push(
      <MenuItem
        key={`o-${o.value}-${items.length}`}
        selected={isSel}
        disabled={o.disabled}
        onClick={() => pick(o.value)}
        sx={{ fontSize: "0.875rem", py: 0.875, px: 1.5, gap: 1.5, justifyContent: "space-between", fontWeight: isSel ? 600 : 400, whiteSpace: "normal", minHeight: { xs: 44, sm: 36 } }}
      >
        <span>{o.label === "" ? " " : o.label}</span>
        {isSel && <IconCheck width={16} height={16} aria-hidden style={{ flexShrink: 0 }} />}
      </MenuItem>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        className={`${className} selectTrigger`}
        style={style}
        disabled={disabled}
        title={title ?? (selected ? selected.text : undefined)}
        role="combobox"
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        data-placeholder={!selected || selected.value === "" ? true : undefined}
        onClick={(e) => (open ? close() : openMenu(e.currentTarget))}
        onKeyDown={onTriggerKey}
      >
        <span className="selectTriggerText">{selected ? (selected.label === "" ? " " : selected.label) : placeholder ?? (current || " ")}</span>
      </button>
      <Menu
        anchorEl={anchor}
        open={open}
        onClose={close}
        autoFocus={!searchable}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              mt: 0.5,
              minWidth: anchor ? anchor.offsetWidth : 180,
              maxWidth: "min(28rem, calc(100vw - 16px))",
              maxHeight: { xs: "60vh", sm: "20rem" },
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
            },
          },
          list: { id: listId, "aria-label": ariaLabel ?? title, role: "listbox", sx: { py: 0.5 } },
        }}
      >
        {searchable && (
          <li className="filterDropdownSearch" onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}>
            <input className="input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search the list" />
          </li>
        )}
        {shown.length === 0 && (
          <MenuItem disabled sx={{ fontSize: "0.875rem" }}>
            No matches
          </MenuItem>
        )}
        {items}
      </Menu>
    </>
  );
}
