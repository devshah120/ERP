"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import type { LayoutId } from "@/lib/printFormats/catalog";
import { fromPosOrder, type PosTextOptions, type PrintBusiness } from "@/components/print/model";
import { PrintPortal, ScaledSheet, printPortal } from "@/components/print/PrintArea";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { SkeletonBlock } from "@/components/ui/States";
import { IconAlertCircle, IconArrowLeft, IconEye, IconPrint, IconRefresh, IconSearch } from "@/components/icons";

interface BillRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerName?: string;
  customerPhone?: string;
  itemCount: number;
  paymentModes: string;
  cashierName: string;
  status: string;
  refundedAmount?: string;
  totals: { grandTotal: string };
}

interface BillPage {
  items: BillRow[];
  total: number;
  salesTotal: string;
}

const PRINT_ID = "bills";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Today's bills, opened from the register so the cashier never leaves the
 * counter: search, view any bill in the chosen print format and reprint it.
 */
export default function TodaysBillsDialog({
  registerId,
  layoutId,
  business,
  text,
  onClose,
}: {
  registerId: string;
  layoutId: LayoutId;
  business: PrintBusiness;
  text: PosTextOptions;
  onClose: () => void;
}) {
  // Local midnight, fixed for this opening of the dialog.
  const [since] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  });
  const [scope, setScope] = useState<"COUNTER" | "ALL">("COUNTER");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<BillPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One bill opened inside the dialog (view / reprint).
  const [bill, setBill] = useState<Record<string, unknown> | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [printPending, setPrintPending] = useState(false);
  // Reprint straight from the list: print, then stay on the list.
  const [printOnly, setPrintOnly] = useState(false);

  // Debounce typing so each keystroke isn't a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ fromDate: since, page: String(page), pageSize: String(pageSize) });
    if (query) params.set("query", query);
    if (scope === "COUNTER") params.set("registerId", registerId);
    apiFetch<BillPage>(`/api/pos/orders?${params}`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load bills"));
    return () => {
      cancelled = true;
    };
  }, [since, page, pageSize, query, scope, registerId, reload]);

  const model = useMemo(() => (bill ? fromPosOrder(bill, business, text) : null), [bill, business, text]);

  async function openBill(id: string, print: boolean) {
    setOpening(id);
    try {
      setBill(await apiFetch<Record<string, unknown>>(`/api/pos/orders/${id}`));
      setPrintPending(print);
      setPrintOnly(print);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the bill");
    } finally {
      setOpening(null);
    }
  }

  // Print once the bill's print copy has rendered.
  useEffect(() => {
    if (!model || !printPending) return;
    const t = setTimeout(() => {
      printPortal(PRINT_ID);
      setPrintPending(false);
      if (printOnly) {
        setPrintOnly(false);
        setBill(null);
      }
    }, 80);
    return () => clearTimeout(t);
  }, [model, printPending, printOnly]);

  const viewing = Boolean(bill && !printOnly);

  return (
    <Modal
      title={viewing && model ? `Bill ${model.number}` : "Today's bills"}
      subtitle={
        viewing && model
          ? `${new Date(model.date).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${model.party?.name ?? ""}`
          : `${new Date(since).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" })} · ${scope === "COUNTER" ? "this counter" : "all counters"}`
      }
      // Escape / × from a bill goes back to the list first.
      onClose={viewing ? () => setBill(null) : onClose}
      width={viewing ? "34rem" : "74rem"}
      footer={
        viewing ? (
          <div style={{ display: "flex", gap: "0.5rem", width: "100%" }}>
            <button type="button" className="button buttonSecondary" onClick={() => setBill(null)}>
              <IconArrowLeft /> Back to bills
            </button>
            <button type="button" className="button buttonPrimary" style={{ marginLeft: "auto" }} onClick={() => printPortal(PRINT_ID)} autoFocus>
              <IconPrint /> Print
            </button>
          </div>
        ) : undefined
      }
    >
      {viewing && model ? (
        <div className="pfmPreviewStage" style={{ maxHeight: "62vh" }}>
          <ScaledSheet layoutId={layoutId} model={model} width={440} />
        </div>
      ) : (
        <div className="posBills">
          <div className="posBillsBar">
            <div className="posxSearch posBillsSearch">
              <IconSearch />
              <input
                autoFocus
                placeholder="Search bill number, customer or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search today's bills"
              />
            </div>
            <div className="pfmChips" role="group" aria-label="Which counters">
              <button type="button" className="pfmChip" aria-pressed={scope === "COUNTER"} onClick={() => (setScope("COUNTER"), setPage(1))}>
                This counter
              </button>
              <button type="button" className="pfmChip" aria-pressed={scope === "ALL"} onClick={() => (setScope("ALL"), setPage(1))}>
                All counters
              </button>
            </div>
            <button type="button" className="button buttonSecondary buttonIcon" onClick={() => setReload((n) => n + 1)} title="Refresh" aria-label="Refresh">
              <IconRefresh />
            </button>
          </div>

          {error && (
            <div className="banner bannerError" role="alert">
              <IconAlertCircle />
              <span>{error}</span>
            </div>
          )}

          {!data && !error ? (
            <SkeletonBlock lines={6} />
          ) : data && data.items.length === 0 ? (
            <div className="posBillsEmpty">{query ? `No bill today matches “${query}”.` : "No bills yet today."}</div>
          ) : data ? (
            <div className="tableWrap posBillsTable">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Bill No</th>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Mobile</th>
                    <th className="num">Qty</th>
                    <th className="num">Total</th>
                    <th>Paid by</th>
                    <th>Cashier</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b, i) => (
                    <tr key={b.id}>
                      <td className="cellMuted">{(page - 1) * pageSize + i + 1}</td>
                      <td>
                        <button type="button" className="textLink cellMono" onClick={() => openBill(b.id, false)}>
                          {b.orderNumber}
                        </button>
                      </td>
                      <td className="tabular">{time(b.orderDate)}</td>
                      <td>{b.customerName || "Walk-in customer"}</td>
                      <td className="tabular">{b.customerPhone || <span className="cellMuted">—</span>}</td>
                      <td className="num">{formatQuantity(b.itemCount)}</td>
                      <td className="num">
                        ₹{formatMoney(b.totals.grandTotal)}
                        {Number(b.refundedAmount) > 0 && <div className="cellMuted">−₹{formatMoney(String(b.refundedAmount))} refunded</div>}
                      </td>
                      <td>{b.paymentModes || "—"}</td>
                      <td>{b.cashierName}</td>
                      <td>
                        <StatusBadge status={b.status} />
                      </td>
                      <td>
                        <div className="posBillsActions">
                          <button
                            type="button"
                            className="button buttonGhost buttonIcon buttonSm"
                            onClick={() => openBill(b.id, false)}
                            disabled={opening !== null}
                            title="View bill"
                            aria-label={`View ${b.orderNumber}`}
                          >
                            <IconEye />
                          </button>
                          <button
                            type="button"
                            className="button buttonGhost buttonIcon buttonSm"
                            onClick={() => openBill(b.id, true)}
                            disabled={opening !== null}
                            title="Reprint"
                            aria-label={`Reprint ${b.orderNumber}`}
                          >
                            {opening === b.id ? <span className="spinner" /> : <IconPrint />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {data && data.total > 0 && (
            <div className="posBillsFoot">
              <span>
                Sales {scope === "COUNTER" ? "on this counter" : "today"}: <strong>₹{formatMoney(data.salesTotal)}</strong>
              </span>
              <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={(n) => (setPageSize(n), setPage(1))} />
            </div>
          )}
        </div>
      )}

      {model && <PrintPortal id={PRINT_ID} layoutId={layoutId} model={model} />}
    </Modal>
  );
}
