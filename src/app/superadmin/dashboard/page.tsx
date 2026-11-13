"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconBuilding, IconUsers, IconAlertCircle, IconRefresh } from "@/components/icons";

interface CompanyRow {
  id: string;
  legalName: string;
  tradeName: string;
  domain: string;
  email: string;
  status: string;
  userCount: number;
  createdAt: string;
}

interface Summary {
  total: number;
  active: number;
  suspended: number;
  pending: number;
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

export default function SuperAdminDashboard() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/companies");
      if (res.status === 401) { router.replace("/superadmin/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to load");
      setCompanies(json.data.items);
      setSummary(json.data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load companies.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function signOut() {
    await fetch("/api/superadmin/logout", { method: "POST" });
    router.replace("/superadmin/login");
  }

  const recent = companies?.slice(0, 8) ?? [];

  return (
    <div className="saPage">
      {/* Header */}
      <header className="saHeader">
        <div className="saHeaderBrand">NEXORA <span className="saHeaderTag">Admin Portal</span></div>
        <nav className="saHeaderNav">
          <Link href="/superadmin/dashboard" className="saNavLink saNavLinkActive">Dashboard</Link>
          <Link href="/superadmin/companies" className="saNavLink">Companies</Link>
        </nav>
        <button type="button" className="saBtn saBtnGhost saBtnSm" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="saMain">
        <div className="saPageHead">
          <div>
            <h1 className="saPageTitle">Dashboard</h1>
            <p className="saPageSub">Overview of all registered companies on the platform.</p>
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

        {/* Summary Cards */}
        <div className="saCards">
          {[
            { label: "Total Companies", value: summary?.total ?? "—", icon: <IconBuilding /> },
            { label: "Active", value: summary?.active ?? "—", icon: <IconBuilding />, accent: "active" },
            { label: "Suspended", value: summary?.suspended ?? "—", icon: <IconBuilding />, accent: "danger" },
            { label: "Pending Verification", value: summary?.pending ?? "—", icon: <IconUsers />, accent: "warn" },
          ].map((c) => (
            <div key={c.label} className={`saCard ${c.accent ? `saCard--${c.accent}` : ""}`}>
              <div className="saCardIcon">{c.icon}</div>
              <div className="saCardValue">{loading ? "—" : c.value}</div>
              <div className="saCardLabel">{c.label}</div>
            </div>
          ))}
        </div>

        {/* Recent Companies */}
        <div className="saSection">
          <div className="saSectionHead">
            <h2 className="saSectionTitle">Recent Registrations</h2>
            <Link href="/superadmin/companies" className="saTextLink">View all →</Link>
          </div>

          <div className="saTableWrap">
            <table className="saTable">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Domain</th>
                  <th>Owner Email</th>
                  <th>Users</th>
                  <th>Registered</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="saTableEmpty">Loading…</td></tr>
                )}
                {!loading && recent.length === 0 && (
                  <tr><td colSpan={7} className="saTableEmpty">No companies registered yet.</td></tr>
                )}
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className="saCellPrimary">{c.legalName}</span>
                      {c.tradeName !== c.legalName && <span className="saCellSub">{c.tradeName}</span>}
                    </td>
                    <td className="saCellMono">{c.domain}</td>
                    <td className="saCellMuted">{c.email}</td>
                    <td className="saCellMuted">{c.userCount}</td>
                    <td className="saCellMuted">
                      {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>
                      <Link href={`/superadmin/companies/${c.id}`} className="saBtn saBtnGhost saBtnSm">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

