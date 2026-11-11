"use client";

import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getPath } from "@/lib/resources/ui/paths";
import type { PaymentUi } from "@/lib/payments/ui";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useColumnVisibility } from "@/lib/table/useColumnVisibility";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import ColumnPicker from "@/components/table/ColumnPicker";
import ExportButton, { type ExportButtonHandle } from "@/components/table/ExportButton";
import RowActions, { type RowAction } from "@/components/table/RowActions";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { IconPlus, IconRefresh, IconFilter, IconEye, IconTrash, IconChart } from "@/components/icons";

/** How payment modes read on screen; the stored codes stay unchanged. */
const MODE_LABEL: Record<string, string> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  BANK: "Bank transfer",
  UPI: "UPI",
  CARD: "Card",
  ADJUSTMENT: "Adjustment",
};

interface PaymentRow extends Record<string, unknown> {
  id: string;
  status: string;
}

interface ListResult {
  items: PaymentRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY = { query: "", partyName: "", mode: "", status: "", fromDate: "", toDate: "" };
type Filters = typeof EMPTY;

const MODES = ["CASH", "CHEQUE", "BANK", "UPI", "CARD", "ADJUSTMENT"];

function format(value: unknown, type?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "date") return new Date(String(value)).toLocaleDateString("en-GB");
  if (type === "money") return Number(value).toFixed(2);
  return String(value);
}

