import { Schema, model, models, type Model } from "mongoose";
import { defineMasterModel } from "./shared/masterSchema";

/**
 * HRMS data. Masters (departments, designations, shifts, holidays, leave
 * types, employees, recruitment, assets, appraisals, announcements) use the
 * generic master framework; transactions (attendance, leave applications,
 * payroll, loans, claims) have their own schemas and services under
 * src/lib/hr.
 *
 * Every collection is tenant-scoped by businessId.
 */

export const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;
export const GENDERS_HR = ["MALE", "FEMALE", "OTHER"] as const;
export const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"] as const;
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"] as const;
export const EMPLOYMENT_STATUSES = ["PROBATION", "CONFIRMED", "ON_NOTICE", "RESIGNED", "TERMINATED", "RETIRED"] as const;
/** Employment statuses that are still on the payroll and attendance sheet. */
export const WORKING_STATUSES = ["PROBATION", "CONFIRMED", "ON_NOTICE"] as const;
export const SALARY_PAYMENT_MODES = ["BANK", "CASH", "CHEQUE"] as const;
export const HOLIDAY_TYPES = ["PUBLIC", "OPTIONAL", "COMPANY"] as const;
export const CANDIDATE_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFERED", "HIRED", "REJECTED", "WITHDRAWN"] as const;
export const OPENING_STATUSES = ["OPEN", "ON_HOLD", "CLOSED"] as const;
export const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const;
export const APPRAISAL_STAGES = ["DRAFT", "SELF_REVIEW", "MANAGER_REVIEW", "COMPLETED"] as const;

const money = { type: Schema.Types.Decimal128, default: "0" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defineHrModel(name: string, schema: Schema): Model<any> {
  return models[name] ?? model(name, schema);
}

/* ------------------------------------------------------------------ */
/* Organisation masters                                                */
/* ------------------------------------------------------------------ */

export const HrDepartment = defineMasterModel(
  "HrDepartment",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    headEmployeeId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    costCenter: { type: String, trim: true },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
);

export const Designation = defineMasterModel(
  "Designation",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
);

/**
 * An employee grade or band (L1, L2…). The grade decides the employee's leave
 * entitlement through the leave group assigned to it (GradeLeaveGroup).
 */
export const HrGrade = defineMasterModel(
  "HrGrade",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    /** Legacy: where a grade's leave group was kept before GradeLeaveGroup; moved there and cleared on first use. */
    leaveGroupId: { type: Schema.Types.ObjectId, ref: "LeaveGroup", default: null },
    description: { type: String, trim: true },
  },
  { uniqueField: "code", indexes: [{ leaveGroupId: 1 }] }
);

/** "Assign Leave Group to Grade": the leave group a grade follows. One live row per grade. */
export const GradeLeaveGroup = defineMasterModel(
  "GradeLeaveGroup",
  {
    gradeId: { type: Schema.Types.ObjectId, ref: "HrGrade", required: true },
    leaveGroupId: { type: Schema.Types.ObjectId, ref: "LeaveGroup", required: true },
    notes: { type: String, trim: true },
  },
  { uniqueField: "gradeId", indexes: [{ leaveGroupId: 1 }] }
);

export const Shift = defineMasterModel("Shift", {
  name: { type: String, required: true, trim: true },
  /** "HH:mm", 24-hour. */
  startTime: { type: String, required: true, default: "09:30" },
  endTime: { type: String, required: true, default: "18:30" },
  graceMinutes: { type: Number, default: 15, min: 0 },
  /** Fewer worked hours than this marks the day a half day. */
  halfDayHours: { type: Number, default: 4, min: 0 },
  /** At least this many worked hours is a full day. */
  fullDayHours: { type: Number, default: 8, min: 0 },
  weeklyOff1: { type: String, enum: [...WEEKDAYS, ""], default: "SUNDAY" },
  weeklyOff2: { type: String, enum: [...WEEKDAYS, ""], default: "" },
  isDefault: { type: Boolean, default: false },
  notes: { type: String, trim: true },
});

/**
 * A set of holidays for a group of employees, e.g. a state or a site. An
 * employee follows their own calendar (Employee.holidayCalendarId) or, with
 * none, the default one. Holidays on no calendar apply to everyone.
 */
