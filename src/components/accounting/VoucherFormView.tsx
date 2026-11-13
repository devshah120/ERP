"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { formatMoney } from "@/lib/format/number";
import { IconPlus, IconSave, IconClose, IconTrash } from "@/components/icons";

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  isGroup?: boolean;
}

interface VoucherLine {
  accountId: string;
  debit: string;
  credit: string;
  narration?: string;
}

interface VoucherRecord {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  voucherType: string;
  narration?: string;
  referenceNumber?: string;
  sourceType?: string | null;
  sourceNumber?: string | null;
  isSystemGenerated: boolean;
  status: string;
  cancellationReason?: string;
  totalDebit: string;
  totalCredit: string;
  lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
    narration?: string;
  }[];
}

const VOUCHER_TYPES = [
  { value: "JOURNAL", label: "Journal" },
  { value: "PAYMENT", label: "Payment" },
  { value: "RECEIPT", label: "Receipt" },
  { value: "CONTRA", label: "Contra (cash ↔ bank)" },
];

const emptyLine: VoucherLine = { accountId: "", debit: "", credit: "" };

function safe(value: string): Decimal {
  try {
    return new Decimal(value || "0");
  } catch {
    return new Decimal(0);
  }
}

/**
 * Hand-written journal entry.
 *
 * The running difference is shown at all times and Save stays disabled until
 * it is zero — an unbalanced entry is not a smaller problem than no entry,
 * it is a corrupt ledger that every later report inherits.
 */
