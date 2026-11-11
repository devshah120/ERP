import { statusClass } from "@/lib/documents/ui";

/** "PARTIALLY_DELIVERED" → "Partially delivered". */
export function humanizeStatus(status: string): string {
  const s = status.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PAYMENT_CLASS: Record<string, string> = {
  PAID: "badgeSuccess",
  PARTIALLY_PAID: "badgeWarning",
  UNPAID: "badgeNeutral",
};

/**
 * One badge for every status in the product. Colour comes from the shared
 * status → tone map, so "Posted" is the same green on a list, a form and the
 * dashboard.
 */
export default function StatusBadge({
  status,
  kind = "document",
}: {
  status: string | null | undefined;
  kind?: "document" | "payment" | "active";
}) {
  if (!status) return <span className="cellMuted">—</span>;
  const cls =
    kind === "payment"
      ? PAYMENT_CLASS[status] ?? "badgeNeutral"
      : kind === "active"
        ? status === "ACTIVE"
          ? "badgeSuccess"
          : "badgeNeutral"
        : statusClass(status);
  return (
    <span className={`badge ${cls}`} title={status}>
      {humanizeStatus(status)}
    </span>
  );
}
