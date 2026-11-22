import mongoose, { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import {
  Employee,
  EmploymentChange,
  Payslip,
  PayrollArrear,
  HrDepartment,
  Designation,
  EMPLOYMENT_CHANGE_TYPES,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  HISTORY_REF_FIELDS,
  HISTORY_TEXT_FIELDS,
  HISTORY_MONEY_FIELDS,
  HISTORY_FLAG_FIELDS,
} from "@/models/hr";
import { Branch } from "@/models/Branch";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, eachDay, todayIn } from "./calendar";
import { assertPayrollOpen } from "./attendance";
import { findEmployee, businessTimeZone, objectId, type AnyDoc } from "./common";
import { createIncrementArrears, cancelArrearsOfChange } from "./arrears";

/*
 * Employment history: dated changes to an employee's placement and salary.
 * Each change stores the full set of tracked values from its effective date,
 * so the state on any day is the latest change on or before it. The Employee
 * record mirrors today's state; future-dated changes are applied when their
 * day arrives (applyDueChanges), and payroll reads the structure in effect
 * during the month (salaryForMonth).
 */

export const TRACKED_FIELDS = [...HISTORY_REF_FIELDS, ...HISTORY_TEXT_FIELDS, ...HISTORY_MONEY_FIELDS, ...HISTORY_FLAG_FIELDS] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];
type Values = Record<TrackedField, unknown>;

const d = (v: unknown) => new Decimal(v === null || v === undefined || v === "" ? "0" : String(v));
const isRef = (f: string) => (HISTORY_REF_FIELDS as readonly string[]).includes(f);
const isMoney = (f: string) => (HISTORY_MONEY_FIELDS as readonly string[]).includes(f);
const isFlag = (f: string) => (HISTORY_FLAG_FIELDS as readonly string[]).includes(f);

/** Comparable form of a tracked value: ids and money as strings (money to 2 places), flags as booleans. */
function norm(field: string, v: unknown): string | boolean {
  if (isMoney(field)) return d(v).toFixed(2);
  if (isFlag(field)) return Boolean(v);
  if (isRef(field)) return v ? String(v) : "";
  return v === null || v === undefined ? "" : String(v);
}

