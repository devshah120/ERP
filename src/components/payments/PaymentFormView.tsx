"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Decimal from "decimal.js";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { PaymentUi } from "@/lib/payments/ui";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import { PAYMENT_MODES } from "@/lib/payments/types";
import { formatMoney } from "@/lib/format/number";

/** How payment modes read on screen; the stored codes stay unchanged. */
const MODE_LABEL: Record<string, string> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  BANK: "Bank transfer",
  UPI: "UPI",
  CARD: "Card",
  ADJUSTMENT: "Adjustment",
};

interface PartyOption {
  id: string;
  name: string;
}

interface OpenInvoice {
  id: string;
  documentNumber: string;
  documentDate?: string;
  dueDate: string | null;
  grandTotal: string;
  paidAmount: string;
  dueAmount: string;
  paymentStatus: string;
}

interface PaymentRecord {
  id: string;
  documentNumber: string;
  documentDate: string;
  party: { name: string; code: string };
  partyId: string;
  mode: string;
  referenceNumber?: string;
  notes?: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  status: string;
  cancellationReason?: string;
  allocations: { invoiceNumber: string; invoiceId: string; amount: string }[];
}

function safeDecimal(value: string): Decimal {
  try {
    return new Decimal(value || "0");
  } catch {
    return new Decimal(0);
  }
}

/**
 * Records money in or out and settles it against open invoices.
 *
 * The allocation grid is the point of the screen: an amount that is not
 * matched to an invoice leaves the receivable untouched, so the form makes
 * what is settled, and what is left on account, explicit before saving.
 */
