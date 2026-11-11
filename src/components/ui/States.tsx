import type { ReactNode } from "react";
import { IconAlertCircle, IconInbox, IconSearch } from "@/components/icons";

/**
 * Empty, error and loading placeholders. Every list and panel uses these so
 * "nothing here", "something broke" and "still loading" each look the same
 * everywhere — and each tells the user what to do next.
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  compact = false,
  variant = "empty",
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  variant?: "empty" | "search";
}) {
  return (
    <div className={`emptyState ${compact ? "emptyStateCompact" : ""}`}>
      <span className="emptyStateIcon" aria-hidden>
        {icon ?? (variant === "search" ? <IconSearch /> : <IconInbox />)}
      </span>
      <div className="emptyStateTitle">{title}</div>
      {description && <div className="emptyStateText">{description}</div>}
      {actions && <div className="emptyStateActions">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="emptyState emptyStateCompact" role="alert">
      <span className="emptyStateIcon danger" aria-hidden>
        <IconAlertCircle />
      </span>
      <div className="emptyStateTitle">{title}</div>
      <div className="emptyStateText">{message}</div>
      {onRetry && (
        <div className="emptyStateActions">
          <button type="button" className="button buttonSecondary" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

/** Varying widths so a skeleton reads as "rows of data", not a grey slab. */
const WIDTHS = ["70%", "55%", "85%", "40%", "65%", "50%", "75%"];

export function SkeletonRows({ rows = 6, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeletonRow" aria-hidden>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <span className="skeleton" style={{ width: WIDTHS[(r + c) % WIDTHS.length] }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonBlock({ lines = 3, height }: { lines?: number; height?: string }) {
  return (
    <div className="skeletonCard" aria-hidden>
      <span className="skeleton" style={{ width: "35%", height: "0.7rem" }} />
      {height ? (
        <span className="skeleton" style={{ width: "100%", height }} />
      ) : (
        Array.from({ length: lines }, (_, i) => (
          <span key={i} className="skeleton" style={{ width: WIDTHS[i % WIDTHS.length] }} />
        ))
      )}
    </div>
  );
}