export const HolidayCalendar = defineMasterModel(
  "HolidayCalendar",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    /** Followed by employees who have no calendar of their own; at most one. */
    isDefault: { type: Boolean, default: false },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
);

export const Holiday = defineMasterModel(
  "Holiday",
  {
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    holidayType: { type: String, enum: HOLIDAY_TYPES, default: "PUBLIC" },
    /** The calendar it belongs to; null = every employee gets it. */
    calendarId: { type: Schema.Types.ObjectId, ref: "HolidayCalendar", default: null },
    description: { type: String, trim: true },
  },
  { indexes: [{ date: 1 }, { calendarId: 1, date: 1 }] }
);

export const LeaveType = defineMasterModel(
  "LeaveType",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    /** Days granted per calendar year. */
    annualQuota: { type: Number, default: 0, min: 0 },
    isPaid: { type: Boolean, default: true },
    allowHalfDay: { type: Boolean, default: true },
    carryForward: { type: Boolean, default: false },
    /** Most days carried into the next year; 0 = no limit. */
    maxCarryForward: { type: Number, default: 0, min: 0 },
    /** Employees who join during a year get the quota for the months left (rounded to half days). */
    prorateForJoiners: { type: Boolean, default: true },
    encashable: { type: Boolean, default: false },
    /** Lets a balance go below zero (e.g. loss of pay, which has no quota). */
    allowNegative: { type: Boolean, default: false },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
);

/**
 * A set of leave types with the days a year each one grants. Employees whose
 * grade is assigned to the group get these days instead of each leave type's
 * own quota; a leave type left out of the group grants them none.
 */
