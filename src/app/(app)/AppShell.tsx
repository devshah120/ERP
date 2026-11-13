"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { useAuth } from "./AuthProvider";
import {
  NAV_SECTIONS,
  NAV_GROUPS,
  breadcrumbsFor,
  creatableModules,
  getRequiredPermission,
  getCreatePermission,
  type NavGroup,
  type NavChild,
} from "./navigation";
import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";
import CommandPalette from "@/components/shell/CommandPalette";
import NotificationsMenu from "@/components/shell/NotificationsMenu";
import UserMenu from "@/components/shell/UserMenu";
import { FinancialYearMenu, CalculatorButton } from "@/components/shell/HeaderWidgets";
import { IconSearch, IconChevronRight, IconMenu, IconSidebar, IconPlus, IconHome, IconClose, IconStore } from "@/components/icons";

const COLLAPSE_KEY = "erp.sidebar.collapsed";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/** The child whose href is the longest prefix of the path — so /reports/x doesn't also light up /reports. */
function activeChildHref(pathname: string, group: NavGroup): string | null {
  let best: string | null = null;
  for (const c of group.children ?? []) {
    if (c.enabled && isActive(pathname, c.href) && (!best || c.href.length > best.length)) best = c.href;
  }
  return best;
}

function hit(text: string | undefined, q: string) {
  return Boolean(text && text.toLowerCase().includes(q));
}

