"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { DashboardResult, Insight } from "@/lib/analytics/types";
import { NOTIFICATION_INSIGHTS, type NotificationSettings } from "@/lib/settings/definitions";
import { usePopover } from "@/components/ui/usePopover";
import { IconBell, IconCheckCircle } from "@/components/icons";

/**
 * The bell shows the same "needs attention" findings the dashboard computes —
 * overdue receivables, orders waiting to ship, stock below reorder level — not
 * a separate notification feed. Nothing is invented: if the analysis finds no
 * problems, the bell says so.
 */
export default function NotificationsMenu() {
  const { open, toggle, close, ref } = usePopover<HTMLDivElement>();
  const [items, setItems] = useState<Insight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, prefs] = await Promise.all([
        apiFetch<DashboardResult>("/api/analytics/dashboard?period=month"),
        apiFetch<NotificationSettings>("/api/settings/notifications").catch(() => null),
      ]);
      // Settings → Notifications decides which kinds of finding reach the bell.
      const muted = new Set<string>();
      if (prefs) {
        for (const [setting, keys] of Object.entries(NOTIFICATION_INSIGHTS)) {
          if (prefs[setting as keyof NotificationSettings] === false) keys.forEach((k) => muted.add(k));
        }
      }
      setItems(data.insights.filter((i) => (i.tone === "warn" || i.tone === "bad") && !muted.has(i.key)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load once, shortly after the shell paints, so the badge count is ready
    // without competing with the page's own first request.
    const t = setTimeout(load, 1200);
    return () => clearTimeout(t);
  }, [load]);

  const count = items?.length ?? 0;

  return (
    <div className="menuWrap" ref={ref}>
      <button
        type="button"
        className="iconButton"
        onClick={() => {
          if (!open) load();
          toggle();
        }}
        aria-expanded={open}
        aria-label={count > 0 ? `Alerts, ${count} need attention` : "Alerts"}
        title="Alerts"
      >
        <IconBell />
        {count > 0 && <span className="notifDot">{count > 9 ? "9+" : count}</span>}
      </button>

      {open && (
        <div className="menu menuWide" role="dialog" aria-label="Alerts">
          <div className="menuHeader" style={{ justifyContent: "space-between" }}>
            <div className="menuHeaderText">
              <strong>Needs attention</strong>
              <small>Findings from this month&apos;s activity</small>
            </div>
            {loading && <span className="spinner" style={{ color: "var(--text-tertiary)" }} />}
          </div>
          <div className="menuSep" />
          {error && <div className="menuEmpty">{error}</div>}
          {!error && items && items.length === 0 && (
            <div className="menuEmpty">
              <IconCheckCircle style={{ fontSize: "1.4rem", color: "var(--success-solid)", marginBottom: "0.5rem" }} />
              <div>Nothing needs attention right now.</div>
            </div>
          )}
          {!error && !items && loading && <div className="menuEmpty">Checking…</div>}
          <div style={{ maxHeight: "22rem", overflowY: "auto" }}>
            {items?.map((i) => (
              <div key={i.key} className="notifItem">
                <span className={`notifTone notifTone-${i.tone}`} />
                <div className="notifText">
                  {i.headline}
                  {i.action && (
                    <Link href={i.action.href} onClick={close}>
                      <small>{i.action.label} →</small>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="menuFooter">
            <Link href="/settings/notifications" onClick={close}>
              Choose alerts
            </Link>
            <Link href="/dashboard" onClick={close}>
              Open dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