export default function PaymentFormView({
  config,
  recordId,
}: {
  config: PaymentUi;
  recordId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const isView = Boolean(recordId);
  /** ?partyId= pre-selects the party, e.g. from the dashboard's aging table. */
  const presetPartyId = useSearchParams().get("partyId");

  const [parties, setParties] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState("");
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<string>("BANK");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  const [record, setRecord] = useState<PaymentRecord | null>(null);
  const [loading, setLoading] = useState(isView);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------------------------------------------- loading */

  const loadParties = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: PartyOption[] }>(`${config.partyApiPath}?pageSize=200&status=ACTIVE`);
      setParties(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not load ${config.partyLabel.toLowerCase()}s`);
    }
  }, [config.partyApiPath, config.partyLabel]);

  const loadRecord = useCallback(async () => {
    if (!recordId) return;
    // `loading` already starts true when viewing a record, so there is no
    // synchronous setState here — everything happens after the await.
    try {
      setRecord(await apiFetch<PaymentRecord>(`${config.apiPath}/${recordId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not load this ${config.singular.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [config.apiPath, config.singular, recordId]);

  useEffect(() => {
    // Fetch-on-mount: every setState below happens inside the loaders' async
    // bodies after an await, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isView) loadRecord();
    else loadParties();
  }, [isView, loadRecord, loadParties]);

  const loadOpenInvoices = useCallback(
    async (id: string) => {
      setLoadingInvoices(true);
      setError(null);
      try {
        const data = await apiFetch<{ items: OpenInvoice[] }>(
          `${config.apiPath}/outstanding?partyId=${encodeURIComponent(id)}`
        );
        setOpenInvoices(data.items);
        setAllocations({});
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load open invoices");
        setOpenInvoices([]);
      } finally {
        setLoadingInvoices(false);
      }
    },
    [config.apiPath]
  );

  function onPickParty(id: string) {
    setPartyId(id);
    setOpenInvoices([]);
    setAllocations({});
    if (id) loadOpenInvoices(id);
  }

  // Apply the pre-selected party once the list has loaded, if it's in it.
  const [presetApplied, setPresetApplied] = useState(false);
  useEffect(() => {
    if (isView || presetApplied || !presetPartyId || parties.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresetApplied(true);
    if (parties.some((p) => p.id === presetPartyId)) onPickParty(presetPartyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPickParty is a plain function; run once per load
  }, [parties, presetPartyId, isView, presetApplied]);

  /* ---------------------------------------------- allocation maths */

  const allocatedTotal = useMemo(
    () => Object.values(allocations).reduce((acc, v) => acc.plus(safeDecimal(v)), new Decimal(0)),
    [allocations]
  );
  const amountDecimal = safeDecimal(amount);
  const unallocated = amountDecimal.minus(allocatedTotal);
  const overAllocated = allocatedTotal.gt(amountDecimal);

  /** Fills the entry down the open invoices, oldest first. */
  function autoAllocate() {
    let left = amountDecimal;
    const next: Record<string, string> = {};
    for (const inv of openInvoices) {
      if (left.lte(0)) break;
      const take = Decimal.min(left, new Decimal(inv.dueAmount));
      if (take.gt(0)) {
        next[inv.id] = take.toFixed(2);
        left = left.minus(take);
      }
    }
    setAllocations(next);
  }

  const dirty = Boolean(partyId || amount || Object.keys(allocations).length > 0);
  useUnsavedChangesWarning(!isView && dirty && !submitting);

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (submitting || isView) return;

    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        documentDate,
        partyId,
        amount: amountDecimal.toFixed(2),
        mode,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
        allocations: Object.entries(allocations)
          .filter(([, v]) => safeDecimal(v).gt(0))
          .map(([invoiceId, v]) => ({ invoiceId, amount: safeDecimal(v).toFixed(2) })),
      };
      const created = await apiFetch<{ id: string; documentNumber?: string }>(config.apiPath, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success(`${config.singular} saved`, created.documentNumber);
      router.push(`${config.basePath}/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not save this ${config.singular.toLowerCase()}`);
      setSubmitting(false);
    }
  }

  useShortcutScope({
    onSave: isView ? undefined : () => handleSubmit(),
  });

  /* ---------------------------------------------- render */

  if (loading) {
    return <div className="cardBody">Loading…</div>;
  }

  if (isView && record) {
    return (
      <>
        <div className="pageHeader">
          <div>
            <div className="pageTitle">
              {config.singular} {record.documentNumber}
            </div>
            <div className="pageSubtitle">
              {new Date(record.documentDate).toLocaleDateString("en-GB")} &middot; {record.party.name} &middot;{" "}
              <span className={`badge ${record.status === "CONFIRMED" ? "badgeSuccess" : "badgeDanger"}`}>
                {record.status}
              </span>
            </div>
          </div>
          <div className="pageActions">
            <Button
              component={Link}
              href={config.basePath}
              variant="outlined"
              size="small"
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              Back to list
            </Button>
          </div>
        </div>

        {record.status === "CANCELLED" && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
            This entry was cancelled{record.cancellationReason ? `: ${record.cancellationReason}` : "."} The amounts
            below were returned to the invoices they had settled.
          </Alert>
        )}

        <div className="formCard">
          <div className="kpiGrid kpiGridCompact">
            <div className="kpiCard kpiCompact">
              <div className="kpiValue">₹{formatMoney(record.amount)}</div>
              <div className="kpiLabel">{config.amountLabel}</div>
            </div>
            <div className="kpiCard kpiCompact kpiTone-good">
              <div className="kpiValue">₹{formatMoney(record.allocatedAmount)}</div>
              <div className="kpiLabel">Settled against invoices</div>
            </div>
            <div
              className={`kpiCard kpiCompact ${Number(record.unallocatedAmount) > 0 ? "kpiTone-warn" : ""}`}
            >
              <div className="kpiValue">₹{formatMoney(record.unallocatedAmount)}</div>
              <div className="kpiLabel">Left on account</div>
            </div>
            <div className="kpiCard kpiCompact">
              <div className="kpiValue">{record.mode}</div>
              <div className="kpiLabel">Mode {record.referenceNumber ? `· ${record.referenceNumber}` : ""}</div>
            </div>
          </div>

          <div className="sectionLabel" style={{ marginTop: "1.5rem" }}>
            Settled against
          </div>
          {record.allocations.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Nothing was allocated — the full amount is sitting on account against {record.party.name}.
            </p>
          ) : (
            <table className="allocTable">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th style={{ textAlign: "right" }}>Amount applied</th>
                </tr>
              </thead>
              <tbody>
                {record.allocations.map((a) => (
                  <tr key={a.invoiceId}>
                    <td>
                      <Link href={`${config.invoiceBasePath}/${a.invoiceId}`} className="cellLink">
                        {a.invoiceNumber}
                      </Link>
                    </td>
                    <td style={{ textAlign: "right" }}>{formatMoney(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {record.notes && (
            <>
              <div className="sectionLabel" style={{ marginTop: "1.25rem" }}>
                Notes
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{record.notes}</p>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">New {config.singular}</h1>
          <div className="pageSubtitle">{config.partyHint}</div>
        </div>
        <div className="pageActions" style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            component={Link}
            href={config.basePath}
            variant="outlined"
            size="small"
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={submitting || !partyId || amountDecimal.lte(0) || overAllocated}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            title="Save (Ctrl + S)"
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {submitting ? "Saving…" : `Save ${config.singular.toLowerCase()}`}
          </Button>
        </div>
      </div>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      <div className="formCard">
        <div className="formGrid">
          <div className="field">
            <label htmlFor="pay-party">{config.partyLabel} *</label>
            <select
              id="pay-party"
              className="select"
              value={partyId}
              onChange={(e) => onPickParty(e.target.value)}
              required
            >
              <option value="">Select {config.partyLabel.toLowerCase()}</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pay-date">Date *</label>
            <input
              id="pay-date"
              className="input"
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="pay-amount">{config.amountLabel} *</label>
            <input
              id="pay-amount"
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="pay-mode">Mode</label>
            <select id="pay-mode" className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m] ?? m}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pay-ref">Reference no.</label>
            <input
              id="pay-ref"
              className="input"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Cheque / UTR / txn id"
            />
            <span className="hint">Optional</span>
          </div>

          <div className="field fieldSpanFull">
            <label htmlFor="pay-notes">Notes</label>
            <input id="pay-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="formCard" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div className="sectionLabel" style={{ margin: 0 }}>
            Settle against open invoices
          </div>
          <button
            type="button"
            className="button buttonSecondary"
            onClick={autoAllocate}
            disabled={openInvoices.length === 0 || amountDecimal.lte(0)}
            style={{ marginLeft: "auto" }}
            title="Apply the amount to the oldest invoices first"
          >
            Auto-allocate oldest first
          </button>
        </div>

        {!partyId && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
            Choose a {config.partyLabel.toLowerCase()} to see their open invoices.
          </p>
        )}

        {partyId && loadingInvoices && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
            Loading open invoices…
          </p>
        )}

        {partyId && !loadingInvoices && openInvoices.length === 0 && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
            This {config.partyLabel.toLowerCase()} has no open invoices. You can still record the entry — the whole
            amount will sit on account.
          </p>
        )}

        {openInvoices.length > 0 && (
          <table className="allocTable" style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Already paid</th>
                <th style={{ textAlign: "right" }}>Outstanding</th>
                <th style={{ textAlign: "right", width: "8rem" }}>Apply</th>
              </tr>
            </thead>
            <tbody>
              {openInvoices.map((inv) => {
                const applied = safeDecimal(allocations[inv.id] ?? "");
                const over = applied.gt(inv.dueAmount);
                return (
                  <tr key={inv.id}>
                    <td>{inv.documentNumber}</td>
                    <td>{inv.documentDate ? new Date(inv.documentDate).toLocaleDateString("en-GB") : "—"}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(inv.grandTotal)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(inv.paidAmount)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{formatMoney(inv.dueAmount)}</td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={allocations[inv.id] ?? ""}
                        placeholder="0.00"
                        style={over ? { borderColor: "var(--danger-solid)" } : undefined}
                        title={over ? `Cannot exceed the outstanding ${inv.dueAmount}` : undefined}
                        onChange={(e) =>
                          setAllocations((prev) => ({ ...prev, [inv.id]: e.target.value }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="allocSummary">
          <span>
            {config.amountLabel}: <strong>₹{formatMoney(amountDecimal.toFixed(2))}</strong>
          </span>
          <span>
            Allocated: <strong>₹{formatMoney(allocatedTotal.toFixed(2))}</strong>
          </span>
          <span className={overAllocated ? "allocOver" : undefined}>
            {overAllocated ? "Over-allocated by" : "Left on account"}:{" "}
            <strong>₹{formatMoney(unallocated.abs().toFixed(2))}</strong>
          </span>
        </div>

        {overAllocated && (
          <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2 }}>
            You have allocated more than the {config.singular.toLowerCase()} amount. Reduce the allocations or
            increase the amount.
          </Alert>
        )}
      </div>
    </form>
  );
}
