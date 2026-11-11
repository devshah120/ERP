"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../AuthProvider";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { useToast } from "@/components/ui/Toast";
import { IconAlertCircle, IconInfo } from "@/components/icons";

interface PrefixRow {
  documentType: string;
  label: string;
  group: string;
  defaultPrefix: string;
  prefix: string;
  padding: number;
  customised: boolean;
  issued: number;
}

/**
 * Numbering format for every document type. A change applies to the next
 * number issued; documents already numbered keep their number.
 */
export default function DocumentPrefixesPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canEdit = hasPermission("document-prefixes.edit");

  const [rows, setRows] = useState<PrefixRow[] | null>(null);
  const [fy, setFy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { prefix: string; padding: number }>>({});
  const [error, setError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<{ financialYear: string | null; items: PrefixRow[] }>("/api/document-prefixes");
      setRows(res.items);
      setFy(res.financialYear);
      setEdits({});
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const dirty = Object.keys(edits).length > 0;
  useUnsavedChangesWarning(dirty && !saving);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch<{ financialYear: string | null; items: PrefixRow[] }>("/api/document-prefixes", {
        method: "PUT",
        body: JSON.stringify({ items: Object.entries(edits).map(([documentType, v]) => ({ documentType, ...v })) }),
      });
      setRows(res.items);
      setEdits({});
      toast.success("Prefixes saved", "New documents use them from now on.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  useShortcutScope({ onSave: () => void save(), onRefresh: load });

  const groups = useMemo(() => {
    const map = new Map<string, PrefixRow[]>();
    for (const r of rows ?? []) map.set(r.group, [...(map.get(r.group) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  function value(r: PrefixRow) {
    return edits[r.documentType] ?? { prefix: r.prefix, padding: r.padding };
  }

  function change(r: PrefixRow, patch: Partial<{ prefix: string; padding: number }>) {
    setEdits((e) => {
      const next = { ...value(r), ...patch };
      const copy = { ...e };
      if (next.prefix === r.prefix && next.padding === r.padding) delete copy[r.documentType];
      else copy[r.documentType] = next;
      return copy;
    });
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="Document Prefix"
        description="The prefix and number length on every numbered document. Numbers restart each financial year."
        actions={
          canEdit && (
            <button type="button" className="button buttonPrimary" onClick={save} disabled={!dirty || saving}>
              {saving && <span className="spinner" />}
              {saving ? "Saving…" : dirty ? `Save ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? "" : "s"}` : "Saved"}
            </button>
          )
        }
      />

      <div className="banner bannerInfo" style={{ marginBottom: "1rem" }}>
        <IconInfo />
        <span>A new prefix applies to the next number issued. Documents already numbered keep their number, and the running count is not reset.</span>
      </div>
      {saveError && (
        <div className="banner bannerError" role="alert" style={{ marginBottom: "1rem" }}>
          <IconAlertCircle />
          <span>{saveError}</span>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Document</th>
              <th style={{ width: "9rem" }}>Prefix</th>
              <th style={{ width: "8rem" }}>Digits</th>
              <th>Next number{fy ? ` (${fy})` : ""}</th>
              <th className="numCell">Issued this year</th>
            </tr>
          </thead>
          <tbody>
            {!rows && !error && <SkeletonRows columns={5} rows={8} />}
            {error !== null && (
              <tr>
                <td colSpan={5}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load prefixes"} onRetry={load} />
                </td>
              </tr>
            )}
            {groups.map(([group, list]) => [
              <tr key={`g-${group}`}>
                <td colSpan={5} className="cellMuted" style={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em", background: "var(--surface-sunken, transparent)" }}>
                  {group}
                </td>
              </tr>,
              ...list.map((r) => {
                const v = value(r);
                const next = `${v.prefix || "?"}-${fy ?? "YYYY-YYYY"}-${String(r.issued + 1).padStart(v.padding, "0")}`;
                return (
                  <tr key={r.documentType}>
                    <td className="cellPrimary">
                      {r.label}
                      {(r.customised || edits[r.documentType]) && v.prefix !== r.defaultPrefix && (
                        <span className="cellSub">Default: {r.defaultPrefix}</span>
                      )}
                    </td>
                    <td>
                      <input
                        className="input cellMono"
                        value={v.prefix}
                        maxLength={8}
                        disabled={!canEdit}
                        aria-label={`${r.label} prefix`}
                        onChange={(e) => change(r, { prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                      />
                    </td>
                    <td>
                      <select className="select" value={v.padding} disabled={!canEdit} aria-label={`${r.label} digits`} onChange={(e) => change(r, { padding: Number(e.target.value) })}>
                        {[3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="cellMono">{next}</td>
                    <td className="numCell tabular">{r.issued}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}