export default function VoucherFormView({ recordId }: { recordId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const isView = Boolean(recordId);

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [voucherType, setVoucherType] = useState("JOURNAL");
  const [narration, setNarration] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [lines, setLines] = useState<VoucherLine[]>([{ ...emptyLine }, { ...emptyLine }]);

  const [record, setRecord] = useState<VoucherRecord | null>(null);
  const [loading, setLoading] = useState(isView);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: AccountOption[] }>(
        "/api/masters/chart-of-accounts?pageSize=200&status=ACTIVE"
      );
      // Group headings are not postable, so they are never offered.
      setAccounts(data.items.filter((a) => !a.isGroup));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Could not load accounts: ${err.message}`
          : "Could not load the chart of accounts."
      );
    }
  }, []);

  const loadRecord = useCallback(async () => {
    if (!recordId) return;
    try {
      setRecord(await apiFetch<VoucherRecord>(`/api/vouchers/${recordId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this voucher");
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isView) loadRecord();
    else loadAccounts();
  }, [isView, loadRecord, loadAccounts]);

  const totals = useMemo(() => {
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    for (const l of lines) {
      debit = debit.plus(safe(l.debit));
      credit = credit.plus(safe(l.credit));
    }
    return { debit, credit, difference: debit.minus(credit) };
  }, [lines]);

  const filled = lines.filter((l) => l.accountId && (safe(l.debit).gt(0) || safe(l.credit).gt(0)));
  const balanced = totals.difference.abs().lt("0.005") && filled.length >= 2;

  const dirty = filled.length > 0 || narration.length > 0;
  useUnsavedChangesWarning(!isView && dirty && !submitting);

  function updateLine(index: number, patch: Partial<VoucherLine>) {
    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  /** Typing in one column clears the other: a line is a debit or a credit. */
  function setAmount(index: number, side: "debit" | "credit", value: string) {
    updateLine(index, side === "debit" ? { debit: value, credit: "" } : { credit: value, debit: "" });
  }

  /** Fills the remaining difference into an empty line, the usual last step. */
  function balanceLine(index: number) {
    const diff = totals.difference;
    if (diff.abs().lt("0.005")) return;
    if (diff.gt(0)) updateLine(index, { credit: diff.toFixed(2), debit: "" });
    else updateLine(index, { debit: diff.abs().toFixed(2), credit: "" });
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (submitting || isView || !balanced) return;

    setSubmitting(true);
    setError(null);
    try {
      const doc = await apiFetch<{ id: string; voucherNumber?: string }>("/api/vouchers", {
        method: "POST",
        body: JSON.stringify({
          voucherDate,
          voucherType,
          narration: narration || undefined,
          referenceNumber: referenceNumber || undefined,
          lines: filled.map((l) => ({
            accountId: l.accountId,
            debit: safe(l.debit).toFixed(2),
            credit: safe(l.credit).toFixed(2),
            narration: l.narration || undefined,
          })),
        }),
      });
      toast.success("Voucher posted", doc.voucherNumber);
      router.push(`/account-vouchers/${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post this voucher");
      setSubmitting(false);
    }
  }

  useShortcutScope({
    onSave: isView ? undefined : () => handleSubmit(),
    onAddLine: isView ? undefined : () => setLines((rows) => [...rows, { ...emptyLine }]),
  });

  async function runCancel(reason?: string) {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
      await apiFetch(`/api/vouchers/${recordId}${qs}`, { method: "DELETE" });
      setCancelOpen(false);
      toast.success("Voucher cancelled");
      await loadRecord();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Cancel failed");
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) return <p style={{ opacity: 0.6 }}>Loading…</p>;

  /* ------------------------------------------------- view mode */

  if (isView && record) {
    return (
      <div className="docForm">
        <div className="docTopBar">
          <div className="docTopTitle">
            {record.voucherNumber}
            <span className={`badge ${record.status === "POSTED" ? "badgeSuccess" : "badgeDanger"}`}>
              {record.status}
            </span>
            {record.isSystemGenerated && <span className="badge badgeNeutral">Auto-posted</span>}
          </div>
          <div className="docTopActions" style={{ display: "flex", gap: "0.5rem" }}>
            {record.status === "POSTED" && !record.isSystemGenerated && (
              <Button
                variant="outlined"
                color="error"
                size="small"
                onClick={() => setCancelOpen(true)}
                startIcon={<IconTrash />}
                sx={{ textTransform: "none", fontWeight: 600 }}
              >
                Cancel & reverse
              </Button>
            )}
            <Button
              component={Link}
              href="/account-vouchers"
              variant="outlined"
              size="small"
              startIcon={<IconClose />}
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              Back
            </Button>
          </div>
        </div>

        {record.status === "CANCELLED" && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
            Cancelled{record.cancellationReason ? `: ${record.cancellationReason}` : "."} A reversing entry was
            posted — the original is kept so past periods still reconcile.
          </Alert>
        )}

        {record.isSystemGenerated && (
          <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
            This voucher was posted automatically by {record.sourceNumber ?? "a document"}. To reverse it,
            cancel that document — the ledger follows.
          </Alert>
        )}

        <div className="docHeadGrid">
          <div className="docHeadField">
            <label>Date</label>
            <input className="input docReadonly" value={new Date(record.voucherDate).toLocaleDateString("en-GB")} readOnly />
          </div>
          <div className="docHeadField">
            <label>Type</label>
            <input className="input docReadonly" value={record.voucherType} readOnly />
          </div>
          <div className="docHeadField">
            <label>Reference</label>
            <input className="input docReadonly" value={record.referenceNumber ?? record.sourceNumber ?? "—"} readOnly />
          </div>
        </div>

        <div className="docTabPanel" style={{ borderRadius: "10px", borderTop: "1px solid var(--card-border)" }}>
          <table className="docLinesTable">
            <thead>
              <tr>
                <th style={{ width: "7rem" }}>Code</th>
                <th>Account</th>
                <th>Narration</th>
                <th style={{ width: "10rem" }}>Debit</th>
                <th style={{ width: "10rem" }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {record.lines.map((l, i) => (
                <tr key={`${l.accountId}-${i}`}>
                  <td>{l.accountCode}</td>
                  <td>
                    <Link href={`/general-ledger?accountId=${l.accountId}`} className="cellLink">
                      {l.accountName}
                    </Link>
                  </td>
                  <td className="docLineMeta">{l.narration ?? "—"}</td>
                  <td className="numCell">{Number(l.debit) > 0 ? formatMoney(l.debit) : "—"}</td>
                  <td className="numCell">{Number(l.credit) > 0 ? formatMoney(l.credit) : "—"}</td>
                </tr>
              ))}
              <tr className="voucherTotalRow">
                <td colSpan={3}>Total</td>
                <td className="numCell">{formatMoney(record.totalDebit)}</td>
                <td className="numCell">{formatMoney(record.totalCredit)}</td>
              </tr>
            </tbody>
          </table>

          {record.narration && (
            <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              <strong>Narration:</strong> {record.narration}
            </p>
          )}
        </div>

        {cancelOpen && (
          <ConfirmDialog
            title="Cancel this voucher?"
            message={`${record.voucherNumber} will be reversed by an equal and opposite entry. Both stay on file so past periods still reconcile.`}
            confirmLabel="Cancel & reverse"
            requireReason
            busy={cancelBusy}
            error={cancelError}
            onCancel={() => setCancelOpen(false)}
            onConfirm={runCancel}
          />
        )}
      </div>
    );
  }

  /* ------------------------------------------------- create mode */

  return (
    <form className="docForm" onSubmit={handleSubmit}>
      <div className="docTopBar">
        <div className="docTopTitle">New Journal Voucher</div>
        <div className="docTopActions" style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={submitting || !balanced}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <IconSave />}
            title={balanced ? "Save (Ctrl + S)" : "Debits and credits must be equal"}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {submitting ? "Posting…" : "Post voucher"}
          </Button>
          <Button
            component={Link}
            href="/account-vouchers"
            variant="outlined"
            size="small"
            startIcon={<IconClose />}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Cancel
          </Button>
        </div>
      </div>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      <div className="docHeadGrid">
        <div className="docHeadField">
          <label htmlFor="v-date">
            Date<span className="req">*</span>
          </label>
          <input
            id="v-date"
            className="input"
            type="date"
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value)}
            required
          />
        </div>
        <div className="docHeadField">
          <label htmlFor="v-type">Type</label>
          <select id="v-type" className="select" value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
            {VOUCHER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="docHeadField">
          <label htmlFor="v-ref">Reference</label>
          <input
            id="v-ref"
            className="input"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="docTabPanel" style={{ borderRadius: "10px", borderTop: "1px solid var(--card-border)" }}>
        <table className="docLinesTable">
          <thead>
            <tr>
              <th style={{ width: "3rem" }}>#</th>
              <th style={{ minWidth: "16rem" }}>Account</th>
              <th>Narration</th>
              <th style={{ width: "9rem" }}>Debit</th>
              <th style={{ width: "9rem" }}>Credit</th>
              <th style={{ width: "6rem" }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>
                  <select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })}>
                    <option value="">— select account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={line.narration ?? ""}
                    onChange={(e) => updateLine(index, { narration: e.target.value })}
                    placeholder="Optional"
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={line.debit}
                    onChange={(e) => setAmount(index, "debit", e.target.value)}
                    style={{ textAlign: "right" }}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={line.credit}
                    onChange={(e) => setAmount(index, "credit", e.target.value)}
                    style={{ textAlign: "right" }}
                  />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {!totals.difference.abs().lt("0.005") && !line.debit && !line.credit && (
                    <button
                      type="button"
                      className="buttonLink"
                      onClick={() => balanceLine(index)}
                      title={`Fill ${totals.difference.abs().toFixed(2)} to balance`}
                      style={{ fontSize: "0.75rem" }}
                    >
                      Balance
                    </button>
                  )}
                  {lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                      className="rowRemoveBtn" style={{ marginLeft: "0.4rem" }}
                      title="Remove this line"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="voucherTotalRow">
              <td colSpan={3}>Total</td>
              <td className="numCell">{formatMoney(totals.debit.toFixed(2))}</td>
              <td className="numCell">{formatMoney(totals.credit.toFixed(2))}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.9rem" }}>
          <button
            type="button"
            className="button buttonSecondary"
            onClick={() => setLines((rows) => [...rows, { ...emptyLine }])}
            title="Add another line (Ctrl + Enter)"
          >
            <IconPlus /> Add line
          </button>

          <span className={`voucherBalance ${balanced ? "voucherBalanced" : "voucherUnbalanced"}`}>
            {balanced
              ? "Balanced"
              : `Out by ₹${formatMoney(totals.difference.abs().toFixed(2))} — ${
                  totals.difference.gt(0) ? "needs more credit" : "needs more debit"
                }`}
          </span>
        </div>

        <div className="field" style={{ marginTop: "1rem" }}>
          <label htmlFor="v-narration">Narration</label>
          <textarea
            id="v-narration"
            className="input"
            rows={2}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="What this entry is for"
          />
        </div>
      </div>
    </form>
  );
}
