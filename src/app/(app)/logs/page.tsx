"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { humanizeStatus } from "@/components/ui/StatusBadge";
import { IconRefresh } from "@/components/icons";

interface LogRow {
  id: string;
  at: string;
  action: string;
  module: string;
  documentType: string | null;
  documentId: string | null;
  reason: string | null;
  ip: string | null;
  user: string;
}

interface LogResult {
  items: LogRow[];
  total: number;
  modules: string[];
}

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT", "CANCEL", "POST", "UNPOST", "LOGIN", "LOGOUT", "PASSWORD_CHANGE"];

const ACTION_TONE: Record<string, string> = {
  CREATE: "badgeSuccess",
  POST: "badgeSuccess",
  APPROVE: "badgeSuccess",
  UPDATE: "badgeInfo",
  LOGIN: "badgeAccent",
  LOGOUT: "badgeNeutral",
  DELETE: "badgeDanger",
  CANCEL: "badgeDanger",
  REJECT: "badgeDanger",
  UNPOST: "badgeWarning",
  PASSWORD_CHANGE: "badgeWarning",
};

/** "SalesInvoice" → "Sales invoice"; module codes like "sales.sales-invoices" → "Sales invoices". */
function prettify(s: string) {
  const last = s.split(".").pop() ?? s;
  const spaced = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The audit trail: every recorded change, sign-in and approval, newest first.
 * Read-only by design — nobody can edit or delete history from here.
 */
export default function ActivityLogPage() {
  const [data, setData] = useState<LogResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ module: "", action: "", fromDate: "", toDate: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      setData(await apiFetch<LogResult>(`/api/admin/audit-logs?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Activity Log"
        count={data?.total ?? null}
        description="Every change, approval, cancellation and sign-in in this workspace, with who did it and when. History can't be edited."
      />

      <div className="toolbar">
        <select className="select" value={filters.module} onChange={(e) => set("module", e.target.value)} aria-label="Module">
          <option value="">All modules</option>
          {data?.modules.map((m) => (
            <option key={m} value={m}>
              {prettify(m)}
            </option>
          ))}
        </select>
        <select className="select" value={filters.action} onChange={(e) => set("action", e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {humanizeStatus(a)}
            </option>
          ))}
        </select>
        <input className="input" type="date" style={{ width: "auto" }} aria-label="From date" value={filters.fromDate} max={filters.toDate || undefined} onChange={(e) => set("fromDate", e.target.value)} />
        <input className="input" type="date" style={{ width: "auto" }} aria-label="To date" value={filters.toDate} min={filters.fromDate || undefined} onChange={(e) => set("toDate", e.target.value)} />
        {hasFilters && (
          <button type="button" className="button buttonGhost" onClick={() => { setFilters({ module: "", action: "", fromDate: "", toDate: "" }); setPage(1); }}>
            Clear
          </button>
        )}
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh (Ctrl + R)">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <div className="tableWrap">
        {loading && data && <div className="loadingBar" />}
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Module</th>
              <th>Record</th>
              <th>Note</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={7} />}
            {error !== null && (
              <tr>
                <td colSpan={7}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load the activity log."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState variant={hasFilters ? "search" : "empty"} title={hasFilters ? "No activity matches these filters" : "No activity recorded yet"} />
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className="cellMuted tabular">
                  {new Date(r.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </td>
                <td className="cellPrimary">{r.user}</td>
                <td>
                  <span className={`badge ${ACTION_TONE[r.action] ?? "badgeNeutral"}`}>{humanizeStatus(r.action)}</span>
                </td>
                <td>{prettify(r.module)}</td>
                <td className="cellMuted">{r.documentType ? prettify(r.documentType) : "—"}</td>
                <td className="wrap" style={{ maxWidth: "24rem", color: "var(--text-secondary)" }}>
                  {r.reason ?? "—"}
                </td>
                <td className="cellMono cellMuted">{r.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.total > 0 && <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} />}
      </div>
    </>
  );
}