export const LeaveGroup = defineMasterModel(
  "LeaveGroup",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    leaveTypes: {
      type: [
        new Schema(
          {
            leaveTypeId: { type: Schema.Types.ObjectId, ref: "LeaveType", required: true },
            annualQuota: { type: Number, required: true, min: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
);

export const Announcement = defineMasterModel(
  "Announcement",
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    publishDate: { type: Date, required: true },
    expiryDate: { type: Date, default: null },
    pinned: { type: Boolean, default: false },
  },
  { indexes: [{ publishDate: -1 }] }
);

/* ------------------------------------------------------------------ */
/* Employee                                                            */
/* ------------------------------------------------------------------ */

export const Employee = defineMasterModel(
  "Employee",
  {
    employeeCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    gender: { type: String, enum: [...GENDERS_HR, ""], default: "" },
    dateOfBirth: { type: Date, default: null },
    maritalStatus: { type: String, enum: [...MARITAL_STATUSES, ""], default: "" },
    bloodGroup: { type: String, trim: true },
    fatherOrSpouseName: { type: String, trim: true },
    workEmail: { type: String, trim: true, lowercase: true },
    personalEmail: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    emergencyContactName: { type: String, trim: true },
    emergencyContactPhone: { type: String, trim: true },
    currentAddress: { type: String, trim: true },
    permanentAddress: { type: String, trim: true },

    departmentId: { type: Schema.Types.ObjectId, ref: "HrDepartment", default: null },
    designationId: { type: Schema.Types.ObjectId, ref: "Designation", default: null },
    /** Grade / band; its leave group sets the employee's leave entitlement. */
    gradeId: { type: Schema.Types.ObjectId, ref: "HrGrade", default: null },
    reportingManagerId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift", default: null },
    /** Whose holidays they get; null = the default holiday calendar. */
    holidayCalendarId: { type: Schema.Types.ObjectId, ref: "HolidayCalendar", default: null },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    workLocation: { type: String, trim: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "FULL_TIME" },
    employmentStatus: { type: String, enum: EMPLOYMENT_STATUSES, default: "PROBATION" },
    dateOfJoining: { type: Date, required: true },
    probationEndDate: { type: Date, default: null },
    confirmationDate: { type: Date, default: null },
    dateOfExit: { type: Date, default: null },
    exitReason: { type: String, trim: true },

    panNumber: { type: String, trim: true, uppercase: true },
    aadhaarNumber: { type: String, trim: true },
    uanNumber: { type: String, trim: true },
    pfNumber: { type: String, trim: true, uppercase: true },
    esiNumber: { type: String, trim: true },

    salaryPaymentMode: { type: String, enum: SALARY_PAYMENT_MODES, default: "BANK" },
    bankName: { type: String, trim: true },
    bankAccountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true, uppercase: true },

    /** Monthly salary structure (full month, before loss-of-pay proration). */
    basic: money,
    hra: money,
    conveyance: money,
    specialAllowance: money,
    otherAllowance: money,
    pfApplicable: { type: Boolean, default: true },
    esiApplicable: { type: Boolean, default: false },
    ptApplicable: { type: Boolean, default: true },
    professionalTax: { type: Schema.Types.Decimal128, default: "200" },
    monthlyTds: money,

    /** Login for the self-service portal, when one has been granted. */
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** When the photo (EmployeePhoto) was last set; null = no photo. Also versions the image URL. */
    photoUpdatedAt: { type: Date, default: null },
    notes: { type: String, trim: true },
  },
  {
    uniqueField: "employeeCode",
    indexes: [{ departmentId: 1 }, { employmentStatus: 1 }, { userId: 1 }, { reportingManagerId: 1 }, { gradeId: 1 }, { holidayCalendarId: 1 }],
  }
);

/**
 * An employee's photo, one per employee. The bytes live here rather than on
 * the Employee so lists and exports never carry them; `data` is only read
 * when the image itself is asked for.
 */
export const EmployeePhoto = defineHrModel(
  "EmployeePhoto",
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
      mimeType: { type: String, required: true },
      size: { type: Number, required: true },
      data: { type: Buffer, required: true, select: false },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  ).index({ businessId: 1, employeeId: 1 }, { unique: true })
);

/* ------------------------------------------------------------------ */
/* Variable pay                                                        */
/* ------------------------------------------------------------------ */

export const PAY_COMPONENT_KINDS = ["EARNING", "DEDUCTION"] as const;

/** A one-off pay item entered month by month: bonus, incentive, overtime, canteen recovery… */
export const PayComponent = defineMasterModel(
  "PayComponent",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: PAY_COMPONENT_KINDS, default: "EARNING" },
    /** Earnings only: counted in ESI wages. */
    esiApplicable: { type: Boolean, default: true },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
);

/** One employee's amount of one variable component for one month. */
export const PayrollVariable = defineHrModel(
  "PayrollVariable",
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
      componentId: { type: Schema.Types.ObjectId, ref: "PayComponent", required: true },
      year: { type: Number, required: true },
      month: { type: Number, required: true, min: 1, max: 12 },
      amount: { type: Schema.Types.Decimal128, required: true },
      note: { type: String, trim: true, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  )
    .index({ businessId: 1, year: 1, month: 1, employeeId: 1, componentId: 1 }, { unique: true })
    .index({ businessId: 1, componentId: 1 })
);

/** A salary hold: the employee is left out of that month's payroll until unblocked. */
export const PayrollHold = defineHrModel(
  "PayrollHold",
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
      year: { type: Number, required: true },
      month: { type: Number, required: true, min: 1, max: 12 },
      reason: { type: String, trim: true, required: true },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  ).index({ businessId: 1, year: 1, month: 1, employeeId: 1 }, { unique: true })
);

export const ARREAR_KINDS = ["INCREMENT", "DAY", "DA"] as const;

/** Pay owed for months whose payroll is already approved; paid as an earning in the next payroll. */
export const PayrollArrear = defineHrModel(
  "PayrollArrear",
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
      kind: { type: String, enum: ARREAR_KINDS, required: true },
      /** The month (or range of months) the arrear is for. */
      fromYear: { type: Number, required: true },
      fromMonth: { type: Number, required: true },
      toYear: { type: Number, required: true },
      toMonth: { type: Number, required: true },
      amount: { type: Schema.Types.Decimal128, required: true },
      breakdown: {
        type: [new Schema({ code: String, label: String, amount: Schema.Types.Decimal128 }, { _id: false })],
        default: [],
      },
      /** DAY: loss-of-pay days paid back. */
      days: { type: Number, default: null },
      /** DA: percentage of basic. */
      percent: { type: Number, default: null },
      reason: { type: String, trim: true, default: "" },
      /** INCREMENT: the backdated salary revision that caused it. */
      sourceChangeId: { type: Schema.Types.ObjectId, ref: "EmploymentChange", default: null },
      status: { type: String, enum: ["PENDING", "INCLUDED", "CANCELLED"], default: "PENDING" },
      /** The payroll run that paid it. */
      payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", default: null },
      /** Or the full & final settlement that paid it. */
      fnfSettlementId: { type: Schema.Types.ObjectId, ref: "FnfSettlement", default: null },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  )
    .index({ businessId: 1, status: 1, employeeId: 1 })
    .index({ businessId: 1, sourceChangeId: 1 })
    .index({ businessId: 1, payrollRunId: 1 })
);

