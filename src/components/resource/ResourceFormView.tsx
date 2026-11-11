"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { getPath, setPath } from "@/lib/resources/ui/paths";
import type { ResourceUi, FieldConfig } from "@/lib/resources/ui/types";
import VariantsEditor, { type VariantRow } from "./VariantsEditor";
import LinesEditor, { type LineRow, type ReferenceOption } from "./LinesEditor";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonBlock } from "@/components/ui/States";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { MODULE_DESCRIPTIONS } from "@/lib/ui/moduleDescriptions";
import { IconAlertCircle, IconArrowLeft, IconTrash } from "@/components/icons";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";

type FormState = Record<string, unknown>;

function buildInitialState(config: ResourceUi): FormState {
  let state: FormState = {};
  for (const section of config.sections) {
    for (const field of section.fields) {
      const fallback =
        field.type === "checkbox"
          ? false
          : field.type === "variants" || field.type === "lines"
            ? []
            : field.type === "number"
              ? 0
              : "";
      state = setPath(state, field.name, field.defaultValue ?? fallback);
    }
  }
  return state;
}

/** False while a field's `showWhen` condition is not met. */
function isShown(field: FieldConfig, state: FormState): boolean {
  if (!field.showWhen) return true;
  return field.showWhen.values.includes(String(getPath(state, field.showWhen.field) ?? ""));
}

/** Copies a loaded record's values into form state, normalising dates to
 * yyyy-mm-dd so the date input can show them. */
function stateFromRecord(config: ResourceUi, record: Record<string, unknown>): FormState {
  let next = buildInitialState(config);
  for (const section of config.sections) {
    for (const field of section.fields) {
      let value = getPath(record, field.name);
      if (value === undefined || value === null) continue;
      if (field.type === "date" && typeof value === "string") value = value.slice(0, 10);
      next = setPath(next, field.name, value);
    }
  }
  return next;
}

/** Strips empty optional values so the API's zod schemas see `undefined`
 * rather than "" for fields like email that validate format when present. */
function buildPayload(config: ResourceUi, state: FormState): Record<string, unknown> {
  let payload: Record<string, unknown> = {};

  for (const section of config.sections) {
    for (const field of section.fields) {
      if (!isShown(field, state)) continue;
      const value = getPath(state, field.name);

      if (field.type === "lines") {
        const cols = field.columns ?? [];
        const rows = ((value as LineRow[]) ?? [])
          // A row the user added but never filled in is not an error to report.
          .filter((row) => cols.some((c) => c.type !== "number" && String(row[c.name] ?? "").trim() !== ""))
          .map((row) => {
            const out: LineRow = {};
            for (const c of cols) {
              const v = row[c.name];
              if (c.type === "number") out[c.name] = v === "" || v === null || v === undefined ? 0 : Number(v);
              else if (v !== undefined && v !== null && String(v).trim() !== "") out[c.name] = v;
            }
            return out;
          });
        payload = setPath(payload, field.name, rows);
        continue;
      }
      if (field.type === "date") {
        // "" is sent on purpose: it is how an edit clears a date.
        payload = setPath(payload, field.name, value ?? "");
        continue;
      }
      if (field.type === "number") {
        payload = setPath(payload, field.name, value === "" || value === null ? 0 : Number(value));
        continue;
      }
      if (field.type === "checkbox") {
        payload = setPath(payload, field.name, Boolean(value));
        continue;
      }
      if (field.type === "variants") {
        payload = setPath(payload, field.name, value ?? []);
        continue;
      }
      if (typeof value === "string" && value.trim() === "" && !field.required) {
        continue; // omit blank optional fields entirely
      }
      payload = setPath(payload, field.name, value);
    }
  }

  return payload;
}

