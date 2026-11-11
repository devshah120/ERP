"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordField, { passwordMeetsPolicy } from "@/components/auth/PasswordField";
import { GST_STATES } from "@/lib/gst/states";
import { IconAlertCircle, IconArrowLeft, IconArrowRight, IconCheck } from "@/components/icons";

interface RegisterForm {
  legalName: string;
  tradeName: string;
  businessType: string;
  domain: string;
  ownerName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  country: string;
  state: string;
  city: string;
  address: string;
  currency: string;
  timeZone: string;
  gstin: string;
  registrationNumber: string;
  financialYearStartMonth: number;
}

const initialForm: RegisterForm = {
  legalName: "",
  tradeName: "",
  businessType: "",
  domain: "",
  ownerName: "",
  username: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  country: "India",
  state: "",
  city: "",
  address: "",
  currency: "INR",
  timeZone: "Asia/Kolkata",
  gstin: "",
  registrationNumber: "",
  financialYearStartMonth: 4,
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BUSINESS_TYPES = ["Manufacturer", "Trader", "Wholesaler", "Retailer", "Exporter", "Manufacturer & Trader"];

type Key = keyof RegisterForm;

const STEPS: { title: string; blurb: string; fields: Key[] }[] = [
  {
    title: "Business",
    blurb: "Tell us about the business. The domain becomes your workspace ID at sign-in.",
    fields: ["legalName", "tradeName", "businessType", "domain", "gstin", "registrationNumber"],
  },
  {
    title: "Owner account",
    blurb: "You'll be the workspace owner with full access. You can invite others later.",
    fields: ["ownerName", "username", "email", "phone", "password", "confirmPassword"],
  },
  {
    title: "Location & books",
    blurb: "Your state decides CGST + SGST vs IGST on every invoice, so pick it carefully.",
    fields: ["country", "state", "city", "address", "currency", "timeZone", "financialYearStartMonth"],
  },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Client-side mirror of registerSchema, so most mistakes are caught before the round trip. */
function validate(form: RegisterForm, fields: Key[]): Partial<Record<Key, string>> {
  const e: Partial<Record<Key, string>> = {};
  const min2 = (k: Key, label: string) => {
    if (String(form[k]).trim().length < 2) e[k] = `${label} is required`;
  };
  for (const k of fields) {
    switch (k) {
      case "legalName": min2(k, "Legal name"); break;
      case "tradeName": min2(k, "Trade name"); break;
      case "businessType": min2(k, "Business type"); break;
      case "domain":
        if (!/^[a-z0-9-]{3,63}$/.test(form.domain.trim().toLowerCase()))
          e.domain = "3–63 characters: lowercase letters, numbers and hyphens";
        break;
      case "gstin":
        if (form.gstin.trim() && !/^[0-9]{2}[A-Z0-9]{13}$/i.test(form.gstin.trim()))
          e.gstin = "A GSTIN is 15 characters, starting with the 2-digit state code";
        break;
      case "ownerName": min2(k, "Your name"); break;
      case "username":
        if (!/^[a-z0-9._-]{3,32}$/.test(form.username.trim().toLowerCase()))
          e.username = "3–32 characters: letters, numbers, dot, underscore or hyphen";
        break;
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Enter a valid email address";
        break;
      case "phone":
        if (form.phone.trim().length < 7) e.phone = "Enter a valid phone number";
        break;
      case "password":
        if (!passwordMeetsPolicy(form.password)) e.password = "Password doesn't meet the requirements yet";
        break;
      case "confirmPassword":
        if (form.confirmPassword !== form.password) e.confirmPassword = "Passwords do not match";
        break;
      case "country": min2(k, "Country"); break;
      case "state": min2(k, "State"); break;
      case "city": min2(k, "City"); break;
      case "address": min2(k, "Address"); break;
      case "currency":
        if (form.currency.trim().length !== 3) e.currency = "Use a 3-letter currency code, e.g. INR";
        break;
      default:
        break;
    }
  }
  return e;
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<RegisterForm>(initialForm);
  const [step, setStep] = useState(0);
  const [domainTouched, setDomainTouched] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Key, string>>>({});

  function update<K extends Key>(key: K, value: RegisterForm[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Suggest a domain from the trade name until the user edits it themselves.
      if (key === "tradeName" && !domainTouched) next.domain = slugify(String(value));
      return next;
    });
    if (fieldErrors[key]) setFieldErrors((fe) => ({ ...fe, [key]: undefined }));
  }

  function goNext() {
    const errs = validate(form, STEPS[step].fields);
    setFieldErrors(errs);
    if (Object.keys(errs).length === 0) {
      setError(null);
      setStep((s) => s + 1);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (step < STEPS.length - 1) {
      goNext();
      return;
    }
    const errs = validate(form, STEPS[step].fields);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (!acceptTerms) {
      setError("Please confirm you're authorised to register this business.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        domain: form.domain.trim().toLowerCase(),
        username: form.username.trim().toLowerCase(),
        email: form.email.trim().toLowerCase(),
        gstin: form.gstin.trim() || undefined,
        registrationNumber: form.registrationNumber.trim() || undefined,
      };

      const result = await apiFetch<{ businessId: string; otpTarget: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
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
            if (typeof key === "string") next[key as Key] = issue.message;
          }
        }
        if (err.code === "DOMAIN_TAKEN") next.domain = "This domain is already taken — try another";
        setFieldErrors(next);
        // Jump back to the step that holds the first problem.
        const firstBad = STEPS.findIndex((s) => s.fields.some((f) => next[f]));
        if (firstBad >= 0) setStep(firstBad);
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
    }
  }

  const fe = fieldErrors;

  return (
    <AuthLayout
      wide
      topRight={
        <>
          <span className="hideMobile">Already registered?</span>
          <Link href="/login" className="button buttonSecondary buttonSm">
            Sign in
          </Link>
        </>
      }
    >
      <h1 className="title">Create your workspace</h1>
      <p className="subtitle">
        Takes about two minutes. We&apos;ll set up a default branch, warehouse and financial year for you.
      </p>

      <ol className="stepper" aria-label="Registration progress">
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ display: "contents" }} aria-current={i === step ? "step" : undefined}>
            {i > 0 && <span className="stepLine" />}
            <span className={`step ${i === step ? "stepActive" : ""} ${i < step ? "stepDone" : ""}`}>
              <span className="stepDot">{i < step ? <IconCheck /> : i + 1}</span>
              <span className="stepLabel">{s.title}</span>
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <p className="fieldHint" style={{ marginTop: "-0.5rem" }}>
          {STEPS[step].blurb}
        </p>

        {step === 0 && (
          <div className="formGrid">
            <Field id="legalName" label="Legal business name" error={fe.legalName}>
              <input id="legalName" className="input" value={form.legalName} onChange={(e) => update("legalName", e.target.value)} placeholder="Rangoli Textiles Pvt Ltd" autoComplete="organization" autoFocus aria-invalid={!!fe.legalName} />
            </Field>
            <Field id="tradeName" label="Trade name" error={fe.tradeName}>
              <input id="tradeName" className="input" value={form.tradeName} onChange={(e) => update("tradeName", e.target.value)} placeholder="Rangoli Textiles" aria-invalid={!!fe.tradeName} />
            </Field>
            <Field id="businessType" label="Business type" error={fe.businessType}>
              <input id="businessType" className="input" list="business-types" value={form.businessType} onChange={(e) => update("businessType", e.target.value)} placeholder="Choose or type" aria-invalid={!!fe.businessType} />
              <datalist id="business-types">
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field id="domain" label="Workspace domain" hint="Used to sign in" error={fe.domain}>
              <input
                id="domain"
                className="input"
                value={form.domain}
                onChange={(e) => {
                  setDomainTouched(true);
                  update("domain", e.target.value.toLowerCase());
                }}
                placeholder="rangoli-textiles"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!!fe.domain}
              />
            </Field>
            <Field id="gstin" label="GSTIN" hint="Optional" error={fe.gstin}>
              <input id="gstin" className="input" value={form.gstin} onChange={(e) => update("gstin", e.target.value.toUpperCase())} placeholder="24AAACR1234A1Z5" maxLength={15} aria-invalid={!!fe.gstin} />
            </Field>
            <Field id="registrationNumber" label="Registration number" hint="Optional">
              <input id="registrationNumber" className="input" value={form.registrationNumber} onChange={(e) => update("registrationNumber", e.target.value)} placeholder="CIN / Udyam no." />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="formGrid">
            <Field id="ownerName" label="Your full name" error={fe.ownerName}>
              <input id="ownerName" className="input" value={form.ownerName} onChange={(e) => update("ownerName", e.target.value)} placeholder="Asha Rao" autoComplete="name" autoFocus aria-invalid={!!fe.ownerName} />
            </Field>
            <Field id="username" label="Username" error={fe.username}>
              <input id="username" className="input" value={form.username} onChange={(e) => update("username", e.target.value.toLowerCase())} placeholder="asha" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={!!fe.username} />
            </Field>
            <Field id="email" label="Work email" hint="We'll send a code here" error={fe.email}>
              <input id="email" className="input" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="asha@rangoli.com" autoComplete="email" aria-invalid={!!fe.email} />
            </Field>
            <Field id="phone" label="Phone" error={fe.phone}>
              <input id="phone" className="input" type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="98765 43210" autoComplete="tel" aria-invalid={!!fe.phone} />
            </Field>
            <PasswordField id="password" label="Password" value={form.password} onChange={(v) => update("password", v)} autoComplete="new-password" showStrength error={fe.password} />
            <PasswordField id="confirmPassword" label="Confirm password" value={form.confirmPassword} onChange={(v) => update("confirmPassword", v)} autoComplete="new-password" error={fe.confirmPassword} />
          </div>
        )}

        {step === 2 && (
          <>
            <div className="formGrid">
              <Field id="state" label="State" hint="Drives GST" error={fe.state}>
                <select id="state" className="select" value={form.state} onChange={(e) => update("state", e.target.value)} aria-invalid={!!fe.state} autoFocus>
                  <option value="">Select state…</option>
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="city" label="City" error={fe.city}>
                <input id="city" className="input" value={form.city} onChange={(e) => update("city", e.target.value)} placeholder="Surat" autoComplete="address-level2" aria-invalid={!!fe.city} />
              </Field>
              <div className="fieldSpanFull">
                <Field id="address" label="Address" error={fe.address}>
                  <input id="address" className="input" value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="Unit 12, Ring Road Textile Market" autoComplete="street-address" aria-invalid={!!fe.address} />
                </Field>
              </div>
              <Field id="country" label="Country" error={fe.country}>
                <input id="country" className="input" value={form.country} onChange={(e) => update("country", e.target.value)} autoComplete="country-name" />
              </Field>
              <Field id="financialYearStartMonth" label="Financial year starts in">
                <select id="financialYearStartMonth" className="select" value={form.financialYearStartMonth} onChange={(e) => update("financialYearStartMonth", Number(e.target.value))}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="currency" label="Currency" error={fe.currency}>
                <input id="currency" className="input" maxLength={3} value={form.currency} onChange={(e) => update("currency", e.target.value.toUpperCase())} />
              </Field>
              <Field id="timeZone" label="Time zone">
                <input id="timeZone" className="input" value={form.timeZone} onChange={(e) => update("timeZone", e.target.value)} />
              </Field>
            </div>

            <label className="checkboxRow" style={{ alignItems: "flex-start", marginTop: "0.25rem" }}>
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} style={{ marginTop: "0.15rem" }} />
              <span>
                I&apos;m authorised to register <strong>{form.legalName || "this business"}</strong> and agree to keep
                the account credentials confidential and the data entered accurate.
              </span>
            </label>
          </>
        )}

        <div className="authRowBetween" style={{ marginTop: "0.5rem" }}>
          {step > 0 ? (
            <button type="button" className="button buttonGhost" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
              <IconArrowLeft /> Back
            </button>
          ) : (
            <span className="legalNote">Step 1 of {STEPS.length}</span>
          )}
          <button type="submit" className="button buttonPrimary buttonLg" disabled={submitting}>
            {submitting && <span className="spinner" />}
            {step < STEPS.length - 1 ? (
              <>
                Continue <IconArrowRight />
              </>
            ) : submitting ? (
              "Creating workspace…"
            ) : (
              "Create workspace"
            )}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {hint && <span className="hint">· {hint}</span>}
      </label>
      {children}
      {error && <span className="fieldError">{error}</span>}
    </div>
  );
}