export const SEPARATION_TYPES = ["RESIGNED", "TERMINATED", "RETIRED"] as const;
export const NOTICE_TREATMENTS = ["RECOVER", "PAY", "WAIVE"] as const;
export const FNF_STATUSES = ["DRAFT", "APPROVED", "PAID", "CANCELLED"] as const;

const fnfLineSchema = new Schema(
  {
    code: { type: String, required: true },
    label: { type: String, required: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    note: { type: String, default: "" },
    manual: { type: Boolean, default: false },
  },
  { _id: false }
);

/** Full and final settlement of a leaving employee: last salary, encashment, gratuity, recoveries. */
export const FnfSettlement = defineHrModel(
  "FnfSettlement",
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      settlementNumber: { type: String, required: true },
      employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
      separationType: { type: String, enum: SEPARATION_TYPES, required: true },
      resignationDate: { type: Date, default: null },
      lastWorkingDay: { type: Date, required: true },
      exitReason: { type: String, trim: true, default: "" },
      noticeDays: { type: Number, default: 0, min: 0 },
      noticeServedDays: { type: Number, default: 0 },
      noticeShortfallDays: { type: Number, default: 0 },
      noticeTreatment: { type: String, enum: NOTICE_TREATMENTS, default: "RECOVER" },
      /** First month whose salary the settlement pays (the month after the last approved payroll). */
      salaryFromYear: { type: Number, required: true },
      salaryFromMonth: { type: Number, required: true },
      gratuity: {
        eligible: { type: Boolean, default: false },
        completedYears: { type: Number, default: 0 },
        service: { type: String, default: "" },
        basic: money,
        amount: money,
      },
      leaveEncashment: { days: { type: Number, default: 0 }, ratePerDay: money },
      earnings: { type: [fnfLineSchema], default: [] },
      deductions: { type: [fnfLineSchema], default: [] },
      /** Lines HR adds by hand (kind EARNING / DEDUCTION); kept across recalculations. */
      manualLines: {
        type: [new Schema({ kind: { type: String, enum: ["EARNING", "DEDUCTION"], required: true }, label: { type: String, required: true }, amount: { type: Schema.Types.Decimal128, required: true } }, { _id: false })],
        default: [],
      },
      totalEarnings: money,
      totalDeductions: money,
      netPayable: money,
      loanRecoveries: { type: [new Schema({ loanId: { type: Schema.Types.ObjectId, ref: "EmployeeLoan" }, amount: Schema.Types.Decimal128 }, { _id: false })], default: [] },
      arrearIds: { type: [Schema.Types.ObjectId], ref: "PayrollArrear", default: [] },
      assetsPending: { type: [new Schema({ assetTag: String, name: String }, { _id: false })], default: [] },
      status: { type: String, enum: FNF_STATUSES, default: "DRAFT" },
      approvedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
      approvedAt: { type: Date, default: null },
      paidAt: { type: Date, default: null },
      paymentReference: { type: String, trim: true, default: "" },
      cancelReason: { type: String, trim: true, default: "" },
      notes: { type: String, trim: true, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  )
    .index({ businessId: 1, settlementNumber: 1 }, { unique: true })
    .index({ businessId: 1, employeeId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["DRAFT", "APPROVED", "PAID"] } } })
    .index({ businessId: 1, status: 1, createdAt: -1 })
);

/* ------------------------------------------------------------------ */
/* Employment history                                                  */
/* ------------------------------------------------------------------ */

