/**
 * Display formatting for the dashboard and analysis screens.
 *
 * These are presentation helpers only — they take the decimal *strings* the
 * API returns and never participate in arithmetic, so no money is ever run
 * through a JS float on its way to the screen.
 */

/** 1234567.5 → "12,34,567.50" (Indian grouping). */
export function formatMoney(value: string | number, decimals = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Compact Indian notation for tiles and axis labels: 1,25,000 → "1.25 L".
 * Full precision stays available in the tooltip/title attribute.
 */
export function formatCompact(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);

  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}${(abs / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `${sign}${(abs / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)} K`;
  return `${sign}${abs.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatQuantity(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export function formatCount(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-IN");
}

/** Formats by KPI kind so a count is never rendered with a rupee sign. */
export function formatByKind(
  value: string | number,
  kind: "money" | "count" | "quantity" | "percent",
  options: { compact?: boolean } = {}
): string {
  switch (kind) {
    case "money":
      return `₹${options.compact ? formatCompact(value) : formatMoney(value)}`;
    case "percent":
      return `${value}%`;
    case "quantity":
      return formatQuantity(value);
    default:
      return formatCount(value);
  }
}
