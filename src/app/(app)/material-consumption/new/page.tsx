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

export default function NewConsumptionPage() {
  const router = useRouter();
  const toast = useToast();
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purpose, setPurpose] = useState("");
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
      const doc = await apiFetch<{ id: string; entryNumber: string }>("/api/production/material-consumption", {
        method: "POST",
        body: JSON.stringify({ warehouseId, entryDate, purpose: purpose || undefined, notes: notes || undefined, lines: cleanLines(lines) }),
      });
      setDirty(false);
      toast.success(`${doc.entryNumber} posted`);
      router.push(`/material-consumption/${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post the entry");
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: () => void submit() });

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/material-consumption" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Material Consumption
          </Link>
        }
        title="Issue materials"
        description="Stock goes out at its average cost and the value is written off to Materials Consumed."
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
                <label htmlFor="c-wh">Warehouse<span className="req">*</span></label>
                <select id="c-wh" className="select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">— choose —</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-date">Date</label>
                <input id="c-date" type="date" className="input" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="c-purpose">Purpose<span className="hint"> · Optional</span></label>
                <input id="c-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Sampling, finishing, repairs…" />
              </div>
              <div className="field fieldSpanFull">
                <label htmlFor="c-notes">Notes</label>
                <textarea id="c-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </div>
        </section>
        <section className="formSection">
          <div className="formSectionHead">
            <h2 className="formSectionTitle">Materials</h2>
          </div>
          <div className="formSectionBody">
            <ItemLinesInput
              lines={lines}
              onChange={(l) => (setLines(l), setDirty(true))}
              addLabel="Add material"
              balance={warehouseId ? { kind: "material-consumption", warehouseId } : undefined}
            />
          </div>
        </section>
        <div className="formActionsBar">
          <span className="formActionsNote">Ctrl + S to save</span>
          <Link href="/material-consumption" className="button buttonSecondary">Cancel</Link>
          <button type="submit" className="button buttonPrimary" disabled={saving}>
            {saving && <span className="spinner" />} Post issue
          </button>
        </div>
      </form>
    </>
  );
}