export default function ResourceFormView({
  config,
  recordId,
}: {
  config: ResourceUi;
  recordId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEdit = Boolean(recordId);
  /** Copy: prefill a new record from an existing one of the same type. */
  const copyFromId = searchParams.get("copyFrom");

  const [state, setState] = useState<FormState>(() => buildInitialState(config));
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [referenceOptions, setReferenceOptions] = useState<Record<string, ReferenceOption[]>>({});
  const [headerCode, setHeaderCode] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  // Load the record being edited.
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;

    apiFetch<Record<string, unknown>>(`${config.apiPath}/${recordId}`)
      .then((record) => {
        if (cancelled) return;
        setState(stateFromRecord(config, record));
        const codeKey = config.columns[0]?.key;
        if (codeKey) setHeaderCode(String(getPath(record, codeKey) ?? ""));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load record"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config, recordId]);

  /**
   * Copy: prefills a new record from an existing one.
   *
   * Only the configured form fields are carried over — the auto-generated
   * code and audit stamps are not, so the copy gets its own identity rather
   * than colliding with the record it came from.
   */
  useEffect(() => {
    if (!copyFromId || isEdit) return;
    let cancelled = false;

    apiFetch<Record<string, unknown>>(`${config.apiPath}/${copyFromId}`)
      .then((record) => {
        if (cancelled) return;
        setState(stateFromRecord(config, record));
        toast.info("Copied", "Change what you need, then save to create a new record.");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load the record to copy"));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast is stable; run once per copy source
  }, [config, copyFromId, isEdit]);

  // A brand-new record starts from the workspace's saved defaults (e.g. Item
  // Settings). Not applied to edits or copies, which have their own values.
  useEffect(() => {
    const defaults = config.settingsDefaults;
    if (!defaults || isEdit || copyFromId) return;
    let cancelled = false;
    apiFetch<Record<string, unknown>>(`/api/settings/${defaults.section}`)
      .then((settings) => {
        if (cancelled) return;
        setState((s) => {
          let next = s;
          for (const [field, key] of Object.entries(defaults.map)) {
            if (settings[key] !== undefined && settings[key] !== "") next = setPath(next, field, settings[key]);
          }
          return next;
        });
      })
      .catch(() => {
        /* the built-in defaults stay */
      });
    return () => {
      cancelled = true;
    };
  }, [config, isEdit, copyFromId]);

  useUnsavedChangesWarning(dirty && !submitting);

  useShortcutScope({
    onSave: () => {
      if (!submitting) handleSubmit();
    },
  });

  // Load option lists for reference (foreign-key) fields.
  useEffect(() => {
    // Top-level reference fields, plus reference columns inside "lines" fields
    // (keyed "<field>.<column>").
    const refs: { key: string; reference: { resource: string; labelField: string } }[] = [];
    for (const field of config.sections.flatMap((s) => s.fields)) {
      if (field.type === "reference" && field.reference) refs.push({ key: field.name, reference: field.reference });
      for (const col of field.columns ?? []) {
        if (col.type === "reference" && col.reference) refs.push({ key: `${field.name}.${col.name}`, reference: col.reference });
      }
    }

    let cancelled = false;
    // Several fields often point at the same master; fetch each one once.
    const cache = new Map<string, Promise<{ items: Record<string, unknown>[] }>>();

    Promise.all(
      refs.map(async ({ key, reference }) => {
        if (!cache.has(reference.resource)) {
          cache.set(reference.resource, apiFetch(`/api/masters/${reference.resource}?pageSize=200&status=ACTIVE`));
        }
        const res = await cache.get(reference.resource)!;
        return [
          key,
          res.items.map((item): ReferenceOption => {
            const variants = Array.isArray(item.variants)
              ? (item.variants as { sku: string; color?: string; size?: string; isActive?: boolean }[])
                  .filter((v) => v.isActive !== false)
                  .map((v) => ({ sku: v.sku, label: [v.size, v.color].filter(Boolean).join(" / ") || v.sku }))
              : undefined;
            const code = item.itemCode ? `${String(item.itemCode)} · ` : "";
            return {
              value: String(item.id),
              label: `${reference.resource === "items" ? code : ""}${String(item[reference.labelField] ?? item.id)}`,
              variants: variants && variants.length > 0 ? variants : undefined,
            };
          }),
        ] as const;
      })
    )
      .then((entries) => {
        if (!cancelled) setReferenceOptions(Object.fromEntries(entries));
      })
      .catch((err) => {
        // Surfaced rather than swallowed — an empty picker with no message
        // looks identical to "no data exists" and hides real failures.
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

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const payload = buildPayload(config, state);

      if (isEdit) {
        await apiFetch(`${config.apiPath}/${recordId}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast.success(`${config.singular} saved`);
        setDirty(false);
      } else {
        const record = await apiFetch<{ id: string }>(config.apiPath, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setDirty(false);
        toast.success(`${config.singular} created`);
        router.push(`${config.basePath}/${record.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (Array.isArray(err.errors)) {
          const next: Record<string, string> = {};
          for (const issue of err.errors as { path?: (string | number)[]; message: string }[]) {
            const key = issue.path?.join(".");
            if (key) next[key] = issue.message;
          }
          setFieldErrors(next);
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!recordId) return;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`${config.apiPath}/${recordId}`, { method: "DELETE" });
      setDirty(false);
      toast.success(`${config.singular} deleted`);
      router.push(config.basePath);
    } catch (err) {
      setConfirmDelete(false);
      setError(err instanceof ApiError ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  function updateField(name: string, value: unknown) {
    setState((s) => setPath(s, name, value));
    // Arms the before-unload warning so a half-typed record is not lost to a
    // stray tab close.
    setDirty(true);
  }

  function renderField(field: FieldConfig) {
    if (!isShown(field, state)) return null;
    const value = getPath(state, field.name);
    const error = fieldErrors[field.name];

    const control = (() => {
      if (field.variantOf) {
        const itemId = String(getPath(state, field.variantOf) ?? "");
        const variants = (referenceOptions[field.variantOf] ?? []).find((o) => o.value === itemId)?.variants ?? [];
        return (
          <select
            id={`f-${field.name}`}
            aria-invalid={error ? true : undefined}
            className="select"
            value={String(value ?? "")}
            onChange={(e) => updateField(field.name, e.target.value)}
            disabled={variants.length === 0}
          >
            <option value="">{variants.length === 0 ? "No size/colour variants" : "— choose —"}</option>
            {variants.map((v) => (
              <option key={v.sku} value={v.sku}>
                {v.label} ({v.sku})
              </option>
            ))}
          </select>
        );
      }
      switch (field.type) {
        case "date":
          return (
            <input
              id={`f-${field.name}`}
              aria-invalid={error ? true : undefined}
              className="input"
              type="date"
              value={String(value ?? "")}
              onChange={(e) => updateField(field.name, e.target.value)}
              required={field.required}
            />
          );
        case "lines":
          return (
            <LinesEditor
              fieldName={field.name}
              columns={field.columns ?? []}
              value={(value as LineRow[]) ?? []}
              onChange={(rows) => updateField(field.name, rows)}
              options={referenceOptions}
              errors={fieldErrors}
              addLabel={field.addLabel}
            />
          );
        case "textarea":
          return (
            <textarea
              id={`f-${field.name}`}
              aria-invalid={error ? true : undefined}
              className="input"
              rows={3}
              value={String(value ?? "")}
              onChange={(e) => updateField(field.name, e.target.value)}
            />
          );
        case "select":
          return (
            <select
              id={`f-${field.name}`}
              aria-invalid={error ? true : undefined}
              className="select"
              value={String(value ?? "")}
              onChange={(e) => updateField(field.name, e.target.value)}
            >
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        case "reference":
          return (
            <select
              id={`f-${field.name}`}
              aria-invalid={error ? true : undefined}
              className="select"
              value={String(value ?? "")}
              onChange={(e) => updateField(field.name, e.target.value)}
              required={field.required}
            >
              <option value="">— none —</option>
              {(referenceOptions[field.name] ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        case "checkbox":
          return (
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => updateField(field.name, e.target.checked)}
              />
              {field.label}
            </label>
          );
        case "variants":
          return (
            <VariantsEditor
              value={(value as VariantRow[]) ?? []}
              onChange={(rows) => updateField(field.name, rows)}
              skuPrefix={String(getPath(state, "name") ?? "")}
              categoryId={String(getPath(state, "categoryId") ?? "")}
            />
          );
        case "number":
          return (
            <input
              id={`f-${field.name}`}
              aria-invalid={error ? true : undefined}
              className="input"
              type="number"
              step="any"
              value={value === undefined || value === null ? "" : String(value)}
              onChange={(e) => updateField(field.name, e.target.value)}
              required={field.required}
            />
          );
        case "money":
          return (
            <input
              id={`f-${field.name}`}
              aria-invalid={error ? true : undefined}
              className="input"
              inputMode="decimal"
              value={String(value ?? "")}
              onChange={(e) => updateField(field.name, e.target.value)}
              required={field.required}
            />
          );
        default:
          return (
            <input
              id={`f-${field.name}`}
              aria-invalid={error ? true : undefined}
              className="input"
              type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
              value={String(value ?? "")}
              onChange={(e) => updateField(field.name, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          );
      }
    })();

    if (field.type === "lines") {
      return (
        <div key={field.name} className="fieldSpanFull">
          {control}
        </div>
      );
    }

    if (field.type === "checkbox") {
      return (
        <div key={field.name} className={field.fullWidth ? "fieldSpanFull" : undefined}>
          {control}
        </div>
      );
    }

    return (
      <div key={field.name} className={`field ${field.fullWidth ? "fieldSpanFull" : ""}`}>
        <label htmlFor={`f-${field.name}`}>
          {field.label}
          {field.required && <span className="req" aria-hidden>*</span>}
          {field.hint && <span className="hint"> · {field.hint}</span>}
        </label>
        {control}
        {error && <span className="fieldError">{error}</span>}
      </div>
    );
  }

  if (loading) {
    return (
      <div aria-busy="true" style={{ display: "grid", gap: "1rem", maxWidth: "60rem" }}>
        <span className="skeleton" style={{ width: "14rem", height: "1.25rem" }} />
        <SkeletonBlock lines={4} />
        <SkeletonBlock lines={3} />
      </div>
    );
  }

  const singularLower = config.singular.toLowerCase();
  const sectionId = (label: string) => `section-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={config.basePath} className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> {config.title}
          </Link>
        }
        title={
          isEdit ? (
            <>
              {String(getPath(state, config.titleField ?? "name") ?? config.singular) || config.singular}
              {headerCode && headerCode !== String(getPath(state, config.titleField ?? "name") ?? "") && (
                <span className="pageTitleCount cellMono">{headerCode}</span>
              )}
            </>
          ) : (
            `New ${singularLower}`
          )
        }
        description={
          isEdit
            ? `Changes apply to new documents. Documents already raised keep the details they were created with.`
            : MODULE_DESCRIPTIONS[config.key]
        }
        actions={
          isEdit && (
            <button
              type="button"
              className="button buttonSecondary"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              style={{ color: "var(--danger)" }}
            >
              <IconTrash /> Delete
            </button>
          )
        }
      />

      <form onSubmit={handleSubmit} noValidate={false}>
        <div className={config.sections.length > 2 ? "formLayout" : undefined}>
          {config.sections.length > 2 && (
            <nav className="formNav" aria-label="Form sections">
              {config.sections.map((s) => (
                <a key={s.label} href={`#${sectionId(s.label)}`}>
                  {s.label}
                </a>
              ))}
            </nav>
          )}

          <div style={{ minWidth: 0, maxWidth: "62rem" }}>
            {error && (
              <div className="banner bannerError" role="alert" style={{ marginBottom: "1rem" }}>
                <IconAlertCircle />
                <span>{error}</span>
              </div>
            )}

            {config.sections.map((section) => (
              <section key={section.label} id={sectionId(section.label)} className="formSection">
                <div className="formSectionHead">
                  <h2 className="formSectionTitle">{section.label}</h2>
                  {SECTION_HINTS[section.label] && <p className="formSectionDesc">{SECTION_HINTS[section.label]}</p>}
                </div>
                <div className="formSectionBody">
                  <div className="formGrid">{section.fields.map(renderField)}</div>
                </div>
              </section>
            ))}

            <div className="formActionsBar">
              <span className="formActionsNote">
                {dirty ? "Unsaved changes" : isEdit ? "All changes saved" : "Fields marked * are required"}
                <span className="hideMobile"> · Ctrl + S to save</span>
              </span>
              <Link href={config.basePath} className="button buttonSecondary">
                {isEdit ? "Close" : "Cancel"}
              </Link>
              <button type="submit" className="button buttonPrimary" disabled={submitting}>
                {submitting && <span className="spinner" />}
                {submitting ? "Saving…" : isEdit ? "Save changes" : `Create ${singularLower}`}
              </button>
            </div>
          </div>
        </div>
      </form>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete this ${singularLower}?`}
          message="It will be hidden from lists and pickers. Documents that already use it keep working — nothing is removed from the database."
          confirmLabel="Delete"
          busy={deleting}
          error={null}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}

/** One-line purpose under each form section heading. */
const SECTION_HINTS: Record<string, string> = {
  "Basic details": "Name, identifiers and how to reach them.",
  "Account details": "How this account appears in the chart of accounts.",
  "Commercial terms": "Credit period, credit limit and the balance carried in from before.",
  "Agent details": "Contact details and the commission rate applied to their sales.",
  "Transporter details": "Used on delivery challans and e-way bills.",
  "Category details": "Categories can sit under a parent to form a hierarchy.",
  "Brand details": "The label products are sold under.",
  "Unit details": "Decimal places control how quantities in this unit can be entered.",
  "Pricing & tax": "Default prices on new documents, plus the HSN code and GST rate used to compute tax.",
  "Stock levels": "When stock falls to the reorder level, it shows up in low-stock alerts.",
  "Garment attributes": "Fabric, style, season and fit — used for filtering and reports.",
  "Size / colour variants": "Each size and colour combination is stocked and sold as its own SKU.",
  "Warehouse details": "Every stock movement is recorded against a warehouse.",
  "Branch details": "Documents are raised from a branch.",
};
