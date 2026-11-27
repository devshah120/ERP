/**
 * The HR reports, in sidebar order. Kept free of server imports so the
 * sidebar (navigation.ts) and the report screen can use it as well as the
 * API (insights.ts builds each report).
 */
export const HR_REPORTS = [
  {
    key: "headcount",
    label: "Employee master (headcount)",
    needs: "none",
    description: "Everyone currently employed, with department, designation and monthly gross.",
    keywords: "employee master headcount staff list",
  },
  {
    key: "attendance-summary",
    label: "Attendance summary",
    needs: "month",
    description: "Present, absent, leave, late and loss-of-pay days per employee for a month.",
    keywords: "attendance present absent late lop monthly",
  },
  {
    key: "yearly-attendance",
    label: "Yearly attendance",
    needs: "period",
    description: "Each employee's calendar or financial year: days employed, weekly offs, holidays, working days, present, leave and absent days.",
    keywords: "yearly annual financial year working days holidays weekly off present absent leave attendance",
  },
  {
    key: "weekoff-working",
    label: "Week-off & holiday working",
    needs: "period",
    description: "Employees who worked on their weekly off or a holiday, with how many days, the hours and the dates.",
    keywords: "week off weekly off holiday working worked sunday comp off",
  },
  {
    key: "attendance-incentive",
    label: "Attendance incentive",
    needs: "year",
    description: "Days counted, the slab reached and the incentive per employee, from the first active incentive matrix.",
    keywords: "attendance incentive matrix slab reward days salary january",
  },
  { key: "leave-register", label: "Leave register", needs: "year", description: "Every leave request filed in a year.", keywords: "leave register applications yearly" },
  {
    key: "salary-register",
    label: "Salary register",
    needs: "month",
    description: "Each employee's earnings, deductions and net pay for a month's payroll.",
    keywords: "salary register payroll earnings deductions net pay",
  },
  {
    key: "form-16",
    label: "Form 16 (salary & TDS)",
    needs: "fy",
    description: "Each employee's salary, deductions and TDS for a financial year (Apr–Mar) from approved payrolls, with TDS by quarter for Part A and the salary break-up for Part B.",
    keywords: "form 16 form16 tds income tax salary certificate part a part b quarterly 24q pan",
  },
  { key: "pf-statement", label: "PF statement (ECR)", needs: "month", description: "EPF/EPS wages and contributions in the EPFO ECR layout.", keywords: "pf epf eps ecr provident fund statement" },
  { key: "esi-statement", label: "ESI statement", needs: "month", description: "ESI wages and employee/employer contributions.", keywords: "esi esic statement contribution" },
  {
    key: "bank-transfer",
    label: "Bank transfer sheet",
    needs: "month",
    description: "Account, IFSC and net pay for uploading salary payments to your bank.",
    keywords: "bank transfer salary upload ifsc neft",
  },
  {
    key: "loans-outstanding",
    label: "Loans outstanding",
    needs: "none",
    description: "Active loans and advances with what is still to be recovered.",
    keywords: "loans advances outstanding recovery emi",
  },
  {
    key: "asset-register",
    label: "Asset register",
    needs: "none",
    description: "Every asset with its category, serial number, value, condition, status and who holds it now.",
    keywords: "asset register list laptop inventory value status",
  },
  {
    key: "assets-with-employees",
    label: "Assets with employees",
    needs: "none",
    description: "Assets currently allocated, with the employee, since when, days held and whether they are overdue.",
    keywords: "assets with employees allocated held overdue pending return",
  },
  {
    key: "asset-movement",
    label: "Asset allocation & returns",
    needs: "period",
    description: "Assets allocated and returned in a calendar or financial year, with outcome, condition and amounts to recover.",
    keywords: "asset allocation return movement history issued returned lost damaged recovery",
  },
  { key: "exits", label: "Exits / attrition", needs: "year", description: "Employees who left in a year, with an approximate attrition rate.", keywords: "exits attrition resigned left turnover" },
] as const;

export type HrReportKey = (typeof HR_REPORTS)[number]["key"];

/** Reports listed under "Incentive Reports" in the sidebar instead of "HR Reports". */
export const INCENTIVE_REPORT_KEYS: ReadonlySet<string> = new Set(["yearly-attendance", "weekoff-working", "attendance-incentive"]);

export function hrReport(key: string) {
  return HR_REPORTS.find((r) => r.key === key);
}
