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
  { key: "leave-register", label: "Leave register", needs: "year", description: "Every leave request filed in a year.", keywords: "leave register applications yearly" },
  {
    key: "salary-register",
    label: "Salary register",
    needs: "month",
    description: "Each employee's earnings, deductions and net pay for a month's payroll.",
    keywords: "salary register payroll earnings deductions net pay",
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
  { key: "exits", label: "Exits / attrition", needs: "year", description: "Employees who left in a year, with an approximate attrition rate.", keywords: "exits attrition resigned left turnover" },
] as const;

export type HrReportKey = (typeof HR_REPORTS)[number]["key"];

export function hrReport(key: string) {
  return HR_REPORTS.find((r) => r.key === key);
}
