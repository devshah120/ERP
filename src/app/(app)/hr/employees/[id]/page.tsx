"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ErrorState, SkeletonBlock, EmptyState } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Card, fmtDate } from "@/components/hr/HrKit";
import EmploymentHistory from "@/components/hr/EmploymentHistory";
import { formatMoney } from "@/lib/format/number";
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } from "@/lib/resources/ui/hrRegistry";
import { IconArrowLeft, IconEdit, IconKey, IconPlus } from "@/components/icons";

interface Balance {
  leaveTypeId: string;
  code: string;
  name: string;
  allocated: number;
  carriedForward: number;
  used: number;
  pending: number;
  available: number;
}

interface Profile {
  id: string;
  employeeCode: string;
  name: string;
  gender?: string;
  dateOfBirth?: string;
  bloodGroup?: string;
  phone?: string;
  workEmail?: string;
  personalEmail?: string;
  currentAddress?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  department: string;
  designation: string;
  manager: { id: string; name: string } | null;
  shift: { name: string; startTime: string; endTime: string } | null;
  workLocation?: string;
  employmentType: string;
  employmentStatus: string;
  dateOfJoining: string;
  probationEndDate?: string;
  dateOfExit?: string;
  panNumber?: string;
  uanNumber?: string;
  esiNumber?: string;
  pfNumber?: string;
  salaryPaymentMode?: string;
  bankName?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  basic: string;
  hra: string;
  conveyance: string;
  specialAllowance: string;
  otherAllowance: string;
  monthlyTds: string;
  professionalTax: string;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  monthlyGross: string;
  annualCtc: string;
  leaveBalances: Balance[];
  recentLeaves: { id: string; leaveNumber: string; fromDate: string; toDate: string; days: number; status: string }[];
  activeLoans: { id: string; loanNumber: string; outstanding: string; emiAmount: string }[];
  assets: { id: string; assetTag: string; name: string; assignedDate?: string }[];
  payslips: { id: string; payrollRunId: string; period: string; netPay: string; status: string }[];
  directReports: { id: string; name: string; employeeCode: string }[];
  portal: { email: string; status: string; lastLoginAt?: string } | null;
}

type Tab = "overview" | "job" | "salary" | "history" | "leave" | "payslips";

