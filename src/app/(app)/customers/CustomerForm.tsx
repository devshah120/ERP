"use client";

import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api/client";

export interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface CustomerFormState {
  name: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  alternatePhone: string;
  billingAddress: AddressForm;
  shippingSameAsBilling: boolean;
  shippingAddress: AddressForm;
  gstin: string;
  creditLimit: string;
  creditDays: string;
  paymentTerms: string;
  currency: string;
  customerGroup: string;
  openingBalance: string;
  openingBalanceType: "DEBIT" | "CREDIT";
  notes: string;
  status: "ACTIVE" | "INACTIVE";
}

const emptyAddress: AddressForm = { line1: "", line2: "", city: "", state: "", country: "India", postalCode: "" };

export const emptyCustomerForm: CustomerFormState = {
  name: "",
  companyName: "",
  contactPerson: "",
  email: "",
  phone: "",
  alternatePhone: "",
  billingAddress: { ...emptyAddress },
  shippingSameAsBilling: true,
  shippingAddress: { ...emptyAddress },
  gstin: "",
  creditLimit: "0",
  creditDays: "0",
  paymentTerms: "",
  currency: "INR",
  customerGroup: "",
  openingBalance: "0",
  openingBalanceType: "DEBIT",
  notes: "",
  status: "ACTIVE",
};

export function customerFormToPayload(form: CustomerFormState) {
  return {
    name: form.name,
    companyName: form.companyName || undefined,
    contactPerson: form.contactPerson || undefined,
    email: form.email || undefined,
    phone: form.phone,
    alternatePhone: form.alternatePhone || undefined,
    billingAddress: form.billingAddress,
    shippingAddress: form.shippingSameAsBilling ? undefined : form.shippingAddress,
    gstin: form.gstin || undefined,
    creditLimit: form.creditLimit || "0",
    creditDays: Number(form.creditDays || 0),
    paymentTerms: form.paymentTerms || undefined,
    currency: form.currency || undefined,
    customerGroup: form.customerGroup || undefined,
    openingBalance: form.openingBalance || "0",
    openingBalanceType: form.openingBalanceType,
    notes: form.notes || undefined,
    status: form.status,
  };
}

