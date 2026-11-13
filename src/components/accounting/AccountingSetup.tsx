"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useToast } from "@/components/ui/Toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { IconWarning, IconRefresh } from "@/components/icons";

interface SetupState {
  enabled: boolean;
  accountCount: number;
}

/**
 * Prompt shown until a tenant has a chart of accounts.
 *
 * Auto-posting is deliberately non-blocking: an invoice still posts without a
 * chart, it just does not reach the ledger. This banner is how the user finds
 * out that happened, and the backfill is how they close the gap.
 */
export default function AccountingSetup({ onReady }: { onReady?: () => void }) {
  const [state, setState] = useState<SetupState | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await apiFetch<SetupState>("/api/accounting/setup"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check the chart of accounts");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(path: string, key: string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(path, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!body?.success) throw new Error(body?.message ?? `Request failed (${res.status})`);
      setMessage(body.message ?? "Done");
      toast.success(body.message ?? "Done");
      await load();
      onReady?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!state) return null;

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
          {message}
        </Alert>
      )}

      {!state.enabled ? (
        <div className="setupCard">
          <span className="setupIcon">
            <IconWarning />
          </span>
          <div className="setupBody">
            <strong>Accounting is not set up yet</strong>
            <p>
              Create the standard chart of accounts to switch on the general ledger. Until then, invoices,
              receipts and payments still work — they just do not post journal entries, so the Trial Balance
              and General Ledger will be empty.
            </p>
          </div>
          <Button
            variant="contained"
            size="small"
            onClick={() => run("/api/accounting/setup", "setup")}
            disabled={busy !== null}
            startIcon={busy === "setup" ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ textTransform: "none", fontWeight: 600, whiteSpace: "nowrap" }}
          >
            {busy === "setup" ? "Creating…" : "Create chart of accounts"}
          </Button>
        </div>
      ) : (
        <div className="setupCard setupCardReady">
          <div className="setupBody">
            <strong>Ledger is active — {state.accountCount} accounts</strong>
            <p>
              New invoices, credit/debit notes, receipts, payments and stock adjustments post journal entries
              automatically. If some of those were completed before accounting was switched on, run the
              backfill — it is safe to run more than once.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => run("/api/accounting/setup", "topup")}
              disabled={busy !== null}
              title="Adds any standard accounts that are missing"
              startIcon={busy === "topup" ? <CircularProgress size={16} color="inherit" /> : undefined}
              sx={{ textTransform: "none", fontWeight: 600, whiteSpace: "nowrap" }}
            >
              {busy === "topup" ? "Checking…" : "Top up chart"}
            </Button>
            <Button
              variant="contained"
              color="inherit"
              size="small"
              onClick={() => run("/api/accounting/backfill", "backfill")}
              disabled={busy !== null}
              startIcon={busy === "backfill" ? <CircularProgress size={16} color="inherit" /> : <IconRefresh />}
              sx={{
                textTransform: "none",
                fontWeight: 600,
                whiteSpace: "nowrap",
                bgcolor: "text.primary",
                color: "background.paper",
                "&:hover": { bgcolor: "text.secondary" },
              }}
            >
              {busy === "backfill" ? "Posting…" : "Backfill ledger"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
