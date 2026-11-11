"use client";

import { useCallback, useEffect, useState } from "react";
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
      {error && <div className="banner bannerError" style={{ marginBottom: "0.9rem" }}>{error}</div>}
      {message && <div className="banner bannerSuccess" style={{ marginBottom: "0.9rem" }}>{message}</div>}

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
          <button
            type="button"
            className="button buttonPrimary"
            onClick={() => run("/api/accounting/setup", "setup")}
            disabled={busy !== null}
          >
            {busy === "setup" ? "Creating…" : "Create chart of accounts"}
          </button>
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
          <button
            type="button"
            className="button buttonSecondary"
            onClick={() => run("/api/accounting/setup", "topup")}
            disabled={busy !== null}
            title="Adds any standard accounts that are missing"
          >
            {busy === "topup" ? "Checking…" : "Top up chart"}
          </button>
          <button
            type="button"
            className="button buttonDark"
            onClick={() => run("/api/accounting/backfill", "backfill")}
            disabled={busy !== null}
          >
            <IconRefresh /> {busy === "backfill" ? "Posting…" : "Backfill ledger"}
          </button>
        </div>
      )}
    </>
  );
}
