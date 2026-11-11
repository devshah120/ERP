"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "../AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import StatusBadge from "@/components/ui/StatusBadge";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { initials } from "@/components/shell/UserMenu";
import { IconRefresh, IconPlus, IconCopy, IconAlertCircle } from "@/components/icons";

interface UserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  status: string;
  roleId: string | null;
  role: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface RoleOption {
  id: string;
  name: string;
  isActive: boolean;
}

function when(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const time = d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return days === 0 ? `Today, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : time;
}

/** A password that satisfies the policy: upper, lower, digit, symbol, 12 chars. */
function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%&*!?"];
  const all = sets.join("");
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 8 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function fieldErrorsFrom(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (err instanceof ApiError && Array.isArray(err.errors)) {
    for (const issue of err.errors as { path?: (string | number)[]; message: string }[]) {
      if (issue.path?.length) out[issue.path.join(".")] = issue.message;
    }
  }
  return out;
}

/** Who can sign in to this workspace, and controls to add, edit and disable them. */
export default function UsersPage() {
  const { me, hasPermission } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [created, setCreated] = useState<{ domain: string; username: string; password: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canCreate = hasPermission("users.create");
  const canEdit = hasPermission("users.edit");
  const canDisable = hasPermission("users.disable");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await apiFetch<{ items: UserRow[] }>("/api/admin/users")).items);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    apiFetch<{ items: RoleOption[] }>("/api/admin/roles")
      .then((r) => setRoles(r.items.filter((x) => x.isActive)))
      .catch(() => setRoles([]));
  }, [load]);

  useShortcutScope({ onRefresh: load, onNew: canCreate ? () => openInvite() : undefined });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((r) => [r.name, r.username, r.email, r.role ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [rows, query]);

  function resetForm(values: Record<string, string>) {
    setForm(values);
    setFormError(null);
    setFieldErrors({});
  }

  function openInvite() {
    resetForm({ name: "", username: "", email: "", phone: "", roleId: roles.find((r) => r.name !== "Owner")?.id ?? roles[0]?.id ?? "", password: generatePassword() });
    setCreated(null);
    setInviting(true);
  }

  function openEdit(u: UserRow) {
    resetForm({ name: u.name, phone: u.phone ?? "", roleId: u.roleId ?? "" });
    setEditing(u);
  }

  async function submitInvite() {
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const res = await apiFetch<{ domain: string; username: string }>("/api/admin/users", { method: "POST", body: JSON.stringify(form) });
      setCreated({ domain: res.domain, username: res.username, password: form.password });
      toast.success("Employee added");
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add the employee");
      setFieldErrors(fieldErrorsFrom(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!editing) return;
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await apiFetch(`/api/admin/users/${editing.id}`, { method: "PATCH", body: JSON.stringify(form) });
      toast.success("Employee updated");
      setEditing(null);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save");
      setFieldErrors(fieldErrorsFrom(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(u: UserRow, status: "ACTIVE" | "DISABLED") {
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast.success(status === "DISABLED" ? `${u.name} can no longer sign in` : `${u.name} can sign in again`);
      load();
    } catch (err) {
      toast.error("Couldn't change status", err instanceof ApiError ? err.message : undefined);
    }
  }

  function input(name: string, label: string, opts: { type?: string; hint?: string } = {}) {
    return (
      <div className="field">
        <label htmlFor={`u-${name}`}>
          {label}
          {opts.hint && <span className="hint"> · {opts.hint}</span>}
        </label>
        <input
          id={`u-${name}`}
          className="input"
          type={opts.type ?? "text"}
          value={form[name] ?? ""}
          aria-invalid={fieldErrors[name] ? true : undefined}
          onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
        />
        {fieldErrors[name] && <span className="fieldError">{fieldErrors[name]}</span>}
      </div>
    );
  }

  const roleSelect = (
    <div className="field">
      <label htmlFor="u-role">Role</label>
      <select id="u-role" className="select" value={form.roleId ?? ""} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {fieldErrors.roleId && <span className="fieldError">{fieldErrors.roleId}</span>}
    </div>
  );

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  const cols = canEdit || canDisable ? 8 : 7;

  return (
    <>
      <PageHeader
        title="Employees"
        count={rows?.length ?? null}
        description="Everyone who can sign in to this workspace, their role and when they were last active."
        actions={
          <>
            <Link href="/user-roles" className="button buttonSecondary">
              User roles
            </Link>
            {canCreate && (
              <button type="button" className="button buttonPrimary" onClick={openInvite}>
                <IconPlus /> Add employee
              </button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search name, username, email or role…" width="20rem" />
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh (Ctrl + R)">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Username</th>
              <th>Role</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th>Added</th>
              {(canEdit || canDisable) && <th style={{ textAlign: "right" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {!rows && !error && <SkeletonRows columns={cols} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={cols}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load employees."} onRetry={load} />
                </td>
              </tr>
            )}
            {rows && filtered.length === 0 && (
              <tr>
                <td colSpan={cols}>
                  <EmptyState variant="search" title="No matching employees" />
                </td>
              </tr>
            )}
            {filtered.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.625rem" }}>
                      <span className="avatar">{initials(u.name)}</span>
                      <span>
                        <span className="cellPrimary">{u.name}</span>
                        {isSelf && <span className="badge badgeAccent badgePlain" style={{ marginLeft: "0.375rem" }}>You</span>}
                        <span className="cellSub">{u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="cellMono cellMuted">@{u.username}</td>
                  <td>{u.role ?? <span className="cellMuted">—</span>}</td>
                  <td className="cellMuted tabular">{u.phone ?? "—"}</td>
                  <td>
                    <StatusBadge status={u.status} kind="active" />
                  </td>
                  <td className="cellMuted">{when(u.lastLoginAt)}</td>
                  <td className="cellMuted">{new Date(u.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  {(canEdit || canDisable) && (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canEdit && (
                        <button type="button" className="button buttonGhost buttonSm" onClick={() => openEdit(u)}>
                          Edit
                        </button>
                      )}
                      {canDisable && !isSelf && u.status !== "DISABLED" && (
                        <button type="button" className="button buttonGhost buttonSm" style={{ color: "var(--danger)" }} onClick={() => setStatus(u, "DISABLED")}>
                          Disable
                        </button>
                      )}
                      {canDisable && !isSelf && u.status !== "ACTIVE" && (
                        <button type="button" className="button buttonGhost buttonSm" onClick={() => setStatus(u, "ACTIVE")}>
                          {u.status === "LOCKED" ? "Unlock" : "Enable"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inviting && (
        <Modal
          title={created ? "Employee added" : "Add employee"}
          subtitle={created ? "Share these sign-in details with them. The password is not shown again." : "They sign in with a temporary password you share with them."}
          onClose={() => setInviting(false)}
          busy={busy}
          footer={
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <button type="button" className="button buttonSecondary" onClick={() => setInviting(false)} disabled={busy}>
                {created ? "Done" : "Cancel"}
              </button>
              {!created && (
                <button type="button" className="button buttonPrimary" onClick={submitInvite} disabled={busy}>
                  {busy && <span className="spinner" />} Add employee
                </button>
              )}
            </div>
          }
        >
          {created ? (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <dl className="settingsList">
                <div className="settingsRow">
                  <dt>Workspace</dt>
                  <dd className="cellMono">{created.domain}</dd>
                </div>
                <div className="settingsRow">
                  <dt>Username</dt>
                  <dd className="cellMono">{created.username}</dd>
                </div>
                <div className="settingsRow">
                  <dt>Temporary password</dt>
                  <dd className="cellMono">{created.password}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="button buttonSecondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`Workspace: ${created.domain}\nUsername: ${created.username}\nPassword: ${created.password}`);
                    toast.success("Sign-in details copied");
                  } catch {
                    toast.error("Couldn't copy", "Your browser blocked clipboard access.");
                  }
                }}
              >
                <IconCopy /> Copy sign-in details
              </button>
              <p className="fieldHint">Ask them to set their own password with “Forgot password” on the sign-in screen.</p>
            </div>
          ) : (
            <>
              {formError && (
                <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
                  <IconAlertCircle />
                  <span>{formError}</span>
                </div>
              )}
              <div className="formGrid">
                {input("name", "Full name")}
                {input("username", "Username", { hint: "for sign-in" })}
                {input("email", "Email", { type: "email" })}
                {input("phone", "Phone", { type: "tel" })}
                {roleSelect}
                <div className="field">
                  <label htmlFor="u-password">Temporary password</label>
                  <div style={{ display: "flex", gap: "0.375rem" }}>
                    <input id="u-password" className="input cellMono" value={form.password ?? ""} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                    <button type="button" className="button buttonSecondary buttonSm" onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}>
                      New
                    </button>
                  </div>
                  {fieldErrors.password && <span className="fieldError">{fieldErrors.password}</span>}
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          subtitle={`@${editing.username} · ${editing.email}`}
          onClose={() => setEditing(null)}
          busy={busy}
          footer={
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <button type="button" className="button buttonSecondary" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={submitEdit} disabled={busy}>
                {busy && <span className="spinner" />} Save
              </button>
            </div>
          }
        >
          {formError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <IconAlertCircle />
              <span>{formError}</span>
            </div>
          )}
          <div className="formGrid">
            {input("name", "Full name")}
            {input("phone", "Phone", { type: "tel" })}
            {editing.id !== me?.id && roleSelect}
          </div>
          {editing.id !== me?.id && <p className="fieldHint" style={{ marginTop: "0.75rem" }}>Changing the role signs them out so the new access applies at once.</p>}
        </Modal>
      )}
    </>
  );
}