export default function PaymentListView({ config }: { config: PaymentUi }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = useAuth();

  const initial = useMemo(() => {
    const f = { ...EMPTY };
    for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
      const v = searchParams.get(key);
      if (v) f[key] = v;
    }
    return f;
  }, [searchParams]);

  const [filters, setFilters] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PaymentRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<ExportButtonHandle>(null);
  const columnsRef = useRef<HTMLButtonElement>(null);

  const { hidden, isVisible, toggle, reset } = useColumnVisibility(`pay.${config.key}`);
  const visibleColumns = useMemo(
    () => config.columns.filter((c) => isVisible(c.key)),
    [config.columns, isVisible]
  );

  const canCreate = hasPermission(config.permissions.create);
  const canCancel = hasPermission(config.permissions.cancel);

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
      setResult(await apiFetch<ListResult>(`${config.apiPath}?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to load ${config.title.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [config.apiPath, config.title, page, pageSize, applied]);

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

  async function runCancel(reason?: string) {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
      await apiFetch(`${config.apiPath}/${cancelTarget.id}${qs}`, { method: "DELETE" });
      setCancelTarget(null);
      setNotice(
        `${config.singular} ${String(cancelTarget.documentNumber)} cancelled — the money has been returned to the invoices it settled.`
      );
      load();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Cancel failed");
    } finally {
      setCancelBusy(false);
    }
  }

  function buildActions(row: PaymentRow): RowAction[] {
    return [
      { key: "view", label: "View", icon: <IconEye />, href: `${config.basePath}/${row.id}`, primary: true },
      {
        key: "cancel",
        label: "Cancel entry",
        icon: <IconTrash />,
        tone: "danger",
        onSelect: () => {
          setCancelError(null);
          setCancelTarget(row);
        },
        disabledReason: !canCancel
          ? "You do not have permission to cancel"
          : row.status === "CANCELLED"
            ? "Already cancelled"
            : undefined,
      },
    ];
  }

  const rows = result?.items ?? [];
  const total = result?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const activeFilterCount = Object.entries(applied).filter(([k, v]) => k !== "query" && v).length;

  return (
    <>
      <div className="pageHeader">
        <div className="pageHeaderText">
          <h1 className="pageTitle">{config.title}</h1>
          <div className="pageSubtitle">
            {config.direction === "RECEIPT"
              ? "Money received from customers, settled against sales invoices"
              : "Money paid to suppliers, settled against purchase invoices"}
          </div>
        </div>
        <div className="pageActions">
          <Link href="/analysis/accounting" className="button buttonSecondary">
            <IconChart /> Analysis
          </Link>
          <Link
            href={`${config.basePath}/new`}
            className={`button buttonPrimary ${canCreate ? "" : "buttonDisabledLink"}`}
            aria-disabled={!canCreate}
            title={canCreate ? "Record a new entry (Ctrl + N)" : "You do not have create permission"}
          >
            <IconPlus /> New {config.singular}
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <ColumnPicker
          buttonRef={columnsRef}
          options={config.columns.map((c) => ({ key: c.key, label: c.label }))}
          hidden={hidden}
          onToggle={toggle}
          onReset={reset}
        />
        <button
          type="button"
          className={`button ${activeFilterCount > 0 ? "buttonPrimary" : "buttonSecondary"}`}
          onClick={() => setShowFilters((s) => !s)}
        >
          <IconFilter /> Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        <button type="button" className="button buttonSecondary" onClick={load} disabled={loading}>
          <IconRefresh /> Refresh
        </button>

        <div className="toolbarRight">
          <ExportButton
            ref={exportRef}
            endpoint={`${config.apiPath}/export`}
            params={() => {
              const p = new URLSearchParams();
              for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
              p.set("columns", visibleColumns.map((c) => c.key).join(","));
              return p;
            }}
          />
          <SearchBox
              inputRef={searchRef}
              value={filters.query}
              onChange={(v) => setFilters((f) => ({ ...f, query: v }))}
              placeholder="Search no., party or reference…"
              width="18rem"
            />
        </div>
      </div>

      {showFilters && (
        <div className="filterBar">
          <div className="filterGrid">
            <div className="filterField">
              <label>From date</label>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))}
              />
            </div>
            <div className="filterField">
              <label>To date</label>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
              />
            </div>
            <div className="filterField">
              <label>{config.partyLabel} name</label>
              <input
                value={filters.partyName}
                onChange={(e) => setFilters((f) => ({ ...f, partyName: e.target.value }))}
              />
            </div>
            <div className="filterField">
              <label>Mode</label>
              <select value={filters.mode} onChange={(e) => setFilters((f) => ({ ...f, mode: e.target.value }))}>
                <option value="">Any</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            </div>
            <div className="filterField">
              <label>Status</label>
              <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">Any</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="filterActions">
            <button
              type="button"
              className="button buttonPrimary"
              onClick={() => {
                setApplied(filters);
                setPage(1);
              }}
            >
              Apply filters
            </button>
            <button
              type="button"
              className="button buttonSecondary"
              onClick={() => {
                setFilters(EMPTY);
                setApplied(EMPTY);
                setPage(1);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {error && <div className="banner bannerError" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="banner bannerSuccess" style={{ marginBottom: "1rem" }}>
          {notice}
          <button type="button" className="buttonLink" onClick={() => setNotice(null)} style={{ marginLeft: "0.75rem" }}>
            Dismiss
          </button>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "3rem" }}>#</th>
              {visibleColumns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th className="actionCell">
                <span className="srOnly">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 2}>
                  <div className="tableEmpty">
                    {activeFilterCount > 0 || applied.query
                      ? "No records match these filters."
                      : `No ${config.title.toLowerCase()} recorded yet.`}
                  </div>
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td className="cellMuted tabular">{from + index}</td>
                {visibleColumns.map((col) => {
                  const raw = getPath(row, col.key);
                  if (col.type === "status") {
                    const text = String(raw);
                    return (
                      <td key={col.key}>
                        <StatusBadge status={text} />
                      </td>
                    );
                  }
                  if (col.type === "party") {
                    return (
                      <td key={col.key}>
                        <Link
                          href={`${config.partyBasePath}/${String(row.partyId)}`}
                          className="cellPrimary"
                        >
                          {format(raw)}
                        </Link>
                      </td>
                    );
                  }
                  return (
                    <td key={col.key} className={col.type === "money" ? "numCell" : undefined}>
                      {col.key === "documentNumber" ? (
                        <Link href={`${config.basePath}/${row.id}`} className="cellLink cellMono">
                          {format(raw, col.type)}
                        </Link>
                      ) : (
                        format(raw, col.type)
                      )}
                    </td>
                  );
                })}
                <td className="actionCell">
                  <RowActions actions={buildActions(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {result && result.total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />
        )}
      </div>

      {cancelTarget && (
        <ConfirmDialog
          title={`Cancel ${config.singular.toLowerCase()}?`}
          message={`${String(cancelTarget.documentNumber)} for ${Number(cancelTarget.amount).toFixed(2)} will be reversed. The amount it settled goes back onto the invoices, which may reopen them as unpaid. The entry itself is kept for the audit trail.`}
          confirmLabel="Cancel entry"
          requireReason
          busy={cancelBusy}
          error={cancelError}
          onCancel={() => setCancelTarget(null)}
          onConfirm={runCancel}
        />
      )}
    </>
  );
}
