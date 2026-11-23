import type { ResourceUi, FieldConfig } from "./types";

/** Screens for the HRMS masters in src/lib/resources/hrRegistry.ts. */

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];
const statusField: FieldConfig = { name: "status", label: "Record status", type: "select", options: STATUS_OPTIONS, defaultValue: "ACTIVE" };
const statusColumn = { key: "status", label: "Status", type: "badge" as const };

const EMPLOYEE_REF = { resource: "hr-employees", labelField: "name" };
const DEPARTMENT_REF = { resource: "hr-departments", labelField: "name" };
const DESIGNATION_REF = { resource: "hr-designations", labelField: "name" };
const GRADE_REF = { resource: "hr-grades", labelField: "name" };
const LEAVE_GROUP_REF = { resource: "hr-leave-groups", labelField: "name" };
const LEAVE_TYPE_REF = { resource: "hr-leave-types", labelField: "name" };

function opts(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const WEEKDAY_LABELS: Record<string, string> = {
  SUNDAY: "Sunday",
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
};
export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  INTERN: "Intern",
  CONSULTANT: "Consultant",
};
export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  PROBATION: "On probation",
  CONFIRMED: "Confirmed",
  ON_NOTICE: "Serving notice",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
  RETIRED: "Retired",
};
const GENDER_LABELS = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };
const MARITAL_LABELS = { SINGLE: "Single", MARRIED: "Married", DIVORCED: "Divorced", WIDOWED: "Widowed" };
const PAY_MODE_LABELS = { BANK: "Bank transfer", CASH: "Cash", CHEQUE: "Cheque" };
const HOLIDAY_TYPE_LABELS = { PUBLIC: "Public holiday", OPTIONAL: "Optional / restricted", COMPANY: "Company holiday" };
export const CANDIDATE_STAGE_LABELS: Record<string, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFERED: "Offered",
  HIRED: "Hired",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};
