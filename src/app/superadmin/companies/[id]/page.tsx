"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { IconAlertCircle, IconUsers, IconBuilding, IconRefresh } from "@/components/icons";

interface CompanyDetail {
  id: string;
  legalName: string;
  tradeName: string;
  domain: string;
  email: string;
  phone: string;
  status: string;
  country: string;
  state: string;
  city: string;
  address: string;
  gstin: string | null;
  registrationNumber: string | null;
  currency: string;
  financialYearStartMonth: number;
  createdAt: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  status: string;
  group: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: "Active", cls: "saBadge saBadgeActive" },
    SUSPENDED: { label: "Suspended", cls: "saBadge saBadgeSuspended" },
    PENDING_VERIFICATION: { label: "Pending", cls: "saBadge saBadgePending" },
    LOCKED: { label: "Locked", cls: "saBadge saBadgeSuspended" },
    DISABLED: { label: "Disabled", cls: "saBadge saBadgePending" },
  };
  const s = map[status] ?? { label: status, cls: "saBadge" };
  return <span className={s.cls}>{s.label}</span>;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function CompanyDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, uRes] = await Promise.all([
        fetch(`/api/superadmin/companies/${id}`),
        fetch(`/api/superadmin/companies/${id}/users`),
      ]);
      if (cRes.status === 401 || uRes.status === 401) { router.replace("/superadmin/login"); return; }
      const [cJson, uJson] = await Promise.all([cRes.json(), uRes.json()]);
      if (!cRes.ok) throw new Error(cJson.message ?? "Failed to load company");
      setCompany(cJson.data);
      setUsers(uJson.data?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(newStatus: "ACTIVE" | "SUSPENDED") {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/superadmin/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to update status");
      setCompany((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setActionBusy(false);
    }
  }

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
        {/* Breadcrumb */}
        <div className="saBreadcrumb">
          <Link href="/superadmin/companies" className="saTextLink">← All Companies</Link>
        </div>

        {error && (
          <div className="saBanner saBannerError" style={{ marginBottom: "1.5rem" }}>
            <IconAlertCircle /><span>{error}</span>
          </div>
        )}

        {loading && <div className="saLoadingMsg">Loading company details…</div>}

        {company && (
          <>
            {/* Company Header */}
            <div className="saDetailHeader">
              <div className="saDetailHeaderLeft">
                <div className="saDetailIcon"><IconBuilding /></div>
                <div>
                  <h1 className="saPageTitle">{company.legalName}</h1>
                  {company.tradeName !== company.legalName && (
                    <p className="saPageSub">Trade name: {company.tradeName}</p>
                  )}
                </div>
              </div>
              <div className="saDetailHeaderRight">
                <StatusBadge status={company.status} />
                <button
                  type="button"
                  className="saBtn saBtnSecondary saBtnIcon"
                  onClick={load}
                  disabled={loading}
                  aria-label="Refresh"
                >
                  <IconRefresh />
                </button>
              </div>
            </div>

            {actionError && (
              <div className="saBanner saBannerError" style={{ marginBottom: "1rem" }}>
                <IconAlertCircle /><span>{actionError}</span>
              </div>
            )}

            <div className="saDetailGrid">
              {/* Business Info Panel */}
              <section className="saPanel">
                <div className="saPanelHead">
                  <h2 className="saPanelTitle">Business Information</h2>
                </div>
                <div className="saPanelBody">
                  <dl className="saInfoList">
                    <div className="saInfoRow"><dt>Domain</dt><dd className="saCellMono">{company.domain}</dd></div>
                    <div className="saInfoRow"><dt>Owner Email</dt><dd>{company.email}</dd></div>
                    <div className="saInfoRow"><dt>Phone</dt><dd>{company.phone || "—"}</dd></div>
                    <div className="saInfoRow"><dt>Country</dt><dd>{company.country}</dd></div>
                    {company.state && <div className="saInfoRow"><dt>State</dt><dd>{company.state}</dd></div>}
                    {company.city && <div className="saInfoRow"><dt>City</dt><dd>{company.city}</dd></div>}
                    {company.gstin && <div className="saInfoRow"><dt>GSTIN</dt><dd className="saCellMono">{company.gstin}</dd></div>}
                    <div className="saInfoRow"><dt>Currency</dt><dd>{company.currency}</dd></div>
                    <div className="saInfoRow"><dt>FY Start</dt><dd>{MONTHS[(company.financialYearStartMonth - 1) % 12]}</dd></div>
                    <div className="saInfoRow">
                      <dt>Registered</dt>
                      <dd>{new Date(company.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</dd>
                    </div>
                  </dl>
                </div>
              </section>

              {/* Actions Panel */}
              <section className="saPanel">
                <div className="saPanelHead">
                  <h2 className="saPanelTitle">Actions</h2>
                </div>
                <div className="saPanelBody">
                  <div className="saActionList">
                    {company.status === "ACTIVE" && (
                      <div className="saActionRow">
                        <div>
                          <div className="saActionLabel">Suspend Company</div>
                          <div className="saActionDesc">Prevents the company and all its users from signing in.</div>
                        </div>
                        <button
                          type="button"
                          className="saBtn saBtnDanger saBtnSm"
                          disabled={actionBusy}
                          onClick={() => changeStatus("SUSPENDED")}
                        >
                          {actionBusy ? <span className="spinner" /> : "Suspend"}
                        </button>
                      </div>
                    )}
                    {company.status !== "ACTIVE" && (
                      <div className="saActionRow">
                        <div>
                          <div className="saActionLabel">Activate Company</div>
                          <div className="saActionDesc">Restores full access for all company users.</div>
                        </div>
                        <button
                          type="button"
                          className="saBtn saBtnPrimary saBtnSm"
                          disabled={actionBusy}
                          onClick={() => changeStatus("ACTIVE")}
                        >
                          {actionBusy ? <span className="spinner" /> : "Activate"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* Users Panel */}
            <section className="saPanel" style={{ marginTop: "1.5rem" }}>
              <div className="saPanelHead">
                <h2 className="saPanelTitle">
                  <IconUsers style={{ verticalAlign: "middle", marginRight: "0.4rem" }} />
                  Users ({users?.length ?? 0})
                </h2>
              </div>
              <div className="saTableWrap">
                <table className="saTable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Group</th>
                      <th>Status</th>
                      <th>Last Sign-in</th>
                      <th>Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!users && <tr><td colSpan={6} className="saTableEmpty">Loading users…</td></tr>}
                    {users && users.length === 0 && <tr><td colSpan={6} className="saTableEmpty">No users found.</td></tr>}
                    {users?.map((u) => (
                      <tr key={u.id}>
                        <td className="saCellPrimary">{u.name}</td>
                        <td className="saCellMuted">{u.email}</td>
                        <td>{u.group ?? <span className="saCellMuted">—</span>}</td>
                        <td><StatusBadge status={u.status} /></td>
                        <td className="saCellMuted">
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Never"}
                        </td>
                        <td className="saCellMuted">
                          {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

