"use client";

import { use, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../../AuthProvider";
import DetailShell, { DetailGrid, Panel, fmtDate, type Rec } from "@/components/detail/DetailShell";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { formatQuantity } from "@/lib/format/number";

type Action = "approve" | "reject" | "fulfil";

export default function TransferRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState<{ action: Action; reload: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/stock-transfer-requests/${id}`, { method: "POST", body: JSON.stringify({ action: pending.action, reason }) });
      toast.success(pending.action === "fulfil" ? "Stock transferred" : pending.action === "approve" ? "Request approved" : "Request rejected");
      pending.reload();
      setPending(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const canApprove = hasPermission("stock-transfer-requests.approve");
  const canFulfil = canApprove && hasPermission("stock-transfers.create");

  const actions = (r: Rec, reload: () => void) => (
    <>
      {r.status === "REQUESTED" && canApprove && (
        <>
          <button type="button" className="button buttonSecondary" onClick={() => setPending({ action: "reject", reload })}>
            Reject
          </button>
          <button type="button" className="button buttonPrimary" onClick={() => setPending({ action: "approve", reload })}>
            Approve
          </button>
        </>
      )}
      {r.status === "APPROVED" && canFulfil && (
        <button type="button" className="button buttonPrimary" onClick={() => setPending({ action: "fulfil", reload })}>
          Fulfil — transfer stock
        </button>
      )}
    </>
  );

  return (
    <>
      <DetailShell
        apiPath={`/api/stock-transfer-requests/${id}`}
        backHref="/stock-transfer-requests"
        backLabel="Stock Transfer Requests"
        title={(r) => <span className="cellMono">{String(r.requestNumber)}</span>}
        description={(r) => `${String(r.toWarehouseName)} needs stock from ${String(r.fromWarehouseName)}`}
        cancel={{
          permission: "stock-transfer-requests.cancel",
          when: (r) => r.status === "REQUESTED" || r.status === "APPROVED",
          label: "Cancel request",
          message: "No stock has moved, so nothing needs reversing.",
          path: "",
        }}
        actions={actions}
      >
        {(r) => (
          <>
            <Panel title="Request">
              <DetailGrid
                items={[
                  { label: "Date", value: fmtDate(r.requestDate) },
                  { label: "Needed at", value: String(r.toWarehouseName ?? "—") },
                  { label: "Requested from", value: String(r.fromWarehouseName ?? "—") },
                  { label: "Needed by", value: r.requiredBy ? fmtDate(r.requiredBy) : null },
                  { label: "Approved", value: r.approvedAt ? fmtDate(r.approvedAt, true) : null },
                  {
                    label: "Stock transfer",
                    value: r.transferId ? (
                      <Link href={`/stock-transfers/${String(r.transferId)}`} className="textLink cellMono">
                        {String(r.transferNumber)}
                      </Link>
                    ) : null,
                  },
                ]}
              />
              {typeof r.notes === "string" && r.notes && <p className="fieldHint" style={{ marginTop: "0.75rem" }}>{r.notes}</p>}
              {typeof r.rejectionReason === "string" && <div className="banner bannerWarning" style={{ marginTop: "0.75rem" }}>Rejected — {r.rejectionReason}</div>}
              {typeof r.cancellationReason === "string" && <div className="banner bannerWarning" style={{ marginTop: "0.75rem" }}>Cancelled — {r.cancellationReason}</div>}
            </Panel>
            <Panel title="Items">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Variant</th>
                    <th className="numCell">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.lines as Rec[]).map((l, i) => (
                    <tr key={i}>
                      <td className="cellPrimary">
                        {String(l.itemName)} <span className="cellSub">{String(l.itemCode)}</span>
                      </td>
                      <td className="cellMono">{String(l.variantSku ?? "—")}</td>
                      <td className="numCell">{formatQuantity(String(l.quantity))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </>
        )}
      </DetailShell>
      {pending && (
        <ConfirmDialog
          title={pending.action === "fulfil" ? "Transfer the stock now?" : pending.action === "approve" ? "Approve this request?" : "Reject this request?"}
          message={
            pending.action === "fulfil"
              ? "A stock transfer is raised for every line. If the supplying warehouse is short on any item, nothing moves and the request stays approved."
              : pending.action === "approve"
                ? "The supplying warehouse can then fulfil it."
                : "The requester will see the reason."
          }
          confirmLabel={pending.action === "fulfil" ? "Transfer stock" : pending.action === "approve" ? "Approve" : "Reject"}
          tone={pending.action === "reject" ? "danger" : "primary"}
          requireReason={pending.action === "reject"}
          busy={busy}
          error={error}
          onCancel={() => (setPending(null), setError(null))}
          onConfirm={run}
        />
      )}
    </>
  );
}