const OPENING_STATUS_LABELS = { OPEN: "Open", ON_HOLD: "On hold", CLOSED: "Closed" };
const CONDITION_LABELS = { NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
const APPRAISAL_STAGE_LABELS = { DRAFT: "Draft", SELF_REVIEW: "Self review", MANAGER_REVIEW: "Manager review", COMPLETED: "Completed" };

function master(key: string, title: string, singular: string, ui: Omit<ResourceUi, "key" | "title" | "singular" | "apiPath" | "basePath">): ResourceUi {
  return { key, title, singular, apiPath: `/api/masters/${key}`, basePath: `/${key}`, ...ui };
}

const departments = master("hr-departments", "Departments", "Department", {
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Department", filterParam: "name", sortField: "name" },
    { key: "headEmployeeId", label: "Head", type: "reference", reference: EMPLOYEE_REF },
    { key: "costCenter", label: "Cost centre" },
    statusColumn,
  ],
  sections: [
    {
      label: "Department",
      fields: [
        { name: "name", label: "Department name", type: "text", required: true, placeholder: "Human Resources" },
        { name: "code", label: "Code", type: "text", hint: "Leave blank to number automatically" },
        { name: "headEmployeeId", label: "Department head", type: "reference", reference: EMPLOYEE_REF, hint: "Optional" },
        { name: "costCenter", label: "Cost centre", type: "text", hint: "Optional" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const designations = master("hr-designations", "Designations", "Designation", {
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Designation", filterParam: "name", sortField: "name" },
    statusColumn,
  ],
  sections: [
    {
      label: "Designation",
      fields: [
        { name: "name", label: "Designation", type: "text", required: true, placeholder: "Senior Executive" },
        { name: "code", label: "Code", type: "text", hint: "Leave blank to number automatically" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const grades = master("hr-grades", "Grades", "Grade", {
  permissions: { create: "hr-designations.create", edit: "hr-designations.edit", delete: "hr-designations.delete" },
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Grade", filterParam: "name", sortField: "name" },
    { key: "leaveGroupId", label: "Leave group", type: "reference", reference: LEAVE_GROUP_REF },
    statusColumn,
  ],
  sections: [
    {
      label: "Grade",
      description: "Its leave group is chosen on Assign Grade to Group.",
      fields: [
        { name: "code", label: "Code", type: "text", required: true, placeholder: "L4" },
        { name: "name", label: "Name", type: "text", required: true, placeholder: "Executive" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const shifts = master("hr-shifts", "Shifts", "Shift", {
  columns: [
    { key: "name", label: "Shift", filterParam: "name", sortField: "name" },
    { key: "startTime", label: "Starts", sortField: "startTime" },
    { key: "endTime", label: "Ends" },
    { key: "graceMinutes", label: "Grace (min)", type: "number" },
    { key: "weeklyOff1", label: "Weekly off", type: "label", labels: WEEKDAY_LABELS },
    { key: "weeklyOff2", label: "2nd weekly off", type: "label", labels: WEEKDAY_LABELS },
    { key: "isDefault", label: "Default", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Timing",
      fields: [
        { name: "name", label: "Shift name", type: "text", required: true, placeholder: "General Shift" },
        { name: "startTime", label: "Start time", type: "text", required: true, defaultValue: "09:30", placeholder: "09:30", hint: "24-hour HH:mm" },
        { name: "endTime", label: "End time", type: "text", required: true, defaultValue: "18:30", placeholder: "18:30", hint: "24-hour HH:mm" },
        { name: "graceMinutes", label: "Late grace (minutes)", type: "number", defaultValue: 15 },
        { name: "fullDayHours", label: "Hours for a full day", type: "number", defaultValue: 8 },
        { name: "halfDayHours", label: "Hours for a half day", type: "number", defaultValue: 4, hint: "Less than this is absent" },
      ],
    },
    {
      label: "Weekly offs",
      fields: [
        { name: "weeklyOff1", label: "Weekly off", type: "select", defaultValue: "SUNDAY", options: [{ value: "", label: "None" }, ...opts(WEEKDAY_LABELS)] },
        { name: "weeklyOff2", label: "Second weekly off", type: "select", defaultValue: "", options: [{ value: "", label: "None" }, ...opts(WEEKDAY_LABELS)] },
        { name: "isDefault", label: "Default shift for employees without one", type: "checkbox" },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const holidays = master("hr-holidays", "Holiday Calendar", "Holiday", {
  columns: [
    { key: "date", label: "Date", type: "date", sortField: "date" },
    { key: "name", label: "Holiday", filterParam: "name", sortField: "name" },
    { key: "holidayType", label: "Type", type: "label", labels: HOLIDAY_TYPE_LABELS },
    { key: "description", label: "Description" },
    statusColumn,
  ],
  sections: [
    {
      label: "Holiday",
      fields: [
        { name: "name", label: "Holiday", type: "text", required: true, placeholder: "Diwali" },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "holidayType", label: "Type", type: "select", defaultValue: "PUBLIC", options: opts(HOLIDAY_TYPE_LABELS) },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const leaveTypes = master("hr-leave-types", "Leave Types", "Leave type", {
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Leave type", filterParam: "name", sortField: "name" },
    { key: "annualQuota", label: "Days / year", type: "number", sortField: "annualQuota" },
    { key: "isPaid", label: "Paid", type: "yesno" },
    { key: "carryForward", label: "Carry forward", type: "yesno" },
    { key: "encashable", label: "Encashable", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Policy",
      fields: [
        { name: "code", label: "Code", type: "text", required: true, placeholder: "CL" },
        { name: "name", label: "Name", type: "text", required: true, placeholder: "Casual Leave" },
        { name: "annualQuota", label: "Days per year", type: "number", defaultValue: 12 },
        { name: "maxCarryForward", label: "Most days carried to next year (0 = no limit)", type: "number", defaultValue: 0, showWhen: { field: "carryForward", values: ["true"] } },
        { name: "isPaid", label: "Paid leave (unpaid leave is deducted from salary)", type: "checkbox", defaultValue: true },
        { name: "allowHalfDay", label: "Can be taken as a half day", type: "checkbox", defaultValue: true },
        { name: "carryForward", label: "Unused days carry forward", type: "checkbox" },
        { name: "prorateForJoiners", label: "Pro-rate for employees who join during the year", type: "checkbox", defaultValue: true },
        { name: "encashable", label: "Can be encashed", type: "checkbox" },
        { name: "allowNegative", label: "Allow taking more than the balance", type: "checkbox" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const leaveGroups = master("hr-leave-groups", "Leave Groups", "Leave group", {
  permissions: { create: "hr-leave-types.create", edit: "hr-leave-types.edit", delete: "hr-leave-types.delete" },
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Leave group", filterParam: "name", sortField: "name" },
    { key: "leaveTypes", label: "Leave types", type: "count" },
    { key: "description", label: "Description" },
    statusColumn,
  ],
  sections: [
    {
      label: "Group",
      fields: [
        { name: "name", label: "Group name", type: "text", required: true, placeholder: "Staff" },
        { name: "code", label: "Code", type: "text", hint: "Leave blank to number automatically" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
    {
      label: "Leave types in this group",
      description: "Days a year each leave type grants to grades assigned to this group. A leave type left out grants them none.",
      fields: [
        {
          name: "leaveTypes",
          label: "Leave types",
          type: "lines",
          addLabel: "Add leave type",
          columns: [
            { name: "leaveTypeId", label: "Leave type", type: "reference", reference: LEAVE_TYPE_REF, required: true },
            { name: "annualQuota", label: "Days per year", type: "number", width: "10rem", defaultValue: 0 },
          ],
        },
      ],
    },
  ],
});

const attendanceReasons = master("hr-attendance-reasons", "Attendance Reg. Reasons", "Reason", {
  permissions: { create: "hr-attendance.edit", edit: "hr-attendance.edit", delete: "hr-attendance.edit" },
  columns: [
    { key: "name", label: "Reason", filterParam: "name", sortField: "name" },
    { key: "reasonType", label: "Reason type", type: "label", labels: { SYSTEM: "System Defined", USER: "User Defined" }, sortField: "reasonType" },
    statusColumn,
  ],
  sections: [
    {
      label: "Reason",
      description: "Employees pick one of these when they ask for an attendance correction.",
      fields: [
        { name: "name", label: "Reason", type: "text", required: true, placeholder: "Forgot to Punch" },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const announcements = master("hr-announcements", "Announcements", "Announcement", {
  titleField: "title",
  columns: [
    { key: "title", label: "Title", filterParam: "title", sortField: "title" },
    { key: "publishDate", label: "Published", type: "date", sortField: "publishDate" },
    { key: "expiryDate", label: "Until", type: "date" },
    { key: "pinned", label: "Pinned", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Announcement",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, fullWidth: true, placeholder: "Office closed on Friday" },
        { name: "publishDate", label: "Publish on", type: "date", required: true },
        { name: "expiryDate", label: "Show until", type: "date", hint: "Optional" },
        { name: "pinned", label: "Pin to the top", type: "checkbox" },
        statusField,
        { name: "message", label: "Message", type: "textarea", required: true, fullWidth: true },
      ],
    },
  ],
});

const employees = master("hr-employees", "Employee Records", "Employee", {
  columns: [
    { key: "employeeCode", label: "Emp. code", filterParam: "employeeCode", sortField: "employeeCode" },
    { key: "name", label: "Name", filterParam: "name", sortField: "name" },
    { key: "departmentId", label: "Department", type: "reference", reference: DEPARTMENT_REF },
    { key: "designationId", label: "Designation", type: "reference", reference: DESIGNATION_REF },
    { key: "gradeId", label: "Grade", type: "reference", reference: GRADE_REF },
    { key: "phone", label: "Phone", filterParam: "phone" },
    { key: "dateOfJoining", label: "Joined", type: "date", sortField: "dateOfJoining" },
    { key: "employmentType", label: "Type", type: "label", labels: EMPLOYMENT_TYPE_LABELS },
    { key: "employmentStatus", label: "Employment", type: "label", labels: EMPLOYMENT_STATUS_LABELS, sortField: "employmentStatus" },
    { key: "basic", label: "Basic", type: "money" },
    statusColumn,
  ],
  sections: [
    {
      label: "Personal details",
      fields: [
        { name: "name", label: "Full name", type: "text", required: true, placeholder: "Asha Rao" },
        { name: "employeeCode", label: "Employee code", type: "text", hint: "Leave blank to number automatically" },
        { name: "gender", label: "Gender", type: "select", defaultValue: "", options: [{ value: "", label: "—" }, ...opts(GENDER_LABELS)] },
        { name: "dateOfBirth", label: "Date of birth", type: "date" },
        { name: "maritalStatus", label: "Marital status", type: "select", defaultValue: "", options: [{ value: "", label: "—" }, ...opts(MARITAL_LABELS)] },
        { name: "bloodGroup", label: "Blood group", type: "text", placeholder: "B+" },
        { name: "fatherOrSpouseName", label: "Father's / spouse's name", type: "text", hint: "Needed for PF forms" },
      ],
    },
    {
      label: "Contact",
      fields: [
        { name: "phone", label: "Mobile", type: "tel" },
        { name: "workEmail", label: "Work email", type: "email" },
        { name: "personalEmail", label: "Personal email", type: "email" },
        { name: "emergencyContactName", label: "Emergency contact", type: "text" },
        { name: "emergencyContactPhone", label: "Emergency phone", type: "tel" },
        { name: "currentAddress", label: "Current address", type: "textarea", fullWidth: true },
        { name: "permanentAddress", label: "Permanent address", type: "textarea", fullWidth: true },
      ],
    },
    {
      label: "Job",
      fields: [
        { name: "dateOfJoining", label: "Date of joining", type: "date", required: true },
        { name: "departmentId", label: "Department", type: "reference", reference: DEPARTMENT_REF },
        { name: "designationId", label: "Designation", type: "reference", reference: DESIGNATION_REF },
        { name: "gradeId", label: "Grade", type: "reference", reference: GRADE_REF, hint: "Sets leave days through its leave group", sendBlank: true },
        { name: "reportingManagerId", label: "Reports to", type: "reference", reference: EMPLOYEE_REF },
        { name: "shiftId", label: "Shift", type: "reference", reference: { resource: "hr-shifts", labelField: "name" }, hint: "Blank uses the default shift" },
        { name: "workLocation", label: "Work location", type: "text" },
        { name: "employmentType", label: "Employment type", type: "select", defaultValue: "FULL_TIME", options: opts(EMPLOYMENT_TYPE_LABELS) },
        { name: "employmentStatus", label: "Employment status", type: "select", defaultValue: "PROBATION", options: opts(EMPLOYMENT_STATUS_LABELS) },
        { name: "probationEndDate", label: "Probation ends", type: "date" },
        { name: "confirmationDate", label: "Confirmed on", type: "date" },
        { name: "dateOfExit", label: "Last working day", type: "date", showWhen: { field: "employmentStatus", values: ["ON_NOTICE", "RESIGNED", "TERMINATED", "RETIRED"] } },
        { name: "exitReason", label: "Exit reason", type: "textarea", fullWidth: true, showWhen: { field: "employmentStatus", values: ["ON_NOTICE", "RESIGNED", "TERMINATED", "RETIRED"] } },
      ],
    },
    {
      label: "Salary structure (monthly)",
      fields: [
        { name: "basic", label: "Basic", type: "money", defaultValue: "0", hint: "PF is worked out on basic" },
        { name: "hra", label: "House rent allowance", type: "money", defaultValue: "0" },
        { name: "conveyance", label: "Conveyance", type: "money", defaultValue: "0" },
        { name: "specialAllowance", label: "Special allowance", type: "money", defaultValue: "0" },
        { name: "otherAllowance", label: "Other allowance", type: "money", defaultValue: "0" },
        { name: "monthlyTds", label: "TDS per month", type: "money", defaultValue: "0", hint: "Income tax to deduct each month" },
        { name: "pfApplicable", label: "Deduct Provident Fund (12% of basic, up to ₹15,000 wages)", type: "checkbox", defaultValue: true },
        { name: "esiApplicable", label: "Deduct ESI (0.75%, when gross is ₹21,000 or less)", type: "checkbox" },
        { name: "ptApplicable", label: "Deduct Professional Tax", type: "checkbox", defaultValue: true },
        { name: "professionalTax", label: "Professional tax per month", type: "money", defaultValue: "200", showWhen: { field: "ptApplicable", values: ["true"] } },
      ],
    },
    {
      label: "Statutory & bank",
      fields: [
        { name: "panNumber", label: "PAN", type: "text", placeholder: "ABCDE1234F" },
        { name: "aadhaarNumber", label: "Aadhaar", type: "text", placeholder: "12 digits" },
        { name: "uanNumber", label: "UAN", type: "text", placeholder: "12 digits" },
        { name: "pfNumber", label: "PF account no.", type: "text" },
        { name: "esiNumber", label: "ESI IP number", type: "text" },
        { name: "salaryPaymentMode", label: "Salary paid by", type: "select", defaultValue: "BANK", options: opts(PAY_MODE_LABELS) },
        { name: "bankName", label: "Bank", type: "text", showWhen: { field: "salaryPaymentMode", values: ["BANK"] } },
        { name: "bankAccountNumber", label: "Account number", type: "text", showWhen: { field: "salaryPaymentMode", values: ["BANK"] } },
        { name: "ifscCode", label: "IFSC", type: "text", placeholder: "HDFC0001234", showWhen: { field: "salaryPaymentMode", values: ["BANK"] } },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
    {
      label: "Login",
      description: "Optional. Link a person from Team Members; they sign in with their own login and role.",
      permissions: ["users.view", "users.edit"],
      fields: [
        {
          name: "userId",
          label: "Existing user",
          type: "reference",
          reference: { resource: "users", labelField: "name", url: "/api/admin/users", detailField: "email", searchable: true },
          placeholder: "Search …",
          sendBlank: true,
        },
      ],
    },
  ],
});

const jobOpenings = master("hr-job-openings", "Job Openings", "Job opening", {
  titleField: "title",
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "title", label: "Position", filterParam: "title", sortField: "title" },
    { key: "departmentId", label: "Department", type: "reference", reference: DEPARTMENT_REF },
    { key: "positions", label: "Openings", type: "number" },
    { key: "location", label: "Location" },
    { key: "closingDate", label: "Closes", type: "date", sortField: "closingDate" },
    { key: "openingStatus", label: "Hiring", type: "label", labels: OPENING_STATUS_LABELS },
  ],
  sections: [
    {
      label: "Position",
      fields: [
        { name: "title", label: "Job title", type: "text", required: true, placeholder: "Accounts Executive" },
        { name: "code", label: "Code", type: "text", hint: "Leave blank to number automatically" },
        { name: "departmentId", label: "Department", type: "reference", reference: DEPARTMENT_REF },
        { name: "designationId", label: "Designation", type: "reference", reference: DESIGNATION_REF },
        { name: "positions", label: "Number of openings", type: "number", defaultValue: 1 },
        { name: "location", label: "Location", type: "text" },
        { name: "employmentType", label: "Employment type", type: "select", defaultValue: "FULL_TIME", options: opts(EMPLOYMENT_TYPE_LABELS) },
        { name: "experience", label: "Experience", type: "text", placeholder: "2–4 years" },
        { name: "budgetCtc", label: "Budget (annual CTC)", type: "money", defaultValue: "0" },
        { name: "closingDate", label: "Applications close", type: "date" },
        { name: "openingStatus", label: "Hiring status", type: "select", defaultValue: "OPEN", options: opts(OPENING_STATUS_LABELS) },
        { name: "description", label: "Job description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const candidates = master("hr-candidates", "Candidates", "Candidate", {
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Candidate", filterParam: "name", sortField: "name" },
    { key: "jobOpeningId", label: "Applied for", type: "reference", reference: { resource: "hr-job-openings", labelField: "title" } },
    { key: "phone", label: "Phone" },
    { key: "experienceYears", label: "Exp. (yrs)", type: "number" },
    { key: "interviewDate", label: "Interview", type: "date", sortField: "interviewDate" },
    { key: "stage", label: "Stage", type: "label", labels: CANDIDATE_STAGE_LABELS, sortField: "stage" },
  ],
  sections: [
    {
      label: "Candidate",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", hint: "Leave blank to number automatically" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Phone", type: "tel" },
        { name: "jobOpeningId", label: "Applied for", type: "reference", reference: { resource: "hr-job-openings", labelField: "title" } },
        { name: "stage", label: "Stage", type: "select", defaultValue: "APPLIED", options: opts(CANDIDATE_STAGE_LABELS) },
        { name: "source", label: "Source", type: "text", placeholder: "Referral, LinkedIn, Naukri…" },
        { name: "interviewDate", label: "Interview date", type: "date" },
      ],
    },
    {
      label: "Background",
      fields: [
        { name: "currentCompany", label: "Current company", type: "text" },
        { name: "experienceYears", label: "Experience (years)", type: "number", defaultValue: 0 },
        { name: "currentCtc", label: "Current CTC", type: "money", defaultValue: "0" },
        { name: "expectedCtc", label: "Expected CTC", type: "money", defaultValue: "0" },
        { name: "noticePeriodDays", label: "Notice period (days)", type: "number", defaultValue: 0 },
        { name: "resumeUrl", label: "Résumé link", type: "text", fullWidth: true },
        { name: "notes", label: "Interview notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const assets = master("hr-assets", "Assets Issued", "Asset", {
  columns: [
    { key: "assetTag", label: "Tag", filterParam: "assetTag", sortField: "assetTag" },
    { key: "name", label: "Asset", filterParam: "name", sortField: "name" },
    { key: "category", label: "Category", filterParam: "category" },
    { key: "employeeId", label: "Issued to", type: "reference", reference: EMPLOYEE_REF },
    { key: "assignedDate", label: "Issued on", type: "date", sortField: "assignedDate" },
    { key: "returnedDate", label: "Returned", type: "date" },
    { key: "condition", label: "Condition", type: "label", labels: CONDITION_LABELS },
  ],
  sections: [
    {
      label: "Asset",
      fields: [
        { name: "name", label: "Asset", type: "text", required: true, placeholder: "Dell Latitude 5440" },
        { name: "assetTag", label: "Asset tag", type: "text", hint: "Leave blank to number automatically" },
        { name: "category", label: "Category", type: "text", placeholder: "Laptop" },
        { name: "serialNumber", label: "Serial number", type: "text" },
        { name: "value", label: "Value", type: "money", defaultValue: "0" },
        { name: "condition", label: "Condition", type: "select", defaultValue: "GOOD", options: opts(CONDITION_LABELS) },
      ],
    },
    {
      label: "Issued to",
      fields: [
        { name: "employeeId", label: "Employee", type: "reference", reference: EMPLOYEE_REF },
        { name: "assignedDate", label: "Issued on", type: "date" },
        { name: "returnedDate", label: "Returned on", type: "date" },
        statusField,
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const appraisals = master("hr-appraisals", "Appraisals", "Appraisal", {
  titleField: "period",
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "employeeId", label: "Employee", type: "reference", reference: EMPLOYEE_REF },
    { key: "period", label: "Period", filterParam: "period", sortField: "period" },
    { key: "reviewerId", label: "Reviewer", type: "reference", reference: EMPLOYEE_REF },
    { key: "selfRating", label: "Self", type: "number" },
    { key: "managerRating", label: "Manager", type: "number", sortField: "managerRating" },
    { key: "recommendedIncrementPercent", label: "Increment %", type: "number" },
    { key: "stage", label: "Stage", type: "label", labels: APPRAISAL_STAGE_LABELS },
  ],
  sections: [
    {
      label: "Review",
      fields: [
        { name: "employeeId", label: "Employee", type: "reference", reference: EMPLOYEE_REF, required: true },
        { name: "reviewerId", label: "Reviewer", type: "reference", reference: EMPLOYEE_REF },
        { name: "period", label: "Review period", type: "text", required: true, placeholder: "FY 2026-27 H1" },
        { name: "stage", label: "Stage", type: "select", defaultValue: "DRAFT", options: opts(APPRAISAL_STAGE_LABELS) },
        { name: "selfRating", label: "Self rating (0–5)", type: "number", defaultValue: 0 },
        { name: "managerRating", label: "Manager rating (0–5)", type: "number", defaultValue: 0 },
        { name: "recommendedIncrementPercent", label: "Recommended increment %", type: "number", defaultValue: 0 },
        { name: "goals", label: "Goals / KRAs", type: "textarea", fullWidth: true },
        { name: "strengths", label: "Strengths", type: "textarea", fullWidth: true },
        { name: "improvements", label: "Areas to improve", type: "textarea", fullWidth: true },
        { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

const payComponents = master("hr-pay-components", "Pay Components", "Pay component", {
  permissions: { create: "hr-payroll.process", edit: "hr-payroll.process", delete: "hr-payroll.process" },
  columns: [
    { key: "code", label: "Code", filterParam: "code", sortField: "code" },
    { key: "name", label: "Component", filterParam: "name", sortField: "name" },
    { key: "kind", label: "Type", type: "label", labels: { EARNING: "Earning", DEDUCTION: "Deduction" }, sortField: "kind" },
    { key: "esiApplicable", label: "In ESI wages", type: "yesno" },
    statusColumn,
  ],
  sections: [
    {
      label: "Component",
      fields: [
        { name: "code", label: "Code", type: "text", required: true, placeholder: "BONUS" },
        { name: "name", label: "Name", type: "text", required: true, placeholder: "Performance bonus" },
        { name: "kind", label: "Type", type: "select", defaultValue: "EARNING", options: [{ value: "EARNING", label: "Earning (added to pay)" }, { value: "DEDUCTION", label: "Deduction (taken from pay)" }] },
        { name: "esiApplicable", label: "Counts towards ESI wages (earnings)", type: "checkbox", defaultValue: true },
        statusField,
        { name: "description", label: "Description", type: "textarea", fullWidth: true },
      ],
    },
  ],
});

export const HR_RESOURCE_UI: Record<string, ResourceUi> = {
  "hr-pay-components": payComponents,
  "hr-departments": departments,
  "hr-designations": designations,
  "hr-grades": grades,
  "hr-shifts": shifts,
  "hr-holidays": holidays,
  "hr-leave-types": leaveTypes,
  "hr-leave-groups": leaveGroups,
  "hr-attendance-reasons": attendanceReasons,
  "hr-announcements": announcements,
  "hr-employees": employees,
  "hr-job-openings": jobOpenings,
  "hr-candidates": candidates,
  "hr-assets": assets,
  "hr-appraisals": appraisals,
};
