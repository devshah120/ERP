"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getPath } from "@/lib/resources/ui/paths";
import type { ResourceUi, ColumnConfig } from "@/lib/resources/ui/types";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useColumnVisibility } from "@/lib/table/useColumnVisibility";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import ColumnPicker from "@/components/table/ColumnPicker";
import ExportButton, { type ExportButtonHandle } from "@/components/table/ExportButton";
import ImportDialog from "@/components/table/ImportDialog";
import RowActions, { type RowAction } from "@/components/table/RowActions";
import BulkActionBar from "@/components/table/BulkActionBar";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { getImportDefinition } from "@/lib/import/registry";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge, { humanizeStatus } from "@/components/ui/StatusBadge";
import { EmptyState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { useToast } from "@/components/ui/Toast";
import { MODULE_DESCRIPTIONS } from "@/lib/ui/moduleDescriptions";
import { formatMoney } from "@/lib/format/number";
import {
  IconPlus,
  IconRefresh,
  IconEdit,
  IconEye,
  IconCopy,
  IconTrash,
  IconUpload,
  IconSortAsc,
  IconSortDesc,
  IconSortNone,
  IconFilter,
} from "@/components/icons";

interface MasterRow extends Record<string, unknown> {
  id: string;
}

interface ListResult {
  items: MasterRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Config-driven list screen shared by every master module: free-text search,
 * status filter, inline per-column filters, sortable headers, selectable
 * columns, bulk selection, row actions and paging — all derived from the
 * resource's UI config, so every master behaves identically. */
export default function ResourceListView({ config }: { config: ResourceUi }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = useAuth();
  const toast = useToast();

  const [query, setQuery] = useState(() => searchParams.get("query") ?? "");
  const [status, setStatus] = useState(() => searchParams.get("status") ?? "");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showColumnFilters, setShowColumnFilters] = useState(false);
  const [debounced, setDebounced] = useState<{ query: string; filters: Record<string, string> }>({
    query: searchParams.get("query") ?? "",
    filters: {},
  });
  const [sortBy, setSortBy] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [showImport, setShowImport] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<ExportButtonHandle>(null);
  const columnsRef = useRef<HTMLButtonElement>(null);

  const importable = Boolean(getImportDefinition(config.key));
  const { hidden, isVisible, apply: applyColumns } = useColumnVisibility(`master.${config.key}`);
  const visibleColumns = useMemo(
    () => config.columns.filter((c) => isVisible(c.key)),
    [config.columns, isVisible]
  );
  // The status filter sits under the Status column when the list has one.
  const statusColumn = config.columns.find((c) => c.key === "status");
  const filterableColumns = config.columns.some((c) => c.filterParam) || Boolean(statusColumn);

  const canCreate = hasPermission(`${config.key}.create`);
  const canEdit = hasPermission(`${config.key}.edit`);
  const canDelete = hasPermission(`${config.key}.delete`);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced({ query, filters });
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (sortBy) {
        params.set("sortBy", sortBy);
        params.set("sortDir", sortDir);
      }
      if (debounced.query) params.set("query", debounced.query);
      if (status) params.set("status", status);
      for (const [key, value] of Object.entries(debounced.filters)) {
        if (value) params.set(key, value);
      }
      const data = await apiFetch<ListResult>(`${config.apiPath}?${params.toString()}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(`Failed to load ${config.title.toLowerCase()}`));
    } finally {
      setLoading(false);
    }
  }, [config.apiPath, config.title, page, pageSize, sortBy, sortDir, debounced, status]);

  useEffect(() => {
    // Fetch-on-change: setState runs inside load()'s async body, not synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Reference columns show the linked record's name, not its id. Each master
  // is fetched once; a failure just leaves the cell as "—".
  const [refLabels, setRefLabels] = useState<Record<string, Map<string, string>>>({});
  useEffect(() => {
    const refCols = config.columns.filter((c) => c.type === "reference" && c.reference);
    if (refCols.length === 0) return;
    let cancelled = false;
    const cache = new Map<string, Promise<{ items: Record<string, unknown>[] }>>();
    Promise.all(
      refCols.map(async (col) => {
        const { resource, labelField } = col.reference!;
        if (!cache.has(resource)) cache.set(resource, apiFetch(`/api/masters/${resource}?pageSize=200`));
        try {
          const res = await cache.get(resource)!;
          return [col.key, new Map(res.items.map((i) => [String(i.id), String(i[labelField] ?? "")]))] as const;
        } catch {
          return [col.key, new Map<string, string>()] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setRefLabels(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [config.columns]);

  useShortcutScope({
    onNew: canCreate ? () => router.push(`${config.basePath}/new`) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onRefresh: load,
    onExport: () => exportRef.current?.open(),
    onImport: importable && canCreate ? () => setShowImport(true) : undefined,
    onToggleColumns: () => columnsRef.current?.click(),
    onToggleFilters: filterableColumns ? () => setShowColumnFilters((s) => !s) : undefined,
  });

  function toggleSort(field: string) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  }

  function clearAll() {
    setQuery("");
    setStatus("");
    setFilters({});
    setPage(1);
  }

  function renderCell(record: Record<string, unknown>, col: ColumnConfig) {
    const value = getPath(record, col.key);
    const type = col.type;
    if (type === "count") return Array.isArray(value) ? value.length : 0;
    if (value === null || value === undefined || value === "") return <span className="cellMuted">—</span>;

    if (type === "badge") return <StatusBadge status={String(value)} kind="active" />;
    if (type === "money") return formatMoney(String(value));
    if (type === "date") {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime())
        ? String(value)
        : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }
    if (type === "label") return col.labels?.[String(value)] ?? humanizeStatus(String(value));
    if (type === "reference") return refLabels[col.key]?.get(String(value)) ?? <span className="cellMuted">—</span>;
    if (type === "yesno" || typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  /* ------------------------------------------------ selection */

  const rows = result?.items ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (rows.every((r) => prev.has(r.id))) {
        for (const r of rows) next.delete(r.id);
      } else {
        for (const r of rows) next.add(r.id);
      }
      return next;
    });
  }

  async function runDelete(ids: string[]) {
    setConfirmBusy(true);
    setConfirmError(null);

    const results = await Promise.allSettled(
      ids.map((id) => apiFetch(`${config.apiPath}/${id}`, { method: "DELETE" }))
    );
    const failed = results.filter((r) => r.status === "rejected");
    setConfirmBusy(false);

    if (failed.length === ids.length && failed.length > 0) {
      const first = failed[0] as PromiseRejectedResult;
      setConfirmError(first.reason instanceof ApiError ? first.reason.message : "Delete failed");
      return;
    }

    setConfirm(null);
    setSelected(new Set());
    if (failed.length === 0) {
      toast.success(`Deleted ${ids.length} record${ids.length === 1 ? "" : "s"}`, "Historical documents that used them are unaffected.");
    } else {
      toast.error(`Deleted ${ids.length - failed.length} of ${ids.length}`, `${failed.length} could not be deleted.`);
    }
    load();
  }

  function buildActions(record: MasterRow): RowAction[] {
    const id = record.id;
    const name = String(record.name ?? id);
    return [
      { key: "view", label: "View", icon: <IconEye />, href: `${config.basePath}/${id}`, primary: true },
      {
        key: "edit",
        label: "Edit",
        icon: <IconEdit />,
        href: `${config.basePath}/${id}`,
        primary: true,
        disabledReason: canEdit ? undefined : "You do not have edit permission",
      },
      {
        key: "copy",
        label: "Duplicate",
        icon: <IconCopy />,
        href: `${config.basePath}/new?copyFrom=${id}`,
        disabledReason: canCreate ? undefined : "You do not have create permission",
      },
      {
        key: "delete",
        label: "Delete",
        icon: <IconTrash />,
        tone: "danger",
        onSelect: () => {
          setConfirmError(null);
          setConfirm({ ids: [id], label: name });
        },
        disabledReason: canDelete ? undefined : "You do not have delete permission",
      },
    ];
  }

  const columnFilterCount = Object.values(filters).filter(Boolean).length + (statusColumn && status ? 1 : 0);
  const hasFilters = Boolean(query || status || columnFilterCount > 0);

  const exportParams = () => {
    const p = new URLSearchParams();
    if (debounced.query) p.set("query", debounced.query);
    if (status) p.set("status", status);
    for (const [k, v] of Object.entries(debounced.filters)) if (v) p.set(k, v);
    if (sortBy) {
      p.set("sortBy", sortBy);
      p.set("sortDir", sortDir);
    }
    p.set("columns", visibleColumns.map((c) => c.key).join(","));
    return p;
  };

  if (error && isForbidden(error)) return <AccessDenied detail={error.message} />;

  const singularLower = config.singular.toLowerCase();

  return (
    <>
      <PageHeader
        title={config.title}
        count={result?.total ?? null}
        description={MODULE_DESCRIPTIONS[config.key]}
        actions={
          <>
            {importable && (
              <button
                type="button"
                className="button buttonSecondary"
                onClick={() => setShowImport(true)}
                disabled={!canCreate}
                title={canCreate ? "Import from a spreadsheet (Ctrl + I)" : "You do not have create permission"}
              >
                <IconUpload /> Import
              </button>
            )}
            <ExportButton ref={exportRef} endpoint={`/api/masters/${config.key}/export`} params={exportParams} />
            <Link
              href={`${config.basePath}/new`}
              className={`button buttonPrimary ${canCreate ? "" : "buttonDisabledLink"}`}
              aria-disabled={!canCreate}
              title={canCreate ? `New ${singularLower} (Ctrl + N)` : "You do not have create permission"}
            >
              <IconPlus /> New {singularLower}
            </Link>
          </>
        }
      />

      <div className="toolbar">
        <SearchBox
          inputRef={searchRef}
          value={query}
          onChange={setQuery}
          placeholder={`Search ${config.title.toLowerCase()}…`}
          width="18rem"
        />

        {!statusColumn && (
          <select
            className="select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            <option value="">Status: All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        )}

        {filterableColumns && (
          <button
            type="button"
            className={`button ${showColumnFilters || columnFilterCount > 0 ? "buttonSecondary" : "buttonGhost"}`}
            onClick={() => setShowColumnFilters((s) => !s)}
            aria-pressed={showColumnFilters}
            title="Filter by column (Ctrl + Shift + F)"
          >
            <IconFilter /> Filters
            {columnFilterCount > 0 && <span className="columnPickerCount">{columnFilterCount}</span>}
          </button>
        )}

        {hasFilters && (
          <button type="button" className="button buttonGhost" onClick={clearAll}>
            Clear all
          </button>
        )}

        <div className="toolbarRight">
          <ColumnPicker
            buttonRef={columnsRef}
            options={config.columns.map((c) => ({ key: c.key, label: c.label }))}
            hidden={hidden}
            onApply={applyColumns}
          />
          <button
            type="button"
            className="button buttonSecondary buttonIcon"
            onClick={load}
            disabled={loading}
            title="Refresh (Ctrl + R)"
            aria-label="Refresh"
          >
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          {
            key: "delete",
            label: `Delete ${selected.size} selected`,
            icon: <IconTrash />,
            tone: "danger",
            onSelect: () => {
              setConfirmError(null);
              setConfirm({ ids: Array.from(selected), label: `${selected.size} ${config.title.toLowerCase()}` });
            },
            disabledReason: canDelete ? undefined : "You do not have delete permission",
          },
        ]}
      />

      <div className="tableWrap">
        {loading && result && <div className="loadingBar" />}
        <table className="table">
          <thead>
            <tr>
              <th className="checkCell">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all rows on this page"
                  disabled={rows.length === 0}
                />
              </th>
              {visibleColumns.map((col) => {
                const active = col.sortField && sortBy === col.sortField;
                const isNum = col.type === "money" || col.type === "number";
                return (
                  <th
                    key={col.key}
                    className={isNum ? "numCell" : undefined}
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {col.sortField ? (
                      <button
                        type="button"
                        className="thSortable"
                        data-active={Boolean(active)}
                        onClick={() => toggleSort(col.sortField!)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        <span className="thSort">
                          {active ? sortDir === "asc" ? <IconSortAsc /> : <IconSortDesc /> : <IconSortNone />}
                        </span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
              <th className="actionCell">
                <span className="srOnly">Actions</span>
              </th>
            </tr>
            {showColumnFilters && (
              <tr className="filterRow">
                <th className="checkCell" />
                {visibleColumns.map((col) => (
                  <th key={col.key}>
                    {col === statusColumn ? (
                      <select
                        className="filterRowSelect"
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setPage(1);
                        }}
                        aria-label="Filter by status"
                      >
                        <option value="">All</option>
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    ) : col.filterParam ? (
                      <input
                        placeholder={`Filter ${col.label.toLowerCase()}`}
                        aria-label={`Filter by ${col.label}`}
                        value={filters[col.filterParam] ?? ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [col.filterParam!]: e.target.value }))}
                      />
                    ) : null}
                  </th>
                ))}
                <th className="actionCell" />
              </tr>
            )}
          </thead>
          <tbody>
            {loading && !result && <SkeletonRows columns={visibleColumns.length + 2} />}
            {error && !loading && (
              <tr>
                <td colSpan={visibleColumns.length + 2}>
                  <EmptyState
                    title={`Couldn't load ${config.title.toLowerCase()}`}
                    description={error.message}
                    actions={
                      <button type="button" className="button buttonSecondary" onClick={load}>
                        Try again
                      </button>
                    }
                  />
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 2}>
                  {hasFilters ? (
                    <EmptyState
                      variant="search"
                      title="No matches"
                      description="Nothing matches the current search and filters."
                      actions={
                        <button type="button" className="button buttonSecondary" onClick={clearAll}>
                          Clear filters
                        </button>
                      }
                    />
                  ) : (
                    <EmptyState
                      title={`No ${config.title.toLowerCase()} yet`}
                      description={MODULE_DESCRIPTIONS[config.key] ?? `Add your first ${singularLower} to get started.`}
                      actions={
                        canCreate && (
                          <>
                            <Link href={`${config.basePath}/new`} className="button buttonPrimary">
                              <IconPlus /> New {singularLower}
                            </Link>
                            {importable && (
                              <button type="button" className="button buttonSecondary" onClick={() => setShowImport(true)}>
                                <IconUpload /> Import from spreadsheet
                              </button>
                            )}
                          </>
                        )
                      }
                    />
                  )}
                </td>
              </tr>
            )}
            {rows.map((record) => {
              const id = record.id;
              return (
                <tr key={id} className={selected.has(id) ? "rowSelected" : undefined}>
                  <td className="checkCell">
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggleRow(id)}
                      aria-label={`Select ${String(record.name ?? id)}`}
                    />
                  </td>
                  {visibleColumns.map((col, index) => {
                    const isNum = col.type === "money" || col.type === "number";
                    return (
                      <td key={col.key} className={isNum ? "numCell" : undefined}>
                        {index === 0 ? (
                          <Link href={`${config.basePath}/${id}`} className="cellPrimary">
                            {renderCell(record, col)}
                          </Link>
                        ) : (
                          renderCell(record, col)
                        )}
                      </td>
                    );
                  })}
                  <td className="actionCell">
                    <RowActions actions={buildActions(record)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {result && result.total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={result.total}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.ids.length === 1 ? singularLower : "records"}?`}
          message={`${confirm.label} will be marked deleted and hidden from listings. Historical documents that reference it keep working — nothing is removed from the database.`}
          confirmLabel="Delete"
          busy={confirmBusy}
          error={confirmError}
          onCancel={() => setConfirm(null)}
          onConfirm={() => runDelete(confirm.ids)}
        />
      )}

      {showImport && (
        <ImportDialog
          resource={config.key}
          title={config.title}
          onClose={() => setShowImport(false)}
          onImported={() => load()}
        />
      )}
    </>
  );
}