export const EMPLOYMENT_CHANGE_TYPES = ["JOINED", "SALARY_REVISION", "PROMOTION", "TRANSFER", "STATUS_CHANGE", "CORRECTION"] as const;
export type EmploymentChangeType = (typeof EMPLOYMENT_CHANGE_TYPES)[number];

/** Fields whose history is kept: job placement and the salary structure. */
export const HISTORY_REF_FIELDS = ["departmentId", "designationId", "reportingManagerId", "branchId"] as const;
export const HISTORY_TEXT_FIELDS = ["workLocation", "employmentType", "employmentStatus"] as const;
export const HISTORY_MONEY_FIELDS = ["basic", "hra", "conveyance", "specialAllowance", "otherAllowance", "professionalTax", "monthlyTds"] as const;
export const HISTORY_FLAG_FIELDS = ["pfApplicable", "esiApplicable", "ptApplicable"] as const;

/**
 * One dated change to an employee's job or salary. `values` is the complete
 * set of tracked fields from `effectiveDate` on, so "what applied on day X"
 * is the latest change on or before X. The Employee record mirrors the
 * state as of today; future-dated changes wait (`applied: false`).
 */
export const EmploymentChange = defineHrModel(
  "EmploymentChange",
  new Schema(
    {
      businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
      employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
      effectiveDate: { type: Date, required: true },
      changeType: { type: String, enum: EMPLOYMENT_CHANGE_TYPES, required: true },
      values: {
        departmentId: { type: Schema.Types.ObjectId, ref: "HrDepartment", default: null },
        designationId: { type: Schema.Types.ObjectId, ref: "Designation", default: null },
        reportingManagerId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
        branchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
        workLocation: { type: String, default: "" },
        employmentType: { type: String, default: "" },
        employmentStatus: { type: String, default: "" },
        basic: money,
        hra: money,
        conveyance: money,
        specialAllowance: money,
        otherAllowance: money,
        professionalTax: money,
        monthlyTds: money,
        pfApplicable: { type: Boolean, default: true },
        esiApplicable: { type: Boolean, default: false },
        ptApplicable: { type: Boolean, default: true },
      },
      /** Which tracked fields this change set (the rest carry over). */
      changedFields: { type: [String], default: [] },
      reason: { type: String, trim: true, default: "" },
      /** BASELINE = the record as it stood when history began; FORM = an edit of the employee record. */
      source: { type: String, enum: ["BASELINE", "HISTORY", "FORM"], default: "HISTORY" },
      /** Copied onto the Employee record (false while a future-dated change waits). */
      applied: { type: Boolean, default: false },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  ).index({ businessId: 1, employeeId: 1, effectiveDate: 1, createdAt: 1 })
   .index({ businessId: 1, applied: 1, effectiveDate: 1 })
);

/* ------------------------------------------------------------------ */
/* Recruitment, assets, performance                                    */
/* ------------------------------------------------------------------ */

export const JobOpening = defineMasterModel(
  "JobOpening",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "HrDepartment", default: null },
    designationId: { type: Schema.Types.ObjectId, ref: "Designation", default: null },
    positions: { type: Number, default: 1, min: 1 },
    location: { type: String, trim: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "FULL_TIME" },
    experience: { type: String, trim: true },
    budgetCtc: money,
    openingStatus: { type: String, enum: OPENING_STATUSES, default: "OPEN" },
    closingDate: { type: Date, default: null },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
);

export const Candidate = defineMasterModel(
  "Candidate",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    jobOpeningId: { type: Schema.Types.ObjectId, ref: "JobOpening", default: null },
    stage: { type: String, enum: CANDIDATE_STAGES, default: "APPLIED" },
    source: { type: String, trim: true },
    currentCompany: { type: String, trim: true },
    experienceYears: { type: Number, default: 0, min: 0 },
    currentCtc: money,
    expectedCtc: money,
    noticePeriodDays: { type: Number, default: 0, min: 0 },
    interviewDate: { type: Date, default: null },
    resumeUrl: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { uniqueField: "code", indexes: [{ jobOpeningId: 1 }, { stage: 1 }] }
);

