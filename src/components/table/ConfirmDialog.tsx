"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";
import { IconWarning, IconClose } from "@/components/icons";

/**
 * Modernized Confirmation dialog built on Material UI Dialog.
 * Preserves audit reason capture, keyboard shortcuts, and destructive confirmation styling.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
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
  /** Label of the button that closes the dialog without acting. */
  cancelLabel?: string;
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
    <Dialog
      open
      onClose={busy ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2.5,
            p: 0.5,
          },
        },
      }}
      role="alertdialog"
      aria-label={title}
    >
      <DialogTitle sx={{ pb: 1, pt: 2, px: 2.5, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "50%",
              flexShrink: 0,
              bgcolor: tone === "danger" ? "error.light" : "primary.light",
              color: tone === "danger" ? "error.main" : "primary.main",
            }}
          >
            <IconWarning />
          </Box>
          <Box sx={{ minWidth: 0, pr: 1 }}>
            <Typography variant="h6" component="div" sx={{ fontWeight: 700, fontSize: "1rem", color: "text.primary" }}>
              {title}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, fontSize: "0.8125rem" }}>
              {message}
            </Typography>
          </Box>
        </Box>
        <IconButton
          aria-label="Close"
          onClick={onCancel}
          disabled={busy}
          size="small"
          sx={{ color: "text.secondary", mt: -0.5, mr: -0.5 }}
        >
          <IconClose />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 2.5, pt: 1, pb: 1.5 }}>
        {requireReason && (
          <Box sx={{ mt: 1.5 }}>
            <TextField
              id="confirm-reason"
              label="Reason (recorded in audit log)"
              autoFocus
              fullWidth
              size="small"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Raised against wrong customer"
              disabled={busy}
            />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1.5, py: 0.5, fontSize: "0.8125rem" }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, px: 2.5, gap: 1 }}>
        <Button variant="outlined" color="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant="contained"
          color={tone === "danger" ? "error" : "primary"}
          onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
          disabled={busy || blocked}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
