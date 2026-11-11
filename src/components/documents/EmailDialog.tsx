"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

/**
 * Sends a document to its party. The address defaults to the one snapshotted
 * onto the document but stays editable, because the person who should
 * receive an invoice is often not the contact stored on the master record.
 */
export default function EmailDialog({
  docType,
  docId,
  documentNumber,
  defaultTo,
  label,
  onClose,
}: {
  docType: string;
  docId: string;
  documentNumber: string;
  defaultTo?: string;
  label: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(defaultTo ?? "");
  const toast = useToast();
  const [subject, setSubject] = useState(`${label} ${documentNumber}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEscapeHandler(onClose, !busy);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (to.trim()) body.to = to.trim();
      if (subject.trim()) body.subject = subject.trim();
      await apiFetch(`/api/documents/${docType}/${docId}/email`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSent(to.trim() || defaultTo || "the recipient");
      toast.success("Email sent", to.trim() || defaultTo || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBackdrop" onClick={busy ? undefined : onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Email ${label}`}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Email {label} {documentNumber}</div>
            <div className="modalSubtitle">
              Sends a formatted summary with line items, the GST breakup and the total in words.
            </div>
          </div>
          <button type="button" className="button buttonSecondary" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="modalBody">
          {sent ? (
            <div className="banner bannerSuccess">Sent to {sent}.</div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="email-to">To</label>
                <input
                  id="email-to"
                  className="input"
                  type="email"
                  autoFocus
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder={defaultTo ? defaultTo : "name@example.com"}
                />
                <span className="hint">
                  {defaultTo
                    ? "Defaults to the address on the document."
                    : "No address is stored on this document — enter one."}
                </span>
              </div>
              <div className="field">
                <label htmlFor="email-subject">Subject</label>
                <input
                  id="email-subject"
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              {error && <div className="banner bannerError">{error}</div>}
            </>
          )}
        </div>

        <div className="modalFooter">
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="button buttonSecondary" onClick={onClose} disabled={busy}>
              {sent ? "Done" : "Cancel"}
            </button>
            {!sent && (
              <button
                type="button"
                className="button buttonPrimary"
                onClick={send}
                disabled={busy || (!to.trim() && !defaultTo)}
              >
                {busy ? "Sending…" : "Send email"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
