"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate, todayKey, CLAIM_CATEGORY_LABELS } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconCheck, IconRefresh } from "@/components/icons";

interface Row {
  id: string;
  claimNumber: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  claimDate: string;
  category: string;
  amount: string;
  description: string;
  billReference: string;
  status: string;
  decidedAt: string | null;
  settlementMode: string | null;
  settledAt: string | null;
  settlementReference: string;
}

interface Result {
  items: Row[];
  total: number;
  unsettledCount: number;
  unsettledAmount: string;
}

const SETTLEMENT_LABELS: Record<string, string> = {
  PAYROLL: "With payroll",
  CASH: "Cash",
  BANK: "Bank transfer",
  CHEQUE: "Cheque",
  ADVANCE: "Set off against advance",
};

/** Claim Settlement: pay approved claims now instead of waiting for payroll, and see how settled claims were paid. */
export default function ClaimSettlementPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<"APPROVED" | "REIMBURSED">("APPROVED");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settling, setSettling] = useState(false);
  const [form, setForm] = useState({ mode: "BANK", paidOn: todayKey(), reference: "" });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const canSettle = hasPermission("hr-claims.approve");

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
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: view });
      if (applied) p.set("query", applied);
      setResult(await apiFetch<Result>(`/api/hr/claims?${p.toString()}`));
      setSelected(new Set());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, view, applied]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  const rows = useMemo(() => result?.items ?? [], [result]);
  const picked = rows.filter((r) => selected.has(r.id));
  const pickedTotal = picked.reduce((t, r) => t + Math.round(Number(r.amount) * 100), 0) / 100; // display only; the server totals in decimals
  const allPicked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const selectable = view === "APPROVED" && canSettle;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function settle() {
    setBusy(true);
    setDialogError(null);
    try {
      const res = await apiFetch<{ settled: number; amount: string }>("/api/hr/claims/settle", {
        method: "POST",
        body: JSON.stringify({ claimIds: picked.map((r) => r.id), ...form }),
      });
      toast.success(`${res.settled} claim${res.settled === 1 ? "" : "s"} settled`, `${formatMoney(res.amount)} paid by ${SETTLEMENT_LABELS[form.mode].toLowerCase()}.`);
      setSettling(false);
      setForm({ mode: form.mode, paidOn: todayKey(), reference: "" });
      load();
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const cols = selectable ? 8 : 7;

  return (
    <>
      <PageHeader
        title="Claim settlement"
        count={result?.total ?? null}
        description={
          result && view === "APPROVED"
            ? `${result.unsettledCount} approved claim${result.unsettledCount === 1 ? "" : "s"} not yet paid (${formatMoney(result.unsettledAmount)}). Pay them here, or leave them for the next payroll.`
            : "How approved claims were paid: with payroll, directly, or set off against an advance."
        }
        actions={
          selectable && picked.length > 0 ? (
            <button type="button" className="button buttonPrimary" onClick={() => (setDialogError(null), setSettling(true))}>
              <IconCheck /> Settle {picked.length} ({formatMoney(pickedTotal.toFixed(2))})
            </button>
          ) : undefined
        }
      />

      <div className="tabBar" role="tablist" aria-label="Claims">
        <button type="button" role="tab" className="tabBarItem" aria-selected={view === "APPROVED"} onClick={() => (setView("APPROVED"), setPage(1))}>
          Waiting to be paid
        </button>
        <button type="button" role="tab" className="tabBarItem" aria-selected={view === "REIMBURSED"} onClick={() => (setView("REIMBURSED"), setPage(1))}>
          Settled
        </button>
      </div>

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search employee or claim no…" width="18rem" />
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: "2rem" }}>
                  <input type="checkbox" checked={allPicked} onChange={() => setSelected(allPicked ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" />
                </th>
              )}
              <th>Claim</th>
              <th>Employee</th>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th className="numCell">Amount</th>
              <th>{view === "APPROVED" ? "Approved" : "Paid"}</th>
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={cols} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={cols}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load claims."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && rows.length === 0 && (
              <tr>
                <td colSpan={cols}>
                  <EmptyState
                    variant={applied ? "search" : undefined}
                    title={view === "APPROVED" ? "Nothing waiting to be paid" : "No settled claims"}
                    description={view === "APPROVED" ? "Approve claims on Claim Requests first." : undefined}
                  />
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={selected.has(r.id) ? { background: "var(--accent-soft)" } : undefined}>
                {selectable && (
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.claimNumber}`} />
                  </td>
                )}
                <td className="cellMono">{r.claimNumber}</td>
                <td>
                  <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                    {r.employeeName}
                  </Link>
                  <div className="hrMuted">{r.employeeCode}</div>
                </td>
                <td>{fmtDate(r.claimDate)}</td>
                <td>{CLAIM_CATEGORY_LABELS[r.category] ?? r.category}</td>
                <td style={{ maxWidth: "18rem" }}>
                  {r.description}
                  {r.billReference && <div className="hrMuted">Bill {r.billReference}</div>}
                </td>
                <td className="numCell">{formatMoney(r.amount)}</td>
                <td>
                  {view === "APPROVED" ? (
                    r.decidedAt ? fmtDate(r.decidedAt) : <span className="cellMuted">—</span>
                  ) : (
                    <>
                      {SETTLEMENT_LABELS[r.settlementMode ?? ""] ?? "—"}
                      <div className="hrMuted">
                        {r.settledAt ? fmtDate(r.settledAt) : ""}
                        {r.settlementReference ? ` · ${r.settlementReference}` : ""}
                      </div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />}
      </div>
      {view === "APPROVED" && (
        <p className="hrMuted" style={{ marginTop: "0.5rem" }}>
          To set claims off against an advance the employee owes, open the advance on <Link href="/hr/loans" className="textLink">Advance Settlement</Link>.
        </p>
      )}

      {settling && (
        <Modal
          title={`Settle ${picked.length} claim${picked.length === 1 ? "" : "s"}`}
          subtitle={`${formatMoney(pickedTotal.toFixed(2))} for ${new Set(picked.map((r) => r.employeeId)).size} employee(s). They will not be paid again in payroll.`}
          onClose={() => setSettling(false)}
          busy={busy}
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setSettling(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={settle} disabled={busy || !form.paidOn}>
                {busy && <span className="spinner" />} Mark as paid
              </button>
            </>
          }
        >
          {dialogError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{dialogError}</span>
            </div>
          )}
          <div className="formGrid">
            <div className="field">
              <label htmlFor="cs-mode">Paid by</label>
              <select id="cs-mode" className="select" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="BANK">Bank transfer</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cs-date">Paid on</label>
              <input id="cs-date" className="input" type="date" value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="cs-ref">{form.mode === "CHEQUE" ? "Cheque no." : form.mode === "BANK" ? "UTR / reference" : "Voucher / reference"}</label>
              <input id="cs-ref" className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
