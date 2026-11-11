"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/(app)/AuthProvider";
import { apiFetch } from "@/lib/api/client";
import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";
import { usePopover } from "@/components/ui/usePopover";
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
  const { open, toggle, close, ref } = usePopover<HTMLDivElement>();

  if (!me) return null;

  async function handleLogout() {
    close();
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  const menu = open && (
    <div className={`menu ${variant === "sidebar" ? "menuLeft menuUp" : ""}`} role="menu" style={{ minWidth: "15rem" }}>
      <div className="menuHeader">
        <span className="avatar avatarLg">{initials(me.name)}</span>
        <div className="menuHeaderText">
          <strong>{me.name}</strong>
          <small>{me.email}</small>
        </div>
      </div>
      <div className="menuSep" />
      <div className="menuLabel">{me.business?.name ?? "Workspace"}</div>
      <Link href="/settings" className="menuItem" role="menuitem" onClick={close}>
        <IconSettings />
        <span className="menuItemText">
          Workspace settings
          <small>{me.role?.name ?? "Member"} · @{me.username}</small>
        </span>
      </Link>
      <button
        type="button"
        className="menuItem"
        role="menuitem"
        onClick={() => {
          close();
          openHelp();
        }}
      >
        <IconKeyboard />
        Keyboard shortcuts
        <kbd>Ctrl /</kbd>
      </button>
      <div className="menuSep" />
      <button type="button" className="menuItem menuItemDanger" role="menuitem" onClick={handleLogout}>
        <IconLogout />
        Sign out
      </button>
    </div>
  );

  if (variant === "topbar") {
    return (
      <div className="menuWrap" ref={ref}>
        <button
          type="button"
          className="avatarButton"
          onClick={toggle}
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
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="sbUser"
        onClick={toggle}
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
