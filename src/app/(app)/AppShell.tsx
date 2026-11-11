"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { NAV_SECTIONS, NAV_GROUPS, breadcrumbsFor, creatableModules, soonCount, type NavGroup, type NavChild } from "./navigation";
import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";
import { usePopover } from "@/components/ui/usePopover";
import CommandPalette from "@/components/shell/CommandPalette";
import NotificationsMenu from "@/components/shell/NotificationsMenu";
import UserMenu from "@/components/shell/UserMenu";
import { CalculatorButton, FinancialYearMenu, HelpMenu } from "@/components/shell/HeaderWidgets";
import { IconSearch, IconChevronRight, IconBrandMark, IconMenu, IconSidebar, IconPlus, IconHome, IconClose } from "@/components/icons";

const COLLAPSE_KEY = "erp.sidebar.collapsed";
const PLANNED_KEY = "erp.sidebar.showPlanned";

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
  const { me, loading } = useAuth();
  const { openPalette } = useShortcuts();
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);
  const [showPlanned, setShowPlanned] = useState(true);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
      if (localStorage.getItem(PLANNED_KEY) === "0") setShowPlanned(false);
    } catch {
      /* storage unavailable — keep defaults */
    }
  }, []);

  // Navigating opens the group you landed in and closes the mobile drawer.
  useEffect(() => {
    const g = NAV_GROUPS.find((grp) => grp.children?.some((c) => isActive(pathname, c.href)));
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  function togglePlanned() {
    setShowPlanned((s) => {
      try {
        localStorage.setItem(PLANNED_KEY, s ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !s;
    });
  }

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

  // What the sidebar shows after the planned-module toggle and the menu filter.
  const q = menuQuery.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    return NAV_SECTIONS.map((section) => ({
      ...section,
      groups: section.groups
        .map((g) => {
          if (g.href) {
            if (g.soon && !showPlanned) return null;
            if (q && !hit(g.label, q) && !hit(g.keywords, q)) return null;
            return { group: g, children: [] as NavChild[] };
          }
          let kids = (g.children ?? []).filter((c) => showPlanned || c.enabled);
          if (q) {
            const groupHit = hit(g.label, q) || hit(g.keywords, q);
            if (!groupHit) kids = kids.filter((c) => hit(c.label, q) || hit(c.keywords, q));
          }
          return kids.length > 0 ? { group: g, children: kids } : null;
        })
        .filter((x): x is { group: NavGroup; children: NavChild[] } => x !== null),
    })).filter((s) => s.groups.length > 0);
  }, [q, showPlanned]);

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
  const flyoutChildren = flyoutGroup?.children?.filter((c) => showPlanned || c.enabled) ?? [];
  const filtering = q.length > 0;

  return (
    <div className="appShell" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      {/* ------------------------------------------------------------ header */}
      <header className="appHeader">
        <button type="button" className="hdrIconBtn hdrMenuBtn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          <IconMenu />
        </button>

        <Link href="/dashboard" className="hdrBrand" title={me.business?.name ?? "Garment ERP"}>
          <span className="hdrBrandMark">
            <IconBrandMark />
          </span>
          <span className="hdrBrandText">
            garment<span>erp</span>
          </span>
        </Link>

        <FinancialYearMenu />

        <div className="hdrCenter">
          <button type="button" className="hdrSearch" onClick={openPalette} aria-label="Search (Ctrl + K)">
            <IconSearch />
            <span>Search screens, parties, items, document no…</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>

        <div className="hdrActions">
          <QuickCreate />
          <span className="hdrDivider hideMobile" aria-hidden />
          <CalculatorButton />
          <NotificationsMenu />
          <HelpMenu />
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
                  if (group.soon) {
                    return (
                      <span key={group.key} className="sbItem sbItemSoon" title="Planned — not available yet" aria-disabled="true">
                        <span className="sbItemIcon">
                          <Icon />
                        </span>
                        <span className="sbItemLabel">{group.label}</span>
                        <span className="soonTag sbItemTag">Soon</span>
                      </span>
                    );
                  }
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
                const allPlanned = kids.every((c) => !c.enabled);

                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      className={`sbItem ${activeHref ? "sbItemParentActive" : ""} ${collapsed && activeHref ? "sbItemActive" : ""} ${allPlanned ? "sbItemDim" : ""}`}
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
                      {allPlanned && <span className="soonTag sbItemTag">Soon</span>}
                      <span className={`sbItemChevron ${isOpen ? "open" : ""}`}>
                        <IconChevronRight />
                      </span>
                    </button>

                    <div className={`sbChildren ${isOpen ? "open" : ""}`}>
                      <div className="sbChildrenInner">
                        <div className="sbChildList">
                          {kids.map((child) =>
                            child.enabled ? (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={`sbChild ${activeHref === child.href ? "sbChildActive" : ""}`}
                                aria-current={activeHref === child.href ? "page" : undefined}
                                tabIndex={isOpen ? undefined : -1}
                              >
                                <span className="sbChildText">{child.label}</span>
                              </Link>
                            ) : (
                              <span key={child.href} className="sbChild sbChildDisabled" title={`${child.label} — planned, not available yet`} aria-disabled="true">
                                <span className="sbChildText">{child.label}</span>
                                {!allPlanned && <span className="soonTag">Soon</span>}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sbFoot">
          <label className="sbToggle" title="Show or hide modules that are planned but not built yet">
            <input type="checkbox" checked={showPlanned} onChange={togglePlanned} />
            <span className="sbToggleTrack" aria-hidden>
              <span />
            </span>
            <span className="sbItemLabel">Show planned modules</span>
          </label>
        </div>
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
            {soonCount(flyoutGroup) > 0 && showPlanned && <span className="sbFlyoutNote"> · {soonCount(flyoutGroup)} planned</span>}
          </div>
          {flyoutChildren.map((child) => {
            const activeHref = activeChildHref(pathname, flyoutGroup);
            return child.enabled ? (
              <Link key={child.href} href={child.href} className={`sbChild ${activeHref === child.href ? "sbChildActive" : ""}`}>
                {child.label}
              </Link>
            ) : (
              <span key={child.href} className="sbChild sbChildDisabled">
                {child.label}
                <span className="soonTag">Soon</span>
              </span>
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
  const { open, toggle, close, ref } = usePopover<HTMLDivElement>();
  const modules = creatableModules();
  const groups = [...new Set(modules.map((m) => m.group))];

  return (
    <div className="menuWrap" ref={ref}>
      <button type="button" className="hdrNew" onClick={toggle} aria-expanded={open} aria-haspopup="menu" title="Create a new record">
        <IconPlus />
        <span className="hideMobile">Create</span>
      </button>
      {open && (
        <div className="menu quickCreateMenu" role="menu">
          {groups.map((g) => (
            <div key={g}>
              <div className="menuLabel">{g}</div>
              {modules
                .filter((m) => m.group === g)
                .map((m) => (
                  <Link key={m.href} href={m.href} className="menuItem" role="menuitem" onClick={close}>
                    {m.label.replace(/ies$/, "y").replace(/s$/, "")}
                  </Link>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
