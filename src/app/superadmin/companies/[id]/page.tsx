"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { IconAlertCircle, IconUsers, IconBuilding, IconRefresh } from "@/components/icons";
import SAHeader, { ProductTags, PLAN_OPTIONS, fmtDate } from "../../SAHeader";
import { PRODUCTS, PRODUCT_LABELS, type Product } from "@/lib/products";
import Select from "@/components/ui/Select";

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
  products: Product[];
  plan: string | null;
  maxEmployees: number | null;
  subscriptionEndsAt: string | null;
  provisionedBy: string;
  employeeCount: number;
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
  const [sub, setSub] = useState<{ products: Product[]; plan: string; maxEmployees: string; subscriptionEndsAt: string } | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [subMsg, setSubMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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
      setSub({
        products: cJson.data.products,
        plan: cJson.data.plan ?? "STARTER",
        maxEmployees: cJson.data.maxEmployees ? String(cJson.data.maxEmployees) : "",
        subscriptionEndsAt: cJson.data.subscriptionEndsAt ? String(cJson.data.subscriptionEndsAt).slice(0, 10) : "",
      });
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

  async function saveSubscription() {
    if (!sub) return;
    setSubBusy(true);
    setSubMsg(null);
    try {
      const res = await fetch(`/api/superadmin/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: sub.products,
          plan: sub.plan,
          maxEmployees: sub.maxEmployees ? Number(sub.maxEmployees) : null,
          subscriptionEndsAt: sub.subscriptionEndsAt || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to save");
      setCompany(json.data);
      setSubMsg({ tone: "ok", text: "Subscription saved. Signed-in users see the change within 15 minutes." });
    } catch (err) {
      setSubMsg({ tone: "error", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSubBusy(false);
    }
  }

  async function resetOwnerPassword() {
    setPwBusy(true);
    setPwMsg(null);
    try {
      const res = await fetch(`/api/superadmin/companies/${id}/owner-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(json.errors) && json.errors[0]?.message ? `: ${json.errors[0].message}` : "";
        throw new Error((json.message ?? "Failed to reset") + detail);
      }
      setPwMsg({ tone: "ok", text: `Password reset for ${json.data.email}. They have been signed out everywhere.` });
      setNewPassword("");
    } catch (err) {
      setPwMsg({ tone: "error", text: err instanceof Error ? err.message : "Failed to reset" });
    } finally {
      setPwBusy(false);
    }
  }

  function toggleProduct(p: Product) {
    setSub((s) => (s ? { ...s, products: s.products.includes(p) ? s.products.filter((x) => x !== p) : [...s.products, p] } : s));
  }

  return (
    <div className="saPage">
      <SAHeader />

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
                    <div className="saInfoRow"><dt>Products</dt><dd><ProductTags products={company.products} /></dd></div>
                    <div className="saInfoRow"><dt>Plan</dt><dd>{company.plan ?? "—"}</dd></div>
                    <div className="saInfoRow"><dt>Valid until</dt><dd>{fmtDate(company.subscriptionEndsAt)}</dd></div>
                    {company.products.includes("HRMS") && (
                      <div className="saInfoRow"><dt>Employees</dt><dd>{company.employeeCount}{company.maxEmployees ? ` of ${company.maxEmployees}` : " (no limit)"}</dd></div>
                    )}
                    <div className="saInfoRow"><dt>Created by</dt><dd>{company.provisionedBy === "SUPERADMIN" ? "Admin portal" : "Self sign-up"}</dd></div>
                    <div className="saInfoRow"><dt>Workspace ID</dt><dd className="saCellMono">{company.domain}</dd></div>
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

            {/* Subscription Panel */}
            {sub && (
              <section className="saPanel" style={{ marginTop: "1.5rem" }}>
                <div className="saPanelHead">
                  <h2 className="saPanelTitle">Subscription</h2>
                </div>
                <div className="saPanelBody">
                  {subMsg && (
                    <div
                      className={`saBanner ${subMsg.tone === "error" ? "saBannerError" : ""}`}
                      style={{ marginBottom: "1rem", ...(subMsg.tone === "ok" ? { background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" } : {}) }}
                    >
                      <span>{subMsg.text}</span>
                    </div>
                  )}
                  <div className="saProductChoices" style={{ marginBottom: "1rem" }}>
                    {PRODUCTS.map((p) => (
                      <label key={p} className="saProductChoice" data-checked={sub.products.includes(p)}>
                        <input type="checkbox" checked={sub.products.includes(p)} onChange={() => toggleProduct(p)} />
                        <div>
                          <strong>{PRODUCT_LABELS[p]}</strong>
                          <span>
                            {p === "HRMS" && !company.products.includes("HRMS")
                              ? "Turning this on sets up shifts, leave types, departments and HR roles."
                              : "Included in this workspace when ticked"}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="saFormGrid">
                    <div className="saField">
                      <label htmlFor="s-plan">Plan</label>
                      <Select id="s-plan" className="saInput" value={sub.plan} onChange={(e) => setSub({ ...sub, plan: e.target.value })}>
                        {[...PLAN_OPTIONS, ...(PLAN_OPTIONS.some((o) => o.value === sub.plan) ? [] : [{ value: sub.plan, label: sub.plan }])].map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </Select>
                    </div>
                    <div className="saField">
                      <label htmlFor="s-until">Valid until</label>
                      <input id="s-until" type="date" className="saInput" value={sub.subscriptionEndsAt} onChange={(e) => setSub({ ...sub, subscriptionEndsAt: e.target.value })} />
                      <span className="saHint">Blank = no expiry. Extend this to renew.</span>
                    </div>
                    <div className="saField">
                      <label htmlFor="s-max">Employee limit</label>
                      <input id="s-max" type="number" min={1} className="saInput" value={sub.maxEmployees} onChange={(e) => setSub({ ...sub, maxEmployees: e.target.value })} />
                      <span className="saHint">Blank = unlimited. Currently {company.employeeCount} active.</span>
                    </div>
                  </div>
                  <div className="saFormActions">
                    <button type="button" className="saBtn saBtnPrimary saBtnSm" disabled={subBusy || sub.products.length === 0} onClick={saveSubscription}>
                      {subBusy ? <span className="spinner" /> : "Save subscription"}
                    </button>
                  </div>

                  <div className="saActionRow" style={{ marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px solid #e2e8f0", alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <div className="saActionLabel">Reset owner password</div>
                      <div className="saActionDesc">For a locked-out customer. Unlocks the owner login and signs it out everywhere.</div>
                      {pwMsg && (
                        <div className={pwMsg.tone === "error" ? "saFieldError" : "saHint"} style={{ marginTop: "0.35rem" }}>
                          {pwMsg.text}
                        </div>
                      )}
                    </div>
                    <input className="saInput" style={{ maxWidth: "14rem" }} placeholder="New temporary password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
                    <button type="button" className="saBtn saBtnSecondary saBtnSm" disabled={pwBusy || newPassword.length < 8} onClick={resetOwnerPassword}>
                      {pwBusy ? <span className="spinner" /> : "Reset"}
                    </button>
                  </div>
                </div>
              </section>
            )}

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

