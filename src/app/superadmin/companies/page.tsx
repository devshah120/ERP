"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconRefresh, IconAlertCircle, IconBuilding, IconPlus } from "@/components/icons";
import SAHeader, { ProductTags, fmtDate } from "../SAHeader";

interface CompanyRow {
  id: string;
  legalName: string;
  tradeName: string;
  domain: string;
  email: string;
  status: string;
  userCount: number;
  employeeCount: number;
  country: string;
  products: string[];
  plan: string | null;
  maxEmployees: number | null;
  subscriptionEndsAt: string | null;
  expired: boolean;
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
  const [productFilter, setProductFilter] = useState<string>("");

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
    if (productFilter) list = list.filter((c) => c.products.includes(productFilter));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((c) => [c.legalName, c.tradeName, c.domain, c.email].some((v) => v.toLowerCase().includes(q)));
    }
    return list;
  }, [companies, statusFilter, productFilter, query]);

  return (
    <div className="saPage">
      <SAHeader />

      <main className="saMain">
        <div className="saPageHead">
          <div>
            <h1 className="saPageTitle">All Companies</h1>
            <p className="saPageSub">
              {companies ? `${companies.length} companies registered` : "Loading…"}
            </p>
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

        {/* Toolbar */}
        <div className="saToolbar">
          <input
            className="saSearchInput"
            type="search"
            placeholder="Search by name, workspace ID or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="saInput" style={{ width: "auto" }} value={productFilter} onChange={(e) => setProductFilter(e.target.value)} aria-label="Product">
            <option value="">All products</option>
            <option value="ERP">ERP</option>
            <option value="HRMS">HRMS</option>
          </select>
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
                <th>Products</th>
                <th>Plan</th>
                <th>Owner Email</th>
                <th>Users</th>
                <th>Employees</th>
                <th>Valid until</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="saTableEmpty">Loading…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="saTableEmpty">
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
                  <td><ProductTags products={c.products} /></td>
                  <td className="saCellMuted">{c.plan ?? "—"}</td>
                  <td className="saCellMuted">{c.email}</td>
                  <td className="saCellMuted">{c.userCount}</td>
                  <td className="saCellMuted">
                    {c.products.includes("HRMS") ? `${c.employeeCount}${c.maxEmployees ? ` / ${c.maxEmployees}` : ""}` : "—"}
                  </td>
                  <td className="saCellMuted">
                    {fmtDate(c.subscriptionEndsAt)}
                    {c.expired && <span className="saBadge saBadgeSuspended" style={{ marginLeft: "0.35rem" }}>Expired</span>}
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

