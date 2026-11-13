"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { IconClose } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

/**
 * Sends a document to its party. The address defaults to the one snapshotted
 * onto the document but stays editable, because the person who should
 * receive an invoice is often not the contact stored on the master record.
 */
export default function EmailDialog({
  docType,
  docId,
  documentNumber,
  defaultTo,
  label,
  onClose,
}: {
  docType: string;
  docId: string;
  documentNumber: string;
  defaultTo?: string;
  label: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(defaultTo ?? "");
  const toast = useToast();
  const [subject, setSubject] = useState(`${label} ${documentNumber}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEscapeHandler(onClose, !busy);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (to.trim()) body.to = to.trim();
      if (subject.trim()) body.subject = subject.trim();
      await apiFetch(`/api/documents/${docType}/${docId}/email`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSent(to.trim() || defaultTo || "the recipient");
      toast.success("Email sent", to.trim() || defaultTo || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          elevation: 6,
          sx: {
            borderRadius: 3,
            overflow: "hidden",
          },
        },
      }}
      aria-label={`Email ${label}`}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          p: 2.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ minWidth: 0, pr: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: "1.0625rem" }}>
            Email {label} {documentNumber}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem", mt: 0.5 }}>
            Sends a formatted summary with line items, the GST breakup and the total in words.
          </Typography>
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

      <DialogContent sx={{ p: 2.5 }}>
        {sent ? (
          <Alert severity="success" sx={{ my: 1 }}>
            Sent to {sent}.
          </Alert>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            <TextField
              id="email-to"
              label="Recipient Email"
              type="email"
              autoFocus
              fullWidth
              size="small"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={defaultTo ? defaultTo : "name@example.com"}
              helperText={
                defaultTo
                  ? "Defaults to the address on the document."
                  : "No address is stored on this document — enter one."
              }
              disabled={busy}
            />

            <TextField
              id="email-subject"
              label="Subject"
              fullWidth
              size="small"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={busy}
            />

            {error && <Alert severity="error">{error}</Alert>}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, px: 2.5, borderTop: "1px solid", borderColor: "divider", bgcolor: "var(--surface-subtle, #f8fbfd)" }}>
        <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
          {sent ? "Done" : "Cancel"}
        </Button>
        {!sent && (
          <Button
            variant="contained"
            onClick={send}
            disabled={busy || (!to.trim() && !defaultTo)}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
            disableElevation
          >
            {busy ? "Sending…" : "Send email"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
