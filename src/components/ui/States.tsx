"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Skeleton from "@mui/material/Skeleton";
import { IconAlertCircle, IconInbox, IconSearch } from "@/components/icons";

/**
 * Modernized Empty, Error and Loading placeholders built on Material UI.
 * Provides consistent elevation, typography and responsive layout.
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
    <Box
      className={`emptyState ${compact ? "emptyStateCompact" : ""}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        p: compact ? 3 : 5,
        bgcolor: "var(--surface, #ffffff)",
        borderRadius: 2,
        border: "1px dashed",
        borderColor: "divider",
      }}
    >
      <Box
        className="emptyStateIcon"
        aria-hidden
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: "50%",
          bgcolor: "var(--surface-muted, #f1f5f9)",
          color: "text.secondary",
          mb: 1.5,
          "& svg": { width: 22, height: 22 },
        }}
      >
        {icon ?? (variant === "search" ? <IconSearch /> : <IconInbox />)}
      </Box>
      <Typography variant="subtitle1" className="emptyStateTitle" sx={{ fontWeight: 600, color: "text.primary" }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" className="emptyStateText" sx={{ color: "text.secondary", maxWidth: 420, mt: 0.5, fontSize: "0.8125rem" }}>
          {description}
        </Typography>
      )}
      {actions && (
        <Box className="emptyStateActions" sx={{ mt: 2, display: "flex", gap: 1 }}>
          {actions}
        </Box>
      )}
    </Box>
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
    <Alert
      severity="error"
      icon={<IconAlertCircle />}
      action={
        onRetry ? (
          <Button color="error" size="small" variant="outlined" onClick={onRetry} sx={{ borderRadius: 1 }}>
            Try again
          </Button>
        ) : undefined
      }
      sx={{
        borderRadius: 2,
        my: 2,
        alignItems: "center",
      }}
    >
      <AlertTitle sx={{ fontWeight: 600, fontSize: "0.875rem", mb: 0.25 }}>{title}</AlertTitle>
      <Typography variant="body2" sx={{ fontSize: "0.8125rem" }}>
        {message}
      </Typography>
    </Alert>
  );
}

const WIDTHS = ["70%", "55%", "85%", "40%", "65%", "50%", "75%"];

export function SkeletonRows({ rows = 6, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeletonRow" aria-hidden>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} style={{ padding: "8px 12px" }}>
              <Skeleton
                variant="text"
                animation="wave"
                sx={{ width: WIDTHS[(r + c) % WIDTHS.length], height: 20 }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonBlock({ lines = 3, height }: { lines?: number; height?: string }) {
  return (
    <Box
      className="skeletonCard"
      aria-hidden
      sx={{
        p: 2.5,
        bgcolor: "var(--surface, #ffffff)",
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Skeleton variant="text" animation="wave" sx={{ width: "35%", height: 20, mb: 1.5 }} />
      {height ? (
        <Skeleton variant="rectangular" animation="wave" sx={{ width: "100%", height, borderRadius: 1 }} />
      ) : (
        Array.from({ length: lines }, (_, i) => (
          <Skeleton
            key={i}
            variant="text"
            animation="wave"
            sx={{ width: WIDTHS[i % WIDTHS.length], height: 18, my: 0.5 }}
          />
        ))
      )}
    </Box>
  );
}
