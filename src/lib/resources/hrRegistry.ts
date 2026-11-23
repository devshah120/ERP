import { z } from "zod";
import type { Types } from "mongoose";
import { moneyStringSchema } from "@/lib/validation/money";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import { recordFormWrite } from "@/lib/hr/history";
import { linkedUserFrom, checkUserLink, linkUser } from "@/lib/hr/employeeLogin";
import { ensureAttendanceReasons } from "@/lib/hr/regularization";
import { keepSingleDefault } from "@/lib/hr/holidayCalendars";
import { migrateLegacyGradeGroups, assertGradeGroupAllowed } from "@/lib/hr/leaveGroups";
import {
  HrDepartment,
  Designation,
  HrGrade,
  Shift,
  Holiday,
  HolidayCalendar,
  LeaveType,
  LeaveGroup,
  GradeLeaveGroup,
  AttendanceReason,
  Announcement,
  Employee,
  JobOpening,
  Candidate,
  HrAsset,
  Appraisal,
  WEEKDAYS,
  GENDERS_HR,
  MARITAL_STATUSES,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  WORKING_STATUSES,
  SALARY_PAYMENT_MODES,
  HOLIDAY_TYPES,
  CANDIDATE_STAGES,
  OPENING_STATUSES,
  ASSET_CONDITIONS,
  APPRAISAL_STAGES,
  PayComponent,
  PAY_COMPONENT_KINDS,
} from "@/models/hr";
import type { ResourceDefinition } from "./types";
import { STATUS, permissionsFor, documentConverter, optionalRef, optionalDate, requiredDate } from "./helpers";

/**
 * HRMS masters on the generic resource framework: list, search, filters,
 * create/edit/soft-delete, Excel export and import, all tenant-scoped and
 * audited by the shared handlers. Keys start with "hr-" so the product gate
 * (src/lib/products.ts) recognises them as HRMS.
 */

const status = z.enum(STATUS).default("ACTIVE");
const notes = z.string().trim().max(1000).optional();
const optionalText = (max = 200) => z.string().trim().max(max).optional();
const optionalEmail = z.string().trim().toLowerCase().email().optional().or(z.literal(""));
const money = moneyStringSchema.default("0");
const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm, e.g. 09:30");
const optionalCode = z.string().trim().toUpperCase().max(30).optional().or(z.literal(""));

function define(
  key: string,
  label: string,
  def: Omit<ResourceDefinition, "key" | "label" | "permissions" | "createSchema" | "updateSchema"> & {
    fields: z.ZodRawShape;
    refine?: (v: Record<string, unknown>, ctx: z.RefinementCtx) => void;
  }
): ResourceDefinition {
  const { fields, refine, ...rest } = def;
  const base = z.object(fields);
  return {
    key,
    label,
    permissions: permissionsFor(key),
    createSchema: refine ? base.superRefine(refine as never) : base,
    updateSchema: base.partial(),
    ...rest,
  };
}

function dateOrder(fromKey: string, toKey: string, message: string) {
  return (v: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const from = v[fromKey] ? Date.parse(String(v[fromKey])) : NaN;
    const to = v[toKey] ? Date.parse(String(v[toKey])) : NaN;
    if (!Number.isNaN(from) && !Number.isNaN(to) && to < from) ctx.addIssue({ code: "custom", path: [toKey], message });
  };
}

/* ------------------------------------------------------------------ */
/* Organisation                                                        */
/* ------------------------------------------------------------------ */

