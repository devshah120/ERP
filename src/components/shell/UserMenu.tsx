"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useAuth } from "@/app/(app)/AuthProvider";
import { apiFetch } from "@/lib/api/client";
import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";
import { IconKeyboard, IconLogout, IconSettings, IconChevronUp } from "@/components/icons";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Account menu. Rendered twice — as the sidebar footer card and as the top-bar
 * avatar — so it's reachable whether the sidebar is open or not.
 */
export default function UserMenu({ variant }: { variant: "sidebar" | "topbar" }) {
  const { me } = useAuth();
  const router = useRouter();
  const { openHelp } = useShortcuts();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  if (!me) return null;

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  async function handleLogout() {
    handleClose();
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  const menu = (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={handleClose}
      slotProps={{
        paper: {
          elevation: 4,
          sx: {
            minWidth: "16rem",
            mt: variant === "topbar" ? 1 : 0,
            mb: variant === "sidebar" ? 1 : 0,
            borderRadius: 2.5,
            border: "1px solid",
            borderColor: "divider",
          },
        },
      }}
      transformOrigin={
        variant === "sidebar"
          ? { vertical: "bottom", horizontal: "left" }
          : { vertical: "top", horizontal: "right" }
      }
      anchorOrigin={
        variant === "sidebar"
          ? { vertical: "top", horizontal: "left" }
          : { vertical: "bottom", horizontal: "right" }
      }
    >
      <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
        <span className="avatar avatarLg">{initials(me.name)}</span>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
            {me.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {me.email}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ my: 0.5 }} />

      <Box sx={{ px: 2, py: 0.5 }}>
        <Typography
          variant="overline"
          sx={{ color: "text.secondary", fontWeight: 700, fontSize: "0.6875rem", letterSpacing: 0.5 }}
        >
          {me.business?.name ?? "Workspace"}
        </Typography>
      </Box>

      <MenuItem component={Link} href="/settings" onClick={handleClose}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          <IconSettings />
        </ListItemIcon>
        <ListItemText
          primary={<Typography variant="body2" sx={{ fontWeight: 500 }}>Workspace settings</Typography>}
          secondary={<Typography variant="caption" color="text.secondary">{me.role?.name ?? "Member"}</Typography>}
        />
      </MenuItem>

      <MenuItem
        onClick={() => {
          handleClose();
          openHelp();
        }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <IconKeyboard />
        </ListItemIcon>
        <ListItemText
          primary={<Typography variant="body2" sx={{ fontWeight: 500 }}>Keyboard shortcuts</Typography>}
        />
        <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: "monospace", ml: 1 }}>
          Ctrl /
        </Typography>
      </MenuItem>

      <Divider sx={{ my: 0.5 }} />

      <MenuItem onClick={handleLogout} sx={{ color: "error.main" }}>
        <ListItemIcon sx={{ minWidth: 28, color: "error.main" }}>
          <IconLogout />
        </ListItemIcon>
        <ListItemText
          primary={<Typography variant="body2" sx={{ fontWeight: 600, color: "error.main" }}>Sign out</Typography>}
        />
      </MenuItem>
    </Menu>
  );

  if (variant === "topbar") {
    return (
      <div className="menuWrap">
        <button
          type="button"
          className="avatarButton"
          onClick={handleOpen}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Account menu"
          title={me.name}
        >
          <span className="avatar">{initials(me.name)}</span>
          <span className="hdrUserText">
            <strong>{me.name}</strong>
            <small>{me.role?.name ?? me.business?.name}</small>
          </span>
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="sbUser"
        onClick={handleOpen}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${me.name} — account menu`}
      >
        <span className="avatar">{initials(me.name)}</span>
        <span className="sbUserText">
          <strong>{me.name}</strong>
          <small>{me.role?.name ?? me.email}</small>
        </span>
        <IconChevronUp className="sbItemChevron" style={{ transform: open ? "none" : "rotate(180deg)" }} />
      </button>
      {menu}
    </div>
  );
}
