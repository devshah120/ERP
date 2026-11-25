"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SAHeader, { PLAN_OPTIONS } from "../../SAHeader";
import { IconAlertCircle, IconCheckCircle } from "@/components/icons";
import { PRODUCTS, PRODUCT_LABELS, type Product } from "@/lib/products";
import Select from "@/components/ui/Select";

const PRODUCT_BLURB: Record<Product, string> = {
  ERP: "Sales, purchase, stock, POS, GST and accounting.",
  HRMS: "Employees, attendance, leave, payroll with PF/ESI/PT, payslips and self-service.",
};

/** A strong random password that meets the app's policy, so the owner always gets a valid one. */
function generatePassword(): string {
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "@#$%&*!";
  const all = lower + upper + digits;
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols), ...Array.from({ length: 8 }, () => pick(all))];
  return chars.sort(() => Math.random() - 0.5).join("");
}

function inAYear(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

interface Created {
  businessId: string;
  domain: string;
  loginEmail: string;
}

export default function NewAccountPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: "",
    tradeName: "",
    ownerName: "",
    email: "",
    phone: "",
    password: generatePassword(),
    country: "India",
    state: "",
    city: "",
    gstin: "",
    financialYearStartMonth: "4",
    products: ["HRMS"] as Product[],
    plan: "STARTER",
    maxEmployees: "25",
    subscriptionEndsAt: inAYear(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  function toggleProduct(p: Product) {
    set("products", form.products.includes(p) ? form.products.filter((x) => x !== p) : [...form.products, p]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const res = await fetch("/api/superadmin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          financialYearStartMonth: Number(form.financialYearStartMonth),
          maxEmployees: form.maxEmployees ? Number(form.maxEmployees) : null,
        }),
      });
      if (res.status === 401) {
        router.replace("/superadmin/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        if (Array.isArray(json.errors)) {
          const next: Record<string, string> = {};
          for (const i of json.errors as { path?: (string | number)[]; message: string }[]) if (i.path?.length) next[String(i.path[0])] = i.message;
          setErrors(next);
        }
        throw new Error(json.message ?? "Could not create the account");
      }
      setCreated(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setSaving(false);
    }
  }

  const credentials = created
    ? `Workspace: ${form.tradeName || form.legalName}\nProducts: ${form.products.join(" + ")}\nSign in at: ${typeof window !== "undefined" ? window.location.origin : ""}/login\nEmail: ${created.loginEmail}\nTemporary password: ${form.password}`
    : "";

  async function copyCredentials() {
    try {
      await navigator.clipboard.writeText(credentials);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const err = (k: string) => (errors[k] ? <span className="saFieldError">{errors[k]}</span> : null);
  const hasHr = form.products.includes("HRMS");

  return (
    <div className="saPage">
      <SAHeader />
      <main className="saMain" style={{ maxWidth: "56rem" }}>
        <div className="saBreadcrumb">
          <Link href="/superadmin/companies" className="saTextLink">← All Companies</Link>
        </div>
        <div className="saPageHead">
          <div>
            <h1 className="saPageTitle">New customer account</h1>
            <p className="saPageSub">Create a ready-to-use workspace and hand the owner their sign-in. It is active immediately.</p>
          </div>
        </div>

        {created ? (
          <section className="saPanel">
            <div className="saPanelHead">
              <h2 className="saPanelTitle">
                <IconCheckCircle style={{ verticalAlign: "middle", marginRight: "0.4rem", color: "#047857" }} />
                Account created
              </h2>
            </div>
            <div className="saPanelBody">
              <p style={{ marginTop: 0 }}>Share these details with the customer securely. They can set their own password any time with &ldquo;Forgot password&rdquo; on the sign-in page.</p>
              <div className="saCredentials">
                <div>Workspace: <strong>{form.tradeName || form.legalName}</strong></div>
                <div>Products: {form.products.join(" + ")}</div>
                <div>Sign-in page: <code>/login</code></div>
                <div>Email: <code>{created.loginEmail}</code></div>
                <div>Temporary password: <code>{form.password}</code></div>
              </div>
              <div className="saFormActions" style={{ justifyContent: "flex-start" }}>
                <button type="button" className="saBtn saBtnSecondary saBtnSm" onClick={copyCredentials}>
                  {copied ? "Copied" : "Copy details"}
                </button>
                <Link href={`/superadmin/companies/${created.businessId}`} className="saBtn saBtnPrimary saBtnSm">
                  Open company →
                </Link>
                <button type="button" className="saBtn saBtnGhost saBtnSm" onClick={() => window.location.reload()}>
                  Create another
                </button>
              </div>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} noValidate>
            {error && (
              <div className="saBanner saBannerError" style={{ marginBottom: "1rem" }} role="alert">
                <IconAlertCircle />
                <span>{error}</span>
              </div>
            )}

            <section className="saPanel" style={{ marginBottom: "1.25rem" }}>
              <div className="saPanelHead">
                <h2 className="saPanelTitle">What are they buying?</h2>
              </div>
              <div className="saPanelBody">
                <div className="saProductChoices">
                  {PRODUCTS.map((p) => (
                    <label key={p} className="saProductChoice" data-checked={form.products.includes(p)}>
                      <input type="checkbox" checked={form.products.includes(p)} onChange={() => toggleProduct(p)} />
                      <div>
                        <strong>{PRODUCT_LABELS[p]}</strong>
                        <span>{PRODUCT_BLURB[p]}</span>
                      </div>
                    </label>
                  ))}
                </div>
                {err("products")}
                <div className="saFormGrid" style={{ marginTop: "1.25rem" }}>
                  <div className="saField">
                    <label htmlFor="n-plan">Plan</label>
                    <Select id="n-plan" className="saInput" value={form.plan} onChange={(e) => set("plan", e.target.value)}>
                      {PLAN_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="saField">
                    <label htmlFor="n-until">Valid until</label>
                    <input id="n-until" type="date" className="saInput" value={form.subscriptionEndsAt} onChange={(e) => set("subscriptionEndsAt", e.target.value)} />
                    <span className="saHint">Sign-in stops after this date. Leave blank for no expiry.</span>
                  </div>
                  {hasHr && (
                    <div className="saField">
                      <label htmlFor="n-max">Employee limit</label>
                      <input id="n-max" type="number" min={1} className="saInput" value={form.maxEmployees} onChange={(e) => set("maxEmployees", e.target.value)} />
                      <span className="saHint">Most active employees they can add. Blank = unlimited.</span>
                      {err("maxEmployees")}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="saPanel" style={{ marginBottom: "1.25rem" }}>
              <div className="saPanelHead">
                <h2 className="saPanelTitle">Company</h2>
              </div>
              <div className="saPanelBody">
                <div className="saFormGrid">
                  <div className="saField">
                    <label htmlFor="n-legal">Legal name *</label>
                    <input id="n-legal" className="saInput" value={form.legalName} onChange={(e) => set("legalName", e.target.value)} placeholder="Rangoli Textiles Pvt Ltd" />
                    {err("legalName")}
                  </div>
                  <div className="saField">
                    <label htmlFor="n-trade">Trade name</label>
                    <input id="n-trade" className="saInput" value={form.tradeName} onChange={(e) => set("tradeName", e.target.value)} placeholder="Rangoli" />
                  </div>
                  <div className="saField">
                    <label htmlFor="n-state">State</label>
                    <input id="n-state" className="saInput" value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="Gujarat" />
                  </div>
                  <div className="saField">
                    <label htmlFor="n-city">City</label>
                    <input id="n-city" className="saInput" value={form.city} onChange={(e) => set("city", e.target.value)} />
                  </div>
                  <div className="saField">
                    <label htmlFor="n-gstin">GSTIN</label>
                    <input id="n-gstin" className="saInput" value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} placeholder="Optional" />
                    {err("gstin")}
                  </div>
                  <div className="saField">
                    <label htmlFor="n-fy">Financial year starts</label>
                    <Select id="n-fy" className="saInput" value={form.financialYearStartMonth} onChange={(e) => set("financialYearStartMonth", e.target.value)}>
                      <option value="4">April</option>
                      <option value="1">January</option>
                    </Select>
                  </div>
                </div>
              </div>
            </section>

            <section className="saPanel">
              <div className="saPanelHead">
                <h2 className="saPanelTitle">Owner login</h2>
              </div>
              <div className="saPanelBody">
                <div className="saFormGrid">
                  <div className="saField">
                    <label htmlFor="n-owner">Owner name *</label>
                    <input id="n-owner" className="saInput" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
                    {err("ownerName")}
                  </div>
                  <div className="saField">
                    <label htmlFor="n-email">Sign-in email *</label>
                    <input id="n-email" type="email" className="saInput" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" />
                    {err("email")}
                  </div>
                  <div className="saField">
                    <label htmlFor="n-phone">Phone</label>
                    <input id="n-phone" className="saInput" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                  </div>
                  <div className="saField">
                    <label htmlFor="n-pass">Temporary password *</label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input id="n-pass" className="saInput" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
                      <button type="button" className="saBtn saBtnSecondary saBtnSm" onClick={() => set("password", generatePassword())}>
                        New
                      </button>
                    </div>
                    <span className="saHint">Hand it over securely; they can change it with &ldquo;Forgot password&rdquo;.</span>
                    {err("password")}
                  </div>
                </div>
              </div>
            </section>

            <div className="saFormActions">
              <Link href="/superadmin/companies" className="saBtn saBtnGhost">Cancel</Link>
              <button type="submit" className="saBtn saBtnPrimary" disabled={saving || form.products.length === 0}>
                {saving && <span className="spinner" />}
                {saving ? "Creating…" : "Create account"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
