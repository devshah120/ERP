"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../AuthProvider";
import { formatMoney } from "@/lib/format/number";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { useToast } from "@/components/ui/Toast";
import { IconRefresh } from "@/components/icons";

interface Row {
  voucherId: string;
  lineIndex: number;
  date: string;
  voucherNumber: string;
  particulars: string;
  reference: string | null;
  deposit: string;
  withdrawal: string;
  clearedDate: string | null;
}

interface Recon {
  asOf: string;
  bookBalance: string;
  unclearedDeposits: string;
  unclearedWithdrawals: string;
  expectedBankBalance: string;
  rows: Row[];
}

const key = (r: Row) => `${r.voucherId}:${r.lineIndex}`;

/**
 * Tick off each entry as it appears on the bank statement. Whatever is left
 * unticked explains the gap between the books and the bank.
 */
export default function BankReconciliationPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canEdit = hasPermission("bank-reconciliation.edit");

  const [accounts, setAccounts] = useState<{ id: string; label: string }[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [show, setShow] = useState<"UNCLEARED" | "ALL">("UNCLEARED");
  const [statement, setStatement] = useState("");
  const [data, setData] = useState<Recon | null>(null);
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ accounts: { id: string; label: string }[] }>("/api/bank-reconciliation")
      .then((r) => {
        setAccounts(r.accounts);
        if (r.accounts[0]) setAccountId((a) => a || r.accounts[0].id);
      })
      .catch(setError);
  }, []);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ accountId, asOf, show });
      setData(await apiFetch<Recon>(`/api/bank-reconciliation?${params.toString()}`));
      setEdits({});
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [accountId, asOf, show]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const dirty = Object.keys(edits).length > 0;
  useUnsavedChangesWarning(dirty && !saving);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const items = Object.entries(edits).map(([k, clearedDate]) => {
        const [voucherId, lineIndex] = k.split(":");
        return { voucherId, lineIndex: Number(lineIndex), clearedDate };
      });
      const res = await apiFetch<{ cleared: number; uncleared: number }>("/api/bank-reconciliation", {
        method: "PUT",
        body: JSON.stringify({ accountId, items }),
      });
      toast.success("Reconciliation saved", `${res.cleared} cleared, ${res.uncleared} un-cleared`);
      await load();
    } catch (err) {
      toast.error("Couldn't save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: () => void save(), onRefresh: load });

  function clearedValue(r: Row) {
    return key(r) in edits ? edits[key(r)] : r.clearedDate;
  }

  function setCleared(r: Row, value: string | null) {
    setEdits((e) => {
      const next = { ...e };
      if (value === r.clearedDate) delete next[key(r)];
      else next[key(r)] = value;
      return next;
    });
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  // Live figures, including ticks not yet saved.
  let expected: Decimal | null = null;
  if (data) {
    let inPending = new Decimal(data.unclearedDeposits);
    let outPending = new Decimal(data.unclearedWithdrawals);
    for (const r of data.rows) {
      if (!(key(r) in edits)) continue;
      const was = r.clearedDate !== null && r.clearedDate <= data.asOf;
      const now = edits[key(r)] !== null && String(edits[key(r)]) <= data.asOf;
      if (was === now) continue;
      const sign = now ? -1 : 1;
      inPending = inPending.plus(new Decimal(r.deposit).times(sign));
      outPending = outPending.plus(new Decimal(r.withdrawal).times(sign));
    }
    expected = new Decimal(data.bookBalance).minus(inPending).plus(outPending);
  }
  let difference: Decimal | null = null;
  try {
    if (expected && statement.trim()) difference = new Decimal(statement).minus(expected);
  } catch {
    difference = null;
  }

  return (
    <>
      <PageHeader
        title="Bank Reconciliation"
        description="Match the books to the bank statement. Tick each entry with the date it appears on the statement."
        actions={
          canEdit && (
            <button type="button" className="button buttonPrimary" onClick={save} disabled={!dirty || saving}>
              {saving && <span className="spinner" />}
              {dirty ? `Save ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? "" : "s"}` : "Saved"}
            </button>
          )
        }
      />

      {accounts && accounts.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No bank accounts to reconcile"
            description={
              <>
                Add a <Link href="/bank-accounts/new" className="textLink">bank account</Link> linked to a ledger, or set up the chart of accounts.
              </>
            }
          />
        </div>
      ) : (
        <>
          <div className="toolbar">
            <select className="select" style={{ width: "auto", minWidth: "16rem" }} value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Bank account">
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <label className="activeFilterNote" style={{ display: "inline-flex", gap: "0.375rem", alignItems: "center" }}>
              As of <input type="date" className="input" style={{ width: "auto" }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </label>
            <select className="select" style={{ width: "auto" }} value={show} onChange={(e) => setShow(e.target.value as "UNCLEARED" | "ALL")} aria-label="Show">
              <option value="UNCLEARED">Uncleared only</option>
              <option value="ALL">All entries</option>
            </select>
            <div className="toolbarRight">
              <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
                {loading ? <span className="spinner" /> : <IconRefresh />}
              </button>
            </div>
          </div>

          {data && (
            <div className="kpiGrid kpiGrid4" style={{ marginBottom: "1rem" }}>
              <div className="kpiCard kpiCompact">
                <div className="kpiLabel">Balance as per books</div>
                <div className="kpiValue">{formatMoney(data.bookBalance)}</div>
              </div>
              <div className="kpiCard kpiCompact">
                <div className="kpiLabel">Should show on statement</div>
                <div className="kpiValue">{expected ? formatMoney(expected.toFixed(2)) : "—"}</div>
                <div className="kpiHint">Books less uncleared deposits, plus uncleared payments</div>
              </div>
              <div className="kpiCard kpiCompact">
                <div className="kpiLabel">Statement balance</div>
                <input className="input" inputMode="decimal" placeholder="From the bank statement" value={statement} onChange={(e) => setStatement(e.target.value)} aria-label="Statement balance" />
              </div>
              <div className={`kpiCard kpiCompact ${difference === null ? "" : difference.abs().lt("0.005") ? "kpiTone-good" : "kpiTone-bad"}`}>
                <div className="kpiTop">
                  <div className="kpiLabel">Difference</div>
                  <span className="kpiTone" />
                </div>
                <div className="kpiValue">{difference === null ? "—" : formatMoney(difference.toFixed(2))}</div>
                <div className="kpiHint">{difference === null ? "Enter the statement balance" : difference.abs().lt("0.005") ? "Reconciled" : "Look for a missing or wrong entry"}</div>
              </div>
            </div>
          )}

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "3rem" }}>Cleared</th>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Particulars</th>
                  <th>Reference</th>
                  <th className="numCell">Deposit</th>
                  <th className="numCell">Withdrawal</th>
                  <th style={{ width: "10rem" }}>Statement date</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && <SkeletonRows columns={8} rows={6} />}
                {error !== null && (
                  <tr>
                    <td colSpan={8}>
                      <ErrorState message={error instanceof ApiError ? error.message : "Could not load"} onRetry={load} />
                    </td>
                  </tr>
                )}
                {data && data.rows.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState title={show === "UNCLEARED" ? "Everything up to this date has cleared" : "No entries on this account"} />
                    </td>
                  </tr>
                )}
                {data?.rows.map((r) => {
                  const cd = clearedValue(r);
                  return (
                    <tr key={key(r)} style={key(r) in edits ? { background: "var(--accent-soft, rgba(37,99,235,0.06))" } : undefined}>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={cd !== null}
                          disabled={!canEdit}
                          aria-label={`Cleared ${r.voucherNumber}`}
                          onChange={(e) => setCleared(r, e.target.checked ? (r.date.slice(0, 10) > asOf ? r.date.slice(0, 10) : asOf) : null)}
                        />
                      </td>
                      <td>{new Date(r.date).toLocaleDateString("en-GB")}</td>
                      <td>
                        <Link href={`/account-vouchers/${r.voucherId}`} className="cellLink cellMono">
                          {r.voucherNumber}
                        </Link>
                      </td>
                      <td>{r.particulars}</td>
                      <td className="cellMuted">{r.reference ?? "—"}</td>
                      <td className="numCell">{Number(r.deposit) ? formatMoney(r.deposit) : ""}</td>
                      <td className="numCell">{Number(r.withdrawal) ? formatMoney(r.withdrawal) : ""}</td>
                      <td>
                        {cd !== null && (
                          <input type="date" className="input" value={cd} disabled={!canEdit} min={r.date.slice(0, 10)} onChange={(e) => setCleared(r, e.target.value || null)} aria-label="Statement date" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