const departments = define("hr-departments", "Department", {
  model: HrDepartment,
  autoCode: { field: "code", prefix: "DEP", entityType: "HR_DEPARTMENT" },
  fields: {
    code: optionalCode,
    name: z.string().trim().min(2).max(150),
    headEmployeeId: optionalRef,
    costCenter: optionalText(60),
    description: optionalText(500),
    status,
  },
  searchFields: ["name", "code", "costCenter"],
  filterFields: { code: "code", name: "name" },
  sortableFields: ["code", "name", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
  toDocument: documentConverter({ refs: ["headEmployeeId"] }),
});

const designations = define("hr-designations", "Designation", {
  model: Designation,
  autoCode: { field: "code", prefix: "DSG", entityType: "HR_DESIGNATION" },
  fields: {
    code: optionalCode,
    name: z.string().trim().min(2).max(150),
    description: optionalText(500),
    status,
  },
  searchFields: ["name", "code"],
  filterFields: { code: "code", name: "name" },
  sortableFields: ["code", "name", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
});

/** Grades ride on the designation permissions so existing HR roles can use them at once. */
const grades: ResourceDefinition = {
  ...define("hr-grades", "Grade", {
    model: HrGrade,
    fields: {
      code: z.string().trim().toUpperCase().min(1, "Enter a code").max(10),
      name: z.string().trim().min(1).max(100),
      description: optionalText(500),
      status,
    },
    searchFields: ["code", "name"],
    filterFields: { code: "code", name: "name" },
    sortableFields: ["code", "name", "createdAt"],
    defaultSort: "code",
    defaultSortDir: "asc",
  }),
  permissions: { view: "hr-designations.view", create: "hr-designations.create", edit: "hr-designations.edit", delete: "hr-designations.delete" },
};

const shifts = define("hr-shifts", "Shift", {
  model: Shift,
  fields: {
    name: z.string().trim().min(2).max(100),
    startTime: time.default("09:30"),
    endTime: time.default("18:30"),
    graceMinutes: z.coerce.number().int().min(0).max(240).default(15),
    halfDayHours: z.coerce.number().min(0).max(24).default(4),
    fullDayHours: z.coerce.number().min(0).max(24).default(8),
    weeklyOff1: z.enum([...WEEKDAYS, ""]).default("SUNDAY"),
    weeklyOff2: z.enum([...WEEKDAYS, ""]).default(""),
    isDefault: z.coerce.boolean().default(false),
    notes,
    status,
  },
  searchFields: ["name"],
  filterFields: { name: "name" },
  sortableFields: ["name", "startTime", "createdAt"],
  defaultSort: "name",
  defaultSortDir: "asc",
});

const holidays = define("hr-holidays", "Holiday", {
  model: Holiday,
  fields: {
    name: z.string().trim().min(2).max(150),
    date: requiredDate,
    holidayType: z.enum(HOLIDAY_TYPES).default("PUBLIC"),
    calendarId: optionalRef,
    description: optionalText(500),
    status,
  },
  searchFields: ["name", "description"],
  filterFields: { name: "name", holidayType: "holidayType", calendarId: "calendarId" },
  sortableFields: ["date", "name", "createdAt"],
  defaultSort: "date",
  defaultSortDir: "asc",
  toDocument: documentConverter({ dates: ["date"], refs: ["calendarId"] }),
});

/** Holiday calendars ride on the holiday permissions so existing HR roles can use them at once. */
const holidayCalendars: ResourceDefinition = {
  ...define("hr-holiday-calendars", "Holiday calendar", {
    model: HolidayCalendar,
    autoCode: { field: "code", prefix: "HC", entityType: "HR_HOLIDAY_CALENDAR" },
    fields: {
      code: optionalCode,
      name: z.string().trim().min(2).max(100),
      isDefault: z.coerce.boolean().default(false),
      description: optionalText(500),
      status,
    },
    searchFields: ["name", "code"],
    filterFields: { code: "code", name: "name" },
    sortableFields: ["code", "name", "createdAt"],
    defaultSort: "name",
    defaultSortDir: "asc",
    afterWrite: async (ctx, _kind, doc) => keepSingleDefault(ctx.businessId, doc),
  }),
  permissions: { view: "hr-holidays.view", create: "hr-holidays.create", edit: "hr-holidays.edit", delete: "hr-holidays.delete" },
};

const leaveTypes = define("hr-leave-types", "Leave type", {
  model: LeaveType,
  fields: {
    code: z.string().trim().toUpperCase().min(1).max(10),
    name: z.string().trim().min(2).max(100),
    annualQuota: z.coerce.number().min(0).max(365).default(0),
    isPaid: z.coerce.boolean().default(true),
    allowHalfDay: z.coerce.boolean().default(true),
    carryForward: z.coerce.boolean().default(false),
    maxCarryForward: z.coerce.number().min(0).max(365).default(0),
    prorateForJoiners: z.coerce.boolean().default(true),
    encashable: z.coerce.boolean().default(false),
    allowNegative: z.coerce.boolean().default(false),
    description: optionalText(500),
    status,
  },
  searchFields: ["name", "code"],
  filterFields: { code: "code", name: "name" },
  sortableFields: ["code", "name", "annualQuota", "createdAt"],
  defaultSort: "code",
  defaultSortDir: "asc",
});

const leaveGroupLine = z.object({
  leaveTypeId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Choose a leave type"),
  annualQuota: z.coerce.number().min(0, "Days can't be negative").max(365),
});

/** Leave groups are leave policy, so they ride on the leave-type permissions. */
const leaveGroups: ResourceDefinition = {
  ...define("hr-leave-groups", "Leave group", {
    model: LeaveGroup,
    autoCode: { field: "code", prefix: "LG", entityType: "HR_LEAVE_GROUP" },
    fields: {
      code: optionalCode,
      name: z.string().trim().min(2).max(100),
      // Checked on the array itself so edits are held to it too (refine runs on create only).
      leaveTypes: z
        .array(leaveGroupLine)
        .max(50)
        .default([])
        .superRefine((lines, ctx) => {
          const seen = new Set<string>();
          lines.forEach((line, i) => {
            if (seen.has(line.leaveTypeId)) ctx.addIssue({ code: "custom", path: [i, "leaveTypeId"], message: "This leave type is already in the group" });
            seen.add(line.leaveTypeId);
          });
        }),
      description: optionalText(500),
      status,
    },
    searchFields: ["code", "name"],
    filterFields: { code: "code", name: "name" },
    sortableFields: ["code", "name", "createdAt"],
    defaultSort: "name",
    defaultSortDir: "asc",
    toDocument: documentConverter({ lines: { leaveTypes: { refs: ["leaveTypeId"] } } }),
  }),
  permissions: { view: "hr-leave-types.view", create: "hr-leave-types.create", edit: "hr-leave-types.edit", delete: "hr-leave-types.delete" },
};

const idRef = (message: string) => z.string().trim().regex(/^[a-f\d]{24}$/i, message);

/** "Assign Leave Group to Grade": leave policy, so it rides on the leave-type permissions. */
const gradeLeaveGroups: ResourceDefinition = {
  ...define("hr-grade-leave-groups", "Leave group assignment", {
    model: GradeLeaveGroup,
    fields: {
      leaveGroupId: idRef("Choose a leave group"),
      gradeId: idRef("Choose a grade"),
      notes: optionalText(300),
      status,
    },
    searchFields: ["notes"],
    filterFields: {},
    refFilters: {
      leaveGroup: { path: "leaveGroupId", model: LeaveGroup, field: "name" },
      grade: { path: "gradeId", model: HrGrade, field: "name" },
    },
    sortableFields: ["createdAt"],
    defaultSort: "createdAt",
    defaultSortDir: "asc",
    beforeList: migrateLegacyGradeGroups,
    validateCreate: async (ctx, _side, input) => assertGradeGroupAllowed(ctx, input.gradeId, input.leaveGroupId),
    validateUpdate: async (ctx, _side, before, input) =>
      assertGradeGroupAllowed(ctx, input.gradeId && String(input.gradeId) !== String(before.gradeId) ? input.gradeId : null, input.leaveGroupId, before._id),
    toDocument: documentConverter({ refs: ["gradeId", "leaveGroupId"] }),
  }),
  permissions: { view: "hr-leave-types.view", create: "hr-leave-types.create", edit: "hr-leave-types.edit", delete: "hr-leave-types.delete" },
};

/** Reasons for attendance correction requests; they ride on the attendance permissions. */
const attendanceReasons: ResourceDefinition = {
  ...define("hr-attendance-reasons", "Attendance reason", {
    model: AttendanceReason,
    fields: {
      name: z.string().trim().min(2).max(100),
      description: optionalText(300),
      status,
    },
    searchFields: ["name"],
    filterFields: { name: "name", reasonType: "reasonType" },
    sortableFields: ["name", "reasonType", "createdAt"],
    defaultSort: "name",
    defaultSortDir: "asc",
    beforeList: ensureAttendanceReasons,
  }),
  permissions: { view: "hr-attendance.view", create: "hr-attendance.edit", edit: "hr-attendance.edit", delete: "hr-attendance.edit" },
};

const announcements = define("hr-announcements", "Announcement", {
  model: Announcement,
  fields: {
    title: z.string().trim().min(2).max(200),
    message: z.string().trim().min(2).max(5000),
    publishDate: requiredDate,
    expiryDate: optionalDate,
    pinned: z.coerce.boolean().default(false),
    status,
  },
  refine: dateOrder("publishDate", "expiryDate", "Expiry is before the publish date"),
  searchFields: ["title", "message"],
  filterFields: { title: "title" },
  sortableFields: ["publishDate", "title", "createdAt"],
  defaultSort: "publishDate",
  defaultSortDir: "desc",
  toDocument: documentConverter({ dates: ["publishDate", "expiryDate"] }),
});

/* ------------------------------------------------------------------ */
/* Employees                                                           */
/* ------------------------------------------------------------------ */

/**
 * Refuses new employees beyond the subscription's limit. Only people still
 * on the rolls count — resigned or deleted employees free their seat.
 */
export async function assertEmployeeSeats(businessId: Types.ObjectId, adding: number): Promise<void> {
  const business = await Business.findById(businessId, { maxEmployees: 1 }).lean<{ maxEmployees?: number | null }>();
  const limit = business?.maxEmployees;
  if (limit === null || limit === undefined) return;
  const current = await Employee.countDocuments({ businessId, deletedAt: null, employmentStatus: { $in: WORKING_STATUSES } });
  if (current + adding > limit) {
    throw AppError.forbidden(
      `Your plan allows ${limit} active employee${limit === 1 ? "" : "s"} and you have ${current}. Contact your provider to raise the limit.`,
      "EMPLOYEE_LIMIT_REACHED"
    );
  }
}

const employees = define("hr-employees", "Employee", {
  model: Employee,
  autoCode: { field: "employeeCode", prefix: "EMP", entityType: "HR_EMPLOYEE" },
  fields: {
    // Linked team member (see sideFields)
    userId: z.string().trim().max(40).optional().or(z.literal("")),
    employeeCode: optionalCode,
    name: z.string().trim().min(2).max(150),
    gender: z.enum([...GENDERS_HR, ""]).default(""),
    dateOfBirth: optionalDate,
    maritalStatus: z.enum([...MARITAL_STATUSES, ""]).default(""),
    bloodGroup: optionalText(5),
    fatherOrSpouseName: optionalText(150),
    workEmail: optionalEmail,
    personalEmail: optionalEmail,
    phone: optionalText(20),
    emergencyContactName: optionalText(150),
    emergencyContactPhone: optionalText(20),
    currentAddress: optionalText(500),
    permanentAddress: optionalText(500),

    departmentId: optionalRef,
    designationId: optionalRef,
    gradeId: optionalRef,
    reportingManagerId: optionalRef,
    shiftId: optionalRef,
    holidayCalendarId: optionalRef,
    branchId: optionalRef,
    workLocation: optionalText(120),
    employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
    employmentStatus: z.enum(EMPLOYMENT_STATUSES).default("PROBATION"),
    dateOfJoining: requiredDate,
    probationEndDate: optionalDate,
    confirmationDate: optionalDate,
    dateOfExit: optionalDate,
    exitReason: optionalText(500),

    panNumber: z.string().trim().toUpperCase().regex(/^([A-Z]{5}\d{4}[A-Z])?$/, "PAN looks like ABCDE1234F").optional(),
    aadhaarNumber: z.string().trim().regex(/^(\d{12})?$/, "Aadhaar is 12 digits").optional(),
    uanNumber: z.string().trim().regex(/^(\d{12})?$/, "UAN is 12 digits").optional(),
    pfNumber: optionalText(30),
    esiNumber: optionalText(20),

    salaryPaymentMode: z.enum(SALARY_PAYMENT_MODES).default("BANK"),
    bankName: optionalText(120),
    bankAccountNumber: optionalText(30),
    ifscCode: z.string().trim().toUpperCase().regex(/^([A-Z]{4}0[A-Z0-9]{6})?$/, "IFSC looks like HDFC0001234").optional(),

    basic: money,
    hra: money,
    conveyance: money,
    specialAllowance: money,
    otherAllowance: money,
    pfApplicable: z.coerce.boolean().default(true),
    esiApplicable: z.coerce.boolean().default(false),
    ptApplicable: z.coerce.boolean().default(true),
    professionalTax: moneyStringSchema.default("200"),
    monthlyTds: money,
    notes,
    status,
  },
  refine: dateOrder("dateOfJoining", "dateOfExit", "Exit date is before the joining date"),
  searchFields: ["name", "employeeCode", "workEmail", "phone", "panNumber"],
  filterFields: {
    employeeCode: "employeeCode",
    name: "name",
    phone: "phone",
    workEmail: "workEmail",
    employmentStatus: "employmentStatus",
    employmentType: "employmentType",
  },
  sortableFields: ["employeeCode", "name", "dateOfJoining", "employmentStatus", "createdAt"],
  defaultSort: "employeeCode",
  defaultSortDir: "asc",
  beforeCreate: assertEmployeeSeats,
  // The "Existing user" picker: linking a team member has its own permission and checks, so it is not a plain field write.
  sideFields: ["userId"],
  validateCreate: async (ctx, side) => {
    const userId = linkedUserFrom(side);
    if (userId) await checkUserLink(ctx, userId);
  },
  validateUpdate: async (ctx, side, before) => {
    const userId = linkedUserFrom(side);
    if (userId !== undefined && userId !== (before.userId ? String(before.userId) : "")) await checkUserLink(ctx, userId, before._id);
  },
  // Salary and job edits made on the form are logged in the employee's history.
  afterWrite: async (ctx, kind, doc, before, side) => {
    await recordFormWrite(ctx, kind, doc, before);
    const userId = linkedUserFrom(side);
    if (userId !== undefined) await linkUser(ctx, doc, userId);
  },
  toDocument: documentConverter({
    money: ["basic", "hra", "conveyance", "specialAllowance", "otherAllowance", "professionalTax", "monthlyTds"],
    refs: ["departmentId", "designationId", "gradeId", "reportingManagerId", "shiftId", "holidayCalendarId", "branchId"],
    dates: ["dateOfBirth", "dateOfJoining", "probationEndDate", "confirmationDate", "dateOfExit"],
  }),
});

/* ------------------------------------------------------------------ */
/* Talent & assets                                                     */
/* ------------------------------------------------------------------ */

const jobOpenings = define("hr-job-openings", "Job opening", {
  model: JobOpening,
  autoCode: { field: "code", prefix: "JOB", entityType: "HR_JOB_OPENING" },
  fields: {
    code: optionalCode,
    title: z.string().trim().min(2).max(150),
    departmentId: optionalRef,
    designationId: optionalRef,
    positions: z.coerce.number().int().min(1).max(1000).default(1),
    location: optionalText(120),
    employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
    experience: optionalText(60),
    budgetCtc: money,
    openingStatus: z.enum(OPENING_STATUSES).default("OPEN"),
    closingDate: optionalDate,
    description: optionalText(5000),
    status,
  },
  searchFields: ["title", "code", "location"],
  filterFields: { code: "code", title: "title", openingStatus: "openingStatus" },
  sortableFields: ["code", "title", "closingDate", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ money: ["budgetCtc"], refs: ["departmentId", "designationId"], dates: ["closingDate"] }),
});

const candidates = define("hr-candidates", "Candidate", {
  model: Candidate,
  autoCode: { field: "code", prefix: "CAN", entityType: "HR_CANDIDATE" },
  fields: {
    code: optionalCode,
    name: z.string().trim().min(2).max(150),
    email: optionalEmail,
    phone: optionalText(20),
    jobOpeningId: optionalRef,
    stage: z.enum(CANDIDATE_STAGES).default("APPLIED"),
    source: optionalText(60),
    currentCompany: optionalText(150),
    experienceYears: z.coerce.number().min(0).max(60).default(0),
    currentCtc: money,
    expectedCtc: money,
    noticePeriodDays: z.coerce.number().int().min(0).max(365).default(0),
    interviewDate: optionalDate,
    resumeUrl: optionalText(500),
    notes,
    status,
  },
  searchFields: ["name", "code", "email", "phone", "currentCompany"],
  filterFields: { code: "code", name: "name", stage: "stage", email: "email" },
  sortableFields: ["code", "name", "stage", "interviewDate", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ money: ["currentCtc", "expectedCtc"], refs: ["jobOpeningId"], dates: ["interviewDate"] }),
});

