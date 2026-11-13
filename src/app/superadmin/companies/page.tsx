"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconRefresh, IconAlertCircle, IconBuilding } from "@/components/icons";

interface CompanyRow {
  id: string;
  legalName: string;
  tradeName: string;
  domain: string;
  email: string;
  status: string;
  userCount: number;
  country: string;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: "Active", cls: "saBadge saBadgeActive" },
    SUSPENDED: { label: "Suspended", cls: "saBadge saBadgeSuspended" },
    PENDING_VERIFICATION: { label: "Pending", cls: "saBadge saBadgePending" },
  };
  const s = map[status] ?? { label: status, cls: "saBadge" };
  return <span className={s.cls}>{s.label}</span>;
}

const STATUS_FILTERS = ["All", "ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"] as const;

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/companies");
      if (res.status === 401) { router.replace("/superadmin/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to load");
      setCompanies(json.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!companies) return [];
    let list = companies;
    if (statusFilter !== "All") list = list.filter((c) => c.status === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((c) => [c.legalName, c.tradeName, c.domain, c.email].some((v) => v.toLowerCase().includes(q)));
    }
    return list;
  }, [companies, statusFilter, query]);

  async function signOut() {
    await fetch("/api/superadmin/logout", { method: "POST" });
    router.replace("/superadmin/login");
  }

  return (
    <div className="saPage">
      <header className="saHeader">
        <div className="saHeaderBrand">NEXORA <span className="saHeaderTag">Admin Portal</span></div>
        <nav className="saHeaderNav">
          <Link href="/superadmin/dashboard" className="saNavLink">Dashboard</Link>
          <Link href="/superadmin/companies" className="saNavLink saNavLinkActive">Companies</Link>
        </nav>
        <button type="button" className="saBtn saBtnGhost saBtnSm" onClick={signOut}>Sign out</button>
      </header>

      <main className="saMain">
        <div className="saPageHead">
          <div>
            <h1 className="saPageTitle">All Companies</h1>
            <p className="saPageSub">
              {companies ? `${companies.length} companies registered` : "Loading…"}
            </p>
          </div>
          <button type="button" className="saBtn saBtnSecondary saBtnIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>

        {error && (
          <div className="saBanner saBannerError" style={{ marginBottom: "1.5rem" }}>
            <IconAlertCircle /><span>{error}</span>
          </div>
        )}

        {/* Toolbar */}
        <div className="saToolbar">
          <input
            className="saSearchInput"
            type="search"
            placeholder="Search by name, domain or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="saFilterGroup">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`saFilterBtn ${statusFilter === s ? "saFilterBtnActive" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === "All" ? "All" : s === "ACTIVE" ? "Active" : s === "SUSPENDED" ? "Suspended" : "Pending"}
              </button>
            ))}
          </div>
        </div>

        <div className="saTableWrap">
          <table className="saTable">
            <thead>
              <tr>
                <th>Company</th>
                <th>Domain</th>
                <th>Owner Email</th>
                <th>Users</th>
                <th>Country</th>
                <th>Registered</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="saTableEmpty">Loading…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="saTableEmpty">
                    <IconBuilding style={{ opacity: 0.3, fontSize: "2rem" }} />
                    <p>No companies found.</p>
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="saCellPrimary">{c.legalName}</span>
                    {c.tradeName !== c.legalName && <span className="saCellSub">{c.tradeName}</span>}
                  </td>
                  <td className="saCellMono">{c.domain}</td>
                  <td className="saCellMuted">{c.email}</td>
                  <td className="saCellMuted">{c.userCount}</td>
                  <td className="saCellMuted">{c.country}</td>
                  <td className="saCellMuted">
                    {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>
                    <Link href={`/superadmin/companies/${c.id}`} className="saBtn saBtnGhost saBtnSm">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

