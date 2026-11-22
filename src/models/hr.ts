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
    grade: { type: String, trim: true },
    description: { type: String, trim: true },
  },
  { uniqueField: "code" }
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

export const Holiday = defineMasterModel(
  "Holiday",
  {
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    holidayType: { type: String, enum: HOLIDAY_TYPES, default: "PUBLIC" },
    description: { type: String, trim: true },
  },
  { indexes: [{ date: 1 }] }
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
    maxCarryForward: { type: Number, default: 0, min: 0 },
    encashable: { type: Boolean, default: false },
    /** Lets a balance go below zero (e.g. loss of pay, which has no quota). */
    allowNegative: { type: Boolean, default: false },
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
    reportingManagerId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift", default: null },
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
    notes: { type: String, trim: true },
  },
  {
    uniqueField: "employeeCode",
    indexes: [{ departmentId: 1 }, { employmentStatus: 1 }, { userId: 1 }, { reportingManagerId: 1 }],
  }
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
export const ATTENDANCE_SOURCES = ["MANUAL", "SELF", "LEAVE"] as const;

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
    allocated: { type: Number, required: true, min: 0 },
    carriedForward: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: "" },
    ...audit,
  },
  { timestamps: true }
);
leaveAllocationSchema.index({ businessId: 1, employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
export const LeaveAllocation = defineModel("LeaveAllocation", leaveAllocationSchema);

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
