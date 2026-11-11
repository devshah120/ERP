"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { IconRefresh, IconArrowLeft, IconPrint } from "@/components/icons";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import StatusBadge, { humanizeStatus } from "@/components/ui/StatusBadge";
import { EmptyState, SkeletonRows } from "@/components/ui/States";
import AccessDenied from "@/components/ui/AccessDenied";
import { statusOptionsFor } from "@/lib/documents/statusOptions";
import { formatMoney, formatCount, formatQuantity } from "@/lib/format/number";
import { useColumnVisibility } from "@/lib/table/useColumnVisibility";
import ColumnPicker from "@/components/table/ColumnPicker";
import ExportButton, { type ExportButtonHandle } from "@/components/table/ExportButton";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";

interface ReportColumn {
  key: string;
  label: string;
  type?: "text" | "date" | "datetime" | "money" | "number" | "status" | "link";
  defaultVisible?: boolean;
  total?: boolean;
}

interface ReportResult {
  key: string;
  title: string;
  module: string;
  description: string;
  availableColumns: ReportColumn[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, string>;
  summary: { label: string; value: string }[];
  filters: string[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY_FILTERS = { fromDate: "", toDate: "", partyName: "", itemName: "", status: "", accountId: "" };

interface AccountOption {
  id: string;
  code: string;
  name: string;
  isGroup?: boolean;
}

const DRILL_LABELS: Record<string, string> = {
  LOW: "items at or below their reorder level",
  OUT: "items that are out of stock",
  NEGATIVE: "items showing negative stock",
};

export default function ReportView({ reportKey }: { reportKey: string }) {
  const searchParams = useSearchParams();
  // Dashboard drill-throughs arrive as URL parameters the filter panel does
  // not expose, so the report opens on exactly the subset that was clicked.
  const stockFilter = searchParams.get("stockFilter") ?? "";
  const initialAccount = searchParams.get("accountId") ?? "";

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, accountId: initialAccount });
  const [applied, setApplied] = useState({ ...EMPTY_FILTERS, accountId: initialAccount });
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [result, setResult] = useState<ReportResult | null>(null);
  const [catalogue, setCatalogue] = useState<ReportColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const exportRef = useRef<ExportButtonHandle>(null);
  const columnsRef = useRef<HTMLButtonElement>(null);

  // Column choices are remembered per report and sent to the server, so the
  // response — and therefore any export — contains only what was selected.
  const { hidden, toggle, reset } = useColumnVisibility(`report.${reportKey}`);

  const selectedColumns = useMemo(() => {
    if (catalogue.length === 0) return "";
    const visible = catalogue.filter((c) => !hidden.includes(c.key)).map((c) => c.key);
    return visible.join(",");
  }, [catalogue, hidden]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      for (const [k, v] of Object.entries(applied)) if (v) params.set(k, v);
      if (stockFilter) params.set("stockFilter", stockFilter);
      if (selectedColumns) params.set("columns", selectedColumns);

      const data = await apiFetch<ReportResult>(`/api/reports/${reportKey}?${params.toString()}`);
      setResult(data);
      // Seed the catalogue once so the picker knows every possible column.
      setCatalogue((prev) => (prev.length ? prev : data.availableColumns));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to run report");
    } finally {
      setLoading(false);
    }
  }, [reportKey, page, pageSize, applied, selectedColumns, stockFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({
    onRefresh: load,
    onExport: () => exportRef.current?.open(),
    onToggleColumns: () => columnsRef.current?.click(),
  });

  const needsAccounts = (result?.filters ?? []).includes("account");
  useEffect(() => {
    if (!needsAccounts || accounts.length > 0) return;
    let cancelled = false;
    apiFetch<{ items: AccountOption[] }>("/api/masters/chart-of-accounts?pageSize=200&status=ACTIVE")
      .then((data) => {
        // Group headings hold no postings, so they are not offered here.
        if (!cancelled) setAccounts(data.items.filter((a) => !a.isGroup));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the account list.");
      });
    return () => {
      cancelled = true;
    };
  }, [needsAccounts, accounts.length]);

  function applyFilters() {
    setApplied(filters);
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  function renderCell(row: Record<string, unknown>, col: ReportColumn) {
    const value = row[col.key];
    if (value === null || value === undefined || value === "") return "—";

    if (col.type === "link") {
      const href = row[`${col.key}Href`];
      if (href) {
        return (
          <Link href={String(href)} className="cellPrimary">
            {String(value)}
          </Link>
        );
      }
      return <strong>{String(value)}</strong>;
    }
    if (col.type === "status") {
      return <StatusBadge status={String(value)} />;
    }
    if (col.type === "money") return formatMoney(String(value));
    if (col.type === "number") return formatQuantity(String(value));
    if (col.type === "date")
      return new Date(String(value)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    if (col.type === "datetime") {
      const d = new Date(String(value));
      return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    }
    return String(value);
  }

  const enabled = result?.filters ?? [];
  const columns = result?.columns ?? [];
  const activeFilterCount = Object.values(applied).filter(Boolean).length;
  const hasTotals = Object.keys(result?.totals ?? {}).length > 0;
  const isNum = (c: ReportColumn) => c.type === "money" || c.type === "number";
  // Reports over invoices get a real status picker from the invoice workflow.
  const statusDoc = reportKey.startsWith("sales") ? "sales-invoices" : reportKey.startsWith("purchase") ? "purchase-invoices" : null;
  const statusChoices = statusDoc ? statusOptionsFor(statusDoc) : [];

  if (error && /permission/i.test(error)) return <AccessDenied detail={error} />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/reports" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> All reports
          </Link>
        }
        title={result?.title ?? "Report"}
        count={result?.total ?? null}
        description={result?.description}
        actions={
          <>
            <button type="button" className="button buttonSecondary" onClick={() => window.print()} title="Print this page">
              <IconPrint /> Print
            </button>
            <ExportButton
              ref={exportRef}
              endpoint={`/api/reports/${reportKey}/export`}
              params={() => {
                // Same filters and columns the screen is showing.
                const p = new URLSearchParams();
                for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
                if (stockFilter) p.set("stockFilter", stockFilter);
                if (selectedColumns) p.set("columns", selectedColumns);
                return p;
              }}
            />
          </>
        }
      />

      {result && result.summary.length > 0 && (
        <div className="kpiGrid" style={{ marginBottom: "1.25rem", gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))" }}>
          {result.summary.map((s) => {
            const money = /^-?\d+\.\d+$/.test(s.value);
            const numeric = /^-?\d+$/.test(s.value);
            return (
              <div key={s.label} className="kpiCard">
                <div className="kpiLabel">{s.label}</div>
                <div className="kpiValue" style={{ fontSize: "1.25rem", marginTop: "0.375rem" }} title={money ? `₹${formatMoney(s.value)}` : undefined}>
                  {money ? `₹${formatMoney(s.value)}` : numeric ? formatCount(s.value) : s.value}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {stockFilter && DRILL_LABELS[stockFilter] && (
        <div className="drillBanner">
          <span>Showing only {DRILL_LABELS[stockFilter]}.</span>
          <Link href={`/reports/${reportKey}`} className="buttonLink">
            Show the full report
          </Link>
        </div>
      )}

      {enabled.length > 0 && (
        <form
          className="filterBar"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters();
          }}
        >
          <div className="filterGrid">
            {enabled.includes("dateRange") && (
              <>
                <div className="filterField">
                  <label htmlFor="r-from">Date from</label>
                  <input id="r-from" type="date" value={filters.fromDate} max={filters.toDate || undefined} onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))} />
                </div>
                <div className="filterField">
                  <label htmlFor="r-to">Date to</label>
                  <input id="r-to" type="date" value={filters.toDate} min={filters.fromDate || undefined} onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))} />
                </div>
              </>
            )}
            {enabled.includes("party") && (
              <div className="filterField">
                <label htmlFor="r-party">Customer / supplier</label>
                <input id="r-party" placeholder="Name contains…" value={filters.partyName} onChange={(e) => setFilters((f) => ({ ...f, partyName: e.target.value }))} />
              </div>
            )}
            {enabled.includes("item") && (
              <div className="filterField">
                <label htmlFor="r-item">Product</label>
                <input id="r-item" placeholder="Item name or code…" value={filters.itemName} onChange={(e) => setFilters((f) => ({ ...f, itemName: e.target.value }))} />
              </div>
            )}
            {enabled.includes("account") && (
              <div className="filterField">
                <label htmlFor="r-account">Account</label>
                <select
                  id="r-account"
                  value={filters.accountId}
                  onChange={(e) => {
                    const accountId = e.target.value;
                    setFilters((f) => ({ ...f, accountId }));
                    setApplied((a) => ({ ...a, accountId }));
                    setPage(1);
                  }}
                >
                  <option value="">— choose an account —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {enabled.includes("status") && (
              <div className="filterField">
                <label htmlFor="r-status">Status</label>
                {statusChoices.length > 0 ? (
                  <select id="r-status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                    <option value="">Any</option>
                    {statusChoices.map((s) => (
                      <option key={s} value={s}>
                        {humanizeStatus(s)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id="r-status" placeholder="e.g. POSTED" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value.toUpperCase() }))} />
                )}
              </div>
            )}
          </div>
          <div className="filterActions">
            <button type="submit" className="button buttonPrimary">
              Apply filters
            </button>
            {activeFilterCount > 0 && (
              <button type="button" className="button buttonGhost" onClick={clearFilters}>
                Reset ({activeFilterCount})
              </button>
            )}
          </div>
        </form>
      )}

      <div className="toolbar">
        {catalogue.length > 0 && (
          <ColumnPicker
            buttonRef={columnsRef}
            options={catalogue.map((c) => ({ key: c.key, label: c.label }))}
            hidden={hidden}
            onToggle={toggle}
            onReset={reset}
          />
        )}
        <span className="activeFilterNote">
          {columns.length} of {catalogue.length} columns · export uses the same columns and filters
        </span>
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={() => load()} disabled={loading} aria-label="Refresh" title="Refresh (Ctrl + R)">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      {error && (
        <div className="banner bannerError" role="alert" style={{ marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}

      <div className="tableWrap">
        {loading && result && <div className="loadingBar" />}
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={isNum(c) ? "numCell" : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !result && <SkeletonRows columns={Math.max(4, columns.length || 6)} />}
            {!loading && result?.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, columns.length)}>
                  {activeFilterCount > 0 ? (
                    <EmptyState
                      variant="search"
                      title="No matching records"
                      description="Nothing matches these filters."
                      actions={
                        <button type="button" className="button buttonSecondary" onClick={clearFilters}>
                          Reset filters
                        </button>
                      }
                    />
                  ) : (
                    <EmptyState title="Nothing to report yet" description="Records appear here once transactions exist in the related module." />
                  )}
                </td>
              </tr>
            )}
            {result?.rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key} className={isNum(col) ? "numCell" : undefined}>
                    {renderCell(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {result && result.rows.length > 0 && hasTotals && (
            <tfoot>
              <tr className="voucherTotalRow">
                {columns.map((col, index) => {
                  const t = result.totals[col.key];
                  return (
                    <td key={col.key} className={isNum(col) ? "numCell" : undefined}>
                      {index === 0
                        ? "Page total"
                        : t === undefined || t === ""
                          ? ""
                          : col.type === "money"
                            ? formatMoney(String(t))
                            : col.type === "number"
                              ? formatQuantity(String(t))
                              : String(t)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>

        {result && result.total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />
        )}
      </div>
    </>
  );
}
