"use client";

import { useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { IconClose } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

interface RowError {
  row: number;
  column?: string;
  message: string;
}

interface PreviewRow {
  row: number;
  values: Record<string, unknown>;
  errors: RowError[];
  duplicate?: boolean;
}

interface PreviewResult {
  title: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  rows: PreviewRow[];
  errors: RowError[];
  detectedHeaders: string[];
  missingHeaders: string[];
}

/**
 * Import flow: download template → upload → preview with row-level errors →
 * commit. Nothing is written until the user confirms.
 */
export default function ImportDialog({
  resource,
  title,
  onClose,
  onImported,
}: {
  resource: string;
  title: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEscapeHandler(onClose, busy === null);

  async function downloadTemplate() {
    setBusy("template");
    setError(null);
    try {
      const res = await fetch(`/api/masters/${resource}/import/template`, { credentials: "include" });
      if (!res.ok) throw new Error(`Could not download template (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${resource}-import-template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  async function send(path: string, extra?: Record<string, string>) {
    if (!file) throw new Error("Choose a file first");
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);

    const res = await fetch(`/api/masters/${resource}/import/${path}`, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const body = await res.json().catch(() => ({}));
    if (!body?.success) throw new Error(body?.message ?? `Request failed (${res.status})`);
    return body;
  }

  async function runPreview(selected?: File) {
    const target = selected ?? file;
    if (!target) return;
    setBusy("preview");
    setError(null);
    setDone(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", target);
      const res = await fetch(`/api/masters/${resource}/import/preview`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!body?.success) throw new Error(body?.message ?? `Preview failed (${res.status})`);
      setPreview(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy("import");
    setError(null);
    try {
      const body = await send("commit", { skipDuplicates: String(skipDuplicates) });
      setDone(body.message ?? "Imported");
      toast.success("Import complete", body.message);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  const canImport = preview && preview.errorRows === 0 && preview.validRows + (skipDuplicates ? 0 : preview.duplicateRows) > 0;

  return (
    <Dialog
      open
      onClose={busy === null ? onClose : undefined}
      maxWidth="md"
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
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: "1.125rem" }}>
            Import {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem", mt: 0.5 }}>
            Download the template, fill it in, then upload to preview before saving.
          </Typography>
        </Box>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          disabled={busy !== null}
          size="small"
          sx={{ color: "text.secondary", mt: -0.5, mr: -0.5 }}
        >
          <IconClose />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2.5 }}>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center", mb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={downloadTemplate}
            disabled={busy !== null}
            startIcon={busy === "template" ? <CircularProgress size={14} /> : undefined}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {busy === "template" ? "Preparing..." : "Download sample template"}
          </Button>

          <Button variant="outlined" component="label" size="small" sx={{ textTransform: "none" }}>
            Choose File
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".xlsx,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setDone(null);
                if (f) runPreview(f);
              }}
            />
          </Button>
          {file && (
            <Typography variant="caption" sx={{ color: "text.primary", fontWeight: 500 }}>
              {file.name}
            </Typography>
          )}

          {busy === "preview" && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
              <CircularProgress size={14} />
              <Typography variant="caption">Validating…</Typography>
            </Box>
          )}
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {done && <Alert severity="success" sx={{ mb: 2 }}>{done}</Alert>}

        {preview && (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
              <Chip label={`Total: ${preview.totalRows}`} size="small" variant="outlined" />
              <Chip label={`Ready: ${preview.validRows}`} size="small" color="success" />
              <Chip label={`Duplicates: ${preview.duplicateRows}`} size="small" color="warning" />
              <Chip label={`Errors: ${preview.errorRows}`} size="small" color="error" />
            </Box>

            {preview.missingHeaders.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Missing required column(s): {preview.missingHeaders.join(", ")}. Use the sample template.
              </Alert>
            )}

            {preview.duplicateRows > 0 && (
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontSize: "0.8125rem" }}>
                    Skip {preview.duplicateRows} row(s) that already exist
                  </Typography>
                }
                sx={{ mb: 1.5 }}
              />
            )}

            <TableContainer sx={{ maxHeight: 320, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 60, fontWeight: 700 }}>Row</TableCell>
                    <TableCell sx={{ width: 100, fontWeight: 700 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.rows.map((r) => {
                    const status = r.errors.length > 0 ? "ERROR" : r.duplicate ? "DUPLICATE" : "READY";
                    const chipColor = status === "ERROR" ? "error" : status === "DUPLICATE" ? "warning" : "success";

                    return (
                      <TableRow key={r.row} hover>
                        <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.row}</TableCell>
                        <TableCell>
                          <Chip label={status} size="small" color={chipColor} sx={{ height: 20, fontSize: "0.6875rem", fontWeight: 700 }} />
                        </TableCell>
                        <TableCell>
                          {r.errors.length > 0 ? (
                            <Box component="ul" sx={{ m: 0, pl: 2 }}>
                              {r.errors.map((e, i) => (
                                <Typography key={i} component="li" variant="caption" sx={{ color: "error.main", display: "list-item" }}>
                                  {e.column ? <strong>{e.column}: </strong> : null}
                                  {e.message}
                                </Typography>
                              ))}
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              {Object.entries(r.values)
                                .filter(([, v]) => typeof v !== "object" && v !== undefined && v !== "")
                                .slice(0, 4)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ")}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, px: 2.5, borderTop: "1px solid", borderColor: "divider", bgcolor: "var(--surface-subtle, #f8fbfd)" }}>
        {preview && preview.errorRows > 0 && (
          <Typography variant="caption" color="error.main" sx={{ mr: "auto" }}>
            Fix the {preview.errorRows} highlighted row(s) and upload again — nothing has been saved.
          </Typography>
        )}
        <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy !== null}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={runImport}
          disabled={!canImport || busy !== null}
          startIcon={busy === "import" ? <CircularProgress size={14} color="inherit" /> : undefined}
          disableElevation
        >
          {busy === "import" ? "Importing..." : `Import ${preview?.validRows ?? 0} record(s)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
