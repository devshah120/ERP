"use client";

import { useState } from "react";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";
import { IconWarning } from "@/components/icons";

/**
 * Confirmation for anything destructive. Destructive actions ask for a typed
 * reason where the server will record one, so the audit log says *why* a
 * document was cancelled rather than only that it was.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  requireReason = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  requireReason?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  useEscapeHandler(onCancel, !busy);

  const blocked = requireReason && reason.trim().length === 0;

  return (
    <div className="modalBackdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="modalCard confirmCard"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modalHeader">
          <div className="confirmHeading">
            <span className={`confirmIcon confirmIcon-${tone}`}>
              <IconWarning />
            </span>
            <div>
              <div className="modalTitle">{title}</div>
              <div className="modalSubtitle">{message}</div>
            </div>
          </div>
        </div>

        {requireReason && (
          <div className="modalBody">
            <div className="field">
              <label htmlFor="confirm-reason">Reason (recorded in the audit log)</label>
              <input
                id="confirm-reason"
                className="input"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Raised against the wrong customer"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="modalBody" style={{ paddingTop: 0 }}>
            <div className="banner bannerError">{error}</div>
          </div>
        )}

        <div className="modalFooter">
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="button buttonSecondary" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className={`button ${tone === "danger" ? "buttonDanger" : "buttonPrimary"}`}
              onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
              disabled={busy || blocked}
            >
              {busy && <span className="spinner" />}
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
