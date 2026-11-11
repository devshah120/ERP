"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft } from "@/components/icons";

export type Rec = Record<string, unknown>;

/** Label/value grid used on every detail page. */
export function DetailGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="settingsList" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))", gap: "0.25rem 1.5rem" }}>
      {items.map((i) => (
        <div key={i.label} className="settingsRow">
          <dt>{i.label}</dt>
          <dd>{i.value === null || i.value === undefined || i.value === "" ? <span className="cellMuted">—</span> : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="formSection">
      <div className="formSectionHead" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <h2 className="formSectionTitle" style={{ flex: 1 }}>
          {title}
        </h2>
        {actions}
      </div>
      <div className="formSectionBody">{children}</div>
    </section>
  );
}

export function fmtDate(v: unknown, withTime = false) {
  if (!v) return "—";
  const d = new Date(String(v));
  return withTime
    ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Loads one record and frames it: back link, number, status, and an optional
 * reason-required cancel action. The page supplies the body.
 */
export default function DetailShell({
  apiPath,
  backHref,
  backLabel,
  title,
  description,
  cancel,
  actions,
  children,
}: {
  apiPath: string;
  backHref: string;
  backLabel: string;
  title: (r: Rec) => ReactNode;
  description?: (r: Rec) => ReactNode;
  /** Cancel posts { reason } to `${apiPath}${cancel.path ?? ""}`. */
  cancel?: { permission: string; when: (r: Rec) => boolean; label?: string; message: string; path?: string };
  actions?: (r: Rec, reload: () => void) => ReactNode;
  children: (r: Rec, reload: () => void) => ReactNode;
}) {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [record, setRecord] = useState<Rec | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRecord(await apiFetch<Rec>(apiPath));
    } catch (err) {
      setError(err);
    }
  }, [apiPath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  async function doCancel(reason?: string) {
    if (!cancel) return;
    setBusy(true);
    setCancelError(null);
    try {
      setRecord(await apiFetch<Rec>(`${apiPath}${cancel.path ?? ""}`, { method: "POST", body: JSON.stringify({ reason }) }));
      setConfirming(false);
      toast.success("Cancelled");
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const eyebrow = (
    <Link href={backHref} className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      <IconArrowLeft /> {backLabel}
    </Link>
  );

  if (error) {
    return (
      <>
        <PageHeader eyebrow={eyebrow} title="Not available" />
        <div className="card">
          <ErrorState message={error instanceof ApiError ? error.message : "Could not load this record."} onRetry={load} />
        </div>
      </>
    );
  }
  if (!record) return <SkeletonBlock lines={6} />;

  const canCancel = cancel && hasPermission(cancel.permission) && cancel.when(record);

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={
          <>
            {title(record)} {typeof record.status === "string" && <StatusBadge status={record.status} />}
          </>
        }
        description={description?.(record)}
        actions={
          <>
            {actions?.(record, load)}
            {canCancel && (
              <button type="button" className="button buttonSecondary" style={{ color: "var(--danger)" }} onClick={() => setConfirming(true)}>
                {cancel.label ?? "Cancel"}
              </button>
            )}
          </>
        }
      />
      <div style={{ maxWidth: "72rem" }}>{children(record, load)}</div>
      {confirming && cancel && (
        <ConfirmDialog
          title={`${cancel.label ?? "Cancel"}?`}
          message={cancel.message}
          confirmLabel={cancel.label ?? "Cancel"}
          requireReason
          busy={busy}
          error={cancelError}
          onCancel={() => setConfirming(false)}
          onConfirm={doCancel}
        />
      )}
    </>
  );
}
