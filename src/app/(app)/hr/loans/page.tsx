"use client";

import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";
import { formatMoney } from "@/lib/format/number";

const config: SimpleListConfig = {
  title: "Loans & advances",
  description: "Salary advances and loans, recovered in monthly instalments when payroll is approved.",
  apiPath: "/api/hr/loans",
  basePath: "/hr/loans",
  create: { label: "New loan / advance", href: "/hr/loans/new", permission: "hr-loans.create" },
  searchPlaceholder: "Search employee or loan no…",
  statusOptions: [
    { value: "ACTIVE", label: "Active" },
    { value: "CLOSED", label: "Closed" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  emptyText: "No loans or advances",
  columns: [
    { key: "loanNumber", label: "Loan", link: true },
    { key: "employeeName", label: "Employee" },
    { key: "loanType", label: "Type" },
    { key: "issueDate", label: "Issued", type: "date" },
    { key: "amount", label: "Amount", type: "money" },
    { key: "emiAmount", label: "Instalment", type: "money" },
    { key: "repaidAmount", label: "Recovered", type: "money" },
    { key: "outstanding", label: "Outstanding", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ],
  summary: (r) => (
    <span className="activeFilterNote">
      Outstanding on active loans: <strong>{formatMoney(String(r.totalOutstanding ?? "0"))}</strong>
    </span>
  ),
};

export default function LoansPage() {
  return <SimpleListView config={config} />;
}
