"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import AccessDenied from "@/components/ui/AccessDenied";
import { EmptyState } from "@/components/ui/States";
import LeaveForm from "@/components/hr/LeaveForm";
import { useEmployeeOptions } from "@/components/hr/HrKit";
import { IconArrowLeft } from "@/components/icons";

export default function NewLeavePage() {
  return (
    <Suspense fallback={null}>
      <NewLeave />
    </Suspense>
  );
}

function NewLeave() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { hasPermission, me } = useAuth();
  const allEmployees = useEmployeeOptions();
  // Everyone files only their own leave; the Owner may file for anyone (e.g. staff without a sign-in).
  const forAnyone = Boolean(me?.permissions.includes("*"));
  const ownId = me?.employeeId ?? "";
  const employees = forAnyone ? allEmployees : allEmployees && allEmployees.filter((o) => o.id === ownId);

  if (!hasPermission("hr-leaves.create")) return <AccessDenied detail="Missing required permission: hr-leaves.create" />;
  if (me && !forAnyone && !ownId) {
    return (
      <EmptyState
        title="Your login isn't linked to an employee record"
        description="Leave is filed for your own employee record. Ask HR to link your sign-in to it (Employee profile → Give portal access)."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/leaves" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Leave requests
          </Link>
        }
        title="File leave"
        description={forAnyone ? "Record leave for an employee. It starts as pending until someone with approval rights approves it." : "Apply for your own leave. It starts as pending until your manager or HR approves it."}
      />
      <section className="formSection" style={{ maxWidth: "52rem" }}>
        <div className="formSectionBody">
          <LeaveForm
            employees={employees}
            initialEmployeeId={forAnyone ? params.get("employeeId") ?? "" : ownId}
            employeeLocked={!forAnyone}
            submitUrl="/api/hr/leaves"
            onDone={(r) => {
              toast.success(`${r.leaveNumber} filed`, `${r.days} day(s), waiting for approval.`);
              router.push("/hr/leaves?status=PENDING");
            }}
            onCancel={() => router.push("/hr/leaves")}
          />
        </div>
      </section>
    </>
  );
}
