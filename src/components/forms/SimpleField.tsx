"use client";

import type { FieldConfig } from "@/lib/resources/ui/types";

/**
 * Renders one FieldConfig as a labelled control. Used by screens that edit a
 * flat object (settings, small dialogs) rather than a master record, so they
 * look exactly like the master forms without pulling in the whole form view.
 */
export default function SimpleField({
  field,
  value,
  onChange,
  options,
  error,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Options for "reference" fields. */
  options?: { value: string; label: string }[];
  error?: string;
}) {
  const id = `f-${field.name}`;
  const invalid = error ? true : undefined;

  if (field.type === "checkbox") {
    return (
      <div className={field.fullWidth ? "fieldSpanFull" : undefined}>
        <label className="checkboxRow">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
        {field.hint && <span className="fieldHint">{field.hint}</span>}
        {error && <span className="fieldError">{error}</span>}
      </div>
    );
  }

  let control;
  switch (field.type) {
    case "textarea":
      control = (
        <textarea id={id} className="input" rows={3} aria-invalid={invalid} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case "select":
    case "reference":
      control = (
        <select id={id} className="select" aria-invalid={invalid} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.type === "reference" && <option value="">— none —</option>}
          {(field.type === "select" ? field.options : options)?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    default:
      control = (
        <input
          id={id}
          className="input"
          aria-invalid={invalid}
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text"}
          step={field.type === "number" ? "any" : undefined}
          inputMode={field.type === "money" ? "decimal" : undefined}
          placeholder={field.placeholder}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
        />
      );
  }

  return (
    <div className={`field ${field.fullWidth ? "fieldSpanFull" : ""}`}>
      <label htmlFor={id}>
        {field.label}
        {field.required && <span className="req" aria-hidden>*</span>}
        {field.hint && <span className="hint"> · {field.hint}</span>}
      </label>
      {control}
      {error && <span className="fieldError">{error}</span>}
    </div>
  );
}
