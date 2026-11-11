"use client";

import type { ReactNode } from "react";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";
import { IconClose } from "@/components/icons";

/** A dialog with the same chrome as ConfirmDialog, for small forms. */
export default function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  busy = false,
  width = "34rem",
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  width?: string;
}) {
  useEscapeHandler(onClose, !busy);
  return (
    <div className="modalBackdrop" onClick={busy ? undefined : onClose}>
      <div className="modalCard" style={{ maxWidth: width, width: "100%" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modalHeader" style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
          <div style={{ flex: 1 }}>
            <div className="modalTitle">{title}</div>
            {subtitle && <div className="modalSubtitle">{subtitle}</div>}
          </div>
          <button type="button" className="iconButton" onClick={onClose} disabled={busy} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="modalBody">{children}</div>
        {footer && <div className="modalFooter">{footer}</div>}
      </div>
    </div>
  );
}
