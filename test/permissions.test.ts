import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { NAV_GROUPS, getRequiredPermission, getCreatePermission } from "@/app/(app)/navigation";
import {
  ALL_PERMISSION_KEYS,
  ERP_REPORT_PERMISSIONS,
  HR_PERMISSION_KEYS,
  LEGACY_GRANTS,
  PERMISSIONS_VERSION,
  RETIRED_PERMISSION_KEYS,
  upgradePermissionList,
} from "@/lib/auth/permissionCatalog";
import { REPORTS } from "@/lib/reports/registry";
import { RESOURCES } from "@/lib/resources/registry";
import { DOCUMENTS } from "@/lib/documents/registry";
import { SETTINGS_SECTIONS } from "@/lib/settings/definitions";
import { HR_REPORTS } from "@/lib/hr/reportCatalog";
import { buildRoleEditorLayout, layoutKeys, togglePermissions } from "@/components/admin/roleEditorLayout";

/** Every enabled screen in the sidebar. */
const SCREENS: { href: string; label: string; createHref?: string }[] = NAV_GROUPS.flatMap((g) =>
  g.href ? (g.soon ? [] : [{ href: g.href, label: g.label }]) : (g.children ?? []).filter((c) => c.enabled)
);

/** Screens deliberately open to every signed-in user. */
const OPEN_SCREENS = new Set(["/dashboard", "/approvals/queue"]);

describe("permission catalog", () => {
  it("has a permission for every menu entry, and every one is grantable", () => {
    for (const s of SCREENS) {
      const perm = getRequiredPermission(s.href);
      if (OPEN_SCREENS.has(s.href)) continue;
      expect(perm, `${s.href} has no menu permission`).toBeTruthy();
      expect(ALL_PERMISSION_KEYS.has(perm!), `${perm} (${s.href}) is not in the catalog`).toBe(true);
      if (s.createHref) {
        const create = getCreatePermission(s.createHref);
        expect(create && ALL_PERMISSION_KEYS.has(create), `${s.createHref}: ${create}`).toBe(true);
      }
    }
  });

  it("lists every ERP report, HR report, master, document and settings section", () => {
    expect(ERP_REPORT_PERMISSIONS.map((r) => r.key).sort()).toEqual(Object.keys(REPORTS).sort());
    for (const r of HR_REPORTS) expect(ALL_PERMISSION_KEYS.has(`hr-report-${r.key}.view`)).toBe(true);
    for (const def of [...Object.values(RESOURCES), ...Object.values(DOCUMENTS)]) {
      for (const p of Object.values(def.permissions)) expect(ALL_PERMISSION_KEYS.has(p), `${def.key}: ${p}`).toBe(true);
    }
    for (const s of Object.values(SETTINGS_SECTIONS)) {
      expect(ALL_PERMISSION_KEYS.has(s.viewPermission), s.viewPermission).toBe(true);
      expect(ALL_PERMISSION_KEYS.has(s.editPermission), s.editPermission).toBe(true);
    }
  });

  it("maps every new key from keys that exist, and seeds HR Manager with the new HR keys", () => {
    for (const [key, from] of Object.entries(LEGACY_GRANTS)) {
      expect(ALL_PERMISSION_KEYS.has(key), key).toBe(true);
      for (const f of from) expect(ALL_PERMISSION_KEYS.has(f) || RETIRED_PERMISSION_KEYS.has(f), `${key} ← ${f}`).toBe(true);
    }
    expect(HR_PERMISSION_KEYS).toContain("hr-report-salary-register.view");
    expect(HR_PERMISSION_KEYS).toContain("hr-grades.create");
    expect(HR_PERMISSION_KEYS.some((k) => k.startsWith("hr-self."))).toBe(false);
  });

  it("upgrades an old role without widening or narrowing what it could open", () => {
    const upgraded = upgradePermissionList(["sales-invoices.view", "settings.view", "hr-reports.view", "hr-designations.create", "analytics.view", "purchase-invoices.view"]);
    expect(upgraded).toEqual(
      expect.arrayContaining([
        "report-sales-register.view",
        "report-gst-hsn-summary.view",
        "settings-items.view",
        "settings-print-formats.view",
        "hr-report-salary-register.view",
        "hr-grades.create",
        "analysis-sales.view",
        "analysis-purchase.view",
      ])
    );
    expect(upgraded).not.toContain("hr-reports.view"); // retired
    expect(upgraded).not.toContain("settings-items.edit"); // never had settings.edit
    expect(upgraded).not.toContain("report-stock-summary.view"); // never had items.view
    expect(upgraded).not.toContain("analysis-inventory.view");
    expect(upgradePermissionList(["*"])).toEqual(["*"]);
  });
});

