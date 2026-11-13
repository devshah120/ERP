"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

export interface BulkAction {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: () => void;
  disabledReason?: string;
}

/**
 * Appears only once rows are selected. Bulk operations report per-row
 * outcomes rather than a single "done" — with 40 selected rows, "37 deleted,
 * 3 skipped because they are not drafts" is the only useful answer.
 */
export default function BulkActionBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <Paper
      elevation={2}
      className="bulkBar"
      role="region"
      aria-label="Bulk actions"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        p: 1.25,
        px: 2,
        mb: 2,
        borderRadius: 2,
        bgcolor: "var(--accent-soft, #e7f3fb)",
        border: "1px solid",
        borderColor: "var(--accent-soft-strong, #cde6f6)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Chip
          label={count}
          size="small"
          color="primary"
          sx={{ height: 22, fontWeight: 700, fontSize: "0.75rem" }}
        />
        <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
          row{count === 1 ? "" : "s"} selected
        </Typography>
      </Box>

      <Box className="bulkActions" sx={{ display: "flex", alignItems: "center", gap: 1, ml: 1 }}>
        {actions.map((a) => (
          <Button
            key={a.key}
            size="small"
            variant="contained"
            color={a.tone === "danger" ? "error" : "primary"}
            onClick={a.onSelect}
            disabled={Boolean(a.disabledReason)}
            title={a.disabledReason ?? a.label}
            startIcon={a.icon}
            disableElevation
            sx={{
              borderRadius: 1.5,
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.8125rem",
              py: 0.5,
            }}
          >
            {a.label}
          </Button>
        ))}
      </Box>

      <Button
        size="small"
        onClick={onClear}
        className="bulkClear"
        sx={{
          ml: "auto",
          textTransform: "none",
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "text.secondary",
          "&:hover": { color: "text.primary" },
        }}
      >
        Clear selection
      </Button>
    </Paper>
  );
}
