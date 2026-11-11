"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../../AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconPlus, IconRefresh, IconCheck } from "@/components/icons";

interface FyRow {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
  isCurrent: boolean;
  closedAt: string | null;
}

type Pending = { row: FyRow; action: "set-current" | "close" | "reopen" } | { action: "open-next" };

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The workspace's financial years. Opening the next year, switching the
 * working year and closing old ones all happen here; the header year menu
 * links in.
 */
export default function FinancialYearsPage() {
  const { hasPermission, refresh } = useAuth();
  const toast = useToast();
  const canManage = hasPermission("financial-years.manage");

  const [rows, setRows] = useState<FyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await apiFetch<{ items: FyRow[] }>("/api/financial-years")).items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load financial years");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  async function run() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      if (pending.action === "open-next") {
        const fy = await apiFetch<FyRow>("/api/financial-years", { method: "POST" });
        toast.success(`Financial year ${fy.label} opened`);
      } else {
        await apiFetch(`/api/financial-years/${pending.row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: pending.action }),
        });
        toast.success(
          pending.action === "set-current"
            ? `${pending.row.label} is now the working year`
            : pending.action === "close"
              ? `${pending.row.label} closed`
              : `${pending.row.label} reopened`
        );
        // The header's year pill reads from the session profile.
        if (pending.action === "set-current") await refresh();
      }
      setPending(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const dialog = (() => {
    if (!pending) return null;
    if (pending.action === "open-next") {
      return {
        title: "Open the next financial year?",
        message: "The new year starts the day after the latest year ends. It opens alongside the current year; switch to it when you are ready.",
        confirm: "Open year",
      };
    }
    const { row } = pending;
    if (pending.action === "set-current") {
      return {
        title: `Make ${row.label} the working year?`,
        message:
          "Applies to everyone in the workspace. New documents and journal entries are numbered and posted in this year from now on.",
        confirm: "Switch year",
      };
    }
    if (pending.action === "close") {
      return {
        title: `Close ${row.label}?`,
        message: "A closed year cannot be made current. Its documents stay readable and can still be reported on. You can reopen it later.",
        confirm: "Close year",
      };
    }
    return { title: `Reopen ${row.label}?`, message: "It can then be made the working year again.", confirm: "Reopen" };
  })();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/settings" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Settings
          </Link>
        }
        title="Financial Years"
        count={rows?.length ?? null}
        description="Document numbers restart in each financial year. The working year applies to the whole workspace."
        actions={
          <>
            <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
              {loading ? <span className="spinner" /> : <IconRefresh />}
            </button>
            {canManage && (
              <button type="button" className="button buttonPrimary" onClick={() => setPending({ action: "open-next" })}>
                <IconPlus /> Open next year
              </button>
            )}
          </>
        }
      />

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Starts</th>
              <th>Ends</th>
              <th>Status</th>
              <th>Closed on</th>
              {canManage && <th style={{ textAlign: "right" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {!rows && !error && <SkeletonRows columns={canManage ? 6 : 5} rows={3} />}
            {error && (
              <tr>
                <td colSpan={6}>
                  <ErrorState message={error} onRetry={load} />
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState title="No financial years yet" />
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="cellPrimary">
                  {r.label}
                  {r.isCurrent && (
                    <span className="badge badgeAccent badgePlain" style={{ marginLeft: "0.5rem" }}>
                      <IconCheck /> Working year
                    </span>
                  )}
                </td>
                <td>{fmt(r.startDate)}</td>
                <td>{fmt(r.endDate)}</td>
                <td>
                  <span className={`badge ${r.status === "OPEN" ? "badgeSuccess" : "badgeNeutral"}`}>{r.status === "OPEN" ? "Open" : "Closed"}</span>
                </td>
                <td className="cellMuted">{r.closedAt ? fmt(r.closedAt) : "—"}</td>
                {canManage && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {!r.isCurrent && r.status === "OPEN" && (
                      <button type="button" className="button buttonSecondary buttonSm" onClick={() => setPending({ row: r, action: "set-current" })}>
                        Make current
                      </button>
                    )}{" "}
                    {!r.isCurrent && r.status === "OPEN" && (
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => setPending({ row: r, action: "close" })}>
                        Close
                      </button>
                    )}
                    {r.status === "CLOSED" && (
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => setPending({ row: r, action: "reopen" })}>
                        Reopen
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pending && dialog && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirm}
          tone={pending.action === "close" ? "danger" : "primary"}
          busy={busy}
          error={actionError}
          onCancel={() => {
            setPending(null);
            setActionError(null);
          }}
          onConfirm={run}
        />
      )}
    </>
  );
}
