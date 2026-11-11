"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import { getPath } from "@/lib/resources/ui/paths";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { IconPlus, IconRefresh } from "@/components/icons";

export interface SimpleColumn {
  key: string;
  label: string;
  type?: "text" | "mono" | "date" | "datetime" | "money" | "number" | "status" | "count";
  /** Links the cell to the row's detail page. */
  link?: boolean;
}

export interface SimpleListConfig {
  title: string;
  description: string;
  apiPath: string;
  basePath: string;
  columns: SimpleColumn[];
  /** Shown only with this permission. */
  create?: { label: string; href: string; permission: string };
  statusOptions?: { value: string; label: string }[];
  searchPlaceholder?: string;
  dateFilter?: boolean;
  emptyText?: string;
  /** Extra headline under the toolbar, from the list response. */
  summary?: (result: Record<string, unknown>) => ReactNode;
  headerActions?: ReactNode;
  /** URL query params forwarded to the API as fixed filters, e.g. ["registerId"]. */
  urlParams?: string[];
}

interface ListResult {
  items: Record<string, unknown>[];
  total: number;
  [key: string]: unknown;
}

function cell(row: Record<string, unknown>, col: SimpleColumn): ReactNode {
  const v = getPath(row, col.key);
  if (col.type === "count") return Array.isArray(v) ? v.length : 0;
  if (v === null || v === undefined || v === "") return <span className="cellMuted">—</span>;
  switch (col.type) {
    case "date":
      return new Date(String(v)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    case "datetime":
      return new Date(String(v)).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    case "money":
      return formatMoney(String(v));
    case "number":
      return formatQuantity(String(v));
    case "status":
      return <StatusBadge status={String(v)} />;
    default:
      return String(v);
  }
}

/**
 * A config-driven list for transaction screens that aren't documents or
 * masters (expenses, POS orders, production entries): search, optional date
 * and status filters, paging, and a link to each record.
 */
export default function SimpleListView({ config }: { config: SimpleListConfig }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fixed = (config.urlParams ?? [])
    .map((k) => [k, searchParams.get(k)] as const)
    .filter((e): e is readonly [string, string] => Boolean(e[1]));
  const fixedKey = fixed.map(([k, v]) => `${k}=${v}`).join("&");
  const { hasPermission } = useAuth();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canCreate = config.create ? hasPermission(config.create.permission) : false;

  useEffect(() => {
    const t = setTimeout(() => {
      setApplied(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(fixedKey);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (applied) params.set("query", applied);
      if (status) params.set("status", status);
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      setResult(await apiFetch<ListResult>(`${config.apiPath}?${params.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [config.apiPath, fixedKey, page, pageSize, applied, status, fromDate, toDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({
    onNew: canCreate && config.create ? () => router.push(config.create!.href) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onRefresh: load,
  });

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const rows = result?.items ?? [];
  const filtering = Boolean(applied || status || fromDate || toDate);

  return (
    <>
      <PageHeader
        title={config.title}
        count={result?.total ?? null}
        description={config.description}
        actions={
          <>
            {config.headerActions}
            {config.create && canCreate && (
              <Link href={config.create.href} className="button buttonPrimary" title={`${config.create.label} (Ctrl + N)`}>
                <IconPlus /> {config.create.label}
              </Link>
            )}
          </>
        }
      />

      <div className="toolbar">
        <SearchBox inputRef={searchRef} value={query} onChange={setQuery} placeholder={config.searchPlaceholder ?? "Search…"} width="18rem" />
        {config.statusOptions && (
          <select className="select" style={{ width: "auto" }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
            <option value="">Status: All</option>
            {config.statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {config.dateFilter && (
          <>
            <input type="date" className="input" style={{ width: "auto" }} value={fromDate} onChange={(e) => (setFromDate(e.target.value), setPage(1))} aria-label="From date" />
            <input type="date" className="input" style={{ width: "auto" }} value={toDate} onChange={(e) => (setToDate(e.target.value), setPage(1))} aria-label="To date" />
          </>
        )}
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh (Ctrl + R)">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      {result && config.summary && <div style={{ marginBottom: "0.75rem" }}>{config.summary(result)}</div>}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              {config.columns.map((c) => (
                <th key={c.key} className={c.type === "money" || c.type === "number" || c.type === "count" ? "numCell" : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={config.columns.length} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={config.columns.length}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load this list."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && rows.length === 0 && (
              <tr>
                <td colSpan={config.columns.length}>
                  <EmptyState variant={filtering ? "search" : undefined} title={filtering ? "Nothing matches these filters" : config.emptyText ?? "Nothing recorded yet"} />
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={String(row.id)}>
                {config.columns.map((c) => (
                  <td
                    key={c.key}
                    className={[
                      c.type === "money" || c.type === "number" || c.type === "count" ? "numCell" : "",
                      c.type === "mono" ? "cellMono" : "",
                    ].join(" ")}
                  >
                    {c.link ? (
                      <Link href={`${config.basePath}/${String(row.id)}`} className="cellLink cellMono">
                        {cell(row, c)}
                      </Link>
                    ) : (
                      cell(row, c)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />}
      </div>
    </>
  );
}
