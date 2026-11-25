import { Schema, model, models, type Model } from "mongoose";
import { defineMasterModel } from "./shared/masterSchema";
import { GENDERS_HR, SALARY_PAYMENT_MODES } from "./hr";

/**
 * Contract labour (HRMS): labour contractors, the workers they supply and the
 * workers' daily attendance with overtime. Contractors and workers are masters
 * on the generic resource framework; attendance has its own service
 * (src/lib/hr/contractLabour.ts).
 *
 * Every collection is tenant-scoped by businessId.
 */

export const CONTRACT_STATUSES = ["ACTIVE", "SUSPENDED", "ENDED"] as const;
export const SKILL_CATEGORIES = ["UNSKILLED", "SEMI_SKILLED", "SKILLED", "HIGHLY_SKILLED"] as const;
export const OVERTIME_RATE_TYPES = ["MULTIPLIER", "FIXED"] as const;

const money = { type: Schema.Types.Decimal128, default: "0" };

/**
 * A labour contractor, with the same profile an employee has (contact, IDs,
 * bank, placement) plus the contract and wage terms. `parentContractorId`
 * makes them a sub-contractor, which builds the contractor tree.
 */
export const Contractor = defineMasterModel(
  "Contractor",
  {
    contractorCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    firmName: { type: String, trim: true },
    gender: { type: String, enum: [...GENDERS_HR, ""], default: "" },
    dateOfBirth: { type: Date, default: null },
    fatherOrSpouseName: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    emergencyContactName: { type: String, trim: true },
    emergencyContactPhone: { type: String, trim: true },
    currentAddress: { type: String, trim: true },
    permanentAddress: { type: String, trim: true },

    /** The contractor this one works under; null = engaged directly. */
    parentContractorId: { type: Schema.Types.ObjectId, ref: "Contractor", default: null },
    /** The company's own person in charge of this contractor. */
    supervisorEmployeeId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    departmentId: { type: Schema.Types.ObjectId, ref: "HrDepartment", default: null },
    /** Shift whose hours set a full day for overtime; workers may have their own. */
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift", default: null },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    workLocation: { type: String, trim: true },
    contractStatus: { type: String, enum: CONTRACT_STATUSES, default: "ACTIVE" },
    contractStartDate: { type: Date, default: null },
    contractEndDate: { type: Date, default: null },
    labourLicenceNumber: { type: String, trim: true },
    licenceValidUpto: { type: Date, default: null },
    /** Most workers the licence allows; 0 = not limited. */
    maxWorkers: { type: Number, default: 0, min: 0 },

    panNumber: { type: String, trim: true, uppercase: true },
    aadhaarNumber: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    pfCode: { type: String, trim: true, uppercase: true },
    esiCode: { type: String, trim: true },

    paymentMode: { type: String, enum: SALARY_PAYMENT_MODES, default: "BANK" },
    bankName: { type: String, trim: true },
    bankAccountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true, uppercase: true },

    /** Day wage for workers who have none of their own. */
    defaultDailyWage: money,
    /** MULTIPLIER: hourly wage × overtimeMultiplier. FIXED: overtimeRatePerHour. */
    overtimeRateType: { type: String, enum: OVERTIME_RATE_TYPES, default: "MULTIPLIER" },
    overtimeMultiplier: { type: Number, default: 2, min: 0 },
    overtimeRatePerHour: money,
    /** Overtime shorter than this many minutes in a day is not paid. */
    minOvertimeMinutes: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true },
  },
  { uniqueField: "contractorCode", indexes: [{ parentContractorId: 1 }, { contractStatus: 1 }] }
);

/** A contract worker. One worker can be supplied by several contractors. */
export const ContractWorker = defineMasterModel(
  "ContractWorker",
  {
    workerCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    emergencyPhone: { type: String, trim: true },
    contractorIds: { type: [{ type: Schema.Types.ObjectId, ref: "Contractor" }], default: [] },

    gender: { type: String, enum: [...GENDERS_HR, ""], default: "" },
    aadhaarNumber: { type: String, trim: true },
    skillCategory: { type: String, enum: [...SKILL_CATEGORIES, ""], default: "" },
    dateOfJoining: { type: Date, default: null },
    dateOfExit: { type: Date, default: null },
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift", default: null },
    /** 0 = the contractor's default day wage. */
    dailyWage: money,
    /** 0 = worked out from the contractor's overtime terms. */
    overtimeRatePerHour: money,
    notes: { type: String, trim: true },
  },
  { uniqueField: "workerCode", indexes: [{ contractorIds: 1 }] }
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defineModel(name: string, schema: Schema): Model<any> {
  return models[name] ?? model(name, schema);
}

export const CONTRACT_ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "WEEKLY_OFF", "HOLIDAY"] as const;

/**
 * One row per worker per day (UTC midnight, as in HR attendance), booked to
 * the contractor they worked for that day.
 */
const contractAttendanceSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    workerId: { type: Schema.Types.ObjectId, ref: "ContractWorker", required: true },
    contractorId: { type: Schema.Types.ObjectId, ref: "Contractor", required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: CONTRACT_ATTENDANCE_STATUSES, required: true },
    /** "HH:mm" local times. */
    checkIn: { type: String, default: "" },
    checkOut: { type: String, default: "" },
    workedMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    /** True when the overtime was typed in rather than worked out from the times. */
    overtimeManual: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
contractAttendanceSchema.index({ businessId: 1, workerId: 1, date: 1 }, { unique: true });
contractAttendanceSchema.index({ businessId: 1, date: 1, contractorId: 1 });
export const ContractAttendance = defineModel("ContractAttendance", contractAttendanceSchema);