type Flyout = { key: string; top: number; kind: "tip" | "menu" } | null;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { me, loading, hasPermission } = useAuth();
  const { openPalette } = useShortcuts();
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const g = NAV_GROUPS.find((grp) => grp.children?.some((c) => isActive(pathname, c.href)));
    return new Set(g ? [g.key] : []);
  });
  const [flyout, setFlyout] = useState<Flyout>(null);
  const flyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore per-browser sidebar preferences after hydration.
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      /* storage unavailable — keep defaults */
    }
  }, []);

  // Navigating opens the group you landed in and closes the mobile drawer.
  useEffect(() => {
    const g = NAV_GROUPS.find((grp) => grp.children?.some((c) => isActive(pathname, c.href)));
    if (g) setOpenGroups((prev) => (prev.has(g.key) ? prev : new Set(prev).add(g.key)));
    setMobileOpen(false);
    setFlyout(null);
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
    setFlyout(null);
  }, []);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function showFlyout(key: string, el: HTMLElement, kind: "tip" | "menu") {
    if (!collapsed || window.matchMedia("(max-width: 900px)").matches) return;
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    const rect = el.getBoundingClientRect();
    setFlyout({ key, top: kind === "tip" ? rect.top + rect.height / 2 : rect.top, kind });
  }

  function hideFlyoutSoon() {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    flyoutTimer.current = setTimeout(() => setFlyout(null), 140);
  }

  function keepFlyout() {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
  }

  // What the sidebar shows after the permission check and menu filter.
  const q = menuQuery.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    return NAV_SECTIONS.map((section) => ({
      ...section,
      groups: section.groups
        .map((g) => {
          if (g.href) {
            if (g.soon) return null;
            const perm = getRequiredPermission(g.href);
            if (perm && !hasPermission(perm)) return null;
            if (q && !hit(g.label, q) && !hit(g.keywords, q)) return null;
            return { group: g, children: [] as NavChild[] };
          }
          let kids = (g.children ?? []).filter((c) => {
            if (!c.enabled) return false;
            const perm = getRequiredPermission(c.href);
            if (perm && !hasPermission(perm)) return false;
            return true;
          });
          if (q) {
            const groupHit = hit(g.label, q) || hit(g.keywords, q);
            if (!groupHit) kids = kids.filter((c) => hit(c.label, q) || hit(c.keywords, q));
          }
          return kids.length > 0 ? { group: g, children: kids } : null;
        })
        .filter((x): x is { group: NavGroup; children: NavChild[] } => x !== null),
    })).filter((s) => s.groups.length > 0);
  }, [q, hasPermission]);

  if (loading || !me) {
    return (
      <div className="shellLoading" role="status">
        <span className="spinner" style={{ color: "var(--accent)" }} />
        {loading ? "Loading your workspace…" : "Redirecting to sign in…"}
      </div>
    );
  }

  const crumbs = breadcrumbsFor(pathname);
  const flyoutGroup = flyout ? NAV_GROUPS.find((g) => g.key === flyout.key) : undefined;
  const flyoutChildren = (flyoutGroup?.children ?? [])
    .filter((c) => c.enabled)
    .filter((c) => {
      const perm = getRequiredPermission(c.href);
      return !perm || hasPermission(perm);
    });
  const filtering = q.length > 0;

  return (
    <div className="appShell" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      {/* ------------------------------------------------------------ header */}
      <header className="appHeader">
        <button type="button" className="hdrIconBtn hdrMenuBtn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          <IconMenu />
        </button>

        <Link href="/dashboard" className="hdrBrand" title={me.business?.name ?? "NEXORA"}>
          <span className="hdrBrandText">
            NEXORA
          </span>
        </Link>

        <FinancialYearMenu />

        <div className="hdrCenter">
          <ButtonBase
            type="button"
            className="hdrSearch"
            onClick={openPalette}
            aria-label="Search (Ctrl + K)"
            sx={{
              textAlign: "left",
              fontFamily: "inherit",
              fontSize: "inherit",
              cursor: "pointer",
            }}
          >
            <IconSearch />
            <span>Search screens, parties, items, document no…</span>
            <Box
              component="kbd"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                height: 20,
                px: "6px",
                fontSize: "0.6875rem",
                fontFamily: "monospace",
                lineHeight: 1,
                borderRadius: "4px",
                border: "1px solid",
                borderColor: "var(--border, #e2e8f0)",
                bgcolor: "var(--surface, #fff)",
                color: "var(--text, #1e293b)",
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              Ctrl K
            </Box>
          </ButtonBase>
        </div>

        <div className="hdrActions">
          <QuickCreate />
          <CalculatorButton />
          <span className="hdrDivider hideMobile" aria-hidden />
          <Link
            href="/pos/register"
            className="hdrIconBtn posToggle"
            aria-label="Open POS register"
            title="Point of Sale"
            aria-current={isActive(pathname, "/pos/register") ? "page" : undefined}
          >
            <IconStore />
          </Link>
          <NotificationsMenu />
          <UserMenu variant="topbar" />
        </div>
      </header>

      {/* ----------------------------------------------------------- sidebar */}
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sbHead">
          <div className="sbFind">
            <IconSearch />
            <input
              value={menuQuery}
              onChange={(e) => setMenuQuery(e.target.value)}
              placeholder="Find in menu"
              aria-label="Find in menu"
              onKeyDown={(e) => {
                if (e.key === "Escape") setMenuQuery("");
              }}
            />
            {menuQuery && (
              <button type="button" onClick={() => setMenuQuery("")} aria-label="Clear menu filter">
                <IconClose />
              </button>
            )}
          </div>
          <button
            type="button"
            className="sbHeadBtn"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <IconSidebar />
          </button>
        </div>

        <nav className="sbScroll">
          {visibleSections.length === 0 && <div className="sbEmpty">No menu item matches “{menuQuery}”.</div>}
          {visibleSections.map((section) => (
            <div key={section.key} className="sbSection">
              {section.label && <div className="sbSectionLabel">{section.label}</div>}
              {section.groups.map(({ group, children: kids }) => {
                const Icon = group.icon;

                if (group.href) {
                  const active = isActive(pathname, group.href);
                  return (
                    <Link
                      key={group.key}
                      href={group.href}
                      className={`sbItem ${active ? "sbItemActive" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onMouseEnter={(e) => showFlyout(group.key, e.currentTarget, "tip")}
                      onMouseLeave={hideFlyoutSoon}
                      onFocus={(e) => showFlyout(group.key, e.currentTarget, "tip")}
                      onBlur={hideFlyoutSoon}
                    >
                      <span className="sbItemIcon">
                        <Icon />
                      </span>
                      <span className="sbItemLabel">{group.label}</span>
                    </Link>
                  );
                }

                const isOpen = filtering || openGroups.has(group.key);
                const activeHref = activeChildHref(pathname, group);

                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      className={`sbItem ${activeHref ? "sbItemParentActive" : ""} ${collapsed && activeHref ? "sbItemActive" : ""}`}
                      onClick={() => (collapsed ? null : toggleGroup(group.key))}
                      aria-expanded={collapsed ? undefined : isOpen}
                      onMouseEnter={(e) => showFlyout(group.key, e.currentTarget, "menu")}
                      onMouseLeave={hideFlyoutSoon}
                      onFocus={(e) => showFlyout(group.key, e.currentTarget, "menu")}
                    >
                      <span className="sbItemIcon">
                        <Icon />
                      </span>
                      <span className="sbItemLabel">{group.label}</span>
                      <span className={`sbItemChevron ${isOpen ? "open" : ""}`}>
                        <IconChevronRight />
                      </span>
                    </button>

                    <div className={`sbChildren ${isOpen ? "open" : ""}`}>
                      <div className="sbChildrenInner">
                        <div className="sbChildList">
                          {kids.map((child) => (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={`sbChild ${activeHref === child.href ? "sbChildActive" : ""}`}
                              aria-current={activeHref === child.href ? "page" : undefined}
                              tabIndex={isOpen ? undefined : -1}
                            >
                              <span className="sbChildText">{child.label}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

      </aside>

      {/* Collapsed-rail tooltip / submenu, fixed so the scrolling nav can't clip it. */}
      {flyout && flyoutGroup && flyout.kind === "tip" && (
        <div className="sbTooltip" style={{ top: flyout.top }} role="tooltip">
          {flyoutGroup.label}
        </div>
      )}
      {flyout && flyoutGroup && flyout.kind === "menu" && (
        <div
          className="sbFlyout"
          style={{ top: Math.max(8, Math.min(flyout.top, window.innerHeight - 48 - flyoutChildren.length * 31)) }}
          onMouseEnter={keepFlyout}
          onMouseLeave={hideFlyoutSoon}
        >
          <div className="sbFlyoutTitle">
            {flyoutGroup.label}
          </div>
          {flyoutChildren.map((child) => {
            const activeHref = activeChildHref(pathname, flyoutGroup);
            return (
              <Link key={child.href} href={child.href} className={`sbChild ${activeHref === child.href ? "sbChildActive" : ""}`}>
                {child.label}
              </Link>
            );
          })}
        </div>
      )}

      <div className="sbBackdrop" onClick={() => setMobileOpen(false)} aria-hidden />

      {/* -------------------------------------------------------------- main */}
      <div className="mainColumn">
        <nav className="crumbBar" aria-label="Breadcrumb">
          <Link href="/dashboard" className="crumbHome" aria-label="Home">
            <IconHome />
          </Link>
          {crumbs.map((c, i) => (
            <Fragment key={`${c.label}-${i}`}>
              <span className="crumbSep" aria-hidden>
                <IconChevronRight />
              </span>
              {c.href ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span className={i === crumbs.length - 1 ? "crumbCurrent" : "crumbMuted"} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                  {c.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
        <main className="mainArea" id="main">
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

/** "+ New" — every creatable record type, grouped by module. */
function QuickCreate() {
  const { hasPermission } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const allModules = useMemo(() => creatableModules(), []);
  const modules = useMemo(
    () =>
      allModules.filter((m) => {
        const perm = getCreatePermission(m.href);
        return !perm || hasPermission(perm);
      }),
    [allModules, hasPermission]
  );
  const groups = useMemo(() => [...new Set(modules.map((m) => m.group))], [modules]);

  if (modules.length === 0) return null;

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <div className="menuWrap">
      <button
        type="button"
        className="hdrNew"
        onClick={handleOpen}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Create a new record"
      >
        <IconPlus />
        <span className="hideMobile">Create</span>
      </button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              width: 220,
              maxHeight: "24rem",
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              mt: 1,
            },
          },
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {groups.map((g) => (
          <Box key={g}>
            <Typography
              variant="overline"
              sx={{
                px: 2,
                pt: 1,
                pb: 0.25,
                display: "block",
                fontWeight: 700,
                fontSize: "0.6875rem",
                color: "text.secondary",
                letterSpacing: 0.5,
              }}
            >
              {g}
            </Typography>
            {modules
              .filter((m) => m.group === g)
              .map((m) => (
                <MenuItem
                  key={m.href}
                  component={Link}
                  href={m.href}
                  onClick={handleClose}
                  sx={{ py: 0.75, px: 2, fontSize: "0.8125rem" }}
                >
                  <ListItemText
                    primary={
                      <Typography variant="body2" sx={{ fontSize: "0.8125rem", fontWeight: 500 }}>
                        {m.label.replace(/ies$/, "y").replace(/s$/, "")}
                      </Typography>
                    }
                  />
                </MenuItem>
              ))}
          </Box>
        ))}
      </Menu>
    </div>
  );
}