const assets = define("hr-assets", "Asset", {
  model: HrAsset,
  autoCode: { field: "assetTag", prefix: "AST", entityType: "HR_ASSET" },
  fields: {
    assetTag: optionalCode,
    name: z.string().trim().min(2).max(150),
    category: optionalText(60),
    serialNumber: optionalText(80),
    employeeId: optionalRef,
    assignedDate: optionalDate,
    returnedDate: optionalDate,
    condition: z.enum(ASSET_CONDITIONS).default("GOOD"),
    value: money,
    notes,
    status,
  },
  refine: dateOrder("assignedDate", "returnedDate", "Return date is before the assigned date"),
  searchFields: ["name", "assetTag", "serialNumber", "category"],
  filterFields: { assetTag: "assetTag", name: "name", category: "category" },
  sortableFields: ["assetTag", "name", "assignedDate", "createdAt"],
  defaultSort: "assetTag",
  defaultSortDir: "asc",
  toDocument: documentConverter({ money: ["value"], refs: ["employeeId"], dates: ["assignedDate", "returnedDate"] }),
});

const appraisals = define("hr-appraisals", "Appraisal", {
  model: Appraisal,
  autoCode: { field: "code", prefix: "APR", entityType: "HR_APPRAISAL" },
  fields: {
    code: optionalCode,
    employeeId: z.string().trim().min(1, "Choose the employee"),
    reviewerId: optionalRef,
    period: z.string().trim().min(2).max(60),
    stage: z.enum(APPRAISAL_STAGES).default("DRAFT"),
    goals: optionalText(5000),
    selfRating: z.coerce.number().min(0).max(5).default(0),
    managerRating: z.coerce.number().min(0).max(5).default(0),
    strengths: optionalText(3000),
    improvements: optionalText(3000),
    recommendedIncrementPercent: z.coerce.number().min(0).max(100).default(0),
    notes,
    status,
  },
  searchFields: ["code", "period"],
  filterFields: { code: "code", period: "period", stage: "stage" },
  sortableFields: ["code", "period", "managerRating", "createdAt"],
  defaultSort: "createdAt",
  defaultSortDir: "desc",
  toDocument: documentConverter({ refs: ["employeeId", "reviewerId"] }),
});

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

