"use client";

import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";
import { formatMoney } from "@/lib/format/number";

const config: SimpleListConfig = {
  title: "Advance settlement",
  description: "Issued advances and loans. They are recovered in instalments when payroll is approved; open one to record a repayment or set approved claims off against it.",
  apiPath: "/api/hr/loans",
  basePath: "/hr/loans",
  create: { label: "Issue advance directly", href: "/hr/loans/new", permission: "hr-loans.create" },
  searchPlaceholder: "Search employee or loan no…",
  statusOptions: [
    { value: "ACTIVE", label: "Outstanding" },
    { value: "CLOSED", label: "Fully recovered" },
    { value: "REQUESTED", label: "Requested (not yet approved)" },
    { value: "REJECTED", label: "Rejected" },
    { value: "CANCELLED", label: "Cancelled / withdrawn" },
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

export default function AdvanceSettlementPage() {
  return <SimpleListView config={config} />;
}
