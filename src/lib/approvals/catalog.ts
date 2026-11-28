/**
 * Every transaction an approval scheme can be set up for. Kept free of server
 * imports so the scheme screen and the approval screens can use it as well as
 * the engine.
 *
 * Two kinds of document go through the same engine:
 * - `record`: the record has its own life cycle (a leave request, an invoice,
 *   a payroll run). It is raised, waits in its own "pending" status, and the
 *   module's approve step calls approvalGate() before doing its work.
 * - `action`: an operation that would otherwise write straight away (saving
 *   the day's attendance, changing a leave balance, recording a salary
 *   revision). With an active scheme the validated input is held on the
 *   approval request and the operation runs only when the last stage
 *   approves (see holdForApproval / executors.ts). Without a scheme it runs
 *   at once, as before.
 *
 * `amount` = the document carries a money value, so a stage can apply
 * "only if the amount exceeds" a limit.
 * `product` = which product must be bought for the document to be offered.
 * `href` = where the record or its screen opens (":id" is replaced).
 * `sendBack` = an approver may send it back to the requester for correction
 * instead of rejecting it.
 * `permission` (actions) = what the operation needs; an approver acting from
 * the approval screens is given it for that one step.
 * `fallback` = a more specific scheme: when it has no active scheme of its
 * own, the `fallback` document's scheme applies (e.g. Medical Claim → Expense Claim).
 * `trigger` = in words, what starts the approval.
 */
export type ApprovalKind = "record" | "action";

export interface ApprovalDocumentDef {
  key: string;
  label: string;
  group: string;
  module: string;
  product: "ERP" | "HRMS";
  kind: ApprovalKind;
  amount: boolean;
  href: string;
  sendBack: boolean;
  permission?: string;
  fallback?: string;
  trigger: string;
}

const PP = "People & Payroll";
const ERP_TRADE = "Sales & Purchase";
const ERP_MONEY = "Money, Books & Stock";

