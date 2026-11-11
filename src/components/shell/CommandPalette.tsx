"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { NAV_GROUPS, creatableModules } from "@/app/(app)/navigation";
import { apiFetch } from "@/lib/api/client";
import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";
import { humanizeStatus } from "@/components/ui/StatusBadge";
import { IconArrowRight, IconFile, IconKeyboard, IconPlus, IconSearch, IconUser, IconBox } from "@/components/icons";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  meta?: string;
  icon: ReactNode;
  keywords: string;
  run: () => void;
}

interface ListResult {
  items: Record<string, unknown>[];
}

/** Record types the palette searches live, in result order. */
const RECORD_SOURCES: {
  key: string;
  label: string;
  api: string;
  base: string;
  kind: "party" | "item" | "document";
}[] = [
  { key: "customers", label: "Customer", api: "/api/customers", base: "/customers", kind: "party" },
  { key: "vendors", label: "Vendor", api: "/api/masters/vendors", base: "/vendors", kind: "party" },
  { key: "items", label: "Item", api: "/api/masters/items", base: "/items", kind: "item" },
  { key: "sales-orders", label: "Sales Order", api: "/api/documents/sales-orders", base: "/sales-orders", kind: "document" },
  { key: "sales-invoices", label: "Sales Invoice", api: "/api/documents/sales-invoices", base: "/sales-invoices", kind: "document" },
  { key: "delivery-challans", label: "Delivery Challan", api: "/api/documents/delivery-challans", base: "/delivery-challans", kind: "document" },
  { key: "purchase-orders", label: "Purchase Order", api: "/api/documents/purchase-orders", base: "/purchase-orders", kind: "document" },
  { key: "purchase-invoices", label: "Purchase Invoice", api: "/api/documents/purchase-invoices", base: "/purchase-invoices", kind: "document" },
];

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function partyName(row: Record<string, unknown>): string {
  const party = (row.customer ?? row.vendor) as { name?: string } | undefined;
  return party?.name ?? "";
}

function score(item: PaletteItem, q: string): number {
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  return q.split(/\s+/).every((w) => item.keywords.includes(w)) ? 1 : 0;
}

/**
 * Ctrl + K: one box to reach any screen, create any record, or open a
 * specific customer, item or document by name or number. Record results come
 * from the same list APIs the screens use, so nothing here is a separate index
 * that could go stale.
 */
