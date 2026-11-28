"use client";

import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { useAuth } from "@/app/(app)/AuthProvider";
import { getRequiredPermission } from "@/app/(app)/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { PAYROLL_SETUP_STEPS, WORKFORCE_GUIDE } from "@/lib/hr/payrollHelp";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { IconWallet, IconCalendar, IconBuilding, IconFactory, IconUsers, IconBook, IconPlus } from "@/components/icons";

type Card = { href: string; title: string; description: string };
type Category = { key: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; cards: Card[] };

/** Every HR setup screen, grouped as HR thinks of them. Each card links to an existing screen and shows with that screen's menu permission. */
const CATEGORIES: Category[] = [
  {
    key: "payroll",
    label: "Payroll",
    icon: IconWallet,
    cards: [
      { href: "/hr/settings/payroll", title: "Payroll Settings", description: "Monthly or annual salary entry, salary restrictions, employee defaults." },
      { href: "/hr/settings/pf", title: "PF Settings", description: "Provident fund rates and the wage ceiling." },
      { href: "/hr/settings/esic", title: "ESIC Settings", description: "Employee State Insurance rates and gross limit." },
      { href: "/hr-pt-slabs", title: "PT Slabs", description: "Professional tax by monthly gross for your state." },
      { href: "/hr-salary-structures", title: "Salary Structures", description: "Split a gross into basic, HRA, conveyance and allowances." },
      { href: "/hr-pay-components", title: "Pay Components", description: "Monthly extras: bonus, overtime, incentive, recoveries." },
      { href: "/hr-incentive-matrices", title: "Incentive Matrix", description: "Yearly attendance incentive slabs." },
    ],
  },
  {
    key: "attendance",
    label: "Attendance & Leave",
    icon: IconCalendar,
    cards: [
      { href: "/hr-shifts", title: "Shifts", description: "Shift timings, grace and weekly offs." },
      { href: "/hr/shifts/assign/employees", title: "Assign Shift to Employees", description: "Put employees on a shift in bulk." },
      { href: "/hr-holiday-calendars", title: "Holiday Calendars", description: "Holiday lists per state or location." },
      { href: "/hr/holidays/assign", title: "Assign Holiday Calendar", description: "Which employees follow which calendar." },
      { href: "/hr-leave-types", title: "Leave Types", description: "Casual, sick, earned leave and their quotas." },
      { href: "/hr-leave-groups", title: "Leave Groups", description: "Bundles of leave entitlements." },
      { href: "/hr-grade-leave-groups", title: "Assign Leave Group to Grade", description: "Leave entitlement by grade." },
      { href: "/hr/attendance/regularization", title: "Attendance Regularization", description: "Which days employees may ask to correct." },
      { href: "/hr-attendance-reasons", title: "Attendance Reg. Reasons", description: "Reasons offered on correction requests." },
    ],
  },
  {
    key: "company",
    label: "Company",
    icon: IconBuilding,
    cards: [
      { href: "/hr-departments", title: "Departments", description: "Departments and their heads." },
      { href: "/hr-designations", title: "Designations", description: "Job titles." },
      { href: "/hr-grades", title: "Grades", description: "Bands that decide leave entitlement." },
    ],
  },
  {
    key: "contract",
    label: "Contract Labour",
    icon: IconFactory,
    cards: [
      { href: "/hr-contractors", title: "Contractors", description: "Labour agencies, wage and overtime terms." },
      { href: "/hr-contract-workers", title: "Workers", description: "Daily-wage workers and their contractors." },
      { href: "/hr/shifts/assign/contractors", title: "Assign Shift to Contractors", description: "Shift timings that decide overtime." },
    ],
  },
];

