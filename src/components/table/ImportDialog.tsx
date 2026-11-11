"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

interface RowError {
  row: number;
  column?: string;
  message: string;
}

interface PreviewRow {
  row: number;
  values: Record<string, unknown>;
  errors: RowError[];
  duplicate?: boolean;
}

interface PreviewResult {
  title: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  rows: PreviewRow[];
  errors: RowError[];
  detectedHeaders: string[];
  missingHeaders: string[];
}

/**
 * Import flow: download template → upload → preview with row-level errors →
 * commit. Nothing is written until the user confirms, and the server refuses
 * a commit that still has errors.
 */
export default function ImportDialog({
  resource,
  title,
  onClose,
  onImported,
}: {
  resource: string;
  title: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Escape closes the dialog, but not mid-upload — cancelling a request the
  // server may already be committing would leave the user unsure what landed.
  useEscapeHandler(onClose, busy === null);

  async function downloadTemplate() {
    setBusy("template");
    setError(null);
    try {
      const res = await fetch(`/api/masters/${resource}/import/template`, { credentials: "include" });
      if (!res.ok) throw new Error(`Could not download template (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${resource}-import-template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  async function send(path: string, extra?: Record<string, string>) {
    if (!file) throw new Error("Choose a file first");
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);

    const res = await fetch(`/api/masters/${resource}/import/${path}`, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const body = await res.json().catch(() => ({}));
    if (!body?.success) throw new Error(body?.message ?? `Request failed (${res.status})`);
    return body;
  }

  async function runPreview(selected?: File) {
    const target = selected ?? file;
    if (!target) return;
    setBusy("preview");
    setError(null);
    setDone(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", target);
      const res = await fetch(`/api/masters/${resource}/import/preview`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!body?.success) throw new Error(body?.message ?? `Preview failed (${res.status})`);
      setPreview(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy("import");
    setError(null);
    try {
      const body = await send("commit", { skipDuplicates: String(skipDuplicates) });
      setDone(body.message ?? "Imported");
      toast.success("Import complete", body.message);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  const canImport = preview && preview.errorRows === 0 && preview.validRows + (skipDuplicates ? 0 : preview.duplicateRows) > 0;

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Import {title}</div>
            <div className="modalSubtitle">
              Download the template, fill it in, then upload to preview before saving.
            </div>
          </div>
          <button type="button" className="button buttonSecondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modalBody">
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
            <button type="button" className="button buttonSecondary" onClick={downloadTemplate} disabled={busy !== null}>
              {busy === "template" ? "Preparing..." : "Download sample template"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              className="input"
              style={{ fontSize: "0.85rem" }}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setDone(null);
                if (f) runPreview(f);
              }}
            />
            {busy === "preview" && <span className="activeFilterNote">Validating...</span>}
          </div>

          {error && <div className="banner bannerError" style={{ marginBottom: "1rem" }}>{error}</div>}
          {done && <div className="banner bannerSuccess" style={{ marginBottom: "1rem" }}>{done}</div>}

          {preview && (
            <>
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <span className="importStat">Total: {preview.totalRows}</span>
                <span className="importStat importStatOk">Ready: {preview.validRows}</span>
                <span className="importStat importStatWarn">Duplicates: {preview.duplicateRows}</span>
                <span className="importStat importStatBad">Errors: {preview.errorRows}</span>
              </div>

              {preview.missingHeaders.length > 0 && (
                <div className="banner bannerError" style={{ marginBottom: "1rem" }}>
                  Missing required column(s): {preview.missingHeaders.join(", ")}. Use the sample template.
                </div>
              )}

              {preview.duplicateRows > 0 && (
                <label className="checkboxRow" style={{ marginBottom: "0.9rem" }}>
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                  />
                  Skip {preview.duplicateRows} row(s) that already exist
                </label>
              )}

              <div className="tableWrap" style={{ maxHeight: "22rem", overflow: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: "4rem" }}>Row</th>
                      <th style={{ width: "7rem" }}>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const status = r.errors.length > 0 ? "ERROR" : r.duplicate ? "DUPLICATE" : "READY";
                      const cls =
                        status === "ERROR" ? "badgeDanger" : status === "DUPLICATE" ? "badgeWarning" : "badgeSuccess";
                      return (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>
                            <span className={`badge ${cls}`}>{status}</span>
                          </td>
                          <td>
                            {r.errors.length > 0 ? (
                              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                                {r.errors.map((e, i) => (
                                  <li key={i} style={{ color: "var(--danger)", fontSize: "0.8125rem" }}>
                                    {e.column ? <strong>{e.column}: </strong> : null}
                                    {e.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                                {Object.entries(r.values)
                                  .filter(([, v]) => typeof v !== "object" && v !== undefined && v !== "")
                                  .slice(0, 4)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join(" · ")}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="modalFooter">
          {preview && preview.errorRows > 0 && (
            <span className="activeFilterNote">
              Fix the {preview.errorRows} highlighted row(s) and upload again — nothing has been saved.
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="button buttonSecondary" onClick={onClose} disabled={busy !== null}>
              Cancel
            </button>
            <button
              type="button"
              className="button buttonPrimary"
              onClick={runImport}
              disabled={!canImport || busy !== null}
            >
              {busy === "import" ? "Importing..." : `Import ${preview?.validRows ?? 0} record(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
