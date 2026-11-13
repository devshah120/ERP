"use client";

import { useImperativeHandle, useRef, useState, type Ref, type MouseEvent } from "react";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { IconChevronDown, IconDownload } from "@/components/icons";

/**
 * Triggers a download from an export endpoint, carrying the caller's current
 * filters and column selection so the file matches the screen exactly.
 */
export interface ExportButtonHandle {
  /** Opens the format menu — used by the Ctrl+E shortcut. */
  open: () => void;
}

export default function ExportButton({
  endpoint,
  params,
  disabled,
  ref,
}: {
  endpoint: string;
  params: () => URLSearchParams;
  disabled?: boolean;
  ref?: Ref<ExportButtonHandle>;
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useImperativeHandle(ref, () => ({ open: () => setAnchorEl(buttonRef.current) }), []);

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  async function download(format: "xlsx" | "csv") {
    setBusy(format);
    setError(null);
    handleClose();
    try {
      const search = params();
      search.set("format", format);

      const res = await fetch(`${endpoint}?${search.toString()}`, { credentials: "include" });
      if (!res.ok) {
        let message = `Export failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
        } catch {
          // Non-JSON error body — keep the status-based message.
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `export.${format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="columnPicker" style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        className="button buttonSecondary"
        onClick={handleOpen}
        disabled={disabled || busy !== null}
        title="Export the filtered data with the selected columns (Ctrl + E)"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {busy ? <CircularProgress size={14} color="inherit" /> : <IconDownload />}
        {busy ? `Exporting ${busy.toUpperCase()}…` : "Export"}
        <IconChevronDown style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }} />
      </button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              minWidth: "15rem",
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              mt: 1,
            },
          },
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={() => download("xlsx")} sx={{ py: 1 }}>
          <ListItemIcon sx={{ minWidth: 28, color: "success.main" }}>
            <IconDownload />
          </ListItemIcon>
          <ListItemText
            primary={<Typography variant="body2" sx={{ fontWeight: 600 }}>Excel (.xlsx)</Typography>}
            secondary={<Typography variant="caption" color="text.secondary">Formatted spreadsheet</Typography>}
          />
        </MenuItem>

        <MenuItem onClick={() => download("csv")} sx={{ py: 1 }}>
          <ListItemIcon sx={{ minWidth: 28, color: "primary.main" }}>
            <IconDownload />
          </ListItemIcon>
          <ListItemText
            primary={<Typography variant="body2" sx={{ fontWeight: 600 }}>CSV (.csv)</Typography>}
            secondary={<Typography variant="caption" color="text.secondary">Raw comma-separated values</Typography>}
          />
        </MenuItem>

        <Divider sx={{ my: 0.5 }} />

        <Typography variant="caption" sx={{ px: 2, py: 0.5, display: "block", color: "text.secondary", fontSize: "0.6875rem" }}>
          Exports all filtered rows using your selected columns.
        </Typography>
      </Menu>

      {error && (
        <Alert
          severity="error"
          onClose={() => setError(null)}
          sx={{
            position: "absolute",
            top: "calc(100% + 0.5rem)",
            right: 0,
            zIndex: 40,
            minWidth: "16rem",
            fontSize: "0.8125rem",
          }}
        >
          {error}
        </Alert>
      )}
    </div>
  );
}
