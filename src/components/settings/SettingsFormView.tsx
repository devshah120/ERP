"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import { SETTINGS_SECTIONS } from "@/lib/settings/definitions";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonBlock } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import SimpleField from "@/components/forms/SimpleField";
import { IconAlertCircle, IconArrowLeft, IconInfo } from "@/components/icons";

/** One settings section as an editable form. Read-only without settings.edit. */
export default function SettingsFormView({ sectionKey }: { sectionKey: string }) {
  const section = SETTINGS_SECTIONS[sectionKey];
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canEdit = hasPermission("settings.edit");

  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [options, setOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Record<string, unknown>>(`/api/settings/${section.key}`)
      .then((v) => !cancelled && setValues(v))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load settings"));

    const refs = section.fields.filter((f) => f.type === "reference" && f.reference);
    Promise.all(
      refs.map(async (f) => {
        const res = await apiFetch<{ items: Record<string, unknown>[] }>(`/api/masters/${f.reference!.resource}?pageSize=200&status=ACTIVE`);
        return [f.name, res.items.map((i) => ({ value: String(i.id), label: String(i[f.reference!.labelField] ?? i.id) }))] as const;
      })
    )
      .then((entries) => !cancelled && setOptions(Object.fromEntries(entries)))
      .catch(() => {
        /* the picker stays empty; saving still works */
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  useUnsavedChangesWarning(dirty && !saving);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!values || !canEdit) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const saved = await apiFetch<Record<string, unknown>>(`/api/settings/${section.key}`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      setValues(saved);
      setDirty(false);
      toast.success(`${section.title} saved`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (Array.isArray(err.errors)) {
          const next: Record<string, string> = {};
          for (const issue of err.errors as { path?: (string | number)[]; message: string }[]) {
            if (issue.path?.length) next[issue.path.join(".")] = issue.message;
          }
          setFieldErrors(next);
        }
      } else setError("Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: () => void save() });

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/settings" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Settings
          </Link>
        }
        title={section.title}
        description={section.description}
      />

      <div style={{ maxWidth: "62rem" }}>
        <div className="banner bannerInfo" style={{ marginBottom: "1rem" }}>
          <IconInfo />
          <span>
            <strong>Where this applies:</strong> {section.usedBy}
          </span>
        </div>
        {!canEdit && (
          <div className="banner bannerLocked" style={{ marginBottom: "1rem" }}>
            <span>You can view these settings. Changing them needs the Settings · edit permission.</span>
          </div>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!values && !error && <SkeletonBlock lines={5} />}

        {values && (
          <form onSubmit={save}>
            <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
              <section className="formSection">
                <div className="formSectionBody">
                  <div className="formGrid">
                    {section.fields.map((f) => (
                      <SimpleField
                        key={f.name}
                        field={f}
                        value={values[f.name]}
                        options={options[f.name]}
                        error={fieldErrors[f.name]}
                        onChange={(v) => {
                          setValues((s) => ({ ...(s ?? {}), [f.name]: v }));
                          setDirty(true);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </section>
            </fieldset>
            {canEdit && (
              <div className="formActionsBar">
                <span className="formActionsNote">
                  {dirty ? "Unsaved changes" : "All changes saved"}
                  <span className="hideMobile"> · Ctrl + S to save</span>
                </span>
                <Button
                  type="submit"
                  variant="contained"
                  size="small"
                  disabled={saving || !dirty}
                  startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
                  disableElevation
                  sx={{ textTransform: "none", fontWeight: 600 }}
                >
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
            )}
          </form>
        )}
      </div>
    </>
  );
}