/** HR Settings: every HR setup screen in one place, the payroll setup order, and which module suits which worker. */
export default function HrSettingsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [category, setCategory] = useState("payroll");
  const [query, setQuery] = useState("");
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        cards: c.cards.filter((card) => {
          const perm = getRequiredPermission(card.href);
          return !perm || hasPermission(perm);
        }),
      })).filter((c) => c.cards.length > 0),
    [hasPermission]
  );
  const q = query.trim().toLowerCase();
  const cards = q
    ? visible.flatMap((c) => c.cards).filter((c) => `${c.title} ${c.description}`.toLowerCase().includes(q))
    : visible.find((c) => c.key === category)?.cards ?? visible[0]?.cards ?? [];

  async function createDemo() {
    setBusy(true);
    setDemoError(null);
    try {
      const res = await apiFetch<{ created: string[] }>("/api/hr/payroll-setup/demo", { method: "POST", body: "{}" });
      toast.success(res.created.length > 0 ? `Created ${res.created.join(" and ")}` : "The demo data is already there");
      setConfirmDemo(false);
    } catch (err) {
      setDemoError(err instanceof ApiError ? err.message : "Could not create the demo data");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="HR Settings"
        description="Set up payroll, attendance, leave and contract labour. Each screen has a “How this works” panel."
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Search settings…" width="16rem" />
            {hasPermission("hr-salary-structures.create") && hasPermission("hr-pt-slabs.create") && (
              <button type="button" className="button buttonSecondary" onClick={() => setConfirmDemo(true)}>
                <IconPlus /> Create demo data
              </button>
            )}
          </>
        }
      />

      {hasPermission("hr-payroll-settings.view") && (
        <section className="formSection" style={{ marginBottom: "1rem" }}>
          <div className="formSectionHead">
            <div className="formSectionTitle">Payroll setup, in order</div>
            <div className="formSectionDesc">Do these once. After that, adding an employee is: pick a salary structure, type the salary amount, save.</div>
          </div>
          <div className="formSectionBody">
            <ol className="hrSetupSteps">
              {PAYROLL_SETUP_STEPS.map((s) => (
                <li key={s.key}>
                  <Link href={s.href}>
                    <strong>{s.label}</strong>
                    <span className="cellMuted">{s.detail}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <div className="hrSettingsLayout">
        <nav className="hrSettingsNav" aria-label="Settings categories">
          {visible.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-current={!q && category === c.key}
              onClick={() => {
                setCategory(c.key);
                setQuery("");
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                <c.icon /> {c.label}
              </span>
              <span className="cellMuted">{c.cards.length}</span>
            </button>
          ))}
        </nav>

        <div>
          {cards.length === 0 ? (
            <EmptyState title="No settings match" description="Try another word, or clear the search." />
          ) : (
            <div className="hrSettingsCards">
              {cards.map((c) => (
                <Link key={c.href} href={c.href} className="hrSettingsCard">
                  <div className="hrSettingsCardTitle">{c.title}</div>
                  <div className="hrSettingsCardDesc">{c.description}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="formSection" style={{ marginTop: "1rem" }}>
        <div className="formSectionHead">
          <div className="formSectionTitle" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <IconUsers /> Which module for whom
          </div>
          <div className="formSectionDesc">Monthly staff go through payroll. Contractors and daily-wage workers go through Contract Labour.</div>
        </div>
        <div className="formSectionBody">
          <div className="tableWrap" style={{ boxShadow: "none" }}>
            <table className="table hrWorkforceTable">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Use</th>
                  <th>How they are paid</th>
                  <th>Set up</th>
                </tr>
              </thead>
              <tbody>
                {WORKFORCE_GUIDE.map((w) => (
                  <tr key={w.who}>
                    <td style={{ fontWeight: 600 }}>{w.who}</td>
                    <td>
                      <Link className="textLink" href={w.href}>
                        {w.module}
                      </Link>
                    </td>
                    <td>{w.pay}</td>
                    <td>
                      <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
                        {w.setup.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="helpPanelTip" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <IconBook /> Example: a ₹30,000-a-month accountant goes in Employees with the “Standard Staff” structure. A loader paid ₹600 a day through a labour agency goes in Contract Labour → Workers under that agency.
          </p>
        </div>
      </section>

      {confirmDemo && (
        <ConfirmDialog
          title="Create demo payroll data?"
          message="Adds the salary structure “Standard Staff (demo)” (basic 50% of gross, HRA 40% of basic, conveyance ₹1,600, special allowance the rest) and two Gujarat PT slabs. The slabs are created inactive so they don't change anyone's PT until you activate them. Anything already created is left alone."
          confirmLabel="Create demo data"
          tone="primary"
          busy={busy}
          error={demoError}
          onConfirm={createDemo}
          onCancel={() => setConfirmDemo(false)}
        />
      )}
    </>
  );
}
