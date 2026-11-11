"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { IconShield, IconUsers, IconRefresh, IconPlus, IconEdit } from "@/components/icons";
import { useAuth } from "../AuthProvider";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  fullAccess: boolean;
  isSystemRole: boolean;
  isActive: boolean;
  members: number;
}

/** "sales-orders.approve" → module "Sales orders", action "approve". */
function groupPermissions(perms: string[]) {
  const by = new Map<string, string[]>();
  for (const p of perms) {
    const [mod, action = "all"] = p.split(".");
    const label = mod.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    by.set(label, [...(by.get(label) ?? []), action]);
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * What each role can do. Every permission a role holds is listed, so an owner
 * can see exactly what access someone has; custom roles can be edited.
 */
export default function UserRolesPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await apiFetch<{ items: RoleRow[] }>("/api/admin/roles")).items);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useShortcutScope({ onRefresh: load });

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  return (
    <>
      <PageHeader
        title="User Roles"
        count={rows?.length ?? null}
        description="Roles decide what each employee can see and do. Every screen and API checks these permissions."
        actions={
          <>
            <Link href="/users" className="button buttonSecondary">
              <IconUsers /> Employees
            </Link>
            <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
              {loading ? <span className="spinner" /> : <IconRefresh />}
            </button>
            {hasPermission("roles.manage") && (
              <Link href="/user-roles/new" className="button buttonPrimary">
                <IconPlus /> New role
              </Link>
            )}
          </>
        }
      />

      {error !== null && (
        <div className="card">
          <ErrorState message={error instanceof ApiError ? error.message : "Could not load roles."} onRetry={load} />
        </div>
      )}
      {!rows && !error && (
        <div className="reportGrid">
          <SkeletonBlock lines={4} />
          <SkeletonBlock lines={4} />
        </div>
      )}
      {rows && rows.length === 0 && <EmptyState title="No roles yet" />}

      <div className="roleGrid">
        {rows?.map((r) => {
          const groups = groupPermissions(r.permissions.filter((p) => p !== "*"));
          return (
            <section key={r.id} className="dPanel roleCard">
              <header className="dPanelHead">
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span className="reportCardIcon">
                    <IconShield />
                  </span>
                  <div>
                    <h2 className="dPanelTitle">
                      {r.name}
                      {r.isSystemRole && <span className="badge badgeNeutral badgePlain">System</span>}
                      {!r.isActive && <span className="badge badgeDanger badgePlain">Inactive</span>}
                    </h2>
                    <div className="cardSubtitle">
                      {r.members} member{r.members === 1 ? "" : "s"}
                      {r.description ? ` · ${r.description}` : ""}
                    </div>
                  </div>
                </div>
                {!r.isSystemRole && hasPermission("roles.manage") && (
                  <Link href={`/user-roles/${r.id}`} className="button buttonSecondary buttonSm">
                    <IconEdit /> Edit
                  </Link>
                )}
              </header>
              <div className="dPanelBody">
                {r.fullAccess ? (
                  <p className="roleFull">
                    <span className="badge badgeAccent">Full access</span>
                    Can view, create, edit, approve and cancel in every module, including future ones.
                  </p>
                ) : groups.length === 0 ? (
                  <p className="cellMuted" style={{ fontSize: "0.8125rem" }}>
                    No permissions — members can sign in but see nothing.
                  </p>
                ) : (
                  <dl className="permList">
                    {groups.map(([mod, actions]) => (
                      <div key={mod}>
                        <dt>{mod}</dt>
                        <dd>
                          {actions.map((a) => (
                            <span key={a} className="badge badgeNeutral badgePlain">
                              {a}
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
