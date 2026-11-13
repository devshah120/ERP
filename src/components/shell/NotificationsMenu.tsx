"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { DashboardResult, Insight } from "@/lib/analytics/types";
import { NOTIFICATION_INSIGHTS, type NotificationSettings } from "@/lib/settings/definitions";
import { IconBell, IconCheckCircle } from "@/components/icons";

/**
 * The bell shows the same "needs attention" findings the dashboard computes —
 * overdue receivables, orders waiting to ship, stock below reorder level — not
 * a separate notification feed. Nothing is invented: if the analysis finds no
 * problems, the bell says so.
 */
export default function NotificationsMenu() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
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
    const t = setTimeout(load, 1200);
    return () => clearTimeout(t);
  }, [load]);

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    if (!open) load();
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const count = items?.length ?? 0;

  return (
    <div className="menuWrap">
      <button
        type="button"
        className="iconButton"
        onClick={handleOpen}
        aria-expanded={open}
        aria-label={count > 0 ? `Alerts, ${count} need attention` : "Alerts"}
        title="Alerts"
      >
        <IconBell />
        {count > 0 && <span className="notifDot">{count > 9 ? "9+" : count}</span>}
      </button>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              width: 340,
              maxWidth: "90vw",
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              mt: 1,
            },
          },
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Needs attention
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Findings from this month&apos;s activity
            </Typography>
          </Box>
          {loading && <CircularProgress size={16} sx={{ color: "text.secondary" }} />}
        </Box>

        <Divider />

        {error && (
          <Box sx={{ p: 2, textAlign: "center", color: "error.main" }}>
            <Typography variant="body2">{error}</Typography>
          </Box>
        )}

        {!error && items && items.length === 0 && (
          <Box sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
            <IconCheckCircle style={{ fontSize: "1.75rem", color: "var(--success-solid, #15803d)", marginBottom: "0.5rem" }} />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Nothing needs attention right now.
            </Typography>
          </Box>
        )}

        {!error && !items && loading && (
          <Box sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
            <Typography variant="body2">Checking…</Typography>
          </Box>
        )}

        <Box sx={{ maxHeight: "22rem", overflowY: "auto" }}>
          {items?.map((i) => {
            const toneColor = i.tone === "bad" ? "error.main" : "warning.main";
            return (
              <Box
                key={i.key}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 1.5,
                  p: 1.5,
                  px: 2,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  "&:last-child": { borderBottom: "none" },
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: toneColor,
                    mt: 0.75,
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontSize: "0.8125rem", color: "text.primary" }}>
                    {i.headline}
                  </Typography>
                  {i.action && (
                    <Typography
                      component={Link}
                      href={i.action.href}
                      onClick={handleClose}
                      variant="caption"
                      sx={{
                        color: "primary.main",
                        fontWeight: 600,
                        textDecoration: "none",
                        display: "inline-block",
                        mt: 0.25,
                        "&:hover": { textDecoration: "underline" },
                      }}
                    >
                      {i.action.label} →
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>

        <Divider />

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1,
            bgcolor: "var(--surface-subtle, #f8fbfd)",
          }}
        >
          <Button
            component={Link}
            href="/settings/notifications"
            onClick={handleClose}
            size="small"
            sx={{ textTransform: "none", fontSize: "0.75rem", p: 0.5 }}
          >
            Choose alerts
          </Button>
          <Button
            component={Link}
            href="/dashboard"
            onClick={handleClose}
            size="small"
            sx={{ textTransform: "none", fontSize: "0.75rem", p: 0.5 }}
          >
            Open dashboard
          </Button>
        </Box>
      </Popover>
    </div>
  );
}