describe("role editor layout", () => {
  it("shows every menu and sub-menu of the plan, reports and settings included", () => {
    const layout = buildRoleEditorLayout(["ERP", "HRMS"]);
    const labels = layout.flatMap((s) => s.menus.flatMap((m) => [...m.rows.flatMap((r) => r.screens), ...m.openToAll]));
    for (const s of SCREENS) expect(labels, s.label).toContain(s.label);
    const reports = layout.find((s) => s.key === "insights")!.menus.find((m) => m.key === "reports")!;
    expect(reports.rows.map((r) => r.module.key)).toContain("report-sales-register");
    const prefs = layout.find((s) => s.key === "admin")!.menus.find((m) => m.key === "settings")!;
    expect(prefs.rows.map((r) => r.module.key)).toEqual(expect.arrayContaining(["settings-items", "settings-print-formats", "financial-years"]));
    // Every grantable key of the plan is reachable from the editor.
    expect(new Set(layoutKeys(layout))).toEqual(ALL_PERMISSION_KEYS);
  });

  it("keeps HR rights out of an ERP-only workspace", () => {
    const keys = layoutKeys(buildRoleEditorLayout(["ERP"]));
    expect(keys.some((k) => k.startsWith("hr-"))).toBe(false);
    expect(keys).toContain("settings.edit");
  });

  it("ticks view and lookups along, and view off clears the module", () => {
    let p = togglePermissions(new Set(), ["hr-employees.edit"], true);
    expect([...p]).toEqual(expect.arrayContaining(["hr-employees.edit", "hr-employees.view", "hr-grades.view", "hr-salary-structures.view"]));
    p = togglePermissions(p, ["hr-employees.view"], false);
    expect(p.has("hr-employees.edit")).toBe(false);
    expect(p.has("hr-grades.view")).toBe(true);
  });
});

describe("upgrading stored roles", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60_000 }] });
    await mongoose.connect(replSet.getUri("permissions-test"));
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it("upgrades once, then leaves a revoked key revoked", async () => {
    const { Role } = await import("@/models/Role");
    const { upgradeBusinessRoles, currentRolePermissions } = await import("@/lib/auth/roleUpgrade");
    const businessId = new Types.ObjectId();
    // A role saved before permissionsVersion existed.
    const { insertedId } = await Role.collection.insertOne({ businessId, name: "Clerk", permissions: ["items.view"], isSystemRole: false, isActive: true });

    await upgradeBusinessRoles(businessId);
    let role = await Role.findById(insertedId).lean<{ permissions: string[]; permissionsVersion: number }>();
    expect(role!.permissionsVersion).toBe(PERMISSIONS_VERSION);
    expect(role!.permissions).toEqual(expect.arrayContaining(["items.view", "inventory.view", "report-stock-summary.view", "barcode-labels.view"]));

    // The admin takes Stock on Hand away; the next sign-in must not hand it back.
    await Role.updateOne({ _id: insertedId }, { $pull: { permissions: "inventory.view" } });
    role = await Role.findById(insertedId).lean();
    expect(await currentRolePermissions(role as never)).not.toContain("inventory.view");
    await upgradeBusinessRoles(businessId);
    role = await Role.findById(insertedId).lean();
    expect(role!.permissions).not.toContain("inventory.view");
  });
});
