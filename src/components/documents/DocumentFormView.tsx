"use client";

import { useEffect, useState, useCallback, useRef, useMemo, type FormEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { computeLine, computeTotals } from "@/lib/documents/totals";
import StatusBadge, { humanizeStatus } from "@/components/ui/StatusBadge";
import { getDocumentUi, submitActionLabel, type DocumentUi } from "@/lib/documents/ui";
import { determineSupply, stateTaxLabel } from "@/lib/gst/supply";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import EmailDialog from "@/components/documents/EmailDialog";
import MassDiscountDialog from "@/components/documents/MassDiscountDialog";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { buildFormLayout, type FormTabKey } from "@/lib/documents/formLayout";
import type { FieldConfig } from "@/lib/resources/ui/types";
import {
  IconPlus,
  IconPrint,
  IconMail,
  IconSearch,
  IconInfo,
  IconMenu,
  IconSave,
  IconClose,
  IconLock,
  IconPercent,
  IconCopy,
  IconChevronDown,
  IconChevronUp,
} from "@/components/icons";

interface LineRow {
  itemId: string;
  itemName?: string;
  itemCode?: string;
  unitName?: string;
  variantSku?: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  taxRatePercent: string;
}

interface TransitionRule {
  to: string;
  label: string;
  requiresReason?: boolean;
  intent?: "primary" | "danger" | "neutral";
}

interface DocRecord {
  id: string;
  documentNumber: string;
  documentDate: string;
  status: string;
  customerId?: string;
  vendorId?: string;
  customer?: { name: string; code: string };
  vendor?: { name: string; code: string };
  lines: Record<string, unknown>[];
  totals: Record<string, string>;
  sourceDocuments?: { docType: string; docId: string; docNumber: string }[];
  availableTransitions?: TransitionRule[];
  canEdit?: boolean;
  [key: string]: unknown;
}

interface PartyOption {
  id: string;
  name: string;
  customerCode?: string;
  vendorCode?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  creditDays?: number;
  billingAddress?: { city?: string; state?: string };
  shippingAddress?: { state?: string };
}

interface ItemOption {
  id: string;
  itemCode: string;
  name: string;
  sellingPrice: string;
  purchasePrice: string;
  taxRatePercent: number;
  unitId?: string;
  hsnCode?: string;
  variants?: { sku: string; color?: string; size?: string }[];
}

const emptyQuick = { itemId: "", variantSku: "", quantity: "1", rate: "" };

export default function DocumentFormView({ config, recordId }: { config: DocumentUi; recordId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const isEdit = Boolean(recordId);
  /** Copy: prefill a brand-new draft from an existing document of this type. */
  const copyFromId = searchParams.get("copyFrom");

  const [parties, setParties] = useState<PartyOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [referenceOptions, setReferenceOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  const [customerId, setCustomerId] = useState("");
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<LineRow[]>([]);
  const [shippingCharge, setShippingCharge] = useState("0");
  const [notes, setNotes] = useState("");

  const [record, setRecord] = useState<DocRecord | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<TransitionRule | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [dirty, setDirty] = useState(false);

  // --- layout state ----------------------------------------------------
  const [activeTab, setActiveTab] = useState<FormTabKey>("items");
  const [quick, setQuick] = useState(emptyQuick);
  const [showMassDiscount, setShowMassDiscount] = useState(false);
  const [sendOnSave, setSendOnSave] = useState(false);
  const [showPartyInfo, setShowPartyInfo] = useState(false);
  const [footerOpen, setFooterOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const quickItemRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onAway(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onAway);
    return () => document.removeEventListener("mousedown", onAway);
  }, [menuOpen]);

  // --- option lists -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ items: PartyOption[] }>(`${config.partyApiPath}?pageSize=200&status=ACTIVE`),
      apiFetch<{ items: ItemOption[] }>("/api/masters/items?pageSize=200&status=ACTIVE"),
      apiFetch<{ items: { id: string; unitCode: string; name: string }[] }>(
        "/api/masters/units?pageSize=200&status=ACTIVE"
      ),
    ])
      .then(([c, i, u]) => {
        if (cancelled) return;
        setParties(c.items);
        setItems(i.items);
        setUnits(Object.fromEntries(u.items.map((x) => [x.id, x.unitCode || x.name])));
      })
      .catch((err) => {
        // Never swallow this: an empty picker with no explanation is
        // indistinguishable from "no master data exists", which is exactly
        // how the customer-dropdown bug stayed hidden.
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? `Could not load ${config.partyLabel.toLowerCase()} / item lists: ${err.message}`
              : `Could not load ${config.partyLabel.toLowerCase()} / item lists.`
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  useEffect(() => {
    const refFields = config.extraFields.filter((f) => f.type === "reference" && f.reference);
    if (refFields.length === 0) return;
    let cancelled = false;

    Promise.all(
      refFields.map(async (f) => {
        const res = await apiFetch<{ items: Record<string, unknown>[] }>(
          `/api/masters/${f.reference!.resource}?pageSize=200&status=ACTIVE`
        );
        return [
          f.name,
          res.items.map((i) => ({ value: String(i.id), label: String(i[f.reference!.labelField] ?? i.id) })),
        ] as const;
      })
    )
      .then((entries) => {
        if (!cancelled) setReferenceOptions(Object.fromEntries(entries));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? `Could not load selection lists: ${err.message}` : "Could not load selection lists."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  /** Converts an API line into the editable row shape. */
  const toRow = useCallback(
    (l: Record<string, unknown>): LineRow => ({
      itemId: String(l.itemId),
      itemName: String(l.itemName ?? ""),
      itemCode: String(l.itemCode ?? ""),
      unitName: l.unitName ? String(l.unitName) : undefined,
      variantSku: l.variantSku ? String(l.variantSku) : undefined,
      quantity: String(l.quantity),
      rate: String(l.rate),
      discountPercent: String(l.discountPercent ?? 0),
      taxRatePercent: String(l.taxRatePercent ?? 0),
    }),
    []
  );

  // --- load existing document ------------------------------------------
  const loadRecord = useCallback(async () => {
    if (!recordId) return;
    try {
      const doc = await apiFetch<DocRecord>(`${config.apiPath}/${recordId}`);
      setRecord(doc);
      setCustomerId(String(doc[config.partyIdField]));
      setDocumentDate(String(doc.documentDate).slice(0, 10));
      setShippingCharge(String(doc.totals?.shippingCharge ?? "0"));
      setNotes(String(doc.notes ?? ""));
      setLines(doc.lines.map(toRow));

      const nextExtras: Record<string, string> = {};
      for (const f of config.extraFields) {
        const v = doc[f.name];
        if (v !== undefined && v !== null) {
          nextExtras[f.name] =
            f.name.toLowerCase().includes("date") || f.name === "validUntil" ? String(v).slice(0, 10) : String(v);
        }
      }
      setExtras(nextExtras);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, [config, recordId, toRow]);

  /**
   * Copy: prefills a brand-new draft from an existing document.
   *
   * Lines, party and terms carry over; the document number, date, status and
   * fulfilment counters deliberately do not — a copy is a new document, not a
   * duplicate of an issued one.
   */
  const loadCopySource = useCallback(async () => {
    if (!copyFromId || isEdit) return;
    try {
      const doc = await apiFetch<DocRecord>(`${config.apiPath}/${copyFromId}`);
      setCustomerId(String(doc[config.partyIdField]));
      setShippingCharge(String(doc.totals?.shippingCharge ?? "0"));
      setNotes(String(doc.notes ?? ""));
      setLines(doc.lines.map(toRow));
      setSuccess(`Copied from ${String(doc.documentNumber)} — review and save to create a new draft.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the document to copy");
    }
  }, [config, copyFromId, isEdit, toRow]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRecord();
  }, [loadRecord]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCopySource();
  }, [loadCopySource]);

  // A brand-new document starts with the Sales / Purchase Settings defaults
  // (due date, validity, payment terms, notes) and the default terms template.
  useEffect(() => {
    if (isEdit || copyFromId) return;
    let cancelled = false;
    apiFetch<Record<string, string>>(`/api/settings/document-defaults?docType=${config.key}`)
      .then((defaults) => {
        if (cancelled) return;
        const { notes: defaultNotes, ...rest } = defaults;
        const known = new Set(config.extraFields.map((f) => f.name));
        setExtras((x) => {
          const next = { ...x };
          for (const [k, v] of Object.entries(rest)) if (known.has(k) && !next[k]) next[k] = v;
          return next;
        });
        if (defaultNotes) setNotes((n) => n || defaultNotes);
      })
      .catch(() => {
        /* no defaults — the form starts blank, as before */
      });
    return () => {
      cancelled = true;
    };
  }, [config, isEdit, copyFromId]);

  // --- GST supply type -------------------------------------------------
  // Determined from the selected party using the same shared helper the
  // server uses, so the on-screen CGST/SGST vs IGST split always matches
  // what will actually be saved.
  const selectedParty = parties.find((c) => c.id === customerId);
  const supply = determineSupply(
    { gstin: me?.business?.gstin, billingState: me?.business?.state },
    {
      gstin: selectedParty?.gstin,
      shippingState: selectedParty?.shippingAddress?.state,
      billingState: selectedParty?.billingAddress?.state,
    }
  );
  const effectiveIntraState = record ? Boolean(record.intraState) : supply.intraState;
  const effectiveIsUt = record ? Boolean(record.isUnionTerritory) : supply.isUnionTerritory;

  // --- live totals (preview only; the server recomputes authoritatively)
  const computed = lines
    .filter((l) => l.itemId)
    .map((l) =>
      computeLine(
        {
          quantity: Number(l.quantity || 0),
          rate: l.rate || "0",
          discountPercent: Number(l.discountPercent || 0),
          taxRatePercent: Number(l.taxRatePercent || 0),
        },
        effectiveIntraState
      )
    );
  const preview = computeTotals(computed, shippingCharge || "0");

  const readOnly = isEdit && record?.canEdit === false;

  // --- field placement --------------------------------------------------
  // Where each field goes is decided by buildFormLayout, so the rules are
  // testable on their own rather than buried in this render.
  const layout = useMemo(() => buildFormLayout(config.extraFields), [config.extraFields]);
  const { header: headerFields, tabs: tabFields, visibleTabs } = layout;

  function markDirty() {
    setDirty(true);
  }

  function updateLine(index: number, patch: Partial<LineRow>) {
    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    markDirty();
  }

  function removeLine(index: number) {
    setLines((rows) => rows.filter((_, i) => i !== index));
    markDirty();
  }

  const quickItem = items.find((i) => i.id === quick.itemId);
  const defaultRateFor = useCallback(
    (item?: ItemOption) =>
      config.partyField === "vendor" ? (item?.purchasePrice ?? "0") : (item?.sellingPrice ?? "0"),
    [config.partyField]
  );

  function pickQuickItem(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setQuick({
      itemId,
      variantSku: "",
      quantity: "1",
      rate: defaultRateFor(item),
    });
  }

  /** Resolves a typed "CODE · Name" (or bare code/name) back to an item. */
  function resolveTypedItem(text: string): ItemOption | undefined {
    const value = text.trim().toLowerCase();
    if (!value) return undefined;
    const code = value.split("·")[0].trim();
    return (
      items.find((i) => i.itemCode.toLowerCase() === code) ??
      items.find((i) => i.name.toLowerCase() === value) ??
      items.find((i) => `${i.itemCode} · ${i.name}`.toLowerCase() === value)
    );
  }

  const quickAmount = quickItem
    ? computeLine(
        {
          quantity: Number(quick.quantity || 0),
          rate: quick.rate || "0",
          discountPercent: 0,
          taxRatePercent: Number(quickItem.taxRatePercent ?? 0),
        },
        effectiveIntraState
      ).lineTotal.toFixed(2)
    : "";

  /** Adds the quick-entry row to the grid, then clears it for the next one. */
  function addQuickLine() {
    if (!quickItem) {
      setError("Choose an item before adding a line.");
      return;
    }
    const needsVariant = (quickItem.variants?.length ?? 0) > 0;
    if (needsVariant && !quick.variantSku) {
      // The server rejects this too; catching it here saves a round trip and
      // explains it at the point of entry.
      setError(`"${quickItem.name}" is tracked by size/colour — choose a variant.`);
      return;
    }
    if (Number(quick.quantity) <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    setError(null);
    setLines((rows) => [
      ...rows,
      {
        itemId: quickItem.id,
        itemName: quickItem.name,
        itemCode: quickItem.itemCode,
        unitName: quickItem.unitId ? units[quickItem.unitId] : undefined,
        variantSku: quick.variantSku || undefined,
        quantity: quick.quantity,
        rate: quick.rate || defaultRateFor(quickItem),
        discountPercent: "0",
        taxRatePercent: String(quickItem.taxRatePercent ?? 0),
      },
    ]);
    setQuick(emptyQuick);
    markDirty();
    quickItemRef.current?.focus();
  }

  function applyMassDiscount(percent: number) {
    setLines((rows) => rows.map((r) => ({ ...r, discountPercent: String(percent) })));
    setShowMassDiscount(false);
    setSuccess(`Discount of ${percent}% applied to all ${lines.length} line(s).`);
    markDirty();
  }

  function buildPayload() {
    const payload: Record<string, unknown> = {
      [config.partyIdField]: customerId,
      documentDate,
      shippingCharge: shippingCharge || "0",
      notes: notes || undefined,
      lines: lines
        .filter((l) => l.itemId && Number(l.quantity) > 0)
        .map((l) => ({
          itemId: l.itemId,
          variantSku: l.variantSku || undefined,
          quantity: Number(l.quantity),
          rate: l.rate || "0",
          discountPercent: Number(l.discountPercent || 0),
          taxRatePercent: Number(l.taxRatePercent || 0),
        })),
    };
    for (const [k, v] of Object.entries(extras)) if (v) payload[k] = v;
    return payload;
  }

  /**
   * Advances a freshly created draft through its first workflow step.
   * The transition is read from the saved document rather than assumed, so
   * this works for every document type without duplicating the workflow.
   */
  async function submitAfterSave(id: string) {
    const saved = await apiFetch<DocRecord>(`${config.apiPath}/${id}`);
    const next = saved.availableTransitions?.find((t) => t.to !== "CANCELLED");
    if (!next) return null;
    await apiFetch(`${config.apiPath}/${id}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStatus: next.to }),
    });
    return next.to;
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (submitting) return;

    if (lines.filter((l) => l.itemId).length === 0) {
      setError("Add at least one line item before saving.");
      setActiveTab("items");
      return;
    }

    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const payload = buildPayload();
      if (isEdit) {
        await apiFetch(`${config.apiPath}/${recordId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setDirty(false);
        setSuccess("Saved");
        toast.success(`${config.singular} updated`);
        await loadRecord();
      } else {
        const doc = await apiFetch<{ id: string; documentNumber?: string }>(config.apiPath, { method: "POST", body: JSON.stringify(payload) });
        setDirty(false);
        toast.success(`${config.singular} created`, doc.documentNumber);
        if (sendOnSave) {
          // A failure here must not look like the save failed — the document
          // exists either way, so the error is reported on its own page.
          try {
            const moved = await submitAfterSave(doc.id);
            if (moved) toast.success(`${config.singular} ${humanizeStatus(moved).toLowerCase()}`, doc.documentNumber);
          } catch (err) {
            router.push(`${config.basePath}/${doc.id}`);
            throw err;
          }
        }
        router.push(`${config.basePath}/${doc.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  useUnsavedChangesWarning(dirty && !submitting);

  useShortcutScope({
    onSave: () => {
      if (!submitting && !readOnly) handleSubmit();
    },
    onAddLine: () => {
      setActiveTab("items");
      addQuickLine();
    },
    onPrint: isEdit ? () => router.push(`${config.basePath}/${recordId}/print`) : undefined,
  });

  /** Transitions that need a reason (cancel, reject) open a dialog first. */
  function handleTransition(rule: TransitionRule) {
    if (rule.requiresReason) {
      setReasonError(null);
      setPendingTransition(rule);
      return;
    }
    void runTransition(rule);
  }

  async function runTransition(rule: TransitionRule, reason?: string) {
    setBusyAction(rule.to);
    setError(null);
    setSuccess(null);
    setReasonError(null);
    try {
      await apiFetch(`${config.apiPath}/${recordId}/transition`, {
        method: "POST",
        body: JSON.stringify({ toStatus: rule.to, reason }),
      });
      setPendingTransition(null);
      setSuccess(`Moved to ${rule.to}`);
      toast.success(`${config.singular} ${humanizeStatus(rule.to).toLowerCase()}`);
      await loadRecord();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Transition failed";
      // Keep the reason dialog open with the error so the typed reason isn't lost.
      if (rule.requiresReason) setReasonError(message);
      else setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConvert(target: { key: string; label: string }) {
    const targetUi = getDocumentUi(target.key);
    const extra: Record<string, unknown> = {};

    // Deliveries and returns need a warehouse before they can be created.
    if (target.key === "delivery-challans" || target.key === "sales-returns") {
      const warehouses = referenceOptions.warehouseId ?? [];
      const picked = warehouses[0]?.value;
      if (!picked) {
        setError("Create a warehouse first — deliveries and returns must move stock somewhere.");
        return;
      }
      extra.warehouseId = picked;
    }

    setBusyAction(target.key);
    setError(null);
    try {
      const doc = await apiFetch<{ id: string }>(`${config.apiPath}/${recordId}/convert`, {
        method: "POST",
        body: JSON.stringify({ toType: target.key, extra }),
      });
      toast.success(`${targetUi?.singular ?? target.label} created`, `From this ${config.singular.toLowerCase()}`);
      router.push(`${targetUi?.basePath ?? "/"}/${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Conversion failed");
      setBusyAction(null);
    }
  }

  // Warehouse options must be loaded for conversion targets that need one.
  useEffect(() => {
    if (config.extraFields.some((f) => f.name === "warehouseId")) return;
    if (!config.convertsTo.some((c) => c.key === "delivery-challans" || c.key === "sales-returns")) return;
    let cancelled = false;
    apiFetch<{ items: Record<string, unknown>[] }>("/api/masters/warehouses?pageSize=50&status=ACTIVE")
      .then((res) => {
        if (cancelled) return;
        setReferenceOptions((prev) => ({
          ...prev,
          warehouseId: res.items.map((w) => ({ value: String(w.id), label: String(w.name) })),
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config]);

  if (loading) return <p style={{ opacity: 0.6 }}>Loading...</p>;

  /* ------------------------------------------------------------------ */
  /* Field renderer, shared by the header grid and the tabs              */
  /* ------------------------------------------------------------------ */

  function renderField(f: FieldConfig, inHeader = false) {
    const control =
      f.type === "reference" ? (
        <select
          className="select"
          value={extras[f.name] ?? ""}
          onChange={(e) => {
            setExtras((x) => ({ ...x, [f.name]: e.target.value }));
            markDirty();
          }}
          required={f.required}
          disabled={readOnly}
        >
          <option value="">— none —</option>
          {(referenceOptions[f.name] ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === "select" ? (
        <select
          className="select"
          value={extras[f.name] ?? String(f.defaultValue ?? "")}
          onChange={(e) => {
            setExtras((x) => ({ ...x, [f.name]: e.target.value }));
            markDirty();
          }}
          disabled={readOnly}
        >
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea
          className="input"
          rows={3}
          value={extras[f.name] ?? ""}
          onChange={(e) => {
            setExtras((x) => ({ ...x, [f.name]: e.target.value }));
            markDirty();
          }}
          disabled={readOnly}
        />
      ) : (
        <input
          className="input"
          type={f.name.toLowerCase().includes("date") || f.name === "validUntil" ? "date" : "text"}
          value={extras[f.name] ?? ""}
          onChange={(e) => {
            setExtras((x) => ({ ...x, [f.name]: e.target.value }));
            markDirty();
          }}
          disabled={readOnly}
        />
      );

    if (inHeader) {
      return (
        <div key={f.name} className="docHeadField">
          <label htmlFor={`f-${f.name}`}>
            {f.label}
            {f.required && <span className="req">*</span>}
          </label>
          {control}
        </div>
      );
    }

    return (
      <div key={f.name} className={`field ${f.fullWidth ? "fieldSpanFull" : ""}`}>
        <label>
          {f.label} {f.hint && <span className="hint">— {f.hint}</span>}
        </label>
        {control}
      </div>
    );
  }

  const title = isEdit ? `${config.singular} ${record?.documentNumber ?? ""}` : `Create ${config.singular}`;
  const submitLabel = submitActionLabel(config.key);

  return (
    <div className="docForm">
      {/* ---------------------------------------------------------- header bar */}
      <div className="docTopBar">
        <div className="docTopTitle">
          {title}
          {record && <StatusBadge status={record.status} />}

          <div className="docMenuWrap" ref={menuRef}>
            <button
              type="button"
              className="docMenuButton"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label="Document actions"
              title="Document actions"
            >
              <IconMenu />
              <IconChevronDown style={{ fontSize: "0.7rem" }} />
            </button>

            {menuOpen && (
              <div className="docMenu" role="menu">
                <Link href={config.basePath} className="docMenuItem" role="menuitem">
                  Back to {config.title.toLowerCase()}
                </Link>
                {isEdit && (
                  <>
                    <Link href={`${config.basePath}/${recordId}/print`} className="docMenuItem" role="menuitem">
                      <IconPrint /> Print
                    </Link>
                    <button
                      type="button"
                      className="docMenuItem"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowEmail(true);
                      }}
                    >
                      <IconMail /> Email
                    </button>
                    <Link href={`${config.basePath}/new?copyFrom=${recordId}`} className="docMenuItem" role="menuitem">
                      <IconCopy /> Copy to new
                    </Link>
                  </>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    className="docMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowMassDiscount(true);
                    }}
                    disabled={lines.length === 0}
                  >
                    <IconPercent /> Mass discount
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="docTopActions">
          {isEdit &&
            record?.availableTransitions?.map((rule) => (
              <button
                key={rule.to}
                type="button"
                className={`button ${rule.intent === "danger" ? "buttonSecondary" : "buttonPrimary"}`}
                onClick={() => handleTransition(rule)}
                disabled={busyAction !== null}
                style={rule.intent === "danger" ? { color: "var(--danger)", borderColor: "var(--danger-border)" } : undefined}
              >
                {busyAction === rule.to ? "Working..." : rule.label}
              </button>
            ))}
          {isEdit &&
            config.convertsTo.map((target) => (
              <button
                key={target.key}
                type="button"
                className="button buttonDark"
                onClick={() => handleConvert(target)}
                disabled={busyAction !== null}
              >
                {busyAction === target.key ? "Creating..." : target.label}
              </button>
            ))}
          {!readOnly && (
            <button
              type="button"
              className="button buttonPrimary"
              onClick={() => handleSubmit()}
              disabled={submitting}
              title="Save (Ctrl + S)"
            >
              <IconSave /> {submitting ? "Saving..." : "Save"}
            </button>
          )}
          <Link
            href={config.basePath}
            className="button buttonSecondary"
            title={record ? `Close and return to ${config.title.toLowerCase()}` : "Discard and return to the list"}
          >
            <IconClose /> {record ? "Close" : "Cancel"}
          </Link>
        </div>
      </div>

      {error && <div className="banner bannerError" style={{ margin: "0.9rem 0" }}>{error}</div>}
      {success && <div className="banner bannerSuccess" style={{ margin: "0.9rem 0" }}>{success}</div>}
      {readOnly && (
        <div className="banner bannerLocked">
          <IconLock />
          <span>
            This {config.singular.toLowerCase()} is {humanizeStatus(record?.status ?? "").toLowerCase()} and locked
            against edits. Use the status actions above to move it forward or reverse it.
          </span>
        </div>
      )}

      {record?.sourceDocuments && record.sourceDocuments.length > 0 && (
        <div className="docChain">
          Created from:
          {record.sourceDocuments.map((s) => (
            <Link key={s.docId} href={`/${s.docType}/${s.docId}`} className="docChainLink">
              {s.docNumber}
            </Link>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ------------------------------------------------- header field grid */}
        <div className="docHeadGrid">
          <div className="docHeadField">
            <label htmlFor="doc-party">
              {config.partyLabel}
              <span className="req">*</span>
            </label>
            <div className="docPartyPicker">
              <select
                id="doc-party"
                className="select"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  markDirty();
                }}
                required
                disabled={readOnly}
              >
                <option value="">-- Select --</option>
                {parties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {(c.customerCode ?? c.vendorCode) ? ` · ${c.customerCode ?? c.vendorCode}` : ""}
                  </option>
                ))}
              </select>
              <Link
                href={selectedParty ? `${config.partyBasePath}/${selectedParty.id}` : config.partyBasePath}
                className="docIconBtn"
                title={`Open ${config.partyLabel.toLowerCase()} list`}
              >
                <IconSearch />
              </Link>
              <Link
                href={`${config.partyBasePath}/new`}
                className="docIconBtn"
                title={`Add a new ${config.partyLabel.toLowerCase()}`}
              >
                <IconPlus />
              </Link>
              <button
                type="button"
                className={`docIconBtn ${showPartyInfo ? "docIconBtnOn" : ""}`}
                onClick={() => setShowPartyInfo((v) => !v)}
                disabled={!selectedParty}
                title={selectedParty ? `Show ${selectedParty.name} details` : "Select a party first"}
              >
                <IconInfo />
              </button>
            </div>
          </div>

          <div className="docHeadField">
            <label htmlFor="doc-date">
              Date<span className="req">*</span>
            </label>
            <input
              id="doc-date"
              className="input"
              type="date"
              value={documentDate}
              onChange={(e) => {
                setDocumentDate(e.target.value);
                markDirty();
              }}
              required
              disabled={readOnly}
            />
          </div>

          <div className="docHeadField">
            <label htmlFor="doc-number">{config.singular} No.</label>
            <input
              id="doc-number"
              className="input docReadonly"
              value={record?.documentNumber ?? "Auto"}
              readOnly
              title="Allocated by the server when the document is saved"
            />
          </div>

          {headerFields.map((f) => renderField(f, true))}

          <div className="docHeadField">
            <label htmlFor="doc-currency">Currency</label>
            <input
              id="doc-currency"
              className="input docReadonly"
              value={me?.business?.currency ?? "INR"}
              readOnly
              title="Taken from the business profile — documents are raised in the business currency"
            />
          </div>
        </div>

        {showPartyInfo && selectedParty && (
          <div className="docPartyInfo">
            <div>
              <span>Name</span>
              <strong>{selectedParty.name}</strong>
            </div>
            <div>
              <span>GSTIN</span>
              <strong>{selectedParty.gstin ?? "—"}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong>{selectedParty.phone ?? "—"}</strong>
            </div>
            <div>
              <span>Email</span>
              <strong>{selectedParty.email ?? "—"}</strong>
            </div>
            <div>
              <span>City / State</span>
              <strong>
                {selectedParty.billingAddress?.city ?? "—"}
                {selectedParty.billingAddress?.state ? `, ${selectedParty.billingAddress.state}` : ""}
              </strong>
            </div>
            <Link href={`${config.partyBasePath}/${selectedParty.id}`} className="docPartyInfoLink">
              Open full record
            </Link>
          </div>
        )}

        {!record && supply.warning && customerId && (
          <div className="banner bannerError" style={{ marginBottom: "1rem" }}>
            {supply.warning}
          </div>
        )}

        {/* ------------------------------------------------------------- tabs */}
        <div className="docTabs" role="tablist">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              className={`docTab ${activeTab === t.key ? "docTabActive" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              {t.key === "items" && lines.length > 0 && <span className="docTabCount">{lines.length}</span>}
            </button>
          ))}
        </div>

        <div className="docTabPanel">
          {activeTab === "items" && (
            <>
              {!readOnly && (
                <div className="docQuickAdd">
                  <input
                    className="input docQuickCode"
                    placeholder="Item Code"
                    value={quickItem?.itemCode ?? ""}
                    readOnly
                    tabIndex={-1}
                    title="Filled in from the item you choose"
                  />
                  <input
                    ref={quickItemRef}
                    className="input docQuickName"
                    list="doc-item-list"
                    placeholder="Item Name — type to search"
                    value={quickItem ? `${quickItem.itemCode} · ${quickItem.name}` : ""}
                    onChange={(e) => {
                      const found = resolveTypedItem(e.target.value);
                      if (found) pickQuickItem(found.id);
                      else setQuick((q) => ({ ...q, itemId: "" }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addQuickLine();
                      }
                    }}
                  />
                  <datalist id="doc-item-list">
                    {items.map((i) => (
                      <option key={i.id} value={`${i.itemCode} · ${i.name}`} />
                    ))}
                  </datalist>

                  {(quickItem?.variants?.length ?? 0) > 0 && (
                    <select
                      className="select docQuickVariant"
                      value={quick.variantSku}
                      onChange={(e) => setQuick((q) => ({ ...q, variantSku: e.target.value }))}
                      title="This item is tracked by size/colour"
                    >
                      <option value="">-- Variant --</option>
                      {quickItem?.variants?.map((v) => (
                        <option key={v.sku} value={v.sku}>
                          {[v.color, v.size].filter(Boolean).join(" / ") || v.sku}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    className="input docQuickQty"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Qty"
                    value={quick.quantity}
                    onChange={(e) => setQuick((q) => ({ ...q, quantity: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addQuickLine();
                      }
                    }}
                  />
                  <input
                    className="input docQuickUom docReadonly"
                    value={quickItem?.unitId ? (units[quickItem.unitId] ?? "—") : "—"}
                    readOnly
                    tabIndex={-1}
                    title="Unit of measure, from the item master"
                  />
                  <input
                    className="input docQuickRate"
                    inputMode="decimal"
                    placeholder="Rate"
                    value={quick.rate}
                    onChange={(e) => setQuick((q) => ({ ...q, rate: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addQuickLine();
                      }
                    }}
                  />
                  <input
                    className="input docQuickAmount docReadonly"
                    placeholder="Amount"
                    value={quickAmount}
                    readOnly
                    tabIndex={-1}
                  />
                  <button type="button" className="button buttonDark docQuickBtn" onClick={addQuickLine}>
                    <IconPlus /> Add
                  </button>
                </div>
              )}

              <div className="tableWrap">
                <table className="docLinesTable">
                  <thead>
                    <tr>
                      <th style={{ width: "3rem" }}>#</th>
                      <th style={{ width: "8rem" }}>Code</th>
                      <th style={{ minWidth: "14rem" }}>Item</th>
                      <th className="numCell" style={{ width: "6rem" }}>Qty</th>
                      <th style={{ width: "5rem" }}>UOM</th>
                      <th className="numCell" style={{ width: "8rem" }}>Rate</th>
                      <th className="numCell" style={{ width: "6rem" }}>Disc(%)</th>
                      <th className="numCell" style={{ width: "8rem" }}>Disc.Amount</th>
                      <th className="numCell" style={{ width: "6rem" }}>GST(%)</th>
                      <th className="numCell" style={{ width: "9rem" }}>Amount</th>
                      <th className="numCell" style={{ width: "9rem" }}>Tot. Amount</th>
                      <th style={{ width: "2.5rem" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={12}>
                          <div className="tableEmpty">
                            {readOnly
                              ? "This document has no lines."
                              : "No lines yet — add one using the row above."}
                          </div>
                        </td>
                      </tr>
                    )}
                    {lines.map((line, index) => {
                      const item = items.find((i) => i.id === line.itemId);
                      const c = computeLine(
                        {
                          quantity: Number(line.quantity || 0),
                          rate: line.rate || "0",
                          discountPercent: Number(line.discountPercent || 0),
                          taxRatePercent: Number(line.taxRatePercent || 0),
                        },
                        effectiveIntraState
                      );
                      const uom = line.unitName ?? (item?.unitId ? units[item.unitId] : undefined) ?? "—";
                      return (
                        <tr key={`${line.itemId}-${line.variantSku ?? ""}-${index}`}>
                          <td className="cellMuted tabular">{index + 1}</td>
                          <td>{line.itemCode ?? item?.itemCode ?? "—"}</td>
                          <td>
                            <div className="docLineItem">
                              <strong>{line.itemName ?? item?.name ?? "—"}</strong>
                              {(item?.variants?.length ?? 0) > 0 ? (
                                <select
                                  value={line.variantSku ?? ""}
                                  onChange={(e) => updateLine(index, { variantSku: e.target.value || undefined })}
                                  disabled={readOnly}
                                >
                                  <option value="">-- Variant --</option>
                                  {item?.variants?.map((v) => (
                                    <option key={v.sku} value={v.sku}>
                                      {[v.color, v.size].filter(Boolean).join(" / ") || v.sku}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                line.variantSku && <span className="docLineMeta">{line.variantSku}</span>
                              )}
                            </div>
                          </td>
                          <td className="numCell">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={line.quantity}
                              onChange={(e) => updateLine(index, { quantity: e.target.value })}
                              disabled={readOnly}
                            />
                          </td>
                          <td className="docLineMeta">{uom}</td>
                          <td className="numCell">
                            <input
                              inputMode="decimal"
                              value={line.rate}
                              onChange={(e) => updateLine(index, { rate: e.target.value })}
                              disabled={readOnly}
                            />
                          </td>
                          <td className="numCell">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              value={line.discountPercent}
                              onChange={(e) => updateLine(index, { discountPercent: e.target.value })}
                              disabled={readOnly}
                            />
                          </td>
                          <td className="numCell">{c.discountAmount.toFixed(2)}</td>
                          <td className="numCell">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              value={line.taxRatePercent}
                              onChange={(e) => updateLine(index, { taxRatePercent: e.target.value })}
                              disabled={readOnly}
                            />
                          </td>
                          <td className="numCell">{c.taxableAmount.toFixed(2)}</td>
                          <td className="numCell docLineTotal">{c.lineTotal.toFixed(2)}</td>
                          <td>
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={() => removeLine(index)}
                                title="Remove this line"
                                className="rowRemoveBtn"
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="totalsPanel">
                <div className="totalsRow">
                  <span>Sub total</span>
                  <span>{preview.subTotal.toFixed(2)}</span>
                </div>
                <div className="totalsRow">
                  <span>Discount</span>
                  <span>-{preview.totalDiscount.toFixed(2)}</span>
                </div>
                <div className="totalsRow">
                  <span>Taxable</span>
                  <span>{preview.taxableAmount.toFixed(2)}</span>
                </div>
                {/* GST is shown split exactly as it will be charged: CGST+SGST
                    within the state, IGST across states. */}
                {effectiveIntraState ? (
                  <>
                    <div className="totalsRow">
                      <span>CGST</span>
                      <span>{preview.cgstAmount.toFixed(2)}</span>
                    </div>
                    <div className="totalsRow">
                      <span>{stateTaxLabel(effectiveIsUt)}</span>
                      <span>{preview.sgstAmount.toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <div className="totalsRow">
                    <span>IGST</span>
                    <span>{preview.igstAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="totalsRow">
                  <span>Shipping</span>
                  <span>{Number(shippingCharge || 0).toFixed(2)}</span>
                </div>
                <div className="totalsRow">
                  <span>Round off</span>
                  <span>{preview.roundOff.toFixed(2)}</span>
                </div>
                <div className="totalsRow grand">
                  <span>Grand total</span>
                  <span>{preview.grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}

          {activeTab === "addition" && (
            <div className="formGrid">
              <div className="field">
                <label htmlFor="doc-shipping">Shipping / freight charge</label>
                <input
                  id="doc-shipping"
                  className="input"
                  inputMode="decimal"
                  value={shippingCharge}
                  onChange={(e) => {
                    setShippingCharge(e.target.value);
                    markDirty();
                  }}
                  disabled={readOnly}
                />
                <span className="hint">Added to the grand total after GST.</span>
              </div>

              <div className="field">
                <label>Round off</label>
                <input className="input docReadonly" value={preview.roundOff.toFixed(2)} readOnly />
                <span className="hint">Calculated by the server so the total lands on a whole rupee.</span>
              </div>

              {!readOnly && (
                <div className="field">
                  <label>Line discounts</label>
                  <button
                    type="button"
                    className="button buttonSecondary"
                    onClick={() => setShowMassDiscount(true)}
                    disabled={lines.length === 0}
                  >
                    <IconPercent /> Apply discount to all lines
                  </button>
                  <span className="hint">
                    Per-line discounts stay editable in the Item Details grid.
                  </span>
                </div>
              )}

              {tabFields.addition.map((f) => renderField(f))}
            </div>
          )}

          {activeTab === "partner" && (
            <div className="formGrid">
              {tabFields.partner.length === 0 && (
                <p className="docTabEmpty">
                  This document type has no warehouse, transporter or agent to record.
                </p>
              )}
              {tabFields.partner.map((f) => renderField(f))}
            </div>
          )}

          {activeTab === "other" && (
            <div className="formGrid">
              <div className="field fieldSpanFull">
                <label htmlFor="doc-notes">Notes</label>
                <textarea
                  id="doc-notes"
                  className="input"
                  rows={3}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    markDirty();
                  }}
                  disabled={readOnly}
                />
                <span className="hint">Printed on the document.</span>
              </div>
              {tabFields.other.map((f) => renderField(f))}
            </div>
          )}

          {activeTab === "additional" && (
            <div className="formGrid">
              {tabFields.additional.map((f) => renderField(f))}
            </div>
          )}
        </div>
      </form>

      {/* ---------------------------------------------------------- sticky footer */}
      <div className={`docFooter ${footerOpen ? "" : "docFooterCollapsed"}`}>
        <div className="docFooterActions">
          {!readOnly && (
            <button
              type="button"
              className="button buttonPrimary"
              onClick={() => handleSubmit()}
              disabled={submitting}
              title="Save (Ctrl + S)"
            >
              <IconSave /> {submitting ? "Saving..." : "Save"}
            </button>
          )}
          <Link
            href={config.basePath}
            className="button buttonSecondary"
            title={record ? `Close and return to ${config.title.toLowerCase()}` : "Discard and return to the list"}
          >
            <IconClose /> {record ? "Close" : "Cancel"}
          </Link>
          {!readOnly && (
            <button
              type="button"
              className="button buttonSecondary"
              onClick={() => setShowMassDiscount(true)}
              disabled={lines.length === 0}
            >
              <IconPercent /> Mass Discount
            </button>
          )}
          {!isEdit && !readOnly && (
            <label className="docFooterCheck" title={`Runs "${submitLabel}" straight after saving`}>
              <input type="checkbox" checked={sendOnSave} onChange={(e) => setSendOnSave(e.target.checked)} />
              {submitLabel}
            </label>
          )}
        </div>

        <div className="docFooterTotal">
          <span>Total Amount</span>
          <output className="docFooterTotalBox">{preview.grandTotal.toFixed(2)}</output>
          <button
            type="button"
            className="docIconBtn"
            onClick={() => setFooterOpen((v) => !v)}
            title={footerOpen ? "Collapse the action bar" : "Expand the action bar"}
            aria-label={footerOpen ? "Collapse the action bar" : "Expand the action bar"}
          >
            {footerOpen ? <IconChevronDown /> : <IconChevronUp />}
          </button>
        </div>
      </div>

      {showMassDiscount && (
        <MassDiscountDialog
          lineCount={lines.length}
          onApply={applyMassDiscount}
          onClose={() => setShowMassDiscount(false)}
        />
      )}

      {pendingTransition && (
        <ConfirmDialog
          title={
            pendingTransition.to === "CANCELLED"
              ? `Cancel this ${config.singular.toLowerCase()}?`
              : `${pendingTransition.label}?`
          }
          message={
            pendingTransition.to === "CANCELLED"
              ? `${record?.documentNumber ?? `This ${config.singular.toLowerCase()}`} will be marked cancelled. This can't be undone.`
              : `${record?.documentNumber ?? `This ${config.singular.toLowerCase()}`} will be marked ${humanizeStatus(pendingTransition.to).toLowerCase()}.`
          }
          confirmLabel={pendingTransition.to === "CANCELLED" ? `Cancel ${config.singular.toLowerCase()}` : pendingTransition.label}
          cancelLabel="Go back"
          tone={pendingTransition.intent === "danger" ? "danger" : "primary"}
          requireReason
          busy={busyAction === pendingTransition.to}
          error={reasonError}
          onConfirm={(reason) => void runTransition(pendingTransition, reason)}
          onCancel={() => setPendingTransition(null)}
        />
      )}

      {showEmail && record && (
        <EmailDialog
          docType={config.key}
          docId={String(recordId)}
          documentNumber={record.documentNumber}
          defaultTo={(record[config.partyField] as { email?: string } | undefined)?.email}
          label={config.singular}
          onClose={() => setShowEmail(false)}
        />
      )}
    </div>
  );
}
