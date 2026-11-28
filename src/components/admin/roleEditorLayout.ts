import { NAV_SECTIONS, getCreatePermission, getRequiredPermission } from "@/app/(app)/navigation";
import { PERMISSION_GROUPS, PERMISSION_MODULES, type PermissionModule } from "@/lib/auth/permissionCatalog";
import { permissionInProducts, productForHref, type Product } from "@/lib/products";

/** One permission module inside a menu, with the sub-menus (screens) it opens there. */
export interface RoleEditorRow {
  module: PermissionModule;
  screens: string[];
}

export interface RoleEditorMenu {
  key: string;
  label: string;
  rows: RoleEditorRow[];
  /** Screens in this menu that need no permission (open to every signed-in user). */
  openToAll: string[];
}

export interface RoleEditorSection {
  key: string;
  label: string;
  menus: RoleEditorMenu[];
}

/** Screens with no menu permission of their own, but whose landing right is a module. */
const SCREEN_MODULE: Record<string, string> = { "/dashboard": "analytics" };

function moduleOf(permission: string | null): string | null {
  return permission ? permission.split(".")[0] : null;
}

/**
 * The role editor's layout: the sidebar's sections, menus and sub-menus
 * (navigation.ts), each sub-menu under the permission module that controls
 * it. A module shared by several menus shows in each, with the same
 * checkboxes. Modules no menu entry uses (screens hidden from the menu, or
 * rights without a screen) close the list under "More permissions".
 *
 * Only what the workspace's products include is listed.
 */
export function buildRoleEditorLayout(products: readonly Product[]): RoleEditorSection[] {
  const inPlan = (mod: PermissionModule) => permissionInProducts(`${mod.key}.${mod.actions[0]}`, products);
  const placed = new Set<string>();

  const sections: RoleEditorSection[] = NAV_SECTIONS.map((section) => {
    const menus: RoleEditorMenu[] = [];
    for (const group of section.groups) {
      if (group.soon) continue;
      const screens = group.href
        ? [{ href: group.href, label: group.label, createHref: undefined as string | undefined }]
        : (group.children ?? []).filter((c) => c.enabled).map((c) => ({ href: c.href, label: c.label, createHref: c.createHref }));

      const menu: RoleEditorMenu = { key: group.key, label: group.label, rows: [], openToAll: [] };
      for (const screen of screens) {
        const product = productForHref(screen.href);
        if (product && !products.includes(product)) continue;

        const keys = new Set<string>();
        const viewModule = moduleOf(getRequiredPermission(screen.href)) ?? SCREEN_MODULE[screen.href] ?? null;
        if (viewModule) keys.add(viewModule);
        const createModule = screen.createHref ? moduleOf(getCreatePermission(screen.createHref)) : null;
        if (createModule) keys.add(createModule);

        const modules = [...keys].map((k) => PERMISSION_MODULES.get(k)).filter((x): x is PermissionModule => Boolean(x) && inPlan(x!));
        if (modules.length === 0) {
          if (!viewModule) menu.openToAll.push(screen.label);
          continue;
        }
        for (const mod of modules) {
          placed.add(mod.key);
          const row = menu.rows.find((r) => r.module.key === mod.key);
          if (row) {
            if (!row.screens.includes(screen.label)) row.screens.push(screen.label);
          } else {
            menu.rows.push({ module: mod, screens: [screen.label] });
          }
        }
      }
      if (menu.rows.length > 0 || menu.openToAll.length > 0) menus.push(menu);
    }
    return { key: section.key, label: section.label ?? "Home", menus };
  }).filter((s) => s.menus.length > 0);

  const rest: RoleEditorMenu[] = PERMISSION_GROUPS.map((g) => ({
    key: `more-${g.label}`,
    label: g.label,
    rows: g.modules.filter((mod) => !placed.has(mod.key) && inPlan(mod)).map((mod) => ({ module: mod, screens: [] })),
    openToAll: [],
  })).filter((menu) => menu.rows.length > 0);
  if (rest.length > 0) sections.push({ key: "more", label: "More permissions (not in the menu)", menus: rest });

  return sections;
}

/** Every permission key a layout shows, once each. */
export function layoutKeys(sections: readonly RoleEditorSection[]): string[] {
  const keys = new Set<string>();
  for (const s of sections) for (const menu of s.menus) for (const row of menu.rows) for (const a of row.module.actions) keys.add(`${row.module.key}.${a}`);
  return [...keys];
}

/**
 * Turning permissions on or off, with the rules the editor keeps:
 * any action brings the module's view along, and with it the lookups the
 * module's forms need (`requires`); turning view off turns the module off.
 */
export function togglePermissions(current: ReadonlySet<string>, keys: readonly string[], on: boolean): Set<string> {
  const next = new Set(current);
  for (const key of keys) {
    const [mod, action] = key.split(".");
    const def = PERMISSION_MODULES.get(mod);
    if (on) {
      next.add(key);
      if (action !== "view") next.add(`${mod}.view`);
      if (def?.requires && (action !== "view" || def.actions.length === 1)) def.requires.forEach((r) => next.add(r));
    } else {
      next.delete(key);
      if (action === "view" && def) def.actions.forEach((a) => next.delete(`${mod}.${a}`));
    }
  }
  return next;
}
