"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { apiFetch, ApiError } from "@/lib/api/client";
import { IconInbox, IconCheckCircle } from "@/components/icons";

interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  at: string;
}

const ago = (v: string) => {
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

/**
 * Approval notices for the signed-in user: something waiting for their
 * approval, or a decision / comment on something they raised or decided.
 * Shown in every product (HRMS-only workspaces too). Checks every minute.
 */
export default function ApprovalInbox() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [items, setItems] = useState<Notice[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ unread: number; items: Notice[] }>("/api/notifications?limit=15");
      setItems(r.items);
      setUnread(r.unread);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load notices");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 1500);
    const every = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => (clearTimeout(first), clearInterval(every));
  }, [load]);

  const open = (e: MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
    load();
  };

  async function markAll() {
    try {
      await apiFetch("/api/notifications", { method: "POST", body: JSON.stringify({ ids: "all" }) });
      setUnread(0);
      setItems((cur) => cur?.map((n) => ({ ...n, read: true })) ?? cur);
    } catch {
      // Marking read is a convenience; the list stays as it is.
    }
  }

  function follow(n: Notice) {
    setAnchorEl(null);
    if (!n.read) {
      setUnread((u) => Math.max(0, u - 1));
      apiFetch("/api/notifications", { method: "POST", body: JSON.stringify({ ids: [n.id] }) }).catch(() => undefined);
    }
  }

  return (
    <div className="menuWrap">
      <button type="button" className="iconButton" onClick={open} aria-expanded={Boolean(anchorEl)} aria-label={unread > 0 ? `Approvals inbox, ${unread} unread` : "Approvals inbox"} title="Approvals inbox">
        <IconInbox />
        {unread > 0 && <span className="notifDot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { elevation: 4, sx: { width: 360, maxWidth: "92vw", borderRadius: 2.5, border: "1px solid", borderColor: "divider", mt: 1 } } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Approvals
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {unread > 0 ? `${unread} unread` : "You're up to date"}
            </Typography>
          </Box>
          {unread > 0 && (
            <button type="button" className="button buttonGhost buttonSm" onClick={markAll}>
              Mark all read
            </button>
          )}
        </Box>
        <Divider />
        {error && (
          <Box sx={{ p: 2, textAlign: "center", color: "error.main" }}>
            <Typography variant="body2">{error}</Typography>
          </Box>
        )}
        {!error && items && items.length === 0 && (
          <Box sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
            <IconCheckCircle style={{ fontSize: "1.75rem", color: "var(--success-solid)", marginBottom: "0.5rem" }} />
            <Typography variant="body2">No approval notices yet.</Typography>
          </Box>
        )}
        <Box sx={{ maxHeight: "24rem", overflowY: "auto" }}>
          {items?.map((n) => (
            <Link key={n.id} href={n.href || "/approvals/queue"} className="apvInboxItem" data-unread={!n.read} onClick={() => follow(n)}>
              <b>{n.title}</b>
              {n.body && <small>{n.body}</small>}
              <small>{ago(n.at)}</small>
            </Link>
          ))}
        </Box>
        <Divider />
        <Box sx={{ px: 2, py: 1 }}>
          <Link href="/approvals/queue" className="cellLink" onClick={() => setAnchorEl(null)} style={{ fontSize: "0.8125rem" }}>
            Open Approval Management
          </Link>
        </Box>
      </Popover>
    </div>
  );
}
