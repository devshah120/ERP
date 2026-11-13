"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { IconClose } from "@/components/icons";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

/**
 * Applies one discount percentage across every line at once.
 */
export default function MassDiscountDialog({
  lineCount,
  onApply,
  onClose,
}: {
  lineCount: number;
  onApply: (percent: number) => void;
  onClose: () => void;
}) {
  const [percent, setPercent] = useState("");
  useEscapeHandler(onClose);

  const value = Number(percent);
  const valid = percent.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
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
      aria-label="Mass discount"
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
            Apply discount to all lines
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem", mt: 0.5 }}>
            Sets the same discount on all {lineCount} line{lineCount === 1 ? "" : "s"}, replacing any discount
            already entered on them.
          </Typography>
        </Box>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          size="small"
          sx={{ color: "text.secondary", mt: -0.5, mr: -0.5 }}
        >
          <IconClose />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2.5, pt: 2 }}>
        <TextField
          id="mass-discount"
          label="Discount Percentage"
          type="number"
          autoFocus
          fullWidth
          size="small"
          value={percent}
          placeholder="e.g. 10"
          onChange={(e) => setPercent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) {
              e.preventDefault();
              onApply(value);
            }
          }}
          slotProps={{
            input: {
              endAdornment: <InputAdornment position="end">%</InputAdornment>,
            },
            htmlInput: { min: 0, max: 100, step: "any" },
          }}
          helperText="Between 0 and 100. Totals are recalculated by the server on save."
          sx={{ mt: 1 }}
        />
      </DialogContent>

      <DialogActions sx={{ p: 2, px: 2.5, borderTop: "1px solid", borderColor: "divider", bgcolor: "var(--surface-subtle, #f8fbfd)" }}>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!valid}
          onClick={() => onApply(value)}
          disableElevation
        >
          Apply to all lines
        </Button>
      </DialogActions>
    </Dialog>
  );
}
