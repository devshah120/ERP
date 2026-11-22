"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import AccessDenied from "@/components/ui/AccessDenied";
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
  const { hasPermission } = useAuth();
  const employees = useEmployeeOptions();

  if (!hasPermission("hr-leaves.create")) return <AccessDenied detail="Missing required permission: hr-leaves.create" />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/leaves" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Leave requests
          </Link>
        }
        title="File leave"
        description="Record leave for an employee. It starts as pending until someone with approval rights approves it."
      />
      <section className="formSection" style={{ maxWidth: "52rem" }}>
        <div className="formSectionBody">
          <LeaveForm
            employees={employees}
            initialEmployeeId={params.get("employeeId") ?? ""}
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