export const APPROVAL_DOCUMENTS = [
  /* ---------------------------------------------------------------- Employees */
  { key: "hr-employee-create", label: "Employee Creation", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr-employees", sendBack: true, permission: "hr-employees.create", trigger: "Adding an employee from the form or by Excel import" },
  { key: "hr-employee-update", label: "Employee Information Modification", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr-employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "Editing an employee record, or a status change / correction in employment history" },
  { key: "hr-transfer", label: "Employee Transfer", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr/employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "A change of branch or work location (employment history or the employee form)" },
  { key: "hr-department-change", label: "Employee Department Change", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr/employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "A change of department" },
  { key: "hr-designation-change", label: "Employee Designation Change", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr/employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "A change of designation that is not recorded as a promotion" },
  { key: "hr-promotion", label: "Employee Promotion", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr/employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "A change recorded as a promotion in employment history" },
  { key: "hr-salary-revision", label: "Employee Salary Revision", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: true, href: "/hr/employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "A salary revision in employment history, or salary heads changed on the employee form" },
  { key: "hr-resignation", label: "Employee Resignation / Retirement", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr/employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "Setting an employee's status to Resigned or Retired" },
  { key: "hr-termination", label: "Employee Termination", group: PP, module: "Employees", product: "HRMS", kind: "action", amount: false, href: "/hr/employees/:id", sendBack: true, permission: "hr-employees.edit", trigger: "Setting an employee's status to Terminated" },

  /* ------------------------------------------------------------ Time & Leave */
  { key: "hr-attendance-daily", label: "Daily Attendance", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr/attendance", sendBack: true, permission: "hr-attendance.edit", trigger: "Saving the Daily Attendance sheet" },
  { key: "hr-attendance-monthly", label: "Monthly Attendance", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr/attendance/employee", sendBack: true, permission: "hr-attendance.edit", trigger: "Saving an employee's month on Monthly Attendance" },
  { key: "hr-attendance-correction", label: "Attendance Correction", group: PP, module: "Time & Leave", product: "HRMS", kind: "record", amount: false, href: "/hr/attendance/requests", sendBack: false, trigger: "An employee asking to correct or regularize a day" },
  { key: "hr-regularization-policy", label: "Attendance Regularization Policy", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr/attendance/regularization", sendBack: true, permission: "hr-attendance.edit", trigger: "Changing which days employees may ask to regularize" },
  { key: "hr-leave", label: "Leave Request", group: PP, module: "Time & Leave", product: "HRMS", kind: "record", amount: false, href: "/hr/leaves", sendBack: false, trigger: "An employee (or HR for them) applying for leave" },
  { key: "hr-leave-cancel", label: "Leave Cancellation", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr/leaves", sendBack: true, permission: "hr-leaves.approve", trigger: "HR cancelling leave that is already approved (it clears the leave days)" },
  { key: "hr-leave-balance", label: "Leave Balance Adjustment", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr/leaves/balances", sendBack: true, permission: "hr-leaves.allocate", trigger: "Changing an employee's leave allocation or carry-forward, or committing a year-end carry-forward" },
  { key: "hr-shift-assign", label: "Shift Assignment", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr/shifts/assign/employees", sendBack: true, permission: "hr-shifts.edit", trigger: "Assigning a shift to employees or contractors in bulk" },
  { key: "hr-shift-change", label: "Shift Definition Change", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr-shifts/:id", sendBack: true, permission: "hr-shifts.edit", trigger: "Adding, changing or deleting a shift (timings, weekly offs)" },
  { key: "hr-holiday-change", label: "Holiday Calendar Modification", group: PP, module: "Time & Leave", product: "HRMS", kind: "action", amount: false, href: "/hr-holidays", sendBack: true, permission: "hr-holidays.edit", trigger: "Adding, changing or deleting a holiday or holiday calendar, or assigning calendars to employees" },

  /* ----------------------------------------------------------------- Payroll */
  { key: "hr-payroll", label: "Payroll Run", group: PP, module: "Payroll", product: "HRMS", kind: "record", amount: true, href: "/hr/payroll/:id", sendBack: false, trigger: "Approving a draft payroll run" },
  { key: "hr-payroll-disburse", label: "Payroll Disbursement (Payslip Release)", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: true, href: "/hr/payroll/:id", sendBack: true, permission: "hr-payroll.approve", trigger: "Marking an approved payroll as paid, which releases its payslips" },
  { key: "hr-payroll-rollback", label: "Payroll Rollback", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: true, href: "/hr/payroll/:id", sendBack: true, permission: "hr-payroll.approve", trigger: "Rolling back an approved payroll run" },
  { key: "hr-variable-earning", label: "Bonus & Variable Earnings", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: true, href: "/hr/payroll/variables", sendBack: true, permission: "hr-payroll.process", trigger: "Saving or importing earning components (bonus, incentive, overtime…) on Variable Pay" },
  { key: "hr-variable-deduction", label: "Variable Deductions", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: true, href: "/hr/payroll/variables", sendBack: true, permission: "hr-payroll.process", trigger: "Saving or importing deduction components (canteen, recovery…) on Variable Pay" },
  { key: "hr-incentive", label: "Attendance Incentive", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: true, href: "/hr/payroll/incentive", sendBack: true, permission: "hr-payroll.process", trigger: "Adding the calculated attendance incentive to payroll" },
  { key: "hr-payroll-hold", label: "Payroll Block / Unblock", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: false, href: "/hr/payroll/holds", sendBack: true, permission: "hr-payroll.approve", trigger: "Blocking or unblocking an employee's salary for a month" },
  { key: "hr-arrear", label: "Salary Arrears", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: true, href: "/hr/payroll/arrears/day", sendBack: true, permission: "hr-payroll.process", trigger: "Raising a day arrear or DA arrears" },
  { key: "hr-payroll-setup", label: "Payroll Setup Change", group: PP, module: "Payroll", product: "HRMS", kind: "action", amount: false, href: "/hr/settings", sendBack: true, permission: "hr-payroll-settings.edit", trigger: "Changing payroll, PF or ESIC settings, salary structures, PT slabs, pay components or incentive matrices" },
  { key: "hr-fnf", label: "Full & Final Settlement", group: PP, module: "Payroll", product: "HRMS", kind: "record", amount: true, href: "/hr/payroll/fnf/:id", sendBack: false, trigger: "Approving a draft full & final settlement" },

  /* ------------------------------------------------------ Claims & Expenses */
  { key: "hr-claim", label: "Expense Claim (all categories)", group: PP, module: "Claims & Advances", product: "HRMS", kind: "record", amount: true, href: "/hr/claims", sendBack: false, trigger: "Any expense or reimbursement claim; travel and medical claims use their own scheme when one is set" },
  { key: "hr-claim-travel", label: "Travel Expense Claim", group: PP, module: "Claims & Advances", product: "HRMS", kind: "record", amount: true, href: "/hr/claims", sendBack: false, fallback: "hr-claim", trigger: "A claim in the Travel, Accommodation or Fuel category" },
  { key: "hr-claim-medical", label: "Medical Claim", group: PP, module: "Claims & Advances", product: "HRMS", kind: "record", amount: true, href: "/hr/claims", sendBack: false, fallback: "hr-claim", trigger: "A claim in the Medical category" },
  { key: "hr-claim-settlement", label: "Claim Settlement", group: PP, module: "Claims & Advances", product: "HRMS", kind: "action", amount: true, href: "/hr/claims/settlement", sendBack: true, permission: "hr-claims.approve", trigger: "Paying approved claims by cash, bank or cheque" },
  { key: "hr-advance", label: "Advance Request", group: PP, module: "Claims & Advances", product: "HRMS", kind: "record", amount: true, href: "/hr/loans/requests", sendBack: false, trigger: "An employee (or HR for them) requesting a salary advance or loan" },
  { key: "hr-advance-issue", label: "Advance / Loan Issue by HR", group: PP, module: "Claims & Advances", product: "HRMS", kind: "action", amount: true, href: "/hr/loans", sendBack: true, permission: "hr-loans.create", trigger: "HR issuing an advance or loan directly, without a request" },
  { key: "hr-advance-settlement", label: "Advance Settlement", group: PP, module: "Claims & Advances", product: "HRMS", kind: "action", amount: true, href: "/hr/loans/:id", sendBack: true, permission: "hr-loans.create", trigger: "Recording a repayment of an advance, or setting claims off against it" },

  /* ------------------------------------------------- Assets, labour, hiring */
  { key: "hr-asset-allocation", label: "Asset Allocation", group: PP, module: "Assets", product: "HRMS", kind: "action", amount: false, href: "/hr/assets/allocation", sendBack: true, permission: "hr-assets.edit", trigger: "Issuing an asset to an employee" },
  { key: "hr-asset-return", label: "Asset Return", group: PP, module: "Assets", product: "HRMS", kind: "action", amount: true, href: "/hr/assets/return", sendBack: true, permission: "hr-assets.edit", trigger: "Taking an asset back, including lost or damaged with a recovery" },
  { key: "hr-labour-attendance", label: "Labour Attendance", group: PP, module: "Contract Labour", product: "HRMS", kind: "action", amount: false, href: "/hr/contract-labour/attendance", sendBack: true, permission: "hr-contract-attendance.edit", trigger: "Saving a day's contract labour attendance (with its overtime)" },
  { key: "hr-job-opening", label: "Job Opening (Requisition)", group: PP, module: "Recruitment & Performance", product: "HRMS", kind: "action", amount: false, href: "/hr-job-openings", sendBack: true, permission: "hr-job-openings.create", trigger: "Opening a new vacancy" },
  { key: "hr-appraisal", label: "Appraisal", group: PP, module: "Recruitment & Performance", product: "HRMS", kind: "action", amount: false, href: "/hr-appraisals/:id", sendBack: true, permission: "hr-appraisals.edit", trigger: "Recording or changing an appraisal" },

  /* ------------------------------------------------------- ERP: trade chain */
  { key: "sales-quotations", label: "Sales Quotation", group: ERP_TRADE, module: "Sales", product: "ERP", kind: "record", amount: true, href: "/sales-quotations/:id", sendBack: true, trigger: "Sending the quotation on from draft" },
  { key: "sales-orders", label: "Sales Order", group: ERP_TRADE, module: "Sales", product: "ERP", kind: "record", amount: true, href: "/sales-orders/:id", sendBack: true, trigger: "Submitting the order for approval" },
  { key: "delivery-challans", label: "Delivery Challan", group: ERP_TRADE, module: "Sales", product: "ERP", kind: "record", amount: true, href: "/delivery-challans/:id", sendBack: true, trigger: "Dispatching the challan from draft" },
  { key: "sales-invoices", label: "Sales Invoice", group: ERP_TRADE, module: "Sales", product: "ERP", kind: "record", amount: true, href: "/sales-invoices/:id", sendBack: true, trigger: "Posting the invoice from draft" },
  { key: "sales-returns", label: "Sales Return", group: ERP_TRADE, module: "Sales", product: "ERP", kind: "record", amount: true, href: "/sales-returns/:id", sendBack: true, trigger: "Receiving the return from draft" },
  { key: "credit-notes", label: "Credit Note", group: ERP_TRADE, module: "Sales", product: "ERP", kind: "record", amount: true, href: "/credit-notes/:id", sendBack: true, trigger: "Issuing the credit note from draft" },
  { key: "purchase-orders", label: "Purchase Order", group: ERP_TRADE, module: "Purchase", product: "ERP", kind: "record", amount: true, href: "/purchase-orders/:id", sendBack: true, trigger: "Submitting the order for approval" },
  { key: "goods-receipts", label: "Goods Receipt", group: ERP_TRADE, module: "Purchase", product: "ERP", kind: "record", amount: true, href: "/goods-receipts/:id", sendBack: true, trigger: "Receiving the goods from draft" },
  { key: "purchase-invoices", label: "Purchase Invoice", group: ERP_TRADE, module: "Purchase", product: "ERP", kind: "record", amount: true, href: "/purchase-invoices/:id", sendBack: true, trigger: "Posting the bill from draft" },
  { key: "purchase-returns", label: "Purchase Return", group: ERP_TRADE, module: "Purchase", product: "ERP", kind: "record", amount: true, href: "/purchase-returns/:id", sendBack: true, trigger: "Dispatching the return from draft" },
  { key: "debit-notes", label: "Debit Note", group: ERP_TRADE, module: "Purchase", product: "ERP", kind: "record", amount: true, href: "/debit-notes/:id", sendBack: true, trigger: "Issuing the debit note from draft" },

  /* ---------------------------------------------------- ERP: money & stock */
  { key: "erp-receipt", label: "Money Received (Receipt)", group: ERP_MONEY, module: "Cash & Bank", product: "ERP", kind: "action", amount: true, href: "/receipts", sendBack: true, permission: "receipts.create", trigger: "Recording money received from a customer" },
  { key: "erp-payment", label: "Money Paid (Payment)", group: ERP_MONEY, module: "Cash & Bank", product: "ERP", kind: "action", amount: true, href: "/payments", sendBack: true, permission: "payments.create", trigger: "Recording a payment to a vendor" },
  { key: "erp-expense", label: "Business Expense", group: ERP_MONEY, module: "Cash & Bank", product: "ERP", kind: "action", amount: true, href: "/expenses", sendBack: true, permission: "expenses.create", trigger: "Recording a business expense" },
  { key: "erp-journal", label: "Journal Entry", group: ERP_MONEY, module: "Books", product: "ERP", kind: "action", amount: true, href: "/account-vouchers", sendBack: true, permission: "vouchers.create", trigger: "Posting a manual journal / contra voucher" },
  { key: "erp-stock-adjustment", label: "Stock Audit (Adjustment)", group: ERP_MONEY, module: "Inventory", product: "ERP", kind: "action", amount: false, href: "/stock-adjustments", sendBack: true, permission: "stock-adjustments.create", trigger: "Posting a stock adjustment after a physical count" },
] as const satisfies readonly ApprovalDocumentDef[];

export type ApprovalDocumentKey = (typeof APPROVAL_DOCUMENTS)[number]["key"];

export const APPROVER_TYPES = ["REPORTING_MANAGER", "SPECIFIC_USER", "USER_GROUP", "DEPARTMENT_HEAD", "DESIGNATED_ROLE"] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];
export const APPROVER_TYPE_LABELS: Record<ApproverType, string> = {
  REPORTING_MANAGER: "Reporting Manager",
  SPECIFIC_USER: "Specific User",
  USER_GROUP: "User Group",
  DEPARTMENT_HEAD: "Department Head",
  DESIGNATED_ROLE: "Designated Role",
};
export const APPROVER_TYPE_HINTS: Record<ApproverType, string> = {
  REPORTING_MANAGER: "The reporting manager of the employee the request is for (or of whoever raised it).",
  SPECIFIC_USER: "One named person approves.",
  USER_GROUP: "Anyone in the group can approve; the first decision counts.",
  DEPARTMENT_HEAD: "The head of the employee's department, as set on the HR department.",
  DESIGNATED_ROLE: "Anyone holding the chosen role can approve.",
};

export const MAX_APPROVAL_STAGES = 3;

/** Request statuses as stored. */
export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SENT_BACK", "CANCELLED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Status as shown: a pending request with at least one stage approved is
 * "Partially approved"; one with none yet is "Pending approval".
 */
export const APPROVAL_DISPLAY_STATUSES = ["PENDING_APPROVAL", "PARTIALLY_APPROVED", "APPROVED", "REJECTED", "SENT_BACK", "CANCELLED"] as const;
export type ApprovalDisplayStatus = (typeof APPROVAL_DISPLAY_STATUSES)[number];
export const APPROVAL_STATUS_LABELS: Record<ApprovalDisplayStatus, string> = {
  PENDING_APPROVAL: "Pending approval",
  PARTIALLY_APPROVED: "Partially approved",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT_BACK: "Sent back",
  CANCELLED: "Cancelled",
};

const BY_KEY = new Map<string, ApprovalDocumentDef>(APPROVAL_DOCUMENTS.map((d) => [d.key, d]));

export function approvalDocument(key: string): ApprovalDocumentDef | undefined {
  return BY_KEY.get(key);
}

export function approvalHref(key: string, recordId: string): string {
  const href = approvalDocument(key)?.href ?? "/";
  return href.includes(":id") ? (recordId ? href.replace(":id", recordId) : href.replace("/:id", "")) : href;
}

/** Groups → modules → documents, in catalog order, for pickers. */
export function groupedDocuments<T extends { group: string; module: string }>(docs: readonly T[]): { group: string; modules: { module: string; docs: T[] }[] }[] {
  const out: { group: string; modules: { module: string; docs: T[] }[] }[] = [];
  for (const d of docs) {
    let g = out.find((x) => x.group === d.group);
    if (!g) out.push((g = { group: d.group, modules: [] }));
    let m = g.modules.find((x) => x.module === d.module);
    if (!m) g.modules.push((m = { module: d.module, docs: [] }));
    m.docs.push(d);
  }
  return out;
}

/** Client helper: the module returned "sent for approval" instead of doing the work. */
export interface HeldResult {
  pendingApproval: true;
  approvalId: string;
  requestNo: string;
  approvalMessage: string;
}
export function isHeld(res: unknown): res is HeldResult {
  return Boolean(res && typeof res === "object" && (res as { pendingApproval?: unknown }).pendingApproval === true);
}
