"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconBuilding, IconUsers, IconAlertCircle, IconRefresh, IconPlus } from "@/components/icons";
import SAHeader, { ProductTags } from "../SAHeader";

interface CompanyRow {
  id: string;
  legalName: string;
  tradeName: string;
  domain: string;
  email: string;
  status: string;
  userCount: number;
  products: string[];
  createdAt: string;
}

interface Summary {
  total: number;
  active: number;
  suspended: number;
  pending: number;
  erp: number;
  hrms: number;
  expired: number;
  employees: number;
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


  const recent = companies?.slice(0, 8) ?? [];

  return (
    <div className="saPage">
      {/* Header */}
      <SAHeader />

      <main className="saMain">
        <div className="saPageHead">
          <div>
            <h1 className="saPageTitle">Dashboard</h1>
            <p className="saPageSub">Overview of all registered companies on the platform.</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="saBtn saBtnSecondary saBtnIcon" onClick={load} disabled={loading} aria-label="Refresh">
              {loading ? <span className="spinner" /> : <IconRefresh />}
            </button>
            <Link href="/superadmin/companies/new" className="saBtn saBtnPrimary">
              <IconPlus /> New account
            </Link>
          </div>
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
            { label: "ERP customers", value: summary?.erp ?? "—", icon: <IconBuilding /> },
            { label: "HRMS customers", value: summary?.hrms ?? "—", icon: <IconUsers /> },
            { label: "Employees on HRMS", value: summary?.employees ?? "—", icon: <IconUsers /> },
            { label: "Expired subscriptions", value: summary?.expired ?? "—", icon: <IconAlertCircle />, accent: "danger" },
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
                  <th>Products</th>
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
                    <td><ProductTags products={c.products} /></td>
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

