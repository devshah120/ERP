"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import SearchSelect from "@/components/resource/SearchSelect";
import { IconMinus, IconPlus, IconRefresh, IconUser, IconHome } from "@/components/icons";

interface OrgNode {
  id: string;
  code: string;
  name: string;
  designation: string;
  department: string;
  location: string;
  photoUrl: string | null;
  managerId: string | null;
}

const ZOOMS = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3];
const AVATAR_TONES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function tone(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Organization Tree: everyone on the rolls under their reporting manager. */
export default function OrgTreePage() {
  // Names open the profile only for those who may see the Employee Directory.
  const { hasPermission } = useAuth();
  const canOpenProfile = hasPermission("hr-employee-directory.view");
  const [data, setData] = useState<{ items: OrgNode[]; meId: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(4);
  const [picked, setPicked] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<{ items: OrgNode[]; meId: string | null }>("/api/hr/employees/tree");
      setData(res);
      // Start with the top of the tree and one level under it.
      setExpanded(new Set(res.items.filter((n) => !n.managerId).map((n) => n.id)));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const { byId, children, roots, totals } = useMemo(() => {
    const items = data?.items ?? [];
    const byId = new Map(items.map((n) => [n.id, n]));
    const children = new Map<string, OrgNode[]>();
    for (const n of items) if (n.managerId) children.set(n.managerId, [...(children.get(n.managerId) ?? []), n]);
    const totals = new Map<string, number>();
    const count = (id: string): number => {
      if (totals.has(id)) return totals.get(id)!;
      const t = (children.get(id) ?? []).reduce((s, c) => s + 1 + count(c.id), 0);
      totals.set(id, t);
      return t;
    };
    items.forEach((n) => count(n.id));
    return { byId, children, roots: items.filter((n) => !n.managerId), totals };
  }, [data]);

  const options = useMemo(
    () => (data?.items ?? []).map((n) => ({ value: n.id, label: n.name, detail: [n.designation, n.code].filter(Boolean).join(" · ") })),
    [data]
  );

  /** Opens every manager above `id` and brings the card into view. */
  const goTo = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (let cur = byId.get(id)?.managerId; cur; cur = byId.get(cur)?.managerId) next.add(cur);
        return next;
      });
      setHighlight(id);
      setScrollTo(id);
    },
    [byId]
  );

  // Scroll once the card is on screen (after the expand has rendered).
  useEffect(() => {
    if (!scrollTo) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`org-${scrollTo}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      setScrollTo(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTo, expanded]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [highlight]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goTop() {
    viewportRef.current?.scrollTo({ top: 0, left: Math.max(0, (viewportRef.current.scrollWidth - viewportRef.current.clientWidth) / 2), behavior: "smooth" });
  }

  function renderNode(n: OrgNode) {
    const kids = children.get(n.id) ?? [];
    const open = expanded.has(n.id) && kids.length > 0;
    return (
      <li key={n.id}>
        <div id={`org-${n.id}`} className="orgCard" data-highlight={highlight === n.id || undefined} data-me={data?.meId === n.id || undefined}>
          <span className="orgAvatar" style={{ background: tone(n.id) }} aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
            {n.photoUrl ? <img src={n.photoUrl} alt="" loading="lazy" /> : initials(n.name)}
          </span>
          <div className="orgCardBody">
            {canOpenProfile ? (
              <Link href={`/hr/employees/${n.id}`} className="orgName">
                {n.name}
              </Link>
            ) : (
              <span className="orgName">{n.name}</span>
            )}
            <div className="orgLine" title={n.designation}>
              {n.designation || <span className="cellMuted">No designation</span>}
            </div>
            {n.location && <div className="orgLine">{n.location}</div>}
            {n.department && <div className="orgDept">{n.department}</div>}
          </div>
          {kids.length > 0 && (
            <button
              type="button"
              className="orgToggle"
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} ${n.name}'s ${kids.length} direct report${kids.length === 1 ? "" : "s"}`}
              title={`${kids.length} direct report${kids.length === 1 ? "" : "s"} · ${totals.get(n.id)} in total`}
              onClick={() => toggle(n.id)}
            >
              {open ? <IconMinus width={12} height={12} /> : kids.length}
            </button>
          )}
        </div>
        {open && <ul>{kids.map(renderNode)}</ul>}
      </li>
    );
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader title="Organization Tree" description="Who reports to whom. Set each person's “Reports to” on their employee record." />

      <div className="toolbar">
        <div style={{ width: "18rem" }}>
          <SearchSelect
            id="org-search"
            value={picked}
            options={options}
            placeholder="Search employee"
            onChange={(id) => {
              setPicked(id);
              if (id) goTo(id);
            }}
          />
        </div>
        <div className="toolbarRight">
          <span className="hrMuted">Go to</span>
          {data?.meId && (
            <button type="button" className="button buttonSecondary" onClick={() => goTo(data.meId!)}>
              <IconUser /> Me
            </button>
          )}
          <button type="button" className="button buttonSecondary" onClick={goTop}>
            <IconHome /> Top
          </button>
          <button type="button" className="button buttonSecondary" onClick={() => setExpanded(new Set(data?.items.filter((n) => children.has(n.id)).map((n) => n.id)))} disabled={!data}>
            Expand all
          </button>
          <button type="button" className="button buttonSecondary" onClick={() => setExpanded(new Set())} disabled={!data}>
            Collapse all
          </button>
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} aria-label="Refresh">
            <IconRefresh />
          </button>
        </div>
      </div>

      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load the organization tree."} onRetry={load} />}
      {!data && error === null && <SkeletonBlock height="22rem" />}
      {data && data.items.length === 0 && <EmptyState title="No employees yet" description="Add employees and set who they report to." />}

      {data && data.items.length > 0 && (
        <div className="orgFrame">
          <div className="orgZoom" role="group" aria-label="Zoom">
            <button type="button" onClick={() => setZoom((z) => Math.min(z + 1, ZOOMS.length - 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">
              <IconPlus width={16} height={16} />
            </button>
            <button type="button" onClick={() => setZoom(4)} aria-label="Reset zoom" title="Reset zoom" className="orgZoomLevel">
              {Math.round(ZOOMS[zoom] * 100)}%
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.max(z - 1, 0))} disabled={zoom === 0} aria-label="Zoom out">
              <IconMinus width={16} height={16} />
            </button>
          </div>
          <div className="orgViewport" ref={viewportRef}>
            <div className="orgTree" style={{ zoom: ZOOMS[zoom] }}>
              <ul>{roots.map(renderNode)}</ul>
            </div>
          </div>
        </div>
      )}
      {data && roots.length > 1 && (
        <p className="hrMuted" style={{ marginTop: "0.5rem" }}>
          {roots.length} people report to no one on the rolls, so they are all at the top.
        </p>
      )}
    </>
  );
}
