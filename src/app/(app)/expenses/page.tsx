"use client";

import SimpleListView, { type SimpleListConfig } from "@/components/table/SimpleListView";
import { formatMoney } from "@/lib/format/number";

const config: SimpleListConfig = {
  title: "Expenses",
  description: "Rent, salaries, utilities and petty cash. Each one posts to the ledger as it is recorded.",
  apiPath: "/api/expenses",
  basePath: "/expenses",
  create: { label: "Record expense", href: "/expenses/new", permission: "expenses.create" },
  searchPlaceholder: "Search number, payee, head…",
  dateFilter: true,
  statusOptions: [
    { value: "POSTED", label: "Posted" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  emptyText: "No expenses recorded yet",
  columns: [
    { key: "expenseNumber", label: "Expense No", link: true },
    { key: "expenseDate", label: "Date", type: "date" },
    { key: "expenseAccountName", label: "Expense head" },
    { key: "payee", label: "Paid to" },
    { key: "paidFromAccountName", label: "Paid from" },
    { key: "paymentMode", label: "Mode" },
    { key: "totalAmount", label: "Amount", type: "money" },
    { key: "status", label: "Status", type: "status" },
  ],
  summary: (r) => (
    <span className="activeFilterNote">
      Total of posted expenses matching these filters: <strong>{formatMoney(String(r.totalAmount ?? "0"))}</strong>
    </span>
  ),
};

export default function ExpensesPage() {
  return <SimpleListView config={config} />;
}