export const HrAsset = defineMasterModel(
  "HrAsset",
  {
    assetTag: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    serialNumber: { type: String, trim: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    assignedDate: { type: Date, default: null },
    returnedDate: { type: Date, default: null },
    condition: { type: String, enum: ASSET_CONDITIONS, default: "GOOD" },
    value: money,
    notes: { type: String, trim: true },
  },
  { uniqueField: "assetTag", indexes: [{ employeeId: 1 }] }
);

export const Appraisal = defineMasterModel(
  "Appraisal",
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    period: { type: String, required: true, trim: true },
    stage: { type: String, enum: APPRAISAL_STAGES, default: "DRAFT" },
    goals: { type: String, trim: true },
    selfRating: { type: Number, min: 0, max: 5, default: 0 },
    managerRating: { type: Number, min: 0, max: 5, default: 0 },
    strengths: { type: String, trim: true },
    improvements: { type: String, trim: true },
    recommendedIncrementPercent: { type: Number, min: 0, max: 100, default: 0 },
    notes: { type: String, trim: true },
  },
  { uniqueField: "code", indexes: [{ employeeId: 1 }] }
);

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defineModel(name: string, schema: Schema): Model<any> {
  return models[name] ?? model(name, schema);
}

const audit = {
  createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
};

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEKLY_OFF", "ON_DUTY"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_SOURCES = ["MANUAL", "SELF", "LEAVE", "REQUEST"] as const;

/** One row per employee per day. `date` is stored as UTC midnight of the calendar day. */
const attendanceSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    /** "HH:mm" local times, as entered or punched. */
    checkIn: { type: String, default: "" },
    checkOut: { type: String, default: "" },
    workedMinutes: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    source: { type: String, enum: ATTENDANCE_SOURCES, default: "MANUAL" },
    leaveApplicationId: { type: Schema.Types.ObjectId, ref: "LeaveApplication", default: null },
    /** Paid leave counts as paid; loss-of-pay leave does not. */
    leaveIsPaid: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: "" },
    ...audit,
  },
  { timestamps: true }
);
attendanceSchema.index({ businessId: 1, employeeId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ businessId: 1, date: 1 });
export const Attendance = defineModel("Attendance", attendanceSchema);

export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

const leaveApplicationSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    leaveNumber: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: "LeaveType", required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    halfDay: { type: Boolean, default: false },
    /** Working days the leave covers (weekly offs and holidays excluded). */
    days: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, default: "" },
    status: { type: String, enum: LEAVE_STATUSES, default: "PENDING" },
    appliedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    /** Who decided: HR (leave approvers) or the employee's reporting manager. Empty while pending. */
    decidedAs: { type: String, enum: ["", "HR", "MANAGER"], default: "" },
    decisionNote: { type: String, trim: true, default: "" },
    ...audit,
  },
  { timestamps: true }
);
leaveApplicationSchema.index({ businessId: 1, leaveNumber: 1 }, { unique: true });
leaveApplicationSchema.index({ businessId: 1, employeeId: 1, fromDate: -1 });
leaveApplicationSchema.index({ businessId: 1, status: 1, createdAt: -1 });
export const LeaveApplication = defineModel("LeaveApplication", leaveApplicationSchema);

