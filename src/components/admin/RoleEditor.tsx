"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { apiFetch, ApiError } from "@/lib/api/client";
import { PERMISSION_GROUPS } from "@/lib/auth/permissionCatalog";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonBlock } from "@/components/ui/States";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconAlertCircle, IconTrash } from "@/components/icons";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystemRole: boolean;
  members: number;
}

const ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  cancel: "Cancel",
  disable: "Disable",
  manage: "Manage",
  sell: "Sell",
  refund: "Refund",
  upload: "Upload",
  "manage-registers": "Open/close registers",
};

/**
 * Create or edit a custom role. Permissions are shown module by module with
 * one checkbox per action, so it's clear exactly what the role can do.
 */
export default function RoleEditor({ roleId }: { roleId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(roleId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(!isEdit);
  const [role, setRole] = useState<RoleRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!roleId) return;
    let cancelled = false;
    apiFetch<{ items: RoleRow[] }>("/api/admin/roles")
      .then((r) => {
        if (cancelled) return;
        const found = r.items.find((x) => x.id === roleId);
        if (!found) {
          setError("Role not found");
        } else {
          setRole(found);
          setName(found.name);
          setDescription(found.description ?? "");
          setPerms(new Set(found.permissions));
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load the role");
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  useUnsavedChangesWarning(dirty && !saving);
  const locked = Boolean(role?.isSystemRole);

  function toggle(keys: string[], on: boolean) {
    setPerms((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      // Any action implies being able to see the module.
      for (const k of keys) {
        const [mod, action] = k.split(".");
        if (on && action !== "view") next.add(`${mod}.view`);
      }
      return next;
    });
    setDirty(true);
  }

  const total = useMemo(() => PERMISSION_GROUPS.reduce((n, g) => n + g.modules.reduce((m, mod) => m + mod.actions.length, 0), 0), []);

  async function save() {
    if (locked) return;
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name, description: description || undefined, permissions: [...perms] });
      if (isEdit) {
        await apiFetch(`/api/admin/roles/${roleId}`, { method: "PATCH", body });
        toast.success("Role saved", role && role.members > 0 ? "Members get the new access the next time their session refreshes." : undefined);
        setDirty(false);
      } else {
        await apiFetch("/api/admin/roles", { method: "POST", body });
        setDirty(false);
        toast.success("Role created");
        router.push("/user-roles");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the role");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleteError(null);
    try {
      await apiFetch(`/api/admin/roles/${roleId}`, { method: "DELETE" });
      setDirty(false);
      toast.success("Role deleted");
      router.push("/user-roles");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the role");
    }
  }

  useShortcutScope({ onSave: () => void save() });

  if (!loaded) return <SkeletonBlock lines={6} />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/user-roles" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> User Roles
          </Link>
        }
        title={isEdit ? name || "Role" : "New role"}
        description={`${perms.size} of ${total} permissions selected.`}
        actions={
          isEdit &&
          !locked && (
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={() => setConfirmDelete(true)}
              startIcon={<IconTrash />}
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              Delete
            </Button>
          )
        }
      />

      <div style={{ maxWidth: "70rem" }}>
        {locked && (
          <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
            This is a system role. It always has full access and cannot be changed.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
          <section className="formSection">
            <div className="formSectionHead">
              <h2 className="formSectionTitle">Role</h2>
            </div>
            <div className="formSectionBody">
              <div className="formGrid">
                <div className="field">
                  <label htmlFor="role-name">
                    Name<span className="req">*</span>
                  </label>
                  <input id="role-name" className="input" value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} placeholder="Store manager" />
                </div>
                <div className="field">
                  <label htmlFor="role-desc">Description</label>
                  <input id="role-desc" className="input" value={description} onChange={(e) => (setDescription(e.target.value), setDirty(true))} placeholder="Optional" />
                </div>
              </div>
            </div>
          </section>

          {PERMISSION_GROUPS.map((group) => {
            const groupKeys = group.modules.flatMap((m) => m.actions.map((a) => `${m.key}.${a}`));
            const allOn = groupKeys.every((k) => perms.has(k));
            return (
              <section key={group.label} className="formSection">
                <div className="formSectionHead" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <h2 className="formSectionTitle" style={{ flex: 1 }}>
                    {group.label}
                  </h2>
                  <button type="button" className="button buttonGhost buttonSm" onClick={() => toggle(groupKeys, !allOn)}>
                    {allOn ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="formSectionBody" style={{ padding: 0 }}>
                  <table className="table">
                    <tbody>
                      {group.modules.map((mod) => {
                        const keys = mod.actions.map((a) => `${mod.key}.${a}`);
                        const all = keys.every((k) => perms.has(k));
                        return (
                          <tr key={mod.key}>
                            <td style={{ width: "16rem" }}>
                              <label className="checkboxRow" style={{ fontWeight: 600 }}>
                                <input type="checkbox" checked={all} onChange={(e) => toggle(keys, e.target.checked)} />
                                {mod.label}
                              </label>
                            </td>
                            <td>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1.25rem" }}>
                                {mod.actions.map((a) => {
                                  const key = `${mod.key}.${a}`;
                                  return (
                                    <label key={key} className="checkboxRow">
                                      <input type="checkbox" checked={perms.has(key)} onChange={(e) => toggle([key], e.target.checked)} />
                                      {ACTION_LABELS[a] ?? a}
                                    </label>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </fieldset>

        {!locked && (
          <div className="formActionsBar" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="formActionsNote" style={{ marginRight: "auto" }}>
              {dirty ? "Unsaved changes" : isEdit ? "All changes saved" : "Name the role and pick its permissions"}
              <span className="hideMobile"> · Ctrl + S to save</span>
            </span>
            <Button
              component={Link}
              href="/user-roles"
              variant="outlined"
              size="small"
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              {isEdit ? "Close" : "Cancel"}
            </Button>
            <Button
              type="button"
              variant="contained"
              size="small"
              onClick={save}
              disabled={saving || name.trim().length < 2}
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              {saving ? "Saving…" : isEdit ? "Save role" : "Create role"}
            </Button>
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete the role "${name}"?`}
          message="Only roles with no members can be deleted."
          confirmLabel="Delete"
          error={deleteError}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </>
  );
}
