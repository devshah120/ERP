"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { NAV_GROUPS, creatableModules, getRequiredPermission, getCreatePermission } from "@/app/(app)/navigation";
import { useAuth } from "@/app/(app)/AuthProvider";
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
 * specific customer, item or document by name or number.
 */
export default function CommandPalette() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { paletteOpen, closePalette, openHelp } = useShortcuts();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<PaletteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset each time it opens.
  useEffect(() => {
    if (!paletteOpen) return;
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
        const perm = getRequiredPermission(g.href);
        if (perm && !hasPermission(perm)) continue;
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
        const perm = getRequiredPermission(c.href);
        if (perm && !hasPermission(perm)) continue;
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
      const perm = getCreatePermission(m.href);
      if (perm && !hasPermission(perm)) continue;
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
  }, [router, closePalette, openHelp, hasPermission]);

  // Live record search, debounced. Sources the user can't see (403) are skipped.
  useEffect(() => {
    if (!paletteOpen) return;
    const q = query.trim();
    if (q.length < 2) {
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
    <Dialog
      open={paletteOpen}
      onClose={closePalette}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          elevation: 8,
          sx: {
            borderRadius: 3,
            overflow: "hidden",
            position: "fixed",
            top: "12vh",
            m: 2,
            maxHeight: "75vh",
            border: "1px solid",
            borderColor: "divider",
          },
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          p: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box sx={{ color: "text.secondary", display: "flex", alignItems: "center" }}>
          <IconSearch />
        </Box>
        <InputBase
          inputRef={inputRef}
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
          fullWidth
          sx={{
            fontSize: "0.9375rem",
            "& input": { p: 0 },
          }}
        />
        {searching && <CircularProgress size={16} sx={{ color: "text.secondary" }} />}
        <Chip
          label="Esc"
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: "0.6875rem", fontFamily: "monospace", borderRadius: 1 }}
        />
      </Box>

      <List
        ref={listRef}
        id="cmdk-list"
        role="listbox"
        sx={{
          py: 0.5,
          px: 1,
          maxHeight: "50vh",
          overflowY: "auto",
        }}
      >
        {results.length === 0 && !searching && (
          <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>
            <Typography variant="body2">
              No matches for &ldquo;{query}&rdquo;. Try a document number, party or item name.
            </Typography>
          </Box>
        )}
        {results.map((item, index) => {
          const header = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          const isSelected = index === activeIndex;

          return (
            <Box key={item.id}>
              {header && (
                <Typography
                  variant="overline"
                  sx={{
                    px: 1.5,
                    pt: 1.5,
                    pb: 0.5,
                    display: "block",
                    fontWeight: 700,
                    fontSize: "0.6875rem",
                    color: "text.secondary",
                  }}
                >
                  {header}
                </Typography>
              )}
              <ListItemButton
                id={`cmdk-${index}`}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                data-active={isSelected}
                selected={isSelected}
                onMouseMove={() => setActive(index)}
                onClick={() => item.run()}
                sx={{
                  borderRadius: 1.5,
                  py: 0.875,
                  px: 1.5,
                  mb: 0.25,
                  transition: "background-color 0.1s ease",
                  "&.Mui-selected": {
                    bgcolor: "var(--accent-soft, #e7f3fb)",
                    "&:hover": {
                      bgcolor: "var(--accent-soft-strong, #cde6f6)",
                    },
                    "& .MuiListItemIcon-root": {
                      color: "primary.main",
                    },
                  },
                  "&:hover": {
                    bgcolor: "var(--accent-soft, #e7f3fb)",
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: isSelected ? "primary.main" : "text.secondary" }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="body2" sx={{ fontWeight: isSelected ? 600 : 500, color: "text.primary" }}>
                      {item.label}
                    </Typography>
                  }
                  secondary={
                    item.hint ? (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {item.hint}
                      </Typography>
                    ) : undefined
                  }
                  sx={{ my: 0 }}
                />
                {item.meta && (
                  <Chip
                    label={item.meta}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: "0.6875rem",
                      bgcolor: "action.selected",
                      fontWeight: 600,
                      mr: 1,
                    }}
                  />
                )}
                {isSelected && <IconArrowRight style={{ color: "var(--accent, #0a7bbf)" }} />}
              </ListItemButton>
            </Box>
          );
        })}
      </List>

      <Divider />

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 1,
          bgcolor: "var(--surface-subtle, #f8fbfd)",
          fontSize: "0.75rem",
          color: "text.secondary",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Chip label="↑" size="small" variant="outlined" sx={{ height: 18, minWidth: 18, px: 0, fontSize: "0.625rem" }} />
          <Chip label="↓" size="small" variant="outlined" sx={{ height: 18, minWidth: 18, px: 0, fontSize: "0.625rem" }} />
          <span>navigate</span>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Chip label="↵" size="small" variant="outlined" sx={{ height: 18, minWidth: 18, px: 0, fontSize: "0.625rem" }} />
          <span>open</span>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: "auto" }}>
          <Chip label="Ctrl" size="small" variant="outlined" sx={{ height: 18, minWidth: 24, px: 0.25, fontSize: "0.625rem" }} />
          <Chip label="K" size="small" variant="outlined" sx={{ height: 18, minWidth: 18, px: 0, fontSize: "0.625rem" }} />
          <span>toggle</span>
        </Box>
      </Box>
    </Dialog>
  );
}
