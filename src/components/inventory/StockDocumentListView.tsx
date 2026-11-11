"use client";

import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import RowActions, { type RowAction } from "@/components/table/RowActions";
import { IconPlus, IconRefresh, IconEye, IconChart } from "@/components/icons";
import type { StockKind } from "./StockDocumentFormView";

interface StockRow {
  id: string;
  documentNumber: string;
  documentDate: string;
  status: string;
  reason?: string;
  warehouseName?: string;
  fromWarehouseName?: string;
  toWarehouseName?: string;
  totalValueChange?: string;
  totalQuantity?: number;
  lineCount: number;
}

interface ListResult {
  items: StockRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function StockDocumentListView({ kind }: { kind: StockKind }) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const isAdjustment = kind === "stock-adjustments";
  const title = isAdjustment ? "Stock Adjustments" : "Stock Transfers";
  const singular = isAdjustment ? "Adjustment" : "Transfer";
  const basePath = `/${kind}`;

  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const canCreate = hasPermission(`${kind}.create`);

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
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (applied) params.set("query", applied);
      setResult(await apiFetch<ListResult>(`/api/stock/${kind}?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to load ${title.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [kind, title, page, pageSize, applied]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({
    onNew: canCreate ? () => router.push(`${basePath}/new`) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onRefresh: load,
  });

  function buildActions(row: StockRow): RowAction[] {
    return [{ key: "view", label: "View", icon: <IconEye />, href: `${basePath}/${row.id}`, primary: true }];
  }

  const rows = result?.items ?? [];
  const total = result?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;

  return (
    <>
      <div className="pageHeader">
        <div className="pageHeaderText">
          <h1 className="pageTitle">{title}</h1>
          <div className="pageSubtitle">
            {isAdjustment
              ? "Physical counts, damage and wastage — posts to the stock ledger and the accounts"
              : "Goods moving between your own warehouses — stock only, no accounting effect"}
          </div>
        </div>
        <div className="pageActions">
          <Link href="/stock-ledger" className="button buttonSecondary">
            <IconChart /> Stock Ledger
          </Link>
          <Link
            href={`${basePath}/new`}
            className={`button buttonPrimary ${canCreate ? "" : "buttonDisabledLink"}`}
            aria-disabled={!canCreate}
            title={canCreate ? `New ${singular.toLowerCase()} (Ctrl + N)` : "You do not have create permission"}
          >
            <IconPlus /> New {singular}
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <button type="button" className="button buttonSecondary" onClick={load} disabled={loading}>
          <IconRefresh /> Refresh
        </button>
        <div className="toolbarRight">
          <SearchBox
              inputRef={searchRef}
              value={query}
              onChange={(v) => setQuery(v)}
              placeholder="Search document number…"
              width="18rem"
            />
        </div>
      </div>

      {error && <div className="banner bannerError" style={{ marginBottom: "1rem" }}>{error}</div>}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "3rem" }}>#</th>
              <th>Document No</th>
              <th>Date</th>
              {isAdjustment ? (
                <>
                  <th>Warehouse</th>
                  <th>Reason</th>
                  <th className="numCell">Items</th>
                  <th className="numCell">Value Effect</th>
                </>
              ) : (
                <>
                  <th>From</th>
                  <th>To</th>
                  <th className="numCell">Items</th>
                  <th className="numCell">Quantity</th>
                </>
              )}
              <th>Status</th>
              <th className="actionCell">
                <span className="srOnly">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="tableEmpty">
                    {applied ? "No records match this search." : `No ${title.toLowerCase()} recorded yet.`}
                  </div>
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td className="cellMuted tabular">{from + index}</td>
                <td>
                  <Link href={`${basePath}/${row.id}`} className="cellLink cellMono">
                    {row.documentNumber}
                  </Link>
                </td>
                <td>{new Date(row.documentDate).toLocaleDateString("en-GB")}</td>
                {isAdjustment ? (
                  <>
                    <td>{row.warehouseName ?? "—"}</td>
                    <td className="docLineMeta">{row.reason ?? "—"}</td>
                    <td className="numCell">{row.lineCount}</td>
                    <td className={`numCell ${Number(row.totalValueChange) < 0 ? "stockLoss" : "stockGain"}`}>
                      {formatMoney(row.totalValueChange ?? "0")}
                    </td>
                  </>
                ) : (
                  <>
                    <td>{row.fromWarehouseName ?? "—"}</td>
                    <td>{row.toWarehouseName ?? "—"}</td>
                    <td className="numCell">{row.lineCount}</td>
                    <td className="numCell">{formatQuantity(row.totalQuantity ?? 0)}</td>
                  </>
                )}
                <td>
                  <StatusBadge status={row.status} />
                </td>
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
    </>
  );
}
