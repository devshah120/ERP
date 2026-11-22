"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import CorrectionRequests, { type CorrectionSummary } from "@/components/hr/CorrectionRequests";

const decideUrl = (id: string) => `/api/hr/attendance/requests/${id}`;

/** HR's queue of attendance correction requests from every employee. */
export default function CorrectionRequestsPage() {
  const { hasPermission } = useAuth();
  const [summary, setSummary] = useState<CorrectionSummary | null>(null);
  const onSummary = useCallback((s: CorrectionSummary) => setSummary(s), []);

  return (
    <>
      <PageHeader
        title="Attendance corrections"
        count={summary?.total ?? null}
        description={
          summary
            ? `${summary.pending} waiting for a decision. Reporting managers can also decide their own team's requests. Approving writes the day to the attendance sheet.`
            : "Employees' requests to fix a missed punch, on-duty work or wrong times."
        }
      />
      <CorrectionRequests listUrl="/api/hr/attendance/requests" decideUrl={decideUrl} canDecide={hasPermission("hr-attendance.edit")} onSummary={onSummary} />
    </>
  );
}
