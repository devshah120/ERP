"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import StatusBadge from "@/components/ui/StatusBadge";
import SearchBox from "@/components/ui/SearchBox";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { IconEdit, IconPlus, IconTrash } from "@/components/icons";

interface Group {
  id: string;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  users: { id: string; name: string }[];
}

interface FormState {
  id: string | null;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  userIds: string[];
}

export default function ApprovalGroupsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canManage = hasPermission("approvals.manage");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [g, u] = await Promise.all([apiFetch<Group[]>("/api/approvals/groups"), apiFetch<{ id: string; name: string; email: string }[]>("/api/approvals/users")]);
      setGroups(g);
      setUsers(u);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function open(g?: Group) {
    setFormError(null);
    setFilter("");
    setForm(g ? { id: g.id, name: g.name, description: g.description, status: g.status, userIds: g.users.map((u) => u.id) } : { id: null, name: "", description: "", status: "ACTIVE", userIds: [] });
  }

  function toggle(id: string) {
    setForm((f) => (f ? { ...f, userIds: f.userIds.includes(id) ? f.userIds.filter((x) => x !== id) : [...f.userIds, id] } : f));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setFormError(null);
    try {
      const body = JSON.stringify({ name: form.name, description: form.description, status: form.status, userIds: form.userIds });
      if (form.id) await apiFetch(`/api/approvals/groups/${form.id}`, { method: "PUT", body });
      else await apiFetch("/api/approvals/groups", { method: "POST", body });
      toast.success(form.id ? "User group saved" : "User group created", form.name);
      setForm(null);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save the group");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await apiFetch(`/api/approvals/groups/${deleting.id}`, { method: "DELETE" });
      toast.success("User group deleted", deleting.name);
      setDeleting(null);
      load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the group");
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const shown = users.filter((u) => !filter || `${u.name} ${u.email}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Approval User Groups"
        count={groups?.length ?? null}
        description="Groups of users responsible for approving requests and transactions. When a stage is given to a group, any one member can approve it."
        actions={
          canManage ? (
            <button type="button" className="button buttonPrimary" onClick={() => open()}>
              <IconPlus /> New group
            </button>
          ) : undefined
        }
      />

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Members</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!groups && !error && <SkeletonRows columns={4} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={4}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load user groups."} onRetry={load} />
                </td>
              </tr>
            )}
            {groups && groups.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState title="No user groups yet" description="Create a group, then pick it as the approver of a stage in an Approval Scheme." />
                </td>
              </tr>
            )}
            {groups?.map((g) => (
              <tr key={g.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{g.name}</div>
                  {g.description && <div className="hrMuted">{g.description}</div>}
                </td>
                <td style={{ maxWidth: "28rem" }}>{g.users.map((u) => u.name).join(", ")}</td>
                <td>
                  <StatusBadge status={g.status} />
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {canManage && (
                    <>
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => open(g)} aria-label={`Edit ${g.name}`}>
                        <IconEdit /> Edit
                      </button>
                      <button type="button" className="button buttonGhost buttonSm" onClick={() => (setDeleteError(null), setDeleting(g))} aria-label={`Delete ${g.name}`}>
                        <IconTrash />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal
          title={form.id ? "Edit user group" : "New user group"}
          onClose={() => setForm(null)}
          busy={saving}
          width="40rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setForm(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={save} disabled={saving || !form.name.trim() || form.userIds.length === 0}>
                {saving && <span className="spinner" />} Save
              </button>
            </>
          }
        >
          {formError && (
            <div className="banner bannerError" role="alert" style={{ marginBottom: "0.75rem" }}>
              <span>{formError}</span>
            </div>
          )}
          <div className="formGrid">
            <div className="field">
              <label htmlFor="ag-name">
                Name<span className="req">*</span>
              </label>
              <input id="ag-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Accounts approvers" />
            </div>
            <div className="field">
              <label htmlFor="ag-status">Status</label>
              <Select id="ag-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="ag-desc">Description</label>
              <input id="ag-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="field fieldSpanFull">
              <label>
                Members<span className="req">*</span> <span className="hrMuted">({form.userIds.length} selected)</span>
              </label>
              <SearchBox value={filter} onChange={setFilter} placeholder="Find a user…" width="100%" />
              <div style={{ maxHeight: "16rem", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius, 8px)", marginTop: "0.5rem", padding: "0.25rem 0.5rem" }}>
                {shown.map((u) => (
                  <label key={u.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.3rem 0" }}>
                    <input type="checkbox" checked={form.userIds.includes(u.id)} onChange={() => toggle(u.id)} />
                    <span>{u.name}</span>
                    <span className="hrMuted">{u.email}</span>
                  </label>
                ))}
                {shown.length === 0 && <div className="hrMuted" style={{ padding: "0.5rem 0" }}>No users match.</div>}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this user group?"
          message={`${deleting.name} will no longer be offered as an approver. A group still used by an approval scheme can't be deleted.`}
          confirmLabel="Delete"
          tone="danger"
          error={deleteError}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
