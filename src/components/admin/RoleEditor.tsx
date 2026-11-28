"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { apiFetch, ApiError } from "@/lib/api/client";
import { ALL_PERMISSION_KEYS } from "@/lib/auth/permissionCatalog";
import { useAuth } from "@/app/(app)/AuthProvider";
import type { Product } from "@/lib/products";
import { buildRoleEditorLayout, layoutKeys, togglePermissions } from "@/components/admin/roleEditorLayout";
import { useShortcutScope, useUnsavedChangesWarning } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import { SkeletonBlock } from "@/components/ui/States";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { IconArrowLeft, IconTrash } from "@/components/icons";

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
  "approve-all": "Approve anyone's (HR)",
  allocate: "Allocate",
  process: "Process",
};

/**
 * Create or edit a custom role. Permissions are laid out like the sidebar:
 * section → menu → the rights that control its sub-menus, one checkbox per
 * action, so every menu and sub-menu (reports and settings included) can be
 * granted on its own. Rights with no menu entry close the list.
 */
export default function RoleEditor({ roleId }: { roleId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(roleId);
  const { me } = useAuth();
  const productKey = (me?.products ?? ["ERP"]).join(",");

  // Only the menus this workspace has bought: an HRMS-only customer never sees sales or stock permissions.
  const layout = useMemo(() => buildRoleEditorLayout(productKey.split(",") as Product[]), [productKey]);
  const allKeys = useMemo(() => layoutKeys(layout), [layout]);
  const [query, setQuery] = useState("");

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

  // Any action brings the module's view (and the lookups its forms need); view off turns the module off.
  function toggle(keys: string[], on: boolean) {
    setPerms((prev) => togglePermissions(prev, keys, on));
    setDirty(true);
  }

  const total = allKeys.length;
  const selected = allKeys.filter((k) => perms.has(k)).length;

  // Search narrows to menus, sub-menus and rights whose names match.
  const q = query.trim().toLowerCase();
  const visibleLayout = useMemo(() => {
    if (!q) return layout;
    const hit = (text: string) => text.toLowerCase().includes(q);
    return layout
      .map((section) => ({
        ...section,
        menus: section.menus
          .map((menu) => {
            if (hit(menu.label) || hit(section.label)) return menu;
            return {
              ...menu,
              rows: menu.rows.filter((r) => hit(r.module.label) || r.screens.some(hit)),
              openToAll: menu.openToAll.filter(hit),
            };
          })
          .filter((menu) => menu.rows.length > 0 || menu.openToAll.length > 0),
      }))
      .filter((section) => section.menus.length > 0);
  }, [layout, q]);

  async function save() {
    if (locked) return;
    setSaving(true);
    setError(null);
    try {
      // Only keys the catalog knows: a retired key left on an old role would be refused.
      const body = JSON.stringify({ name, description: description || undefined, permissions: [...perms].filter((p) => ALL_PERMISSION_KEYS.has(p)) });
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
        description={`${selected} of ${total} permissions selected.`}
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

          <div className="roleEditorToolbar">
            <SearchBox value={query} onChange={setQuery} placeholder="Find a menu, screen or report…" width="20rem" />
            <span className="cellMuted" style={{ flex: 1 }}>
              Laid out like the sidebar. Ticking any action also ticks View, and the lists its forms pick from.
            </span>
            <button type="button" className="button buttonGhost buttonSm" onClick={() => toggle(allKeys, selected < total)}>
              {selected < total ? "Select everything" : "Clear everything"}
            </button>
          </div>

          {visibleLayout.length === 0 && <p className="cellMuted">Nothing matches “{query}”.</p>}

          {visibleLayout.map((section) => (
            <div key={section.key} className="roleEditorSection">
              <h2 className="roleEditorSectionTitle">{section.label}</h2>
              {section.menus.map((menu) => {
                const menuKeys = menu.rows.flatMap((r) => r.module.actions.map((a) => `${r.module.key}.${a}`));
                const allOn = menuKeys.length > 0 && menuKeys.every((k) => perms.has(k));
                return (
                  <section key={menu.key} className="formSection">
                    <div className="formSectionHead" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <h3 className="formSectionTitle" style={{ flex: 1 }}>
                        {menu.label}
                      </h3>
                      {menuKeys.length > 0 && (
                        <button type="button" className="button buttonGhost buttonSm" onClick={() => toggle(menuKeys, !allOn)}>
                          {allOn ? "Clear all" : "Select all"}
                        </button>
                      )}
                    </div>
                    <div className="formSectionBody" style={{ padding: 0 }}>
                      <table className="table">
                        <tbody>
                          {menu.rows.map(({ module: mod, screens }) => {
                            const keys = mod.actions.map((a) => `${mod.key}.${a}`);
                            const all = keys.every((k) => perms.has(k));
                            const single = screens.length === 1;
                            return (
                              <tr key={mod.key}>
                                <td style={{ width: "20rem" }}>
                                  <label className="checkboxRow" style={{ fontWeight: 600 }}>
                                    <input type="checkbox" checked={all} onChange={(e) => toggle(keys, e.target.checked)} />
                                    {single ? screens[0] : mod.label}
                                  </label>
                                  {!single && screens.length > 0 && <div className="roleEditorScreens">Sub-menus: {screens.join(", ")}</div>}
                                  {single && screens[0].toLowerCase() !== mod.label.toLowerCase() && <div className="roleEditorScreens">Rights: {mod.label}</div>}
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
                          {menu.openToAll.length > 0 && (
                            <tr>
                              <td colSpan={2} className="cellMuted">
                                {menu.openToAll.join(", ")}: open to every signed-in user.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
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
