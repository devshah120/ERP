"use client";

import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import { formatMoney } from "@/lib/format/number";
import RowActions, { type RowAction } from "@/components/table/RowActions";
import { IconPlus, IconRefresh, IconFilter, IconEye, IconChart } from "@/components/icons";

interface VoucherRow {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  voucherType: string;
  narration?: string;
  referenceNumber?: string;
  sourceNumber?: string | null;
  isSystemGenerated: boolean;
  status: string;
  totalDebit: string;
  totalCredit: string;
  lineCount: number;
  accountSummary: string;
}

interface ListResult {
  items: VoucherRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY = { query: "", voucherType: "", status: "", source: "", fromDate: "", toDate: "", accountId: "" };
type Filters = typeof EMPTY;

const TYPES = ["JOURNAL", "PAYMENT", "RECEIPT", "CONTRA", "SALES", "PURCHASE"];

/**
 * Every journal entry, hand-written and auto-posted alike.
 *
 * Auto-posted vouchers are shown, not hidden: the point of the ledger is that
 * you can see exactly what an invoice did to the accounts.
 */
export default function VoucherListView() {
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
  const [showFilters, setShowFilters] = useState(Boolean(initial.accountId));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const canCreate = hasPermission("vouchers.create");

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
      setResult(await apiFetch<ListResult>(`/api/vouchers?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load vouchers");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, applied]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({
    onNew: canCreate ? () => router.push("/account-vouchers/new") : undefined,
    onSearch: () => searchRef.current?.focus(),
    onRefresh: load,
    onToggleFilters: () => setShowFilters((s) => !s),
  });

  function buildActions(row: VoucherRow): RowAction[] {
    return [
      { key: "view", label: "View", icon: <IconEye />, href: `/account-vouchers/${row.id}`, primary: true },
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
          <h1 className="pageTitle">Account Vouchers</h1>
          <div className="pageSubtitle">
            Every journal entry — hand-written, and posted automatically by invoices, receipts and payments
          </div>
        </div>
        <div className="pageActions">
          <Link href="/reports/trial-balance" className="button buttonSecondary">
            <IconChart /> Trial Balance
          </Link>
          <Link
            href="/account-vouchers/new"
            className={`button buttonPrimary ${canCreate ? "" : "buttonDisabledLink"}`}
            aria-disabled={!canCreate}
            title={canCreate ? "New journal voucher (Ctrl + N)" : "You do not have create permission"}
          >
            <IconPlus /> New Voucher
          </Link>
        </div>
      </div>

      <div className="toolbar">
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
          <SearchBox
              inputRef={searchRef}
              value={filters.query}
              onChange={(v) => setFilters((f) => ({ ...f, query: v }))}
              placeholder="Search voucher no., narration or source…"
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
              <label>Type</label>
              <select
                value={filters.voucherType}
                onChange={(e) => setFilters((f) => ({ ...f, voucherType: e.target.value }))}
              >
                <option value="">Any</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="filterField">
              <label>Source</label>
              <select value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}>
                <option value="">Any</option>
                <option value="MANUAL">Entered by hand</option>
                <option value="SYSTEM">Posted automatically</option>
              </select>
            </div>
            <div className="filterField">
              <label>Status</label>
              <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">Any</option>
                <option value="POSTED">Posted</option>
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

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "3rem" }}>#</th>
              <th>Voucher No</th>
              <th>Date</th>
              <th>Type</th>
              <th>Accounts</th>
              <th>Source</th>
              <th className="numCell">Amount</th>
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
                    {activeFilterCount > 0 || applied.query
                      ? "No vouchers match these filters."
                      : "No vouchers yet. Post an invoice or write a journal entry."}
                  </div>
                </td>
              </tr>
            )}
            {rows.map((v, index) => (
              <tr key={v.id}>
                <td className="cellMuted tabular">{from + index}</td>
                <td>
                  <Link href={`/account-vouchers/${v.id}`} className="cellLink cellMono">
                    {v.voucherNumber}
                  </Link>
                </td>
                <td>{new Date(v.voucherDate).toLocaleDateString("en-GB")}</td>
                <td>{v.voucherType}</td>
                <td className="docLineMeta">
                  {v.accountSummary}
                  {v.lineCount > 3 ? ` +${v.lineCount - 3} more` : ""}
                </td>
                <td>
                  {v.isSystemGenerated ? (
                    <span className="badge badgeNeutral" title="Posted automatically by a document">
                      {v.sourceNumber ?? "Auto"}
                    </span>
                  ) : (
                    <span className="docLineMeta">{v.referenceNumber ?? "Manual"}</span>
                  )}
                </td>
                <td className="numCell">{formatMoney(v.totalDebit)}</td>
                <td>
                  <StatusBadge status={v.status} />
                </td>
                <td className="actionCell">
                  <RowActions actions={buildActions(v)} />
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
