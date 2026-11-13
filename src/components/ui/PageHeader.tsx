"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";

/**
 * Modernized PageHeader built on Material UI.
 * Standardizes title typography, record counts with MUI Chip, and actions alignment.
 */
export default function PageHeader({
  title,
  description,
  count,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Record count shown as a pill next to the title. */
  count?: number | null;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box
      className="pageHeader"
      sx={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 2,
        mb: 2.5,
      }}
    >
      <Box className="pageHeaderText" sx={{ minWidth: 0, flex: 1 }}>
        {eyebrow && (
          <Typography
            variant="caption"
            className="pageEyebrow"
            sx={{
              display: "block",
              color: "primary.main",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              fontSize: "0.6875rem",
              mb: 0.5,
            }}
          >
            {eyebrow}
          </Typography>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography
            variant="h5"
            component="h1"
            className="pageTitle"
            sx={{
              fontWeight: 700,
              color: "text.primary",
              letterSpacing: "-0.015em",
              m: 0,
              fontSize: { xs: "1.25rem", md: "1.375rem" },
            }}
          >
            {title}
          </Typography>
          {typeof count === "number" && (
            <Chip
              size="small"
              label={count.toLocaleString("en-IN")}
              className="pageTitleCount"
              sx={{
                height: 22,
                fontSize: "0.75rem",
                fontWeight: 600,
                bgcolor: "var(--accent-soft, #e7f3fb)",
                color: "var(--accent-text, #0869a6)",
              }}
            />
          )}
        </Box>
        {description && (
          <Typography
            variant="body2"
            className="pageSubtitle"
            sx={{
              color: "text.secondary",
              mt: 0.5,
              fontSize: "0.8125rem",
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box
          className="pageActions"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  );
}