/** Value as stored on an EmploymentChange / Employee document. */
function store(field: string, v: unknown): unknown {
  if (isMoney(field)) return toDecimal128(d(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  if (isFlag(field)) return Boolean(v);
  if (isRef(field)) return v ? new Types.ObjectId(String(v)) : null;
  return v === null || v === undefined ? "" : String(v);
}

/** The tracked fields of an Employee (or of a change's `values`). */
export function snapshotOf(src: AnyDoc): Values {
  const out = {} as Values;
  for (const f of TRACKED_FIELDS) out[f] = store(f, src?.[f]);
  return out;
}

type Dated = { effectiveDate: Date; createdAt?: Date };

function sortChanges<T extends Dated>(rows: T[]): T[] {
  return [...rows].sort((a, b) => toDay(a.effectiveDate).getTime() - toDay(b.effectiveDate).getTime() || new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
}

/** The change in effect on `date` (latest effective on or before it), or null before the first one. */
export function changeAsOf<T extends Dated>(sortedChanges: T[], date: Date): T | null {
  let found: T | null = null;
  for (const c of sortedChanges) {
    if (toDay(c.effectiveDate) <= date) found = c;
    else break;
  }
  return found;
}

async function loadChanges(businessId: Types.ObjectId, employeeId: Types.ObjectId, session?: ClientSession) {
  const q = EmploymentChange.find({ businessId, employeeId });
  return sortChanges(await (session ? q.session(session) : q).lean<AnyDoc[]>());
}

/** Starts the history from the employee as they stand now, dated from joining. No-op once history exists. */
async function ensureBaseline(businessId: Types.ObjectId, emp: AnyDoc, userId: Types.ObjectId | null, session?: ClientSession) {
  const exists = await EmploymentChange.exists({ businessId, employeeId: emp._id }).session(session ?? null);
  if (exists) return;
  await EmploymentChange.create(
    [
      {
        businessId,
        employeeId: emp._id,
        effectiveDate: toDay(emp.dateOfJoining),
        changeType: "JOINED",
        values: snapshotOf(emp),
        changedFields: [],
        reason: "Record as it stood when history began",
        source: "BASELINE",
        applied: true,
        createdBy: userId,
        updatedBy: userId,
      },
    ],
    { session }
  );
}

/**
 * Copies the state as of today onto the Employee record and marks every
 * change effective by today as applied.
 */
async function syncEmployee(businessId: Types.ObjectId, employeeId: Types.ObjectId, today: Date, session: ClientSession) {
  const changes = await loadChanges(businessId, employeeId, session);
  const current = changeAsOf(changes, today) ?? changes[0];
  if (!current) return;
  await Employee.updateOne({ _id: employeeId, businessId }, { $set: snapshotOf(current.values) }, { session });
  await EmploymentChange.updateMany({ businessId, employeeId, effectiveDate: { $lte: today }, applied: false }, { applied: true }, { session });
}

/** Applies future-dated changes whose day has come. Cheap when there are none; safe to call often. */
export async function applyDueChanges(businessId: Types.ObjectId): Promise<number> {
  const today = todayIn(await businessTimeZone(businessId));
  const due: Types.ObjectId[] = await EmploymentChange.distinct("employeeId", { businessId, applied: false, effectiveDate: { $lte: today } });
  for (const employeeId of due) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(() => syncEmployee(businessId, employeeId, today, session));
    } finally {
      await session.endSession();
    }
  }
  return due.length;
}

/**
 * Carries the fields a change set into later changes that didn't set those
 * fields themselves, stopping per field at the first later change that did.
 */
async function propagate(businessId: Types.ObjectId, later: AnyDoc[], fields: string[], valueOf: (f: string) => unknown, session: ClientSession) {
  const open = new Set(fields);
  for (const c of later) {
    if (open.size === 0) break;
    const set: Record<string, unknown> = {};
    for (const f of [...open]) {
      if ((c.changedFields ?? []).includes(f)) open.delete(f);
      else set[`values.${f}`] = store(f, valueOf(f));
    }
    if (Object.keys(set).length > 0) await EmploymentChange.updateOne({ _id: c._id, businessId }, { $set: set }, { session });
  }
}

/* ------------------------------------------------------------------ */
/* Record / delete                                                     */
/* ------------------------------------------------------------------ */

const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => v === "" || (/^\d+(\.\d{1,2})?$/.test(v)), "Enter an amount");
export const changeSchema = z.object({
  changeType: z.enum(EMPLOYMENT_CHANGE_TYPES).refine((t) => t !== "JOINED", "Choose what changed"),
  effectiveDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it takes effect"),
  reason: z.string().trim().max(500).optional().default(""),
  changes: z
    .object({
      departmentId: objectId.nullable().optional(),
      designationId: objectId.nullable().optional(),
      reportingManagerId: objectId.nullable().optional(),
      branchId: objectId.nullable().optional(),
      workLocation: z.string().trim().max(100).optional(),
      employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
      employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
      basic: money.optional(),
      hra: money.optional(),
      conveyance: money.optional(),
      specialAllowance: money.optional(),
      otherAllowance: money.optional(),
      professionalTax: money.optional(),
      monthlyTds: money.optional(),
      pfApplicable: z.boolean().optional(),
      esiApplicable: z.boolean().optional(),
      ptApplicable: z.boolean().optional(),
    })
    .strict(),
});

const EXIT_STATUSES = ["RESIGNED", "TERMINATED", "RETIRED"];
/** Fields a backdated revision into paid months may change (paid as arrears). */
const ARREAR_FIELDS = ["basic", "hra", "conveyance", "specialAllowance", "otherAllowance"] as const;

/**
 * Records a dated change. Backdated changes are allowed up to the last
 * month whose payroll is still open; later changes that didn't set the same
 * fields inherit the new values, and the Employee record is brought up to
 * date if the change is already in effect.
 */
