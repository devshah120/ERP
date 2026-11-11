"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import ItemLinesInput, { emptyItemLine, cleanLines, type ItemLine } from "@/components/inventory/ItemLinesInput";
import { useWarehouses } from "@/components/forms/useWarehouses";
import { IconAlertCircle, IconArrowLeft } from "@/components/icons";

export default function NewTransferRequestPage() {
  const router = useRouter();
  const toast = useToast();
  const warehouses = useWarehouses();
  const [toWarehouseId, setTo] = useState("");
  const [fromWarehouseId, setFrom] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([emptyItemLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useUnsavedChangesWarning(dirty && !saving);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const doc = await apiFetch<{ id: string; requestNumber: string }>("/api/stock-transfer-requests", {
        method: "POST",
        body: JSON.stringify({ toWarehouseId, fromWarehouseId, requiredBy: requiredBy || undefined, notes: notes || undefined, lines: cleanLines(lines) }),
      });
      setDirty(false);
      toast.success(`Request ${doc.requestNumber} raised`);
      router.push(`/stock-transfer-requests/${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not raise the request");
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: () => void submit() });

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/stock-transfer-requests" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Stock Transfer Requests
          </Link>
        }
        title="New transfer request"
        description="Nothing moves yet — the supplying warehouse approves and fulfils the request."
      />
      <form onSubmit={submit} style={{ maxWidth: "62rem" }} onChange={() => setDirty(true)}>
        {error && (
          <div className="banner bannerError" role="alert" style={{ marginBottom: "1rem" }}>
            <IconAlertCircle />
            <span>{error}</span>
          </div>
        )}
        <section className="formSection">
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="r-to">Stock needed at<span className="req">*</span></label>
                <select id="r-to" className="select" value={toWarehouseId} onChange={(e) => setTo(e.target.value)}>
                  <option value="">— choose —</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="r-from">Request from<span className="req">*</span></label>
                <select id="r-from" className="select" value={fromWarehouseId} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">— choose —</option>
                  {warehouses.filter((w) => w.id !== toWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="r-by">Needed by<span className="hint"> · Optional</span></label>
                <input id="r-by" type="date" className="input" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
              </div>
              <div className="field fieldSpanFull">
                <label htmlFor="r-notes">Notes</label>
                <textarea id="r-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </div>
        </section>
        <section className="formSection">
          <div className="formSectionHead">
            <h2 className="formSectionTitle">Items</h2>
            <p className="formSectionDesc">On hand is shown for the warehouse you are requesting from.</p>
          </div>
          <div className="formSectionBody">
            <ItemLinesInput
              lines={lines}
              onChange={(l) => (setLines(l), setDirty(true))}
              balance={fromWarehouseId ? { kind: "stock-transfer-requests", warehouseId: fromWarehouseId } : undefined}
            />
          </div>
        </section>
        <div className="formActionsBar">
          <span className="formActionsNote">Ctrl + S to save</span>
          <Link href="/stock-transfer-requests" className="button buttonSecondary">Cancel</Link>
          <button type="submit" className="button buttonPrimary" disabled={saving}>
            {saving && <span className="spinner" />} Raise request
          </button>
        </div>
      </form>
    </>
  );
}
