"use client";

import { useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";

export interface ClaimAttachmentInfo {
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * The bill attached to a claim: a link that opens it, and (when `canEdit`)
 * a button to attach or replace it. `baseUrl` is the claim's API path,
 * e.g. /api/hr/claims/:id or /api/hr/self/claims/:id.
 */
export default function ClaimAttachment({
  baseUrl,
  attachment,
  canEdit,
  onChange,
}: {
  baseUrl: string;
  attachment: ClaimAttachmentInfo | null | undefined;
  canEdit?: boolean;
  onChange?: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("The bill is larger than 10 MB");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch(`${baseUrl}/attachment`, { method: "POST", body });
      toast.success("Bill attached");
      onChange?.();
    } catch (err) {
      toast.error("Could not attach the bill", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  if (!attachment && !canEdit) return null;

  return (
    <div className="hrMuted" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      {attachment && (
        <a href={`${baseUrl}/attachment`} target="_blank" rel="noopener noreferrer" className="textLink" title={attachment.fileName}>
          📎 View bill
        </a>
      )}
      {canEdit && (
        <>
          <button type="button" className="textLink" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : attachment ? "Replace" : "Attach bill"}
          </button>
          <input ref={input} type="file" hidden accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(e) => upload(e.target.files?.[0])} />
        </>
      )}
    </div>
  );
}