/** Days granted for one leave type in one calendar year; overrides the leave type's quota. */
const leaveAllocationSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: "LeaveType", required: true },
    year: { type: Number, required: true },
    /** Days granted for the year; null = the leave type's quota (pro-rated for joiners). */
    allocated: { type: Number, default: null, min: 0 },
    carriedForward: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: "" },
    ...audit,
  },
  { timestamps: true }
);
leaveAllocationSchema.index({ businessId: 1, employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
export const LeaveAllocation = defineModel("LeaveAllocation", leaveAllocationSchema);

export const ATTENDANCE_REASON_TYPES = ["SYSTEM", "USER"] as const;

/** A reason an employee picks when asking for an attendance correction ("Forgot to Punch", "On Client Visit"…). */
export const AttendanceReason = defineMasterModel(
  "AttendanceReason",
  {
    name: { type: String, required: true, trim: true },
    /** SYSTEM = seeded with the workspace; USER = added by HR. */
    reasonType: { type: String, enum: ATTENDANCE_REASON_TYPES, default: "USER" },
    description: { type: String, trim: true },
  },
  { uniqueField: "name" }
);

/** What an employee can ask a day to be corrected to. Absence and leave go through HR or a leave request. */
export const CORRECTION_STATUSES = ["PRESENT", "HALF_DAY", "ON_DUTY"] as const;
export const ATTENDANCE_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

/** An employee's request to correct one day's attendance (a missed punch, on-duty work, wrong times). */
const attendanceRequestSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    requestNumber: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    /** UTC midnight of the day being corrected. */
    date: { type: Date, required: true },
    requestedStatus: { type: String, enum: CORRECTION_STATUSES, required: true },
    checkIn: { type: String, default: "" },
    checkOut: { type: String, default: "" },
    /** The reason picked from Attendance Reg. Reasons, and its name as it was then. */
    reasonId: { type: Schema.Types.ObjectId, ref: "AttendanceReason", default: null },
    reasonName: { type: String, trim: true, default: "" },
    /** The employee's own words (remarks). */
    reason: { type: String, trim: true, default: "" },
    /** The day as it stood when the request was raised, for the approver and the audit trail. */
    previous: {
      status: { type: String, default: "" },
      checkIn: { type: String, default: "" },
      checkOut: { type: String, default: "" },
    },
    status: { type: String, enum: ATTENDANCE_REQUEST_STATUSES, default: "PENDING" },
    appliedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    decidedAs: { type: String, enum: ["", "HR", "MANAGER"], default: "" },
    decisionNote: { type: String, trim: true, default: "" },
    ...audit,
  },
  { timestamps: true }
);
attendanceRequestSchema.index({ businessId: 1, requestNumber: 1 }, { unique: true });
attendanceRequestSchema.index({ businessId: 1, employeeId: 1, date: -1 });
attendanceRequestSchema.index({ businessId: 1, status: 1, createdAt: -1 });
// One open request per employee per day.
attendanceRequestSchema.index({ businessId: 1, employeeId: 1, date: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" } });
export const AttendanceRequest = defineModel("AttendanceRequest", attendanceRequestSchema);

export const PAYROLL_STATUSES = ["DRAFT", "APPROVED", "PAID", "CANCELLED"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

const payrollRunSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    runNumber: { type: String, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: PAYROLL_STATUSES, default: "DRAFT" },
    employeeCount: { type: Number, default: 0 },
    totalGross: money,
    totalReimbursements: money,
    totalDeductions: money,
    totalNet: money,
    totalEmployerContribution: money,
    approvedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paymentReference: { type: String, trim: true, default: "" },
    /** Working days with no attendance that the approver chose to pay as present (0 when every day was marked). */
    unmarkedDaysPaid: { type: Number, default: 0 },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    ...audit,
  },
  { timestamps: true }
);
payrollRunSchema.index({ businessId: 1, runNumber: 1 }, { unique: true });
// One live run per month: a cancelled run frees the month for a fresh one.
payrollRunSchema.index(
  { businessId: 1, year: 1, month: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["DRAFT", "APPROVED", "PAID"] } } }
);
export const PayrollRun = defineModel("PayrollRun", payrollRunSchema);

const payLineSchema = new Schema(
  {
    code: { type: String, required: true },
    label: { type: String, required: true },
    amount: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: false }
);

const payslipSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    /** Snapshot of who was paid, so later edits to the employee don't rewrite history. */
    employee: {
      code: String,
      name: String,
      department: String,
      designation: String,
      dateOfJoining: Date,
      panNumber: String,
      uanNumber: String,
      esiNumber: String,
      bankName: String,
      bankAccountNumber: String,
      ifscCode: String,
      paymentMode: String,
    },
    daysInMonth: { type: Number, required: true },
    payableDays: { type: Number, required: true },
    lopDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    paidLeaveDays: { type: Number, default: 0 },
    holidays: { type: Number, default: 0 },
    weeklyOffs: { type: Number, default: 0 },
    /** Working days with no attendance recorded; paid as present and included in presentDays. */
    unmarkedDays: { type: Number, default: 0 },
    /** Arrears paid with this payslip. */
    arrearIds: { type: [Schema.Types.ObjectId], ref: "PayrollArrear", default: [] },
    /** Variable pay included, as "CODE:amount|…" — approval compares it with what is entered now. */
    variableKey: { type: String, default: "" },
    /** The monthly salary structure this payslip was calculated from (day-weighted when it changed mid-month). */
    structure: {
      basic: money,
      hra: money,
      conveyance: money,
      specialAllowance: money,
      otherAllowance: money,
      /** Dates within the month on which a new salary took effect. */
      revisedOn: { type: [Date], default: [] },
    },
    earnings: { type: [payLineSchema], default: [] },
    deductions: { type: [payLineSchema], default: [] },
    employerContributions: { type: [payLineSchema], default: [] },
    /** Gross wages used for PF and ESI reporting. */
    pfWages: money,
    esiWages: money,
    grossEarnings: money,
    reimbursements: money,
    totalDeductions: money,
    netPay: money,
    loanDeductions: {
      type: [
        new Schema(
          {
            loanId: { type: Schema.Types.ObjectId, ref: "EmployeeLoan", required: true },
            amount: { type: Schema.Types.Decimal128, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    claimIds: { type: [Schema.Types.ObjectId], ref: "ExpenseClaim", default: [] },
    status: { type: String, enum: PAYROLL_STATUSES, default: "DRAFT" },
  },
  { timestamps: true }
);
payslipSchema.index({ businessId: 1, payrollRunId: 1, employeeId: 1 }, { unique: true });
payslipSchema.index({ businessId: 1, employeeId: 1, year: -1, month: -1 });
export const Payslip = defineModel("Payslip", payslipSchema);

export const LOAN_STATUSES = ["ACTIVE", "CLOSED", "CANCELLED"] as const;

/** A salary advance or loan recovered in monthly instalments through payroll. */
const employeeLoanSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    loanNumber: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    loanType: { type: String, enum: ["ADVANCE", "LOAN"], default: "ADVANCE" },
    issueDate: { type: Date, required: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    emiAmount: { type: Schema.Types.Decimal128, required: true },
    /** First payroll month that deducts an instalment. */
    startMonth: { type: Number, required: true, min: 1, max: 12 },
    startYear: { type: Number, required: true },
    repayments: {
      type: [
        new Schema(
          {
            payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", default: null },
            month: Number,
            year: Number,
            amount: { type: Schema.Types.Decimal128, required: true },
            note: { type: String, default: "" },
            /** Recovered in a full & final settlement instead of payroll. */
            fnfSettlementId: { type: Schema.Types.ObjectId, ref: "FnfSettlement", default: null },
            at: { type: Date, default: () => new Date() },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    repaidAmount: money,
    status: { type: String, enum: LOAN_STATUSES, default: "ACTIVE" },
    reason: { type: String, trim: true, default: "" },
    ...audit,
  },
  { timestamps: true }
);
employeeLoanSchema.index({ businessId: 1, loanNumber: 1 }, { unique: true });
employeeLoanSchema.index({ businessId: 1, employeeId: 1, status: 1 });
export const EmployeeLoan = defineModel("EmployeeLoan", employeeLoanSchema);

export const CLAIM_CATEGORIES = ["TRAVEL", "FOOD", "ACCOMMODATION", "FUEL", "PHONE_INTERNET", "MEDICAL", "OFFICE_SUPPLIES", "OTHER"] as const;
export const CLAIM_STATUSES = ["PENDING", "APPROVED", "REJECTED", "REIMBURSED", "CANCELLED"] as const;

/** An out-of-pocket expense an employee asks to be paid back, reimbursed through payroll. */
const expenseClaimSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    claimNumber: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    claimDate: { type: Date, required: true },
    category: { type: String, enum: CLAIM_CATEGORIES, default: "OTHER" },
    amount: { type: Schema.Types.Decimal128, required: true },
    description: { type: String, trim: true, default: "" },
    billReference: { type: String, trim: true, default: "" },
    status: { type: String, enum: CLAIM_STATUSES, default: "PENDING" },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: "" },
    payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", default: null },
    ...audit,
  },
  { timestamps: true }
);
expenseClaimSchema.index({ businessId: 1, claimNumber: 1 }, { unique: true });
expenseClaimSchema.index({ businessId: 1, employeeId: 1, status: 1 });
export const ExpenseClaim = defineModel("ExpenseClaim", expenseClaimSchema);