export async function recordChange(ctx: AuthContext, employeeId: string, input: z.infer<typeof changeSchema>) {
  const emp = await findEmployee(ctx.businessId, employeeId);
  const effective = toDay(input.effectiveDate);
  if (effective < toDay(emp.dateOfJoining)) throw AppError.badRequest("A change can't take effect before the employee joined.", "BEFORE_JOINING");
  if (input.changes.employmentStatus && EXIT_STATUSES.includes(input.changes.employmentStatus)) {
    throw AppError.badRequest("Record a resignation, termination or retirement on the employee record with the last working day.", "USE_EXIT_FORM");
  }
  if (input.changes.reportingManagerId && String(input.changes.reportingManagerId) === String(emp._id)) {
    throw AppError.badRequest("An employee can't report to themselves.", "SELF_MANAGER");
  }
  // Months already paid at the old rate: only a salary increase of the earning
  // components can reach back into them, and the difference is paid as arrears.
  const paidAfter = await Payslip.exists({
    businessId: ctx.businessId,
    employeeId: emp._id,
    status: { $in: ["APPROVED", "PAID"] },
    $or: [{ year: { $gt: effective.getUTCFullYear() } }, { year: effective.getUTCFullYear(), month: { $gte: effective.getUTCMonth() + 1 } }],
  });
  if (paidAfter) {
    const touched = Object.entries(input.changes).filter(([, v]) => v !== undefined).map(([k]) => k);
    const earningsOnly = touched.length > 0 && touched.every((k) => (ARREAR_FIELDS as readonly string[]).includes(k));
    if (input.changeType !== "SALARY_REVISION" || !earningsOnly) {
      throw AppError.badRequest("Payroll from that date is already approved. Only a salary revision of the earning components can be backdated (paid as arrears); choose a later date for other changes.", "PAYROLL_LOCKED");
    }
  }
  const today = todayIn(await businessTimeZone(ctx.businessId));

  const session = await mongoose.startSession();
  let created: AnyDoc = null;
  let changed: string[] = [];
  let arrears = 0;
  try {
    await session.withTransaction(async () => {
      await ensureBaseline(ctx.businessId, emp, ctx.userId, session);
      const changes = await loadChanges(ctx.businessId, emp._id, session);
      const prior = changeAsOf(changes, effective) ?? changes[0];
      const before = snapshotOf(prior.values);
      const after = { ...before };
      for (const [f, v] of Object.entries(input.changes)) {
        if (v === undefined) continue;
        after[f as TrackedField] = store(f, v);
      }
      changed = TRACKED_FIELDS.filter((f) => norm(f, before[f]) !== norm(f, after[f]));
      if (changed.length === 0) throw AppError.badRequest("Nothing would change on that date.", "NOTHING_TO_CHANGE");
      if (paidAfter && changed.some((f) => d(after[f as TrackedField]).lt(d(before[f as TrackedField])))) {
        throw AppError.badRequest("A salary reduction can't be backdated into months already paid. Choose a date after the last approved payroll.", "PAYROLL_LOCKED");
      }

      [created] = await EmploymentChange.create(
        [
          {
            businessId: ctx.businessId,
            employeeId: emp._id,
            effectiveDate: effective,
            changeType: input.changeType,
            values: after,
            changedFields: changed,
            reason: input.reason,
            source: "HISTORY",
            applied: false,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          },
        ],
        { session }
      );
      const later = changes.filter((c) => toDay(c.effectiveDate) > effective);
      await propagate(ctx.businessId, later, changed, (f) => after[f as TrackedField], session);
      await syncEmployee(ctx.businessId, emp._id, today, session);
      arrears = paidAfter ? await createIncrementArrears(ctx, emp, effective, created._id, session) : 0;
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "hr.history",
    documentType: "EmploymentChange",
    documentId: created?._id,
    newValue: { employee: emp.employeeCode, changeType: input.changeType, effectiveDate: dayKey(effective), changed: Object.fromEntries(changed.map((f) => [f, (input.changes as AnyDoc)[f]])) },
    reason: input.reason || undefined,
  });
  return { id: String(created._id), effectiveDate: dayKey(effective), changedFields: changed, scheduled: effective > today, arrears };
}

/**
 * Removes a change that was entered by mistake. The joining baseline stays,
 * and a change in a payroll-locked month can't be removed. Later changes
 * that had inherited its values get the earlier values back.
 */
export async function deleteChange(ctx: AuthContext, employeeId: string, changeId: string) {
  const emp = await findEmployee(ctx.businessId, employeeId);
  if (!Types.ObjectId.isValid(changeId)) throw AppError.notFound("Change not found");
  const target = await EmploymentChange.findOne({ _id: changeId, businessId: ctx.businessId, employeeId: emp._id }).lean<AnyDoc>();
  if (!target) throw AppError.notFound("Change not found");
  if (target.source === "BASELINE") throw AppError.badRequest("The joining record can't be removed.", "BASELINE");
  // A backdated revision with arrears can go while its arrears are unpaid; anything else in a locked month stays.
  const withArrears = await PayrollArrear.exists({ businessId: ctx.businessId, sourceChangeId: target._id });
  if (!withArrears) await assertPayrollOpen(ctx.businessId, [toDay(target.effectiveDate)]);
  const today = todayIn(await businessTimeZone(ctx.businessId));

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const changes = await loadChanges(ctx.businessId, emp._id, session);
      const idx = changes.findIndex((c) => String(c._id) === String(target._id));
      const prior = changes[idx - 1] ?? changes[0];
      const later = changes.slice(idx + 1);
      await propagate(ctx.businessId, later, target.changedFields ?? [], (f) => prior.values?.[f], session);
      if (withArrears) await cancelArrearsOfChange(ctx.businessId, target._id, session);
      await EmploymentChange.deleteOne({ _id: target._id, businessId: ctx.businessId }, { session });
      await syncEmployee(ctx.businessId, emp._id, today, session);
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "DELETE",
    module: "hr.history",
    documentType: "EmploymentChange",
    documentId: target._id,
    oldValue: { employee: emp.employeeCode, changeType: target.changeType, effectiveDate: dayKey(toDay(target.effectiveDate)), changedFields: target.changedFields },
  });
  return { id: changeId, deleted: true };
}

