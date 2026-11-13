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
import { formatMoney, formatQuantity } from "@/lib/format/number";
import { IconPlus, IconSave, IconClose, IconTrash } from "@/components/icons";

export type StockKind = "stock-adjustments" | "stock-transfers";

interface WarehouseOption {
  id: string;
  name: string;
}

interface BalanceRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  variantSku: string;
  quantity: number;
  unitCost: string;
  value: string;
}

interface Line {
  itemId: string;
  variantSku: string;
  /** Adjustment: the physical count. Transfer: the quantity to move. */
  quantity: string;
  note?: string;
}

interface StockRecord {
  id: string;
  documentNumber: string;
  documentDate: string;
  status: string;
  notes?: string;
  cancellationReason?: string;
  reason?: string;
  warehouseId?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  totalValueChange?: string;
  totalQuantity?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines: any[];
}

const REASONS = [
  { value: "PHYSICAL_COUNT", label: "Physical count" },
  { value: "DAMAGE", label: "Damage" },
  { value: "WASTAGE", label: "Wastage" },
  { value: "OPENING_STOCK", label: "Opening stock" },
  { value: "CORRECTION", label: "Correction" },
];

function safeNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Stock adjustment and stock transfer share this screen.
 *
 * The adjustment asks for the **counted** quantity, not a difference — the
 * person on the warehouse floor knows what is on the shelf, and asking them
 * to work out a delta is how miscounts get entered. The difference and its
 * value are derived and shown live before anything is posted.
 */