export default function CommandPalette() {
  const router = useRouter();
  const { paletteOpen, closePalette, openHelp } = useShortcuts();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<PaletteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset each time it opens.
  useEffect(() => {
    if (!paletteOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    setActive(0);
    setRecords([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [paletteOpen]);

  const staticItems = useMemo<PaletteItem[]>(() => {
    const go = (href: string) => () => {
      closePalette();
      router.push(href);
    };
    const items: PaletteItem[] = [];
    for (const g of NAV_GROUPS) {
      if (g.href && !g.soon) {
        items.push({
          id: `nav:${g.href}`,
          group: "Go to",
          label: g.label,
          icon: <g.icon />,
          keywords: g.label.toLowerCase(),
          run: go(g.href),
        });
      }
      for (const c of g.children ?? []) {
        if (!c.enabled) continue;
        items.push({
          id: `nav:${c.href}`,
          group: "Go to",
          label: c.label,
          hint: g.label,
          icon: <g.icon />,
          keywords: `${c.label} ${g.label} ${c.keywords ?? ""}`.toLowerCase(),
          run: go(c.href),
        });
      }
    }
    for (const m of creatableModules()) {
      items.push({
        id: `new:${m.href}`,
        group: "Create",
        label: `New ${m.label.replace(/ies$/, "y").replace(/s$/, "")}`,
        hint: m.group,
        icon: <IconPlus />,
        keywords: `new create add ${m.label} ${m.group}`.toLowerCase(),
        run: go(m.href),
      });
    }
    items.push({
      id: "help:shortcuts",
      group: "Help",
      label: "Keyboard shortcuts",
      icon: <IconKeyboard />,
      meta: "Ctrl /",
      keywords: "keyboard shortcuts help keys hotkeys",
      run: () => {
        closePalette();
        openHelp();
      },
    });
    return items;
  }, [router, closePalette, openHelp]);

  // Live record search, debounced. Sources the user can't see (403) are skipped.
  useEffect(() => {
    if (!paletteOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecords([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ query: q, page: "1", pageSize: "4" });
      const results = await Promise.allSettled(
        RECORD_SOURCES.map((s) => apiFetch<ListResult>(`${s.api}?${params.toString()}`))
      );
      if (cancelled) return;
      const found: PaletteItem[] = [];
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const src = RECORD_SOURCES[i];
        for (const row of r.value.items ?? []) {
          const id = str(row.id);
          const href = `${src.base}/${id}`;
          const open = () => {
            closePalette();
            router.push(href);
          };
          if (src.kind === "document") {
            found.push({
              id: `rec:${src.key}:${id}`,
              group: "Documents",
              label: str(row.documentNumber) || "Draft",
              hint: [src.label, partyName(row)].filter(Boolean).join(" · "),
              meta: row.status ? humanizeStatus(str(row.status)) : undefined,
              icon: <IconFile />,
              keywords: "",
              run: open,
            });
          } else {
            const code = str(row.customerCode ?? row.vendorCode ?? row.itemCode ?? row.code);
            found.push({
              id: `rec:${src.key}:${id}`,
              group: src.kind === "item" ? "Items" : "Parties",
              label: str(row.name) || code || id,
              hint: [src.label, code].filter(Boolean).join(" · "),
              icon: src.kind === "item" ? <IconBox /> : <IconUser />,
              keywords: "",
              run: open,
            });
          }
        }
      });
      setRecords(found);
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, paletteOpen, router, closePalette]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = staticItems
      .map((i) => ({ i, s: score(i, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.i);
    // With no query, keep the list short and useful: navigation + create.
    const base = q ? matched.slice(0, 12) : matched.filter((i) => i.group !== "Go to" || !i.hint).concat(
      matched.filter((i) => i.group === "Go to" && i.hint).slice(0, 8)
    );
    const ordered = q ? [...records, ...base] : base;
    // Group while keeping the first-seen group order.
    const groups: string[] = [];
    for (const it of ordered) if (!groups.includes(it.group)) groups.push(it.group);
    return groups.flatMap((g) => ordered.filter((it) => it.group === g));
  }, [query, staticItems, records]);

  // Keep the active index in range as results change.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!paletteOpen) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[activeIndex]?.run();
    }
  }

  let lastGroup = "";

  return (
    <div
      className="cmdkBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdkInputRow">
          <IconSearch />
          <input
            ref={inputRef}
            className="cmdkInput"
            placeholder="Search screens, customers, items, document numbers…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[activeIndex] ? `cmdk-${activeIndex}` : undefined}
          />
          {searching && <span className="spinner" style={{ color: "var(--text-tertiary)" }} />}
          <kbd>Esc</kbd>
        </div>

        <div className="cmdkList" id="cmdk-list" role="listbox" ref={listRef}>
          {results.length === 0 && !searching && (
            <div className="cmdkEmpty">No matches for “{query}”. Try a document number, party or item name.</div>
          )}
          {results.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="cmdkGroup">{header}</div>}
                <button
                  type="button"
                  id={`cmdk-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-index={index}
                  data-active={index === activeIndex}
                  className="cmdkItem"
                  onMouseMove={() => setActive(index)}
                  onClick={() => item.run()}
                >
                  <span className="cmdkItemIcon">{item.icon}</span>
                  <span className="cmdkItemText">
                    <span>{item.label}</span>
                    {item.hint && <small>{item.hint}</small>}
                  </span>
                  {item.meta && <span className="cmdkItemMeta">{item.meta}</span>}
                  {index === activeIndex && <IconArrowRight style={{ color: "var(--accent)" }} />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="cmdkFoot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span style={{ marginLeft: "auto" }}>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}
