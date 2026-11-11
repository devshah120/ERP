"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getPath } from "@/lib/resources/ui/paths";
import type { DocumentUi } from "@/lib/documents/ui";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useColumnVisibility } from "@/lib/table/useColumnVisibility";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import ColumnPicker from "@/components/table/ColumnPicker";
import ExportButton, { type ExportButtonHandle } from "@/components/table/ExportButton";
import RowActions, { type RowAction } from "@/components/table/RowActions";
import BulkActionBar from "@/components/table/BulkActionBar";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import EmailDialog from "@/components/documents/EmailDialog";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge, { humanizeStatus } from "@/components/ui/StatusBadge";
import { EmptyState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { useToast } from "@/components/ui/Toast";
import { MODULE_DESCRIPTIONS } from "@/lib/ui/moduleDescriptions";
import { statusOptionsFor } from "@/lib/documents/statusOptions";
import { formatMoney } from "@/lib/format/number";
import {
  IconPlus,
  IconRefresh,
  IconFilter,
  IconPrint,
  IconEdit,
  IconEye,
  IconTrash,
  IconCopy,
  IconMail,
  IconChart,
  IconClose,
  IconSortAsc,
  IconSortDesc,
  IconSortNone,
} from "@/components/icons";

interface DocRow extends Record<string, unknown> {
  id: string;
  status: string;
}

interface ListResult {
  items: DocRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY_FILTERS = {
  query: "",
  partyName: "",
  status: "",
  fromDate: "",
  toDate: "",
  paymentStatus: "",
};
type Filters = typeof EMPTY_FILTERS;

/**
 * Filters that arrive from a dashboard drill-through. They are not editable
 * in the filter panel — they describe *which* figure you clicked, and the
 * banner offers to clear them rather than letting them be half-edited into
 * something that no longer matches any headline number.
 */
const DRILL_PARAMS = ["outstanding", "pendingInvoice", "pendingDelivery", "minAgeDays", "maxAgeDays", "statusIn"] as const;

function describeDrill(params: Record<string, string>): string | null {
  const parts: string[] = [];
  if (params.pendingInvoice === "true") parts.push("still to be invoiced");
  if (params.pendingDelivery === "true") parts.push("still to be delivered");
  if (params.outstanding === "true") parts.push("with money outstanding");
  if (params.minAgeDays || params.maxAgeDays) {
    const min = params.minAgeDays ?? "0";
    parts.push(
      params.maxAgeDays ? `overdue ${min}–${params.maxAgeDays} days` : `overdue ${min}+ days`
    );
  }
  if (params.statusIn) parts.push(`status ${params.statusIn.split(",").join(" or ")}`);
  return parts.length > 0 ? `Showing only documents ${parts.join(", ")}.` : null;
}

function formatValue(value: unknown, type?: string): string {
  if (value === null || value === undefined || value === "") return "—";

  if (type === "date")
    return new Date(String(value)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  if (type === "datetime") {
    const d = new Date(String(value));
    return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (type === "money") return formatMoney(String(value));
  return String(value);
}

export default function DocumentListView({ config }: { config: DocumentUi }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = useAuth();

  // Drill-through links carry their filters in the URL, so a figure on the
  // dashboard and the rows it opens always describe the same set.
  const initial = useMemo(() => {
    const f = { ...EMPTY_FILTERS };
    for (const key of Object.keys(EMPTY_FILTERS) as (keyof Filters)[]) {
      const v = searchParams.get(key);
      if (v) f[key] = v;
    }
    const drill: Record<string, string> = {};
    for (const key of DRILL_PARAMS) {
      const v = searchParams.get(key);
      if (v) drill[key] = v;
    }
    return { filters: f, drill };
  }, [searchParams]);

  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [applied, setApplied] = useState<Filters>(initial.filters);
  const [drill, setDrill] = useState<Record<string, string>>(initial.drill);
  const [showFilters, setShowFilters] = useState(
    Object.values(initial.filters).some((v) => v && v !== initial.filters.query)
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toast = useToast();
  const statusOptions = useMemo(() => statusOptionsFor(config.key), [config.key]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [emailTarget, setEmailTarget] = useState<DocRow | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<ExportButtonHandle>(null);
  const columnsRef = useRef<HTMLButtonElement>(null);

  const { hidden, isVisible, apply: applyColumns } = useColumnVisibility(`doc.${config.key}`);
  const visibleColumns = useMemo(
    () => config.columns.filter((c) => isVisible(c.key)),
    [config.columns, isVisible]
  );

  const canCreate = hasPermission(`${config.key}.create`);
  const canEditDocs = hasPermission(`${config.key}.edit`);

  // The quick search box applies as you type; the filter panel applies on submit.
  useEffect(() => {
    const t = setTimeout(() => {
      setApplied((a) => (a.query === filters.query ? a : { ...a, query: filters.query }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [filters.query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      for (const [k, v] of Object.entries(applied)) if (v) params.set(k, v);
      for (const [k, v] of Object.entries(drill)) if (v) params.set(k, v);
      if (sortBy) {
        params.set("sortBy", sortBy);
        params.set("sortDir", sortDir);
      }
      setResult(await apiFetch<ListResult>(`${config.apiPath}?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load documents"));
    } finally {
      setLoading(false);
    }
  }, [config.apiPath, page, pageSize, applied, drill, sortBy, sortDir]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({
    onNew: canCreate ? () => router.push(`${config.basePath}/new`) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onRefresh: load,
    onExport: () => exportRef.current?.open(),
    onToggleFilters: () => setShowFilters((s) => !s),
    onToggleColumns: () => columnsRef.current?.click(),
  });

  function applyFilters() {
    setApplied(filters);
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setDrill({});
    setPage(1);
  }

  const activeFilterCount =
    Object.entries(applied).filter(([k, v]) => k !== "query" && v).length + Object.keys(drill).length;
  const drillNote = describeDrill(drill);

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
      if (rows.every((r) => prev.has(r.id))) {
        const next = new Set(prev);
        for (const r of rows) next.delete(r.id);
        return next;
      }
      const next = new Set(prev);
      for (const r of rows) next.add(r.id);
      return next;
    });
  }

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedDrafts = selectedRows.filter((r) => r.status === "DRAFT");

  /* ------------------------------------------------ delete */

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
    // Per-row outcome, not a blanket "done" — with a bulk delete the count
    // that failed is the part the user actually needs.
    if (failed.length === 0) toast.success(`Deleted ${ids.length} draft${ids.length === 1 ? "" : "s"}`);
    else
      toast.error(
        `Deleted ${ids.length - failed.length} of ${ids.length}`,
        `${failed.length} could not be deleted — only drafts that no other document links to can be removed.`
      );
    load();
  }

  /* ------------------------------------------------ row actions */

  function buildActions(doc: DocRow): RowAction[] {
    const id = doc.id;
    const status = doc.status;
    const isDraft = status === "DRAFT";
    const linked = Array.isArray(doc.sourceDocuments) && doc.sourceDocuments.length > 0;
    const editable = isDraft || status === "SENT" || status === "PENDING_APPROVAL";

    return [
      {
        key: "print",
        label: "Print",
        icon: <IconPrint />,
        href: `${config.basePath}/${id}/print`,
        primary: true,
      },
      {
        key: "edit",
        label: "Edit",
        icon: <IconEdit />,
        href: `${config.basePath}/${id}`,
        primary: true,
        disabledReason: !canEditDocs
          ? "You do not have edit permission"
          : editable
            ? undefined
            : `${status} documents are locked against edits`,
      },
      {
        key: "view",
        label: "View",
        icon: <IconEye />,
        href: `${config.basePath}/${id}`,
        primary: true,
      },
      {
        key: "copy",
        label: "Copy to new",
        icon: <IconCopy />,
        href: `${config.basePath}/new?copyFrom=${id}`,
        disabledReason: canCreate ? undefined : "You do not have create permission",
      },
      {
        key: "amend",
        label: "Amendment",
        icon: <IconEdit />,
        href: `${config.basePath}/${id}`,
        // A posted document cannot be rewritten — GST requires a credit or
        // debit note instead, so the menu says so rather than silently
        // opening a form that the server would reject on save.
        disabledReason: editable
          ? undefined
          : config.convertsTo.some((c) => c.key.endsWith("credit-notes") || c.key.endsWith("debit-notes"))
            ? `${status} documents cannot be amended — issue a credit/debit note instead`
            : `${status} documents cannot be amended`,
      },
      {
        key: "email",
        label: "Email",
        icon: <IconMail />,
        onSelect: () => setEmailTarget(doc),
      },
      {
        key: "delete",
        label: "Delete",
        icon: <IconTrash />,
        tone: "danger",
        onSelect: () => {
          setConfirmError(null);
          setConfirm({ ids: [id], label: String(doc.documentNumber ?? "this document") });
        },
        disabledReason: !canEditDocs
          ? "You do not have permission"
          : !isDraft
            ? `${status} documents are cancelled, not deleted`
            : linked
              ? "Created from another document — cancel it instead"
              : undefined,
      },
    ];
  }

  const from = result ? (page - 1) * pageSize + 1 : 1;

  /** Columns the server can sort on (see SORTABLE in lib/documents/list.ts). */
  const SORT_FIELDS: Record<string, string> = {
    documentNumber: "documentNumber",
    documentDate: "documentDate",
    createdAt: "createdAt",
    "totals.grandTotal": "totals.grandTotal",
    status: "status",
  };

  function toggleSort(field: string) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir(field === "documentNumber" || field === "status" ? "asc" : "desc");
    }
    setPage(1);
  }

  function removeFilter(key: keyof Filters) {
    const next = { ...applied, [key]: "" };
    setFilters(next);
    setApplied(next);
    setPage(1);
  }

  const FILTER_LABELS: Partial<Record<keyof Filters, string>> = {
    partyName: config.partyLabel,
    status: "Status",
    fromDate: "From",
    toDate: "To",
    paymentStatus: "Payment",
  };

  const exportParams = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(drill)) if (v) p.set(k, v);
    p.set("columns", visibleColumns.map((c) => c.key).join(","));
    return p;
  };

  if (error && isForbidden(error)) return <AccessDenied detail={error.message} />;

  const singularLower = config.singular.toLowerCase();
  const chips = (Object.keys(FILTER_LABELS) as (keyof Filters)[]).filter((k) => applied[k]);
  const colCount = visibleColumns.length + 3;

  return (
    <>
      <PageHeader
        title={config.title}
        count={result?.total ?? null}
        description={MODULE_DESCRIPTIONS[config.key]}
        actions={
          <>
            <Link
              href={`/analysis/${config.partyField === "customer" ? "sales" : "purchase"}`}
              className="button buttonGhost"
            >
              <IconChart /> Analysis
            </Link>
            <ExportButton ref={exportRef} endpoint={`/api/documents/${config.key}/export`} params={exportParams} />
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
          value={filters.query}
          onChange={(v) => setFilters((f) => ({ ...f, query: v }))}
          placeholder={`Search number or ${config.partyLabel.toLowerCase()}…`}
          width="18rem"
        />

        <select
          className="select"
          aria-label="Filter by status"
          value={applied.status}
          onChange={(e) => {
            const next = { ...applied, status: e.target.value };
            setFilters((f) => ({ ...f, status: e.target.value }));
            setApplied(next);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {humanizeStatus(s)}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`button ${showFilters ? "buttonSecondary" : "buttonGhost"}`}
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          title="Advanced filters (Ctrl + Shift + F)"
        >
          <IconFilter /> Filters
          {activeFilterCount > 0 && <span className="columnPickerCount">{activeFilterCount}</span>}
        </button>

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

      {showFilters && (
        <div className="filterBar">
          <div className="filterBarHead">
            <span>Advanced filters</span>
            <button type="button" className="iconButton" onClick={() => setShowFilters(false)} aria-label="Close filters">
              <IconClose />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyFilters();
            }}
          >
            <div className="filterGrid">
              <div className="filterField">
                <label htmlFor="f-from">Date from</label>
                <input
                  id="f-from"
                  type="date"
                  value={filters.fromDate}
                  max={filters.toDate || undefined}
                  onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))}
                />
              </div>
              <div className="filterField">
                <label htmlFor="f-to">Date to</label>
                <input
                  id="f-to"
                  type="date"
                  value={filters.toDate}
                  min={filters.fromDate || undefined}
                  onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
                />
              </div>
              <div className="filterField">
                <label htmlFor="f-party">{config.partyLabel}</label>
                <input
                  id="f-party"
                  placeholder={`${config.partyLabel} name contains…`}
                  value={filters.partyName}
                  onChange={(e) => setFilters((f) => ({ ...f, partyName: e.target.value }))}
                />
              </div>
              <div className="filterField">
                <label htmlFor="f-status">Status</label>
                <select
                  id="f-status"
                  value={filters.status}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="">Any</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {humanizeStatus(s)}
                    </option>
                  ))}
                </select>
              </div>
              {config.columns.some((c) => c.type === "payment") && (
                <div className="filterField">
                  <label htmlFor="f-pay">Payment status</label>
                  <select
                    id="f-pay"
                    value={filters.paymentStatus}
                    onChange={(e) => setFilters((f) => ({ ...f, paymentStatus: e.target.value }))}
                  >
                    <option value="">Any</option>
                    <option value="UNPAID">Unpaid</option>
                    <option value="PARTIALLY_PAID">Partly paid</option>
                    <option value="PAID">Paid</option>
                  </select>
                </div>
              )}
            </div>
            <div className="filterActions">
              <button type="submit" className="button buttonPrimary">
                Apply filters
              </button>
              <button type="button" className="button buttonGhost" onClick={clearFilters}>
                Reset
              </button>
            </div>
          </form>
        </div>
      )}

      {(chips.length > 0 || drillNote) && (
        <div className="filterChips" aria-label="Active filters">
          {chips.map((k) => (
            <span key={k} className="filterChip">
              {FILTER_LABELS[k]}: {k === "status" || k === "paymentStatus" ? humanizeStatus(applied[k]) : applied[k]}
              <button type="button" onClick={() => removeFilter(k)} aria-label={`Remove ${FILTER_LABELS[k]} filter`}>
                <IconClose />
              </button>
            </span>
          ))}
          {drillNote && (
            <span className="filterChip" title="Filter applied from a dashboard figure">
              {drillNote.replace(/^Showing only documents /, "Only ").replace(/\.$/, "")}
              <button type="button" onClick={() => { setDrill({}); setPage(1); }} aria-label="Remove dashboard filter">
                <IconClose />
              </button>
            </span>
          )}
          <button type="button" className="buttonLink" style={{ fontSize: "0.75rem" }} onClick={clearFilters}>
            Clear all
          </button>
        </div>
      )}

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          {
            key: "delete",
            label: `Delete ${selectedDrafts.length} draft${selectedDrafts.length === 1 ? "" : "s"}`,
            icon: <IconTrash />,
            tone: "danger",
            onSelect: () => {
              setConfirmError(null);
              setConfirm({
                ids: selectedDrafts.map((r) => r.id),
                label: `${selectedDrafts.length} draft document(s)`,
              });
            },
            disabledReason:
              !canEditDocs
                ? "You do not have permission"
                : selectedDrafts.length === 0
                  ? "Only drafts can be deleted — cancel posted documents instead"
                  : undefined,
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
              <th style={{ width: "3rem" }}>#</th>
              {visibleColumns.map((col) => {
                const field = SORT_FIELDS[col.key];
                const active = field && sortBy === field;
                return (
                  <th
                    key={col.key}
                    className={col.type === "money" ? "numCell" : undefined}
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {field ? (
                      <button
                        type="button"
                        className="thSortable"
                        data-active={Boolean(active)}
                        onClick={() => toggleSort(field)}
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
          </thead>
          <tbody>
            {loading && !result && <SkeletonRows columns={colCount} />}
            {error && !loading && (
              <tr>
                <td colSpan={colCount}>
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
                <td colSpan={colCount}>
                  {activeFilterCount > 0 || applied.query ? (
                    <EmptyState
                      variant="search"
                      title="No matching documents"
                      description="Nothing matches the current search and filters."
                      actions={
                        <button type="button" className="button buttonSecondary" onClick={clearFilters}>
                          Clear filters
                        </button>
                      }
                    />
                  ) : (
                    <EmptyState
                      title={`No ${config.title.toLowerCase()} yet`}
                      description={MODULE_DESCRIPTIONS[config.key]}
                      actions={
                        canCreate && (
                          <Link href={`${config.basePath}/new`} className="button buttonPrimary">
                            <IconPlus /> New {singularLower}
                          </Link>
                        )
                      }
                    />
                  )}
                </td>
              </tr>
            )}
            {rows.map((doc, index) => {
              const id = doc.id;
              return (
                <tr key={id} className={selected.has(id) ? "rowSelected" : undefined}>
                  <td className="checkCell">
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggleRow(id)}
                      aria-label={`Select ${String(doc.documentNumber ?? id)}`}
                    />
                  </td>
                  <td className="cellMuted tabular">{from + index}</td>
                  {visibleColumns.map((col) => {
                    const raw = getPath(doc, col.key);
                    if (col.type === "status") {
                      return (
                        <td key={col.key}>
                          <StatusBadge status={String(raw)} />
                        </td>
                      );
                    }
                    if (col.type === "party") {
                      const partyId = doc[config.partyIdField];
                      const name = raw ? String(raw) : "—";
                      return (
                        <td key={col.key} style={{ maxWidth: "16rem", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {partyId ? (
                            <Link
                              href={`${config.partyBasePath}/${String(partyId)}`}
                              className="cellPrimary"
                              title={`Open ${config.partyLabel.toLowerCase()} record`}
                            >
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </td>
                      );
                    }
                    if (col.type === "payment") {
                      return (
                        <td key={col.key}>
                          <StatusBadge status={String(raw ?? "UNPAID")} kind="payment" />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.key}
                        className={col.type === "money" ? "numCell" : col.type === "datetime" ? "cellMuted" : undefined}
                      >
                        {col.key === "documentNumber" ? (
                          <Link href={`${config.basePath}/${id}`} className="cellLink cellMono">
                            {raw ? formatValue(raw, col.type) : "Draft"}
                          </Link>
                        ) : (
                          formatValue(raw, col.type)
                        )}
                      </td>
                    );
                  })}
                  <td className="actionCell">
                    <RowActions actions={buildActions(doc)} />
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
          title="Delete draft?"
          message={`${confirm.label} will be permanently removed. Only drafts can be deleted — posted documents are cancelled so their audit trail and numbering stay intact.`}
          confirmLabel="Delete"
          busy={confirmBusy}
          error={confirmError}
          onCancel={() => setConfirm(null)}
          onConfirm={() => runDelete(confirm.ids)}
        />
      )}

      {emailTarget && (
        <EmailDialog
          docType={config.key}
          docId={emailTarget.id}
          documentNumber={String(emailTarget.documentNumber ?? "")}
          defaultTo={(emailTarget[config.partyField] as { email?: string } | undefined)?.email}
          label={config.singular}
          onClose={() => setEmailTarget(null)}
        />
      )}
    </>
  );
}