export default function StockDocumentFormView({
  kind,
  recordId,
}: {
  kind: StockKind;
  recordId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const isAdjustment = kind === "stock-adjustments";
  const isView = Boolean(recordId);
  const basePath = `/${kind}`;
  const label = isAdjustment ? "Stock Adjustment" : "Stock Transfer";

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [reason, setReason] = useState("PHYSICAL_COUNT");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const [record, setRecord] = useState<StockRecord | null>(null);
  const [loading, setLoading] = useState(isView);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadWarehouses = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: WarehouseOption[] }>(
        "/api/masters/warehouses?pageSize=100&status=ACTIVE"
      );
      setWarehouses(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load warehouses");
    }
  }, []);

  const loadRecord = useCallback(async () => {
    if (!recordId) return;
    try {
      setRecord(await apiFetch<StockRecord>(`/api/stock/${kind}/${recordId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this document");
    } finally {
      setLoading(false);
    }
  }, [kind, recordId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isView) loadRecord();
    else loadWarehouses();
  }, [isView, loadRecord, loadWarehouses]);

  /** On-hand stock for the chosen warehouse, so counts start from the truth. */
  const loadBalances = useCallback(
    async (id: string) => {
      setLoadingBalances(true);
      setError(null);
      try {
        const data = await apiFetch<{ items: BalanceRow[] }>(
          `/api/stock/${kind}/balance?warehouseId=${encodeURIComponent(id)}`
        );
        setBalances(data.items);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load stock for this warehouse");
        setBalances([]);
      } finally {
        setLoadingBalances(false);
      }
    },
    [kind]
  );

  function onPickWarehouse(id: string) {
    setWarehouseId(id);
    setLines([]);
    setBalances([]);
    if (id) loadBalances(id);
  }

  const balanceKey = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;
  const balanceMap = useMemo(
    () => new Map(balances.map((b) => [balanceKey(b.itemId, b.variantSku), b])),
    [balances]
  );

  const totals = useMemo(() => {
    let valueChange = new Decimal(0);
    let quantity = 0;
    let changed = 0;

    for (const line of lines) {
      const b = balanceMap.get(balanceKey(line.itemId, line.variantSku));
      if (!b) continue;
      if (isAdjustment) {
        const diff = safeNum(line.quantity) - b.quantity;
        if (diff !== 0) changed += 1;
        valueChange = valueChange.plus(new Decimal(b.unitCost).times(diff));
        quantity += diff;
      } else {
        const qty = safeNum(line.quantity);
        if (qty > 0) changed += 1;
        quantity += qty;
        valueChange = valueChange.plus(new Decimal(b.unitCost).times(qty));
      }
    }
    return { valueChange, quantity, changed };
  }, [lines, balanceMap, isAdjustment]);

  const dirty = lines.length > 0;
  useUnsavedChangesWarning(!isView && dirty && !submitting);

  function addLine(b: BalanceRow) {
    if (lines.some((l) => l.itemId === b.itemId && l.variantSku === b.variantSku)) return;
    setLines((rows) => [
      ...rows,
      {
        itemId: b.itemId,
        variantSku: b.variantSku,
        // Adjustment starts at the system figure, so an untouched row is a no-op.
        quantity: isAdjustment ? String(b.quantity) : "",
      },
    ]);
  }

  /** Pulls in every item held in the warehouse, for a full stocktake. */
  function addAll() {
    const existing = new Set(lines.map((l) => balanceKey(l.itemId, l.variantSku)));
    const next = balances
      .filter((b) => !existing.has(balanceKey(b.itemId, b.variantSku)))
      .map((b) => ({
        itemId: b.itemId,
        variantSku: b.variantSku,
        quantity: isAdjustment ? String(b.quantity) : "",
      }));
    setLines((rows) => [...rows, ...next]);
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (submitting || isView) return;

    const payloadLines = lines
      .filter((l) => l.itemId)
      .map((l) =>
        isAdjustment
          ? {
              itemId: l.itemId,
              variantSku: l.variantSku || undefined,
              countedQuantity: safeNum(l.quantity),
              note: l.note || undefined,
            }
          : {
              itemId: l.itemId,
              variantSku: l.variantSku || undefined,
              quantity: safeNum(l.quantity),
            }
      );

    if (payloadLines.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (!isAdjustment && payloadLines.some((l) => !("quantity" in l) || Number(l.quantity) <= 0)) {
      setError("Every transfer line needs a quantity greater than zero.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body = isAdjustment
        ? { documentDate, warehouseId, reason, notes: notes || undefined, lines: payloadLines }
        : {
            documentDate,
            fromWarehouseId: warehouseId,
            toWarehouseId,
            notes: notes || undefined,
            lines: payloadLines,
          };
      const doc = await apiFetch<{ id: string; documentNumber?: string }>(`/api/stock/${kind}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(`${label} saved`, doc.documentNumber);
      router.push(`${basePath}/${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not save this ${label.toLowerCase()}`);
      setSubmitting(false);
    }
  }

  useShortcutScope({ onSave: isView ? undefined : () => handleSubmit() });

  async function runCancel(cancelReason?: string) {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const qs = cancelReason ? `?reason=${encodeURIComponent(cancelReason)}` : "";
      await apiFetch(`/api/stock/${kind}/${recordId}${qs}`, { method: "DELETE" });
      setCancelOpen(false);
      toast.success(`${label} cancelled`);
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
            {label} {record.documentNumber}
            <span
              className={`badge ${
                record.status === "CANCELLED" ? "badgeDanger" : "badgeSuccess"
              }`}
            >
              {record.status}
            </span>
          </div>
          <div className="docTopActions" style={{ display: "flex", gap: "0.5rem" }}>
            {record.status !== "CANCELLED" && (
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
              href={basePath}
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
            Cancelled{record.cancellationReason ? `: ${record.cancellationReason}` : "."} Offsetting stock
            entries were written, so the ledger still explains how the balance got where it is.
          </Alert>
        )}

        <div className="docHeadGrid">
          <div className="docHeadField">
            <label>Date</label>
            <input
              className="input docReadonly"
              value={new Date(record.documentDate).toLocaleDateString("en-GB")}
              readOnly
            />
          </div>
          {isAdjustment ? (
            <div className="docHeadField">
              <label>Reason</label>
              <input className="input docReadonly" value={record.reason ?? "—"} readOnly />
            </div>
          ) : (
            <div className="docHeadField">
              <label>Quantity moved</label>
              <input className="input docReadonly" value={formatQuantity(record.totalQuantity ?? 0)} readOnly />
            </div>
          )}
          {isAdjustment && (
            <div className="docHeadField">
              <label>Value change</label>
              <input className="input docReadonly" value={formatMoney(record.totalValueChange ?? "0")} readOnly />
            </div>
          )}
        </div>

        <div className="docTabPanel" style={{ borderRadius: "10px", borderTop: "1px solid var(--card-border)" }}>
          <table className="docLinesTable">
            <thead>
              {isAdjustment ? (
                <tr>
                  <th>Code</th>
                  <th>Item</th>
                  <th>Variant</th>
                  <th className="numCell">System</th>
                  <th className="numCell">Counted</th>
                  <th className="numCell">Difference</th>
                  <th className="numCell">Unit Cost</th>
                  <th className="numCell">Value Change</th>
                </tr>
              ) : (
                <tr>
                  <th>Code</th>
                  <th>Item</th>
                  <th>Variant</th>
                  <th className="numCell">Quantity</th>
                  <th className="numCell">Unit Cost</th>
                </tr>
              )}
            </thead>
            <tbody>
              {record.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.itemCode}</td>
                  <td>{l.itemName}</td>
                  <td className="docLineMeta">{l.variantSku ?? "—"}</td>
                  {isAdjustment ? (
                    <>
                      <td className="numCell">{formatQuantity(l.systemQuantity)}</td>
                      <td className="numCell">{formatQuantity(l.countedQuantity)}</td>
                      <td className={`numCell ${l.differenceQuantity < 0 ? "stockLoss" : "stockGain"}`}>
                        {l.differenceQuantity > 0 ? "+" : ""}
                        {formatQuantity(l.differenceQuantity)}
                      </td>
                      <td className="numCell">{formatMoney(l.unitCost)}</td>
                      <td className="numCell">{formatMoney(l.valueChange)}</td>
                    </>
                  ) : (
                    <>
                      <td className="numCell">{formatQuantity(l.quantity)}</td>
                      <td className="numCell">{formatMoney(l.unitCost)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {record.notes && (
            <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              <strong>Notes:</strong> {record.notes}
            </p>
          )}
        </div>

        {cancelOpen && (
          <ConfirmDialog
            title={`Cancel this ${label.toLowerCase()}?`}
            message={`${record.documentNumber} will be reversed with offsetting stock entries${
              isAdjustment ? ", and its journal entry will be reversed too" : ""
            }. Nothing is deleted.`}
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
        <div className="docTopTitle">New {label}</div>
        <div className="docTopActions" style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={submitting || lines.length === 0 || (!isAdjustment && !toWarehouseId)}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <IconSave />}
            title="Save (Ctrl + S)"
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {submitting ? "Posting…" : isAdjustment ? "Post adjustment" : "Complete transfer"}
          </Button>
          <Button
            component={Link}
            href={basePath}
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
          <label htmlFor="s-warehouse">
            {isAdjustment ? "Warehouse" : "From warehouse"}
            <span className="req">*</span>
          </label>
          <select
            id="s-warehouse"
            className="select"
            value={warehouseId}
            onChange={(e) => onPickWarehouse(e.target.value)}
            required
          >
            <option value="">-- Select --</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {!isAdjustment && (
          <div className="docHeadField">
            <label htmlFor="s-to">
              To warehouse<span className="req">*</span>
            </label>
            <select
              id="s-to"
              className="select"
              value={toWarehouseId}
              onChange={(e) => setToWarehouseId(e.target.value)}
              required
            >
              <option value="">-- Select --</option>
              {warehouses
                .filter((w) => w.id !== warehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="docHeadField">
          <label htmlFor="s-date">
            Date<span className="req">*</span>
          </label>
          <input
            id="s-date"
            className="input"
            type="date"
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
            required
          />
        </div>

        {isAdjustment && (
          <div className="docHeadField">
            <label htmlFor="s-reason">Reason</label>
            <select id="s-reason" className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="docTabPanel" style={{ borderRadius: "10px", borderTop: "1px solid var(--card-border)" }}>
        {!warehouseId && (
          <p className="docTabEmpty">
            Choose a warehouse to see what it currently holds.
          </p>
        )}
        {warehouseId && loadingBalances && <p className="docTabEmpty">Loading stock…</p>}
        {warehouseId && !loadingBalances && balances.length === 0 && (
          <p className="docTabEmpty">This warehouse holds no stock yet.</p>
        )}

        {balances.length > 0 && (
          <>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.9rem" }}>
              <select
                className="select"
                value=""
                onChange={(e) => {
                  const b = balanceMap.get(e.target.value);
                  if (b) addLine(b);
                }}
                style={{ minWidth: "20rem" }}
              >
                <option value="">— add an item —</option>
                {balances.map((b) => (
                  <option key={balanceKey(b.itemId, b.variantSku)} value={balanceKey(b.itemId, b.variantSku)}>
                    {b.itemCode} · {b.itemName}
                    {b.variantSku ? ` (${b.variantSku})` : ""} — {formatQuantity(b.quantity)} on hand
                  </option>
                ))}
              </select>
              <button type="button" className="button buttonSecondary" onClick={addAll}>
                <IconPlus /> Add all {balances.length} items
              </button>
            </div>

            <table className="docLinesTable">
              <thead>
                {isAdjustment ? (
                  <tr>
                    <th style={{ width: "3rem" }}>#</th>
                    <th>Item</th>
                    <th className="numCell" style={{ width: "7rem" }}>System</th>
                    <th style={{ width: "8rem" }}>Counted</th>
                    <th className="numCell" style={{ width: "7rem" }}>Difference</th>
                    <th className="numCell" style={{ width: "8rem" }}>Value</th>
                    <th>Note</th>
                    <th style={{ width: "2.5rem" }} />
                  </tr>
                ) : (
                  <tr>
                    <th style={{ width: "3rem" }}>#</th>
                    <th>Item</th>
                    <th className="numCell" style={{ width: "8rem" }}>Available</th>
                    <th style={{ width: "8rem" }}>Transfer qty</th>
                    <th style={{ width: "2.5rem" }} />
                  </tr>
                )}
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={isAdjustment ? 8 : 5}>
                      <div className="tableEmpty">No items added yet.</div>
                    </td>
                  </tr>
                )}
                {lines.map((line, index) => {
                  const b = balanceMap.get(balanceKey(line.itemId, line.variantSku));
                  if (!b) return null;
                  const counted = safeNum(line.quantity);
                  const diff = counted - b.quantity;
                  const valueChange = new Decimal(b.unitCost).times(isAdjustment ? diff : counted);
                  const overAvailable = !isAdjustment && counted > b.quantity;

                  return (
                    <tr key={balanceKey(line.itemId, line.variantSku)}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="docLineItem">
                          <strong>{b.itemName}</strong>
                          <span className="docLineMeta">
                            {b.itemCode}
                            {b.variantSku ? ` · ${b.variantSku}` : ""}
                          </span>
                        </div>
                      </td>
                      <td className="numCell">{formatQuantity(b.quantity)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, quantity: e.target.value } : r))
                            )
                          }
                          style={overAvailable ? { borderColor: "var(--danger-solid)" } : undefined}
                          title={overAvailable ? `Only ${b.quantity} available` : undefined}
                        />
                      </td>
                      {isAdjustment && (
                        <>
                          <td className={`numCell ${diff < 0 ? "stockLoss" : diff > 0 ? "stockGain" : ""}`}>
                            {diff > 0 ? "+" : ""}
                            {formatQuantity(diff)}
                          </td>
                          <td className="numCell">{formatMoney(valueChange.toFixed(2))}</td>
                          <td>
                            <input
                              value={line.note ?? ""}
                              onChange={(e) =>
                                setLines((rows) =>
                                  rows.map((r, i) => (i === index ? { ...r, note: e.target.value } : r))
                                )
                              }
                              placeholder="Optional"
                            />
                          </td>
                        </>
                      )}
                      <td>
                        <button
                          type="button"
                          onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                          className="rowRemoveBtn"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="allocSummary">
              <span>
                Lines: <strong>{lines.length}</strong>
              </span>
              <span>
                {isAdjustment ? "Lines with a difference" : "Items to move"}: <strong>{totals.changed}</strong>
              </span>
              <span>
                {isAdjustment ? "Net quantity change" : "Total quantity"}:{" "}
                <strong>{formatQuantity(totals.quantity)}</strong>
              </span>
              {isAdjustment && (
                <span className={totals.valueChange.lt(0) ? "allocOver" : undefined}>
                  Value effect: <strong>₹{formatMoney(totals.valueChange.toFixed(2))}</strong>
                </span>
              )}
            </div>

            {isAdjustment && totals.changed === 0 && lines.length > 0 && (
              <div className="banner bannerLocked" style={{ marginTop: "0.9rem" }}>
                Every counted quantity matches the system, so there is nothing to post yet.
              </div>
            )}
          </>
        )}

        <div className="field" style={{ marginTop: "1rem" }}>
          <label htmlFor="s-notes">Notes</label>
          <textarea
            id="s-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </form>
  );
}
