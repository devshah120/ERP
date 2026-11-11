"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import ItemLinesInput, { emptyItemLine, cleanLines, loadItemOptions, variantLabel, type ItemLine, type ItemOption } from "@/components/inventory/ItemLinesInput";
import { useWarehouses } from "@/components/forms/useWarehouses";
import { IconAlertCircle, IconArrowLeft } from "@/components/icons";

interface Formula {
  id: string;
  formulaCode: string;
  name: string;
  outputItemId: string;
  outputVariantSku?: string;
  outputQuantity: number;
  processingCost?: string;
  components: { itemId: string; variantSku?: string; quantity: number }[];
  kind: "BOM" | "RECIPE";
}

/** Round to 3 decimals — quantities in metres and kg, not floating-point noise. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export default function NewMaterialCreationPage() {
  const router = useRouter();
  const toast = useToast();
  const warehouses = useWarehouses();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [formulaId, setFormulaId] = useState("");
  const [runs, setRuns] = useState("1");
  const [warehouseId, setWarehouseId] = useState("");
  const [outputWarehouseId, setOutputWarehouseId] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [outputItemId, setOutputItemId] = useState("");
  const [outputVariantSku, setOutputVariantSku] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("1");
  const [processingCost, setProcessingCost] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([emptyItemLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadItemOptions().then(setItems).catch(() => setItems([]));
    Promise.all([
      apiFetch<{ items: Formula[] }>("/api/masters/bill-of-materials?pageSize=200&status=ACTIVE").catch(() => ({ items: [] })),
      apiFetch<{ items: Formula[] }>("/api/masters/recipes?pageSize=200&status=ACTIVE").catch(() => ({ items: [] })),
    ]).then(([b, r]) => setFormulas([...b.items, ...r.items]));
  }, []);

  useUnsavedChangesWarning(dirty && !saving);

  /** Loads a formula scaled by the number of runs. */
  function applyFormula(id: string, runCount: number) {
    const f = formulas.find((x) => x.id === id);
    if (!f) return;
    setOutputItemId(f.outputItemId);
    setOutputVariantSku(f.outputVariantSku ?? "");
    setOutputQuantity(String(r3(f.outputQuantity * runCount)));
    setProcessingCost(String(r3(Number(f.processingCost ?? 0) * runCount)));
    setLines(f.components.map((c) => ({ itemId: c.itemId, variantSku: c.variantSku ?? "", quantity: String(r3(c.quantity * runCount)) })));
  }

  const outputItem = useMemo(() => items.find((i) => i.id === outputItemId), [items, outputItemId]);
  const outputVariants = (outputItem?.variants ?? []).filter((v) => v.isActive !== false);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const doc = await apiFetch<{ id: string; entryNumber: string }>("/api/production/material-creation", {
        method: "POST",
        body: JSON.stringify({
          entryDate,
          warehouseId,
          outputWarehouseId: outputWarehouseId || undefined,
          formulaId: formulaId || undefined,
          runs: Number(runs) || 1,
          outputItemId,
          outputVariantSku: outputVariantSku || undefined,
          outputQuantity: Number(outputQuantity),
          processingCost,
          notes: notes || undefined,
          lines: cleanLines(lines),
        }),
      });
      setDirty(false);
      toast.success(`${doc.entryNumber} posted`);
      router.push(`/material-creation/${doc.id}`);
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
          <Link href="/material-creation" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Material Creation
          </Link>
        }
        title="New production"
        description="Components are issued at average cost; the product is received at their total plus processing cost."
      />
      <form onSubmit={submit} style={{ maxWidth: "62rem" }} onChange={() => setDirty(true)}>
        {error && (
          <div className="banner bannerError" role="alert" style={{ marginBottom: "1rem" }}>
            <IconAlertCircle />
            <span>{error}</span>
          </div>
        )}
        <section className="formSection">
          <div className="formSectionHead">
            <h2 className="formSectionTitle">Start from a formula</h2>
            <p className="formSectionDesc">Optional — fills the product and components from a bill of materials or recipe.</p>
          </div>
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="m-formula">Bill of materials / recipe</label>
                <select
                  id="m-formula"
                  className="select"
                  value={formulaId}
                  onChange={(e) => {
                    setFormulaId(e.target.value);
                    applyFormula(e.target.value, Number(runs) || 1);
                  }}
                >
                  <option value="">— none, enter manually —</option>
                  {formulas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.formulaCode} · {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-runs">Runs<span className="hint"> · multiplies the formula</span></label>
                <input
                  id="m-runs"
                  type="number"
                  min="0"
                  step="any"
                  className="input"
                  value={runs}
                  onChange={(e) => {
                    setRuns(e.target.value);
                    if (formulaId) applyFormula(formulaId, Number(e.target.value) || 1);
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="formSection">
          <div className="formSectionHead">
            <h2 className="formSectionTitle">Output</h2>
          </div>
          <div className="formSectionBody">
            <div className="formGrid">
              <div className="field">
                <label htmlFor="m-out">Product made<span className="req">*</span></label>
                <select id="m-out" className="select" value={outputItemId} onChange={(e) => (setOutputItemId(e.target.value), setOutputVariantSku(""))}>
                  <option value="">— choose —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.itemCode} · {i.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-var">Size / colour</label>
                <select id="m-var" className="select" value={outputVariantSku} disabled={outputVariants.length === 0} onChange={(e) => setOutputVariantSku(e.target.value)}>
                  <option value="">{outputVariants.length === 0 ? "No variants" : "— choose —"}</option>
                  {outputVariants.map((v) => <option key={v.sku} value={v.sku}>{variantLabel(v)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-qty">Quantity made<span className="req">*</span></label>
                <input id="m-qty" type="number" min="0" step="any" className="input" value={outputQuantity} onChange={(e) => setOutputQuantity(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="m-proc">Processing cost<span className="hint"> · labour, job work</span></label>
                <input id="m-proc" className="input" inputMode="decimal" value={processingCost} onChange={(e) => setProcessingCost(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="m-wh">Components from<span className="req">*</span></label>
                <select id="m-wh" className="select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">— choose —</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-owh">Finished goods to<span className="hint"> · defaults to the same warehouse</span></label>
                <select id="m-owh" className="select" value={outputWarehouseId} onChange={(e) => setOutputWarehouseId(e.target.value)}>
                  <option value="">Same warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-date">Date</label>
                <input id="m-date" type="date" className="input" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
            </div>
          </div>
        </section>

        <section className="formSection">
          <div className="formSectionHead">
            <h2 className="formSectionTitle">Components used</h2>
          </div>
          <div className="formSectionBody">
            <ItemLinesInput
              lines={lines}
              onChange={(l) => (setLines(l), setDirty(true))}
              addLabel="Add component"
              balance={warehouseId ? { kind: "material-creation", warehouseId } : undefined}
            />
            <div className="field" style={{ marginTop: "1rem" }}>
              <label htmlFor="m-notes">Notes</label>
              <textarea id="m-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </section>

        <div className="formActionsBar">
          <span className="formActionsNote">Ctrl + S to save</span>
          <Link href="/material-creation" className="button buttonSecondary">Cancel</Link>
          <button type="submit" className="button buttonPrimary" disabled={saving}>
            {saving && <span className="spinner" />} Post production
          </button>
        </div>
      </form>
    </>
  );
}
