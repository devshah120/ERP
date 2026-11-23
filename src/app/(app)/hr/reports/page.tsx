import { redirect } from "next/navigation";

/** HR Reports opens on the salary register; every report has its own entry in the sidebar. */
export default function HrReportsIndex() {
  redirect("/hr/reports/salary-register");
}
