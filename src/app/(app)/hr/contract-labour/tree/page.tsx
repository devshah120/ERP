"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonBlock, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import SearchSelect from "@/components/resource/SearchSelect";
import { useAuth } from "@/app/(app)/AuthProvider";
import { IconMinus, IconPlus, IconRefresh, IconHome, IconUsers, IconClose } from "@/components/icons";
import { CONTRACT_STATUS_LABELS, SKILL_LABELS } from "@/lib/resources/ui/hrRegistry";

interface ContractorNode {
  id: string;
  code: string;
  name: string;
  firmName: string;
  phone: string;
  contractStatus: string;
  supervisor: string;
  workLocation: string;
  workerCount: number;
  managerId: string | null;
}

interface Worker {
  id: string;
  code: string;
  name: string;
  phone: string;
  emergencyPhone: string;
  skillCategory: string;
  otherContractors: number;
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

/** Contractor Tree: every contractor under the main contractor it works for, with its workers. */
export default function ContractorTreePage() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState<{ items: ContractorNode[]; unassignedWorkers: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(4);
  const [picked, setPicked] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [workersError, setWorkersError] = useState<unknown>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const canSeeWorkers = hasPermission("hr-contract-workers.view");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<{ items: ContractorNode[]; unassignedWorkers: number }>("/api/hr/contract-labour/tree");
      setData(res);
      setExpanded(new Set(res.items.filter((n) => !n.managerId).map((n) => n.id)));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkers(null);
    setWorkersError(null);
    apiFetch<{ workers: Worker[] }>(`/api/hr/contract-labour/workers?contractorId=${selected}`)
      .then((r) => {
        if (!cancelled) setWorkers(r.workers);
      })
      .catch((err) => {
        if (!cancelled) setWorkersError(err);
      });
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const { byId, children, roots, totals } = useMemo(() => {
    const items = data?.items ?? [];
    const byId = new Map(items.map((n) => [n.id, n]));
    const children = new Map<string, ContractorNode[]>();
    for (const n of items) if (n.managerId) children.set(n.managerId, [...(children.get(n.managerId) ?? []), n]);
    // Workers in each contractor's whole branch (a worker under two contractors counts in each).
    const totals = new Map<string, number>();
    const count = (id: string): number => {
      if (totals.has(id)) return totals.get(id)!;
      const t = (byId.get(id)?.workerCount ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + count(c.id), 0);
      totals.set(id, t);
      return t;
    };
    items.forEach((n) => count(n.id));
    return { byId, children, roots: items.filter((n) => !n.managerId), totals };
  }, [data]);

  const options = useMemo(
    () => (data?.items ?? []).map((n) => ({ value: n.id, label: n.name, detail: [n.firmName, n.code].filter(Boolean).join(" · ") })),
    [data]
  );

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

  useEffect(() => {
    if (!scrollTo) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`ctr-${scrollTo}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
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

  function renderNode(n: ContractorNode) {
    const kids = children.get(n.id) ?? [];
    const open = expanded.has(n.id) && kids.length > 0;
    return (
      <li key={n.id}>
        <div id={`ctr-${n.id}`} className="orgCard" data-highlight={highlight === n.id || selected === n.id || undefined}>
          <span className="orgAvatar" style={{ background: tone(n.id) }} aria-hidden>
            {initials(n.name)}
          </span>
          <div className="orgCardBody">
            <Link href={`/hr-contractors/${n.id}`} className="orgName">
              {n.name}
            </Link>
            <div className="orgLine" title={n.firmName}>
              {n.firmName || <span className="cellMuted">{n.code}</span>}
            </div>
            {n.phone && <div className="orgLine">{n.phone}</div>}
            {n.supervisor && <div className="orgLine">Supervisor: {n.supervisor}</div>}
            <div className="orgDept">
              {canSeeWorkers ? (
                <button type="button" className="textLink" onClick={() => setSelected(n.id)} title="Show this contractor's workers">
                  {n.workerCount} worker{n.workerCount === 1 ? "" : "s"}
                </button>
              ) : (
                `${n.workerCount} worker${n.workerCount === 1 ? "" : "s"}`
              )}
              {n.contractStatus !== "ACTIVE" && ` · ${CONTRACT_STATUS_LABELS[n.contractStatus] ?? n.contractStatus}`}
            </div>
          </div>
          {kids.length > 0 && (
            <button
              type="button"
              className="orgToggle"
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} ${n.name}'s ${kids.length} sub-contractor${kids.length === 1 ? "" : "s"}`}
              title={`${kids.length} sub-contractor${kids.length === 1 ? "" : "s"} · ${totals.get(n.id)} workers in the branch`}
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

  const current = selected ? byId.get(selected) : undefined;

  return (
    <>
      <PageHeader title="Contractor Tree" description="Main contractors with their sub-contractors and workers. Set “Works under” on a contractor to place it." />

      <div className="toolbar">
        <div style={{ width: "18rem" }}>
          <SearchSelect
            id="ctr-search"
            value={picked}
            options={options}
            placeholder="Search contractor"
            onChange={(id) => {
              setPicked(id);
              if (id) goTo(id);
            }}
          />
        </div>
        <div className="toolbarRight">
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

      {error !== null && <ErrorState message={error instanceof ApiError ? error.message : "Could not load the contractor tree."} onRetry={load} />}
      {!data && error === null && <SkeletonBlock height="22rem" />}
      {data && data.items.length === 0 && <EmptyState title="No contractors yet" description="Add contractors under Contract Labour → Contractors, or bulk upload them from Excel." />}

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
      {data && data.unassignedWorkers > 0 && (
        <p className="hrMuted" style={{ marginTop: "0.5rem" }}>
          {data.unassignedWorkers} active worker{data.unassignedWorkers === 1 ? " is" : "s are"} under no contractor.
        </p>
      )}

      {current && (
        <div ref={panelRef} style={{ marginTop: "1rem" }}>
          <div className="toolbar">
            <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
              <IconUsers /> Workers under {current.name}
            </strong>
            <div className="toolbarRight">
              <Link href="/hr-contract-workers/new" className="button buttonSecondary">
                Add worker
              </Link>
              <button type="button" className="button buttonGhost buttonIcon" onClick={() => setSelected(null)} aria-label="Close the worker list">
                <IconClose />
              </button>
            </div>
          </div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Emergency no.</th>
                  <th>Skill</th>
                  <th>Also works for</th>
                </tr>
              </thead>
              <tbody>
                {!workers && !workersError && <SkeletonRows columns={6} rows={3} />}
                {workersError !== null && (
                  <tr>
                    <td colSpan={6}>
                      <ErrorState message={workersError instanceof ApiError ? workersError.message : "Could not load the workers."} />
                    </td>
                  </tr>
                )}
                {workers && workers.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState title="No active workers under this contractor" />
                    </td>
                  </tr>
                )}
                {workers?.map((w) => (
                  <tr key={w.id}>
                    <td className="cellMono">{w.code}</td>
                    <td>
                      <Link href={`/hr-contract-workers/${w.id}`} className="cellLink">
                        {w.name}
                      </Link>
                    </td>
                    <td>{w.phone || <span className="cellMuted">—</span>}</td>
                    <td>{w.emergencyPhone || <span className="cellMuted">—</span>}</td>
                    <td>{SKILL_LABELS[w.skillCategory] ?? <span className="cellMuted">—</span>}</td>
                    <td>{w.otherContractors > 0 ? `${w.otherContractors} other contractor${w.otherContractors === 1 ? "" : "s"}` : <span className="cellMuted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
