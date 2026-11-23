import type { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { AttendanceReason, AttendanceRequest } from "@/models/hr";
import { getSettings } from "@/lib/settings/service";
import type { AttendanceRegularizationSettings } from "@/lib/settings/definitions";
import { addDays, dayKey, dayKind, loadCalendar, shiftFor } from "./calendar";
import type { AnyDoc } from "./common";

/*
 * The attendance regularization policy (Attendance Regularization settings)
 * and the reasons employees choose from (Attendance Reg. Reasons). Requests
 * are checked against the policy when raised and, unless the policy says not
 * to, again when approved.
 */

export type RegularizationPolicy = AttendanceRegularizationSettings;

export function regularizationPolicy(businessId: Types.ObjectId): Promise<RegularizationPolicy> {
  return getSettings<RegularizationPolicy>(businessId, "attendance-regularization");
}

export interface RegularizationAsk {
  date: Date;
  status: string;
  checkIn: string;
  checkOut: string;
}

/**
 * Refuses a request the policy does not allow. `today` is the day the limits
 * count from (the day the request was raised, when re-checked on approval);
 * `current` is the day's attendance row, if any; `excludeRequestId` keeps a
 * request out of its own monthly count.
 */
export async function assertRegularizationAllowed(
  businessId: Types.ObjectId,
  policy: RegularizationPolicy,
  emp: AnyDoc,
  ask: RegularizationAsk,
  opts: { today: Date; current: AnyDoc | null; excludeRequestId?: Types.ObjectId }
): Promise<void> {
  const { date } = ask;
  const { today, current } = opts;
  const refuse = (message: string, code: string) => {
    throw AppError.badRequest(message, code);
  };

  if (!policy.applicable) refuse("Attendance regularization is turned off. Ask HR to correct the day.", "REGULARIZATION_OFF");

  const future = date > today;
  if (future) {
    if (!policy.futureApplicable) refuse("You can only correct today or an earlier day.", "FUTURE_DATE");
    if (policy.futureDaysLimit > 0 && date > addDays(today, policy.futureDaysLimit)) {
      refuse(`Future days can be requested up to ${policy.futureDaysLimit} day(s) ahead.`, "FUTURE_LIMIT");
    }
  } else if (policy.pastDaysLimit > 0 && date < addDays(today, -policy.pastDaysLimit)) {
    refuse(`Past days can be corrected up to ${policy.pastDaysLimit} day(s) back.`, "PAST_LIMIT");
  }

  const blank = !current || !current.status;
  if (blank && !future && !policy.pastBlankAttendance) refuse("Days with no attendance marked can't be regularized. Ask HR to mark the day.", "BLANK_ATTENDANCE");
  if (blank && future && !policy.futureBlankAttendance) refuse("Future days with no attendance marked can't be regularized.", "BLANK_ATTENDANCE");

  const cal = await loadCalendar(businessId, date, date);
  const kind = dayKind(cal, shiftFor(cal, emp.shiftId), date);
  if (kind === "WEEKLY_OFF" && !policy.allowOnWeeklyOffs) refuse("That day is a weekly off, which can't be regularized.", "WEEKLY_OFF");
  if (kind === "HOLIDAY" && !policy.allowOnHolidays) refuse(`That day is a holiday (${cal.holidays.get(dayKey(date))}), which can't be regularized.`, "HOLIDAY");

  if (current?.leaveApplicationId) {
    const halfDayLeave = current.status === "HALF_DAY";
    if (!halfDayLeave || !policy.applyOnHalfDayLeave) {
      refuse("That day is covered by approved leave. Withdraw the leave or ask HR to cancel it instead.", "ON_LEAVE");
    }
    if (ask.status !== "HALF_DAY") refuse("On a half-day leave you can only correct the half you worked: choose Half day.", "HALF_DAY_LEAVE");
  }

  if (ask.checkIn || ask.checkOut) {
    if (!policy.punchApplicable) refuse("Check-in and check-out times can't be corrected by request. Leave the times blank.", "PUNCH_OFF");
    if (policy.punchPastDaysLimit > 0 && date < addDays(today, -policy.punchPastDaysLimit)) {
      refuse(`Punch times can be corrected up to ${policy.punchPastDaysLimit} day(s) back. Leave the times blank.`, "PUNCH_LIMIT");
    }
  }

  if (policy.maxDaysPerMonth > 0) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    const used = await AttendanceRequest.countDocuments({
      businessId,
      employeeId: emp._id,
      status: { $in: ["PENDING", "APPROVED"] },
      date: { $gte: start, $lte: end },
      ...(opts.excludeRequestId ? { _id: { $ne: opts.excludeRequestId } } : {}),
    });
    if (used >= policy.maxDaysPerMonth) refuse(`Only ${policy.maxDaysPerMonth} day(s) a month can be regularized, and that month has ${used}.`, "MONTH_LIMIT");
  }
}

/** What the employee's request form needs: the reasons and the dates and times the policy allows. */
export async function regularizationOptions(businessId: Types.ObjectId, today: Date) {
  await ensureAttendanceReasons(businessId);
  const [policy, reasons] = await Promise.all([
    regularizationPolicy(businessId),
    AttendanceReason.find({ businessId, deletedAt: null, status: "ACTIVE" }, { name: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
  ]);
  const maxDate = !policy.futureApplicable ? today : policy.futureDaysLimit > 0 ? addDays(today, policy.futureDaysLimit) : null;
  return {
    applicable: policy.applicable,
    minDate: policy.pastDaysLimit > 0 ? dayKey(addDays(today, -policy.pastDaysLimit)) : null,
    maxDate: maxDate ? dayKey(maxDate) : null,
    punchApplicable: policy.punchApplicable,
    punchPastDaysLimit: policy.punchPastDaysLimit,
    reasons: reasons.map((r) => ({ id: String(r._id), name: r.name as string })),
  };
}

/** Looks up a chosen reason; refuses one that is unknown, deleted or inactive. */
export async function reasonFor(businessId: Types.ObjectId, reasonId: string | undefined) {
  if (!reasonId) return null;
  const reason = await AttendanceReason.findOne({ businessId, _id: reasonId, deletedAt: null, status: "ACTIVE" }, { name: 1 }).lean<AnyDoc>();
  if (!reason) throw AppError.badRequest("Choose a reason from the list", "REASON_NOT_FOUND");
  return { id: reason._id as Types.ObjectId, name: reason.name as string };
}

export const SYSTEM_ATTENDANCE_REASONS = ["Client Meeting", "Forgot to Mark Attendance", "Forgot to Punch", "On Client Visit", "On Training", "Travelling (On Duty)"];

/**
 * Seeds the system-defined reasons for a workspace that has never had any
 * (deleted ones count, so a reason HR removed is not brought back).
 */
export async function ensureAttendanceReasons(businessId: Types.ObjectId): Promise<void> {
  if ((await AttendanceReason.countDocuments({ businessId })) > 0) return;
  try {
    await AttendanceReason.insertMany(
      SYSTEM_ATTENDANCE_REASONS.map((name) => ({ businessId, name, reasonType: "SYSTEM" })),
      { ordered: false }
    );
  } catch (err) {
    // Two first visits at once: the unique index keeps one copy of each.
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}
