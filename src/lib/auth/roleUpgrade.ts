import type { Types } from "mongoose";
import { Role } from "@/models/Role";
import { PERMISSIONS_VERSION, upgradePermissionList } from "@/lib/auth/permissionCatalog";

/** Roles whose stored list predates the current catalog (missing version = 0). */
const OUTDATED = { permissionsVersion: { $not: { $gte: PERMISSIONS_VERSION } } };

/**
 * Brings every role of a business up to the current permission catalog
 * (see LEGACY_GRANTS): a screen that got its own permission is granted to the
 * roles that could open it before. Runs once per role; afterwards the new key
 * is edited like any other. Idempotent and cheap when nothing is outdated.
 */
export async function upgradeBusinessRoles(businessId: Types.ObjectId): Promise<void> {
  const outdated = await Role.find({ businessId, ...OUTDATED }, { permissions: 1 }).lean<{ _id: Types.ObjectId; permissions: string[] }[]>();
  for (const role of outdated) {
    await Role.updateOne(
      { _id: role._id, businessId, ...OUTDATED },
      { $set: { permissions: upgradePermissionList(role.permissions ?? []), permissionsVersion: PERMISSIONS_VERSION } }
    );
  }
}

/**
 * The permissions to put in a session for a role read with lean(): upgraded
 * (and saved) first when the role predates the current catalog.
 */
export async function currentRolePermissions(
  role: { _id: Types.ObjectId; businessId: Types.ObjectId; permissions?: string[]; permissionsVersion?: number } | null | undefined
): Promise<string[]> {
  if (!role) return [];
  const permissions = role.permissions ?? [];
  if ((role.permissionsVersion ?? 0) >= PERMISSIONS_VERSION) return permissions;
  const upgraded = upgradePermissionList(permissions);
  await Role.updateOne(
    { _id: role._id, businessId: role.businessId, ...OUTDATED },
    { $set: { permissions: upgraded, permissionsVersion: PERMISSIONS_VERSION } }
  );
  return upgraded;
}
