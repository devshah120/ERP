"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordField, { passwordMeetsPolicy } from "@/components/auth/PasswordField";
import { IconAlertCircle } from "@/components/icons";

/**
 * Sign-up asks only for what's needed to open a store. The server fills the
 * rest: trade name = store name, state from the GST
 * number, India / INR / April financial year. All of it can be changed later.
 */
interface RegisterForm {
  legalName: string; // "Store name"
  gstin: string;
  phone: string;
  ownerName: string;
  email: string;
  password: string;
}

type Key = keyof RegisterForm;

const initialForm: RegisterForm = { legalName: "", gstin: "", phone: "", ownerName: "", email: "", password: "" };

/** Client-side mirror of registerSchema, so most mistakes are caught before the round trip. */
function validate(form: RegisterForm): Partial<Record<Key, string>> {
  const e: Partial<Record<Key, string>> = {};
  if (form.legalName.trim().length < 2) e.legalName = "Store name is required";
  if (form.gstin.trim() && !/^[0-9]{2}[A-Z0-9]{13}$/i.test(form.gstin.trim()))
    e.gstin = "A GST number is 15 characters, starting with the 2-digit state code";
  if (form.phone.trim() && form.phone.replace(/\D/g, "").length < 7) e.phone = "Enter a valid phone number";
  if (form.ownerName.trim().length < 2) e.ownerName = "Your name is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Enter a valid email address";
  if (!passwordMeetsPolicy(form.password)) e.password = "Password doesn't meet the requirements yet";
  return e;
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<RegisterForm>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Key, string>>>({});

  function update(key: Key, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((fe) => ({ ...fe, [key]: undefined }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{ businessId: string; otpTarget: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          legalName: form.legalName.trim(),
          gstin: form.gstin.trim() || undefined,
          phone: form.phone.trim() || undefined,
          ownerName: form.ownerName.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
        }),
      });
      router.push(`/verify-otp?businessId=${result.businessId}&target=${encodeURIComponent(result.otpTarget)}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        setError(err.message);
        const next: Partial<Record<Key, string>> = {};
        if (Array.isArray(err.errors)) {
          for (const issue of err.errors as { path?: (string | number)[]; message: string }[]) {
            const key = issue.path?.[0];
            if (typeof key === "string" && key in initialForm) next[key as Key] = issue.message;
          }
        }
        setFieldErrors(next);
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
    }
  }

  const fe = fieldErrors;

  return (
    <AuthLayout
      wide
      headline={["Your store,", "ready in", "a minute."]}
      lead="Create your workspace and start billing, tracking stock and filing GST from day one."
      tagline="No card needed. Just your email."
    >
      <h1 className="title">Create your store</h1>
      <p className="subtitle">Set up your store account in under a minute.</p>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <h2 className="regSection">
          <span>1</span> Business details
        </h2>
        <Field id="legalName" label="Store name" required error={fe.legalName}>
          <input
            id="legalName"
            className="input"
            value={form.legalName}
            onChange={(e) => update("legalName", e.target.value)}
            placeholder="e.g. Rangoli Textiles"
            autoComplete="organization"
            autoFocus
            aria-invalid={!!fe.legalName}
          />
        </Field>
        <div className="formGrid">
          <Field id="gstin" label="GST number" hint="Optional" error={fe.gstin}>
            <input
              id="gstin"
              className="input"
              value={form.gstin}
              onChange={(e) => update("gstin", e.target.value.toUpperCase())}
              placeholder="24AAACR1234A1Z5"
              maxLength={15}
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={!!fe.gstin}
            />
          </Field>
          <Field id="phone" label="Phone" hint="Optional" error={fe.phone}>
            <input
              id="phone"
              className="input"
              type="tel"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="98765 43210"
              autoComplete="tel"
              aria-invalid={!!fe.phone}
            />
          </Field>
        </div>

        <hr className="regDivider" />

        <h2 className="regSection">
          <span>2</span> Your account
        </h2>
        <Field id="ownerName" label="Your name" required error={fe.ownerName}>
          <input
            id="ownerName"
            className="input"
            value={form.ownerName}
            onChange={(e) => update("ownerName", e.target.value)}
            placeholder="Full name"
            autoComplete="name"
            aria-invalid={!!fe.ownerName}
          />
        </Field>
        <Field id="email" label="Email" required error={fe.email}>
          <input
            id="email"
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@business.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!fe.email}
          />
        </Field>
        <PasswordField
          id="password"
          label={
            <>
              Password
              <span className="regRequired" aria-hidden>
                {" "}
                *
              </span>
            </>
          }
          value={form.password}
          onChange={(v) => update("password", v)}
          autoComplete="new-password"
          showStrength
          error={fe.password}
        />

        <button type="submit" className="button buttonPrimary buttonLg buttonBlock" disabled={submitting}>
          {submitting && <span className="spinner" />}
          {submitting ? "Sending OTP…" : "Send OTP"}
        </button>
      </form>

      <p className="footerRow" style={{ textAlign: "center" }}>
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

function Field({
  id,
  label,
  hint,
  required = false,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="regRequired" aria-hidden>
            {" "}
            *
          </span>
        )}
        {hint && <span className="hint"> {hint}</span>}
      </label>
      {children}
      {error && <span className="fieldError">{error}</span>}
    </div>
  );
}
