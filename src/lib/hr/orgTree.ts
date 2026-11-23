import { Designation, Employee, HrDepartment, WORKING_STATUSES } from "@/models/hr";
import type { AuthContext } from "@/lib/auth/context";
import type { AnyDoc } from "./common";
import { photoUrl } from "./photos";

/*
 * The organization tree: everyone on the rolls, placed under their reporting
 * manager. People whose manager has left (or who have none) are at the top.
 */

export interface OrgNode {
  id: string;
  code: string;
  name: string;
  designation: string;
  department: string;
  location: string;
  photoUrl: string | null;
  /** The manager shown above them; null at the top of the tree. */
  managerId: string | null;
}

/**
 * Makes the reporting lines a forest: a manager who is not in the list is
 * dropped, and a loop (A reports to B, B reports to A) is broken at the first
 * person found in it, who goes to the top, so nobody falls out of the tree.
 */
export function toForest<T extends { id: string; managerId: string | null }>(nodes: T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, { ...n, managerId: n.managerId && n.managerId !== n.id ? n.managerId : null }]));
  for (const n of byId.values()) if (n.managerId && !byId.has(n.managerId)) n.managerId = null;

  const settled = new Set<string>();
  for (const start of byId.values()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: (T & { managerId: string | null }) | undefined = start;
    while (cur && !settled.has(cur.id)) {
      if (onPath.has(cur.id)) {
        cur.managerId = null; // break the loop here
        break;
      }
      path.push(cur.id);
      onPath.add(cur.id);
      cur = cur.managerId ? byId.get(cur.managerId) : undefined;
    }
    for (const id of path) settled.add(id);
  }
  return [...byId.values()];
}

export async function orgTree(ctx: AuthContext): Promise<{ items: OrgNode[]; meId: string | null }> {
  const emps = await Employee.find(
    { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: [...WORKING_STATUSES] } },
    { employeeCode: 1, name: 1, designationId: 1, departmentId: 1, workLocation: 1, reportingManagerId: 1, userId: 1, photoUpdatedAt: 1 }
  )
    .sort({ name: 1 })
    .lean<AnyDoc[]>();
  const [designations, departments] = await Promise.all([
    Designation.find({ businessId: ctx.businessId, _id: { $in: emps.map((e) => e.designationId).filter(Boolean) } }, { name: 1 }).lean<AnyDoc[]>(),
    HrDepartment.find({ businessId: ctx.businessId, _id: { $in: emps.map((e) => e.departmentId).filter(Boolean) } }, { name: 1 }).lean<AnyDoc[]>(),
  ]);
  const dn = new Map(designations.map((d) => [String(d._id), d.name as string]));
  const dp = new Map(departments.map((d) => [String(d._id), d.name as string]));
  const me = emps.find((e) => e.userId && String(e.userId) === String(ctx.userId));

  return {
    items: toForest(
      emps.map((e) => ({
        id: String(e._id),
        code: e.employeeCode as string,
        name: e.name as string,
        designation: e.designationId ? dn.get(String(e.designationId)) ?? "" : "",
        department: e.departmentId ? dp.get(String(e.departmentId)) ?? "" : "",
        location: (e.workLocation as string) ?? "",
        photoUrl: photoUrl(String(e._id), e.photoUpdatedAt),
        managerId: e.reportingManagerId ? String(e.reportingManagerId) : null,
      }))
    ),
    meId: me ? String(me._id) : null,
  };
}
