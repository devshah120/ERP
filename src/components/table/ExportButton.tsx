"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { IconChevronDown, IconDownload } from "@/components/icons";

/**
 * Triggers a download from an export endpoint, carrying the caller's current
 * filters and column selection so the file matches the screen exactly.
 *
 * The request goes through fetch (rather than a plain link) so that an error
 * response surfaces as a message instead of downloading a file full of JSON.
 */
export interface ExportButtonHandle {
  /** Opens the format menu — used by the Ctrl+E shortcut. */
  open: () => void;
}

export default function ExportButton({
  endpoint,
  params,
  disabled,
  ref,
}: {
  endpoint: string;
  params: () => URLSearchParams;
  disabled?: boolean;
  ref?: Ref<ExportButtonHandle>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  async function download(format: "xlsx" | "csv") {
    setBusy(format);
    setError(null);
    setOpen(false);
    try {
      const search = params();
      search.set("format", format);

      const res = await fetch(`${endpoint}?${search.toString()}`, { credentials: "include" });
      if (!res.ok) {
        let message = `Export failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
        } catch {
          // Non-JSON error body — keep the status-based message.
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `export.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="columnPicker" ref={wrapRef}>
      <button
        type="button"
        className="button buttonSecondary"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy !== null}
        title="Export the filtered data with the selected columns (Ctrl + E)"
      >
        {busy ? <span className="spinner" /> : <IconDownload />}
        {busy ? `Exporting ${busy.toUpperCase()}…` : "Export"}
        <IconChevronDown style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }} />
      </button>

      {open && (
        <div className="columnPickerPanel" style={{ minWidth: "14rem", left: "auto", right: 0 }}>
          <button type="button" className="exportOption" onClick={() => download("xlsx")}>
            Excel (.xlsx)
          </button>
          <button type="button" className="exportOption" onClick={() => download("csv")}>
            CSV (.csv)
          </button>
          <div className="exportNote">Exports all filtered rows using your selected columns.</div>
        </div>
      )}

      {error && (
        <div className="banner bannerError" role="alert" style={{ position: "absolute", top: "100%", right: 0, marginTop: "0.4rem", zIndex: 40, minWidth: "16rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}