/**
 * Hook for the generic employee form: a new employee starts their history,
 * and an edit that touches tracked fields is logged as a correction from
 * today instead of silently overwriting the record.
 */
export async function recordFormWrite(ctx: AuthContext, kind: "CREATE" | "UPDATE", doc: AnyDoc, before?: AnyDoc) {
  if (kind === "CREATE") {
    await ensureBaseline(ctx.businessId, doc, ctx.userId);
    return;
  }
  if (!before) return;
  const was = snapshotOf(before);
  const now = snapshotOf(doc);
  const changed = TRACKED_FIELDS.filter((f) => norm(f, was[f]) !== norm(f, now[f]));
  if (changed.length === 0) return;

  const today = todayIn(await businessTimeZone(ctx.businessId));
  const joined = toDay(doc.dateOfJoining);
  const effective = today < joined ? joined : today;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await ensureBaseline(ctx.businessId, before, ctx.userId, session);
      const changes = await loadChanges(ctx.businessId, doc._id, session);
      const prior = changeAsOf(changes, effective) ?? changes[0];
      const values = snapshotOf(prior.values);
      for (const f of changed) values[f] = now[f];
      await EmploymentChange.create(
        [{ businessId: ctx.businessId, employeeId: doc._id, effectiveDate: effective, changeType: "CORRECTION", values, changedFields: changed, reason: "Edited on the employee record", source: "FORM", applied: true, createdBy: ctx.userId, updatedBy: ctx.userId }],
        { session }
      );
      const later = changes.filter((c) => toDay(c.effectiveDate) > effective);
      await propagate(ctx.businessId, later, changed, (f) => now[f as TrackedField], session);
    });
  } finally {
    await session.endSession();
  }
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

export interface MonthStructure {
  basic: Decimal;
  hra: Decimal;
  conveyance: Decimal;
  specialAllowance: Decimal;
  otherAllowance: Decimal;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  professionalTax: Decimal;
  monthlyTds: Decimal;
  /** Days in the month on which a new salary took effect. */
  revisedOn: Date[];
}

const EARNING_FIELDS = ["basic", "hra", "conveyance", "specialAllowance", "otherAllowance"] as const;

/**
 * The salary structure for a month: each earning component weighted by the
 * calendar days it applied (so a revision on the 16th pays half a month at
 * each rate), and the statutory settings in force at month end. Employees
 * with no history use their record as it stands.
 */