/** Variable pay components ride on the payroll permissions so existing HR roles can use them at once. */
const payComponents: ResourceDefinition = {
  ...define("hr-pay-components", "Pay component", {
    model: PayComponent,
    fields: {
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,12}$/, "2–12 letters, digits or _"),
      name: z.string().trim().min(2).max(60),
      kind: z.enum(PAY_COMPONENT_KINDS).default("EARNING"),
      esiApplicable: z.coerce.boolean().default(true),
      description: optionalText(300),
      status,
    },
    searchFields: ["code", "name"],
    filterFields: { code: "code", name: "name", kind: "kind" },
    sortableFields: ["code", "name", "kind", "createdAt"],
    defaultSort: "code",
    defaultSortDir: "asc",
  }),
  permissions: { view: "hr-payroll.view", create: "hr-payroll.process", edit: "hr-payroll.process", delete: "hr-payroll.process" },
};

export const HR_RESOURCES: Record<string, ResourceDefinition> = {
  "hr-pay-components": payComponents,
  "hr-departments": departments,
  "hr-designations": designations,
  "hr-grades": grades,
  "hr-shifts": shifts,
  "hr-holidays": holidays,
  "hr-holiday-calendars": holidayCalendars,
  "hr-leave-types": leaveTypes,
  "hr-leave-groups": leaveGroups,
  "hr-grade-leave-groups": gradeLeaveGroups,
  "hr-attendance-reasons": attendanceReasons,
  "hr-announcements": announcements,
  "hr-employees": employees,
  "hr-job-openings": jobOpenings,
  "hr-candidates": candidates,
  "hr-assets": assets,
  "hr-appraisals": appraisals,
};
