"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../AuthProvider";
import { apiFetch, ApiError } from "@/lib/api/client";
import { GST_STATES, findStateByCode } from "@/lib/gst/states";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { IconBuilding, IconClock, IconEdit } from "@/components/icons";

function Row({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="settingsRow">
      <dt>{label}</dt>
      <dd className={mono ? "cellMono" : undefined}>{value || <span className="cellMuted">Not set</span>}</dd>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface Profile {
  tradeName: string;
  legalName: string;
  gstin: string;
  state: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  currency: string;
}

/**
 * Workspace settings: the business profile (editable with Settings · edit)
 * and the current financial year.
 */
export default function SettingsPage() {
  const { me, hasPermission } = useAuth();
  // Captured once per visit; "days remaining" needn't tick while the page is open.
  const [now] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  if (!me) return null;

  const fy = me.financialYear;
  const daysLeft = fy ? Math.ceil((new Date(fy.endDate).getTime() - now) / 86_400_000) : null;
  const canEdit = hasPermission("settings.edit");

  return (
    <>
      <PageHeader title="Workspace" description="Your business profile and books, as recorded at registration." />

      <div className="dashGrid">
        <section className="card span6" aria-labelledby="s-business">
          <div className="cardHeader">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className="reportCardIcon">
                <IconBuilding />
              </span>
              <div>
                <div className="cardTitle" id="s-business">
                  Business
                </div>
                <div className="cardSubtitle">Used on every document and for GST place of supply</div>
              </div>
            </div>
            {canEdit && (
              <button type="button" className="button buttonSecondary buttonIcon" onClick={() => setEditing(true)} aria-label="Edit business details" title="Edit business details">
                <IconEdit />
              </button>
            )}
          </div>
          <dl className="cardBody settingsList">
            <Row label="Name" value={me.business?.name} />
            <Row label="GSTIN" value={me.business?.gstin} mono />
            <Row label="State" value={me.business?.state} />
            <Row label="Phone" value={me.business?.phone} />
            <Row label="Email" value={me.business?.email} />
            <Row label="City" value={me.business?.city} />
            <Row label="Address" value={me.business?.address} />
            <Row label="Currency" value={me.business?.currency} />
          </dl>
        </section>

        <section className="card span6" aria-labelledby="s-fy">
          <div className="cardHeader">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className="reportCardIcon">
                <IconClock />
              </span>
              <div>
                <div className="cardTitle" id="s-fy">
                  Financial year
                </div>
                <div className="cardSubtitle">Document numbers restart each financial year</div>
              </div>
            </div>
          </div>
          <dl className="cardBody settingsList">
            <Row label="Current year" value={fy?.label} />
            <Row label="Starts" value={fy ? fmt(fy.startDate) : null} />
            <Row label="Ends" value={fy ? fmt(fy.endDate) : null} />
            <Row label="Remaining" value={daysLeft !== null ? (daysLeft > 0 ? `${daysLeft} days` : "Year has ended") : null} />
          </dl>
        </section>
      </div>


      {editing && <EditBusinessDialog onClose={() => setEditing(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Edit business                                                       */
/* ------------------------------------------------------------------ */

function EditBusinessDialog({ onClose }: { onClose: () => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Profile, string>>>({});

  // Load the full profile (including legal name and address) once, on open.
  useEffect(() => {
    apiFetch<Profile>("/api/business")
      .then(setForm)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load business details"));
  }, []);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }));
  }

  // With a GSTIN, the state is fixed by its first two digits.
  const gstState = form && /^[0-9]{2}/.test(form.gstin) ? findStateByCode(form.gstin.slice(0, 2)) : undefined;

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiFetch("/api/business", { method: "PUT", body: JSON.stringify({ ...form, state: gstState?.name ?? form.state }) });
      await refresh();
      toast.success("Business details saved");
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const next: Partial<Record<keyof Profile, string>> = {};
        for (const issue of (err.errors ?? []) as { path?: (string | number)[]; message: string }[]) {
          const k = issue.path?.[0];
          if (typeof k === "string") next[k as keyof Profile] = issue.message;
        }
        setFieldErrors(next);
      } else {
        setError("Could not save. Check your connection and try again.");
      }
      setSaving(false);
    }
  }

  const fe = fieldErrors;
  const field = (key: keyof Profile, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, span = false) => (
    <div className={`field ${span ? "fieldSpanFull" : ""}`}>
      <label htmlFor={`bp-${key}`}>{label}</label>
      <input id={`bp-${key}`} className="input" value={form?.[key] ?? ""} onChange={(e) => set(key, e.target.value)} aria-invalid={!!fe[key]} {...props} />
      {fe[key] && <span className="fieldError">{fe[key]}</span>}
    </div>
  );

  return (
    <Modal
      title="Edit business details"
      subtitle="Changes apply to new documents and labels; existing documents keep what they were saved with."
      onClose={onClose}
      busy={saving}
      width="40rem"
      footer={
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <button type="button" className="button buttonSecondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="button buttonPrimary" onClick={() => save()} disabled={saving || !form}>
            {saving && <span className="spinner" />} Save
          </button>
        </div>
      }
    >
      {loadError ? (
        <div className="banner bannerError">{loadError}</div>
      ) : !form ? (
        <div style={{ display: "grid", gap: "0.75rem" }} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skeleton" style={{ width: `${90 - i * 10}%` }} />
          ))}
        </div>
      ) : (
        <form className="form" onSubmit={save} noValidate>
          {error && (
            <div className="banner bannerError" role="alert">
              {error}
            </div>
          )}
          <div className="formGrid">
            {field("tradeName", "Business name", { autoFocus: true, maxLength: 200 })}
            {field("legalName", "Legal name", { maxLength: 200 })}
            {field("gstin", "GSTIN", { maxLength: 15, placeholder: "24AAACR1234A1Z5", onChange: (e) => set("gstin", e.target.value.toUpperCase()), spellCheck: false })}
            <div className="field">
              <label htmlFor="bp-state">State</label>
              <select
                id="bp-state"
                className="select"
                value={gstState?.name ?? form.state}
                onChange={(e) => set("state", e.target.value)}
                disabled={Boolean(gstState)}
                aria-invalid={!!fe.state}
              >
                <option value="">Select state…</option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
              <span className="fieldHint">{gstState ? "Set by the GSTIN's state code" : "Decides CGST + SGST vs IGST"}</span>
            </div>
            {field("phone", "Phone", { type: "tel", maxLength: 20 })}
            {field("email", "Email", { type: "email", maxLength: 150 })}
            {field("city", "City", { maxLength: 100 })}
            {field("currency", "Currency", { maxLength: 3, onChange: (e) => set("currency", e.target.value.toUpperCase()) })}
            {field("address", "Address", { maxLength: 300 }, true)}
          </div>
        </form>
      )}
    </Modal>
  );
}
