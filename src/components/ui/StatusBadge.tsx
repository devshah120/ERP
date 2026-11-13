"use client";

import Chip from "@mui/material/Chip";
import { statusClass } from "@/lib/documents/ui";

/** "PARTIALLY_DELIVERED" → "Partially delivered". */
export function humanizeStatus(status: string): string {
  const s = status.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Modernized status badge built on MUI Chip.
 * Maps document and payment states to semantic colors with compact enterprise styling.
 */
export default function StatusBadge({
  status,
  kind = "document",
}: {
  status: string | null | undefined;
  kind?: "document" | "payment" | "active";
}) {
  if (!status) return <span className="cellMuted">—</span>;

  let color: "success" | "warning" | "error" | "info" | "default" = "default";
  const rawClass =
    kind === "payment"
      ? status === "PAID"
        ? "badgeSuccess"
        : status === "PARTIALLY_PAID"
          ? "badgeWarning"
          : "badgeNeutral"
      : kind === "active"
        ? status === "ACTIVE"
          ? "badgeSuccess"
          : "badgeNeutral"
        : statusClass(status);

  if (rawClass.includes("Success")) color = "success";
  else if (rawClass.includes("Warning") || rawClass.includes("Warn")) color = "warning";
  else if (rawClass.includes("Danger") || rawClass.includes("Error") || rawClass.includes("bad")) color = "error";
  else if (rawClass.includes("Info") || rawClass.includes("Accent")) color = "info";

  return (
    <Chip
      size="small"
      label={humanizeStatus(status)}
      title={status}
      color={color}
      sx={{
        height: 22,
        fontSize: "0.75rem",
        fontWeight: 600,
        borderRadius: "4px",
        ...(color === "default" && {
          bgcolor: "var(--surface-muted, #f1f5f9)",
          color: "var(--text-secondary, #64748b)",
          border: "1px solid var(--border, #e2e8f0)",
        }),
      }}
    />
  );
}