export default function CustomerForm({
  initial,
  submitLabel,
  showStatus,
  onSubmit,
}: {
  initial?: Partial<CustomerFormState>;
  submitLabel: string;
  showStatus?: boolean;
  onSubmit: (form: CustomerFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<CustomerFormState>({ ...emptyCustomerForm, ...initial });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function update<K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateBilling<K extends keyof AddressForm>(key: K, value: string) {
    setForm((f) => ({ ...f, billingAddress: { ...f.billingAddress, [key]: value } }));
  }

  function updateShipping<K extends keyof AddressForm>(key: K, value: string) {
    setForm((f) => ({ ...f, shippingAddress: { ...f.shippingAddress, [key]: value } }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(form);
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

  return (
    <form className="form" onSubmit={handleSubmit}>
      {error && <div className="banner bannerError">{error}</div>}

      <div className="sectionLabel">Basic details</div>
      <div className="formGrid">
        <Field label="Customer name" error={fieldErrors.name}>
          <input className="input" required value={form.name} onChange={(e) => update("name", e.target.value)} />
        </Field>
        <Field label="Company name" hint="Optional">
          <input className="input" value={form.companyName} onChange={(e) => update("companyName", e.target.value)} />
        </Field>
        <Field label="Contact person" hint="Optional">
          <input
            className="input"
            value={form.contactPerson}
            onChange={(e) => update("contactPerson", e.target.value)}
          />
        </Field>
        <Field label="Phone" error={fieldErrors.phone}>
          <input className="input" required value={form.phone} onChange={(e) => update("phone", e.target.value)} />
        </Field>
        <Field label="Alternate phone" hint="Optional">
          <input
            className="input"
            value={form.alternatePhone}
            onChange={(e) => update("alternatePhone", e.target.value)}
          />
        </Field>
        <Field label="Email" hint="Optional" error={fieldErrors.email}>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </Field>
        <Field label="GSTIN" hint="Optional">
          <input className="input" value={form.gstin} onChange={(e) => update("gstin", e.target.value)} />
        </Field>
        {showStatus && (
          <Field label="Status">
            <select className="select" value={form.status} onChange={(e) => update("status", e.target.value as CustomerFormState["status"])}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
        )}
      </div>

      <div className="sectionLabel">Billing address</div>
      <div className="formGrid">
        <div className="fieldSpanFull">
          <Field label="Address line 1" error={fieldErrors["billingAddress.line1"]}>
            <input
              className="input"
              required
              value={form.billingAddress.line1}
              onChange={(e) => updateBilling("line1", e.target.value)}
            />
          </Field>
        </div>
        <div className="fieldSpanFull">
          <Field label="Address line 2" hint="Optional">
            <input
              className="input"
              value={form.billingAddress.line2}
              onChange={(e) => updateBilling("line2", e.target.value)}
            />
          </Field>
        </div>
        <Field label="City" error={fieldErrors["billingAddress.city"]}>
          <input className="input" required value={form.billingAddress.city} onChange={(e) => updateBilling("city", e.target.value)} />
        </Field>
        <Field label="State" error={fieldErrors["billingAddress.state"]}>
          <input className="input" required value={form.billingAddress.state} onChange={(e) => updateBilling("state", e.target.value)} />
        </Field>
        <Field label="Country" error={fieldErrors["billingAddress.country"]}>
          <input
            className="input"
            required
            value={form.billingAddress.country}
            onChange={(e) => updateBilling("country", e.target.value)}
          />
        </Field>
        <Field label="Postal code" hint="Optional">
          <input
            className="input"
            value={form.billingAddress.postalCode}
            onChange={(e) => updateBilling("postalCode", e.target.value)}
          />
        </Field>
      </div>

      <div className="sectionLabel">Shipping address</div>
      <label className="checkboxRow">
        <input
          type="checkbox"
          checked={form.shippingSameAsBilling}
          onChange={(e) => update("shippingSameAsBilling", e.target.checked)}
        />
        Same as billing address
      </label>

      {!form.shippingSameAsBilling && (
        <div className="formGrid">
          <div className="fieldSpanFull">
            <Field label="Address line 1">
              <input
                className="input"
                required
                value={form.shippingAddress.line1}
                onChange={(e) => updateShipping("line1", e.target.value)}
              />
            </Field>
          </div>
          <div className="fieldSpanFull">
            <Field label="Address line 2" hint="Optional">
              <input
                className="input"
                value={form.shippingAddress.line2}
                onChange={(e) => updateShipping("line2", e.target.value)}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              className="input"
              required
              value={form.shippingAddress.city}
              onChange={(e) => updateShipping("city", e.target.value)}
            />
          </Field>
          <Field label="State">
            <input
              className="input"
              required
              value={form.shippingAddress.state}
              onChange={(e) => updateShipping("state", e.target.value)}
            />
          </Field>
          <Field label="Country">
            <input
              className="input"
              required
              value={form.shippingAddress.country}
              onChange={(e) => updateShipping("country", e.target.value)}
            />
          </Field>
          <Field label="Postal code" hint="Optional">
            <input
              className="input"
              value={form.shippingAddress.postalCode}
              onChange={(e) => updateShipping("postalCode", e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="sectionLabel">Commercial terms</div>
      <div className="formGrid">
        <Field label="Credit limit" error={fieldErrors.creditLimit}>
          <input className="input" inputMode="decimal" value={form.creditLimit} onChange={(e) => update("creditLimit", e.target.value)} />
        </Field>
        <Field label="Credit days">
          <input
            className="input"
            type="number"
            min={0}
            value={form.creditDays}
            onChange={(e) => update("creditDays", e.target.value)}
          />
        </Field>
        <Field label="Payment terms" hint="Optional">
          <input className="input" value={form.paymentTerms} onChange={(e) => update("paymentTerms", e.target.value)} placeholder="Net 30" />
        </Field>
        <Field label="Currency">
          <input
            className="input"
            maxLength={3}
            value={form.currency}
            onChange={(e) => update("currency", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Customer group" hint="Optional">
          <input
            className="input"
            value={form.customerGroup}
            onChange={(e) => update("customerGroup", e.target.value)}
          />
        </Field>
        <Field label="Opening balance" error={fieldErrors.openingBalance}>
          <input
            className="input"
            inputMode="decimal"
            value={form.openingBalance}
            onChange={(e) => update("openingBalance", e.target.value)}
          />
        </Field>
        <Field label="Opening balance type">
          <select
            className="select"
            value={form.openingBalanceType}
            onChange={(e) => update("openingBalanceType", e.target.value as CustomerFormState["openingBalanceType"])}
          >
            <option value="DEBIT">Debit (customer owes us)</option>
            <option value="CREDIT">Credit (we owe customer)</option>
          </select>
        </Field>
      </div>

      <div className="field">
        <label>Notes</label>
        <textarea
          className="input"
          rows={3}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
        />
      </div>

      <button type="submit" className="button buttonPrimary" disabled={submitting}>
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label>
        {label} {hint && <span className="hint">— {hint}</span>}
      </label>
      {children}
      {error && <span className="fieldError">{error}</span>}
    </div>
  );
}
