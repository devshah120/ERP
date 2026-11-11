import { redirect } from "next/navigation";

/**
 * There is no report catalogue page any more: every report is listed in the
 * sidebar. Old links and bookmarks to /reports land on the Sales Register.
 */
export default function ReportsIndexPage() {
  redirect("/reports/sales-register");
}
