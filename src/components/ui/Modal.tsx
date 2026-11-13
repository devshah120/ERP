"use client";

import type { ReactNode } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";
import { IconClose } from "@/components/icons";

/**
 * Modernized Modal built on Material UI Dialog.
 * Fully supports custom width, busy state, escape handler, and accessible chrome.
 */
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
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            maxWidth: width,
            width: "100%",
            borderRadius: 2.5,
            overflow: "hidden",
            m: 2,
          },
        },
      }}
      aria-labelledby="modal-dialog-title"
    >
      <DialogTitle
        id="modal-dialog-title"
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 1.5,
          p: 2.5,
          pb: subtitle ? 1 : 2,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="div" sx={{ fontWeight: 700, fontSize: "1.0625rem", color: "text.primary" }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.8125rem", mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          size="small"
          sx={{ color: "text.secondary", mt: -0.5, mr: -0.5 }}
        >
          <IconClose />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2.5, "&:first-of-type": { pt: 2.5 } }}>
        {children}
      </DialogContent>

      {footer && (
        <DialogActions
          sx={{
            p: 2,
            px: 2.5,
            borderTop: "1px solid",
            borderColor: "divider",
            bgcolor: "var(--surface-subtle, #f8fbfd)",
          }}
        >
          {footer}
        </DialogActions>
      )}
    </Dialog>
  );
}
