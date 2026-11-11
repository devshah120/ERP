"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import { useAuth } from "@/app/(app)/AuthProvider";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { IconPrint } from "@/components/icons";

export interface PrintLayoutChoice {
  /** Settings key of the document type (sales-invoices, pos-orders…). */
  docType: string;
  layoutId: string;
  savedId: string;
  options: { id: string; name: string }[];
}

/** The only interactive part of the print screen — kept as a small client
 *  island so the document sheet itself renders on the server. */
export default function PrintToolbar({ label, choice }: { label: string; choice?: PrintLayoutChoice }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [saving, setSaving] = useState(false);

  // Ctrl+P goes through the same handler as the button. The browser's own
  // print dialog would work too, but routing it here keeps one code path.
  useShortcutScope({ onPrint: () => window.print() });

  // A one-off layout is a URL parameter, so the server renders the sheet in it.
  function switchLayout(id: string) {
    router.replace(id === choice?.savedId ? pathname : `${pathname}?layout=${encodeURIComponent(id)}`);
  }

  async function makeDefault() {
    if (!choice) return;
    setSaving(true);
    try {
      const current = await apiFetch<Record<string, string>>("/api/settings/print-formats");
      await apiFetch("/api/settings/print-formats", {
        method: "PUT",
        body: JSON.stringify({ ...current, [choice.docType]: choice.layoutId }),
      });
      toast.success("Default print format saved");
      router.replace(pathname);
      router.refresh();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  const changed = choice && choice.layoutId !== choice.savedId;

  return (
    <div className="printToolbar">
      <div>
        <strong>Print preview</strong> — {label}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        {choice && choice.options.length > 1 && (
          <label className="pfmSwitcher">
            <span className="cellMuted">Format</span>
            <select className="select" value={choice.layoutId} onChange={(e) => switchLayout(e.target.value)} aria-label="Print format">
              {choice.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.id === choice.savedId ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {changed && hasPermission("settings.edit") && (
          <button type="button" className="button buttonSecondary" onClick={makeDefault} disabled={saving}>
            {saving && <span className="spinner" />} Make default
          </button>
        )}
        {choice && (
          <Link href={`/settings/print-formats?type=${encodeURIComponent(choice.docType)}`} className="button buttonGhost">
            Formats…
          </Link>
        )}
        <button type="button" className="button buttonSecondary" onClick={() => router.back()}>
          Back
        </button>
        <button type="button" className="button buttonPrimary" onClick={() => window.print()} title="Print (Ctrl + P)">
          <IconPrint /> Print
        </button>
      </div>
    </div>
  );
}
