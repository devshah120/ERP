"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { initials } from "@/components/shell/UserMenu";
import { IconBuilding, IconUser, IconShield, IconClock, IconArrowRight } from "@/components/icons";

function Row({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="settingsRow">
      <dt>{label}</dt>
      <dd className={mono ? "cellMono" : undefined}>{value || <span className="cellMuted">Not set</span>}</dd>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Workspace settings. Shows the business, financial year and signed-in
 * account as the system knows them. Editing these isn't built yet, so they
 * are presented read-only rather than as forms that wouldn't save.
 */
export default function SettingsPage() {
  const { me } = useAuth();
  // Captured once per visit; "days remaining" needn't tick while the page is open.
  const [now] = useState(() => Date.now());
  if (!me) return null;

  const isOwner = me.permissions.includes("*");
  const fy = me.financialYear;
  const daysLeft = fy ? Math.ceil((new Date(fy.endDate).getTime() - now) / 86_400_000) : null;

  return (
    <>
      <PageHeader title="Workspace" description="Your business profile, books and account, as recorded at registration." />

      <div className="dashGrid">
        <section className="card span6" aria-labelledby="s-business">
          <div className="cardHeader">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className="reportCardIcon">
                <IconBuilding />
              </span>
              <div>
                <div className="cardTitle" id="s-business">
                  Business
                </div>
                <div className="cardSubtitle">Used on every document and for GST place of supply</div>
              </div>
            </div>
          </div>
          <dl className="cardBody settingsList">
            <Row label="Name" value={me.business?.name} />
            <Row label="GSTIN" value={me.business?.gstin} mono />
            <Row label="State" value={me.business?.state} />
            <Row label="Currency" value={me.business?.currency} />
          </dl>
        </section>

        <section className="card span6" aria-labelledby="s-fy">
          <div className="cardHeader">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className="reportCardIcon">
                <IconClock />
              </span>
              <div>
                <div className="cardTitle" id="s-fy">
                  Financial year
                </div>
                <div className="cardSubtitle">Document numbers restart each financial year</div>
              </div>
            </div>
          </div>
          <dl className="cardBody settingsList">
            <Row label="Current year" value={fy?.label} />
            <Row label="Starts" value={fy ? fmt(fy.startDate) : null} />
            <Row label="Ends" value={fy ? fmt(fy.endDate) : null} />
            <Row label="Remaining" value={daysLeft !== null ? (daysLeft > 0 ? `${daysLeft} days` : "Year has ended") : null} />
          </dl>
        </section>

        <section className="card span6" aria-labelledby="s-account">
          <div className="cardHeader">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className="reportCardIcon">
                <IconUser />
              </span>
              <div>
                <div className="cardTitle" id="s-account">
                  Your account
                </div>
                <div className="cardSubtitle">How you sign in</div>
              </div>
            </div>
          </div>
          <div className="cardBody">
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <span className="avatar avatarLg">{initials(me.name)}</span>
              <div>
                <div className="cellPrimary">{me.name}</div>
                <div className="cellMuted" style={{ fontSize: "0.8125rem" }}>
                  {me.email}
                </div>
              </div>
            </div>
            <dl className="settingsList">
              <Row label="Username" value={`@${me.username}`} />
              <Row label="Role" value={me.role?.name} />
            </dl>
            <p className="fieldHint" style={{ marginTop: "0.75rem" }}>
              To change your password, sign out and use{" "}
              <Link href="/forgot-password" className="textLink">
                Forgot password
              </Link>{" "}
              — a code is emailed to the address above and every other session is signed out.
            </p>
          </div>
        </section>

        <section className="card span6" aria-labelledby="s-access">
          <div className="cardHeader">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span className="reportCardIcon">
                <IconShield />
              </span>
              <div>
                <div className="cardTitle" id="s-access">
                  Access
                </div>
                <div className="cardSubtitle">What your role allows</div>
              </div>
            </div>
          </div>
          <div className="cardBody">
            {isOwner ? (
              <p style={{ fontSize: "0.8125rem", lineHeight: 1.6 }}>
                <span className="badge badgeAccent">Full access</span>
                <br />
                <span className="cellMuted">
                  As the workspace owner you can view, create, edit, approve and cancel in every module.
                </span>
              </p>
            ) : (
              <>
                <p className="cellMuted" style={{ fontSize: "0.8125rem", marginBottom: "0.625rem" }}>
                  {me.permissions.length} permission{me.permissions.length === 1 ? "" : "s"} granted:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", maxHeight: "9rem", overflowY: "auto" }}>
                  {me.permissions.map((p) => (
                    <span key={p} className="badge badgeNeutral badgePlain cellMono">
                      {p}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <div className="sectionHeading">
        <span>Coming next</span>
        <small>Planned — not available yet</small>
      </div>
      <div className="reportGrid">
        {[
          { t: "Financial years", d: "Open the next year and close the previous one." },
          { t: "Users & roles", d: "Invite colleagues and choose exactly what each role can do." },
          { t: "Document numbering", d: "Set prefixes and number formats per document type." },
        ].map((x) => (
          <div key={x.t} className="reportCard" style={{ opacity: 0.75, cursor: "default" }} aria-disabled="true">
            <div>
              <div className="reportCardTitle">
                {x.t} <span className="soonTag">Soon</span>
              </div>
              <div className="reportCardDesc">{x.d}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="fieldHint" style={{ marginTop: "1.5rem" }}>
        Branches and warehouses are managed under{" "}
        <Link href="/branches" className="textLink">
          Masters <IconArrowRight style={{ verticalAlign: "-2px" }} />
        </Link>
      </p>
    </>
  );
}