export async function salaryForMonth(businessId: Types.ObjectId, emps: AnyDoc[], start: Date, end: Date, session?: ClientSession): Promise<Map<string, MonthStructure>> {
  const q = EmploymentChange.find({ businessId, employeeId: { $in: emps.map((e) => e._id) }, effectiveDate: { $lte: end } });
  const rows = await (session ? q.session(session) : q).lean<AnyDoc[]>();
  const byEmp = new Map<string, AnyDoc[]>();
  for (const r of rows) {
    const k = String(r.employeeId);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k)!.push(r);
  }
  const days = eachDay(start, end);
  const out = new Map<string, MonthStructure>();

  for (const e of emps) {
    const changes = sortChanges(byEmp.get(String(e._id)) ?? []);
    if (changes.length === 0) {
      out.set(String(e._id), {
        basic: d(e.basic),
        hra: d(e.hra),
        conveyance: d(e.conveyance),
        specialAllowance: d(e.specialAllowance),
        otherAllowance: d(e.otherAllowance),
        pfApplicable: e.pfApplicable !== false,
        esiApplicable: Boolean(e.esiApplicable),
        ptApplicable: e.ptApplicable !== false,
        professionalTax: d(e.professionalTax),
        monthlyTds: d(e.monthlyTds),
        revisedOn: [],
      });
      continue;
    }
    const sums = Object.fromEntries(EARNING_FIELDS.map((f) => [f, new Decimal(0)])) as Record<(typeof EARNING_FIELDS)[number], Decimal>;
    const revisedOn: Date[] = [];
    let lastKey = "";
    for (const day of days) {
      const c = changeAsOf(changes, day) ?? changes[0];
      const key = EARNING_FIELDS.map((f) => d(c.values?.[f]).toFixed(2)).join("|");
      if (lastKey && key !== lastKey) revisedOn.push(day);
      lastKey = key;
      for (const f of EARNING_FIELDS) sums[f] = sums[f].plus(d(c.values?.[f]));
    }
    const atEnd = (changeAsOf(changes, end) ?? changes[0]).values ?? {};
    const avg = (f: (typeof EARNING_FIELDS)[number]) => sums[f].dividedBy(days.length).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    out.set(String(e._id), {
      basic: avg("basic"),
      hra: avg("hra"),
      conveyance: avg("conveyance"),
      specialAllowance: avg("specialAllowance"),
      otherAllowance: avg("otherAllowance"),
      pfApplicable: atEnd.pfApplicable !== false,
      esiApplicable: Boolean(atEnd.esiApplicable),
      ptApplicable: atEnd.ptApplicable !== false,
      professionalTax: d(atEnd.professionalTax),
      monthlyTds: d(atEnd.monthlyTds),
      revisedOn,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export const FIELD_LABELS: Record<TrackedField, string> = {
  departmentId: "Department",
  designationId: "Designation",
  reportingManagerId: "Reporting manager",
  branchId: "Branch",
  workLocation: "Work location",
  employmentType: "Employment type",
  employmentStatus: "Status",
  basic: "Basic",
  hra: "HRA",
  conveyance: "Conveyance",
  specialAllowance: "Special allowance",
  otherAllowance: "Other allowance",
  professionalTax: "Professional tax",
  monthlyTds: "Monthly TDS",
  pfApplicable: "PF applies",
  esiApplicable: "ESI applies",
  ptApplicable: "PT applies",
};

/** The employee's changes, newest first, each with what it changed from and to, plus the choices for a new change. */
export async function employmentHistory(ctx: AuthContext, employeeId: string) {
  await applyDueChanges(ctx.businessId);
  const emp = await findEmployee(ctx.businessId, employeeId);
  const today = todayIn(await businessTimeZone(ctx.businessId));
  const changes = await loadChanges(ctx.businessId, emp._id);

  const [departments, designations, branches, people] = await Promise.all([
    HrDepartment.find({ businessId: ctx.businessId, deletedAt: null }, { name: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
    Designation.find({ businessId: ctx.businessId, deletedAt: null }, { name: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
    Branch.find({ businessId: ctx.businessId }, { name: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
    Employee.find({ businessId: ctx.businessId, deletedAt: null }, { name: 1, employeeCode: 1, employmentStatus: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
  ]);
  const names: Record<string, Map<string, string>> = {
    departmentId: new Map(departments.map((x) => [String(x._id), x.name])),
    designationId: new Map(designations.map((x) => [String(x._id), x.name])),
    branchId: new Map(branches.map((x) => [String(x._id), x.name])),
    reportingManagerId: new Map(people.map((x) => [String(x._id), x.name])),
  };
  const show = (f: string, v: unknown): string => {
    if (isRef(f)) return v ? names[f].get(String(v)) ?? "(removed)" : "—";
    if (isMoney(f)) return d(v).toFixed(2);
    if (isFlag(f)) return v ? "Yes" : "No";
    return v ? String(v) : "—";
  };

  const items = changes.map((c, i) => {
    const prev = i > 0 ? changes[i - 1].values : null;
    return {
      id: String(c._id),
      effectiveDate: dayKey(toDay(c.effectiveDate)),
      changeType: c.changeType,
      source: c.source,
      reason: c.reason,
      scheduled: toDay(c.effectiveDate) > today,
      createdAt: c.createdAt,
      changes: ((c.changedFields ?? []) as TrackedField[]).map((f) => ({ field: f, label: FIELD_LABELS[f] ?? f, from: prev ? show(f, prev[f]) : "", to: show(f, c.values?.[f]), money: isMoney(f) })),
    };
  });

  const current = snapshotOf(emp);
  return {
    items: items.reverse(),
    current: Object.fromEntries(TRACKED_FIELDS.map((f) => [f, isRef(f) ? (current[f] ? String(current[f]) : "") : isMoney(f) ? d(current[f]).toFixed(2) : current[f]])),
    options: {
      departments: departments.map((x) => ({ id: String(x._id), name: x.name })),
      designations: designations.map((x) => ({ id: String(x._id), name: x.name })),
      branches: branches.map((x) => ({ id: String(x._id), name: x.name })),
      managers: people.filter((x) => String(x._id) !== String(emp._id) && ["PROBATION", "CONFIRMED", "ON_NOTICE"].includes(x.employmentStatus)).map((x) => ({ id: String(x._id), name: `${x.name} (${x.employeeCode})` })),
    },
  };
}