function Dl({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="hrDl">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === undefined || v === null || v === "" ? <span className="cellMuted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [portalOpen, setPortalOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [portalForm, setPortalForm] = useState({ email: "", password: "" });
  const [portalError, setPortalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<Profile>(`/api/hr/employees/${id}`);
      setP(data);
      setPortalForm((f) => ({ ...f, email: f.email || data.workEmail || data.personalEmail || "" }));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function grantPortal() {
    setBusy(true);
    setPortalError(null);
    try {
      const res = await apiFetch<{ email: string; created: boolean }>(`/api/hr/employees/${id}/portal`, {
        method: "POST",
        body: JSON.stringify({ email: portalForm.email, password: portalForm.password || undefined }),
      });
      toast.success(res.created ? "Portal login created" : "Existing login linked", res.created ? `They sign in with ${res.email}. They can set their own password with "Forgot password".` : undefined);
      setPortalOpen(false);
      load();
    } catch (err) {
      const detail = err instanceof ApiError && Array.isArray(err.errors) ? (err.errors as { message: string }[]).map((e) => e.message).join(", ") : "";
      setPortalError(err instanceof ApiError ? `${err.message}${detail ? `: ${detail}` : ""}` : "Could not give portal access");
    } finally {
      setBusy(false);
    }
  }

  async function revokePortal() {
    setBusy(true);
    try {
      await apiFetch(`/api/hr/employees/${id}/portal`, { method: "DELETE" });
      toast.success("Portal access removed");
      setRevokeOpen(false);
      load();
    } catch (err) {
      toast.error("Could not remove access", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  if (error) return <ErrorState message={error instanceof ApiError ? error.message : "Could not load this employee."} onRetry={load} />;
  if (!p) return <SkeletonBlock lines={8} />;

  const canEdit = hasPermission("hr-employees.edit");
  const yes = (b: boolean) => (b ? "Yes" : "No");

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/employees" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Employees
          </Link>
        }
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
            <span className="hrAvatar">{p.name.charAt(0).toUpperCase()}</span>
            <span>
              {p.name}
              <span className="hrMuted" style={{ display: "block", fontWeight: 400 }}>
                {p.employeeCode} · {p.designation || "No designation"} · {p.department || "No department"}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {canEdit && hasPermission("users.create") && !p.portal && (
              <button type="button" className="button buttonSecondary" onClick={() => setPortalOpen(true)}>
                <IconKey /> Give portal access
              </button>
            )}
            {hasPermission("hr-leaves.create") && (
              <Link href={`/hr/leaves/new?employeeId=${p.id}`} className="button buttonSecondary">
                <IconPlus /> Leave
              </Link>
            )}
            {canEdit && (
              <Link href={`/hr-employees/${p.id}`} className="button buttonPrimary">
                <IconEdit /> Edit details
              </Link>
            )}
          </>
        }
      />

      <div className="hrKpis">
        <div className="hrKpi">
          <span className="hrKpiLabel">Status</span>
          <span className="hrKpiValue" style={{ fontSize: "1rem" }}>
            {EMPLOYMENT_STATUS_LABELS[p.employmentStatus] ?? p.employmentStatus}
          </span>
          <span className="hrKpiSub">{EMPLOYMENT_TYPE_LABELS[p.employmentType] ?? p.employmentType}</span>
        </div>
        <div className="hrKpi">
          <span className="hrKpiLabel">Joined</span>
          <span className="hrKpiValue" style={{ fontSize: "1rem" }}>
            {fmtDate(p.dateOfJoining)}
          </span>
          {p.dateOfExit && <span className="hrKpiSub">Last day {fmtDate(p.dateOfExit)}</span>}
        </div>
        <div className="hrKpi">
          <span className="hrKpiLabel">Monthly gross</span>
          <span className="hrKpiValue">{formatMoney(p.monthlyGross)}</span>
          <span className="hrKpiSub">{formatMoney(p.annualCtc)} a year</span>
        </div>
        <div className="hrKpi">
          <span className="hrKpiLabel">Portal login</span>
          <span className="hrKpiValue" style={{ fontSize: "1rem" }}>
            {p.portal ? p.portal.email : "Not given"}
          </span>
          {p.portal && (
            <span className="hrKpiSub">
              {p.portal.lastLoginAt ? `Last sign-in ${fmtDate(p.portal.lastLoginAt)}` : "Never signed in"}
              {canEdit && hasPermission("users.disable") && (
                <>
                  {" · "}
                  <button type="button" className="textLink" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => setRevokeOpen(true)}>
                    Remove
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="hrTabs" role="tablist">
        {(
          [
            ["overview", "Personal"],
            ["job", "Job"],
            ["salary", "Salary & bank"],
            ["history", "History"],
            ["leave", "Leave"],
            ["payslips", "Payslips"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" className="hrTab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="hrGrid">
          <Card title="Personal">
            <Dl
              items={[
                ["Date of birth", fmtDate(p.dateOfBirth)],
                ["Gender", p.gender],
                ["Blood group", p.bloodGroup],
                ["Mobile", p.phone],
                ["Work email", p.workEmail],
                ["Personal email", p.personalEmail],
                ["Emergency contact", [p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(" · ")],
                ["Address", p.currentAddress],
              ]}
            />
          </Card>
          <Card title="Assets issued" action={<Link href="/hr-assets/new">Issue asset</Link>}>
            {p.assets.length === 0 ? (
              <EmptyState compact title="No assets issued" />
            ) : (
              <ul className="hrList">
                {p.assets.map((a) => (
                  <li key={a.id}>
                    <Link href={`/hr-assets/${a.id}`} className="textLink">
                      {a.assetTag} · {a.name}
                    </Link>
                    <span className="hrMuted">{fmtDate(a.assignedDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "job" && (
        <div className="hrGrid">
          <Card title="Job">
            <Dl
              items={[
                ["Department", p.department],
                ["Designation", p.designation],
                ["Reports to", p.manager ? <Link href={`/hr/employees/${p.manager.id}`} className="textLink">{p.manager.name}</Link> : ""],
                ["Shift", p.shift ? `${p.shift.name} (${p.shift.startTime}–${p.shift.endTime})` : "Default shift"],
                ["Work location", p.workLocation],
                ["Probation ends", fmtDate(p.probationEndDate)],
              ]}
            />
          </Card>
          <Card title={`Direct reports (${p.directReports.length})`}>
            {p.directReports.length === 0 ? (
              <EmptyState compact title="No direct reports" />
            ) : (
              <ul className="hrList">
                {p.directReports.map((r) => (
                  <li key={r.id}>
                    <Link href={`/hr/employees/${r.id}`} className="textLink">
                      {r.name}
                    </Link>
                    <span className="hrMuted">{r.employeeCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "salary" && (
        <div className="hrGrid">
          <Card title="Monthly salary structure">
            <ul className="hrList">
              {(
                [
                  ["Basic", p.basic],
                  ["House rent allowance", p.hra],
                  ["Conveyance", p.conveyance],
                  ["Special allowance", p.specialAllowance],
                  ["Other allowance", p.otherAllowance],
                ] as [string, string][]
              ).map(([k, v]) => (
                <li key={k}>
                  <span>{k}</span>
                  <span className="numCell">{formatMoney(v)}</span>
                </li>
              ))}
              <li>
                <strong>Gross</strong>
                <strong className="numCell">{formatMoney(p.monthlyGross)}</strong>
              </li>
            </ul>
            <p className="hrMuted" style={{ marginBottom: 0 }}>
              PF {yes(p.pfApplicable)} · ESI {yes(p.esiApplicable)} · PT {p.ptApplicable ? formatMoney(p.professionalTax) : "No"} · TDS {formatMoney(p.monthlyTds)} / month
            </p>
          </Card>
          <Card title="Statutory & bank">
            <Dl
              items={[
                ["PAN", p.panNumber],
                ["UAN", p.uanNumber],
                ["PF number", p.pfNumber],
                ["ESI number", p.esiNumber],
                ["Paid by", p.salaryPaymentMode],
                ["Bank", p.bankName],
                ["Account", p.bankAccountNumber],
                ["IFSC", p.ifscCode],
              ]}
            />
          </Card>
          <Card title="Loans & advances" action={hasPermission("hr-loans.create") ? <Link href={`/hr/loans/new?employeeId=${p.id}`}>New loan</Link> : undefined}>
            {p.activeLoans.length === 0 ? (
              <EmptyState compact title="No active loans" />
            ) : (
              <ul className="hrList">
                {p.activeLoans.map((l) => (
                  <li key={l.id}>
                    <Link href={`/hr/loans/${l.id}`} className="textLink">
                      {l.loanNumber}
                    </Link>
                    <span>
                      {formatMoney(l.outstanding)} <span className="hrMuted">· {formatMoney(l.emiAmount)}/month</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "leave" && (
        <div className="hrGrid">
          <Card title={`Leave balance ${new Date().getFullYear()}`} action={<Link href="/hr/leaves/balances">All balances</Link>}>
            <div className="balanceGrid">
              {p.leaveBalances.map((b) => (
                <div key={b.leaveTypeId} className="balanceTile">
                  <span className="hrMuted">{b.name}</span>
                  <strong>{b.available}</strong>
                  <span className="hrMuted">
                    of {b.allocated + b.carriedForward} · {b.used} used{b.pending ? ` · ${b.pending} pending` : ""}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Recent leave" action={<Link href={`/hr/leaves?employeeId=${p.id}`}>All</Link>}>
            {p.recentLeaves.length === 0 ? (
              <EmptyState compact title="No leave taken" />
            ) : (
              <ul className="hrList">
                {p.recentLeaves.map((l) => (
                  <li key={l.id}>
                    <span>
                      {fmtDate(l.fromDate)}
                      {l.toDate !== l.fromDate ? ` – ${fmtDate(l.toDate)}` : ""}
                      <div className="hrMuted">
                        {l.leaveNumber} · {l.days} day{l.days === 1 ? "" : "s"}
                      </div>
                    </span>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "history" && <EmploymentHistory employeeId={id} canEdit={hasPermission("hr-employees.edit")} onChanged={load} />}

      {tab === "payslips" && (
        <Card title="Payslips">
          {p.payslips.length === 0 ? (
            <EmptyState compact title="No payslips yet" />
          ) : (
            <ul className="hrList">
              {p.payslips.map((s) => (
                <li key={s.id}>
                  <Link href={`/hr/payslips/${s.id}`} className="textLink">
                    {s.period}
                  </Link>
                  <span style={{ display: "inline-flex", gap: "0.75rem", alignItems: "center" }}>
                    <span className="numCell">{formatMoney(s.netPay)}</span>
                    <StatusBadge status={s.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {portalOpen && (
        <Modal
          title="Give portal access"
          subtitle="They can then check in and out, see attendance, apply for leave, download payslips and submit claims."
          onClose={() => setPortalOpen(false)}
          busy={busy}
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setPortalOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={grantPortal} disabled={busy || !portalForm.email}>
                {busy && <span className="spinner" />} Give access
              </button>
            </>
          }
        >
          {portalError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{portalError}</span>
            </div>
          )}
          <div className="field" style={{ marginBottom: "0.75rem" }}>
            <label htmlFor="pa-email">Sign-in email</label>
            <input id="pa-email" className="input" type="email" value={portalForm.email} onChange={(e) => setPortalForm({ ...portalForm, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pa-pass">
              Temporary password<span className="hint"> · not needed if this email already has a login here</span>
            </label>
            <input id="pa-pass" className="input" value={portalForm.password} onChange={(e) => setPortalForm({ ...portalForm, password: e.target.value })} placeholder="e.g. Welcome@2026" autoComplete="new-password" />
          </div>
        </Modal>
      )}

      {revokeOpen && (
        <ConfirmDialog
          title="Remove portal access?"
          message="A self-service login is disabled and signed out everywhere. A staff login is only unlinked from this employee."
          confirmLabel="Remove access"
          busy={busy}
          onConfirm={revokePortal}
          onCancel={() => setRevokeOpen(false)}
        />
      )}
    </>
  );
}
