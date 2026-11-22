"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import AccessDenied from "@/components/ui/AccessDenied";
import ClaimForm from "@/components/hr/ClaimForm";
import { useEmployeeOptions } from "@/components/hr/HrKit";
import { IconArrowLeft } from "@/components/icons";

export default function NewClaimPage() {
  const router = useRouter();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const employees = useEmployeeOptions();

  if (!hasPermission("hr-claims.create")) return <AccessDenied detail="Missing required permission: hr-claims.create" />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/hr/claims" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Expense claims
          </Link>
        }
        title="Record expense claim"
        description="An out-of-pocket expense to pay back to an employee. It needs approval before payroll includes it."
      />
      <section className="formSection" style={{ maxWidth: "52rem" }}>
        <div className="formSectionBody">
          <ClaimForm
            employees={employees}
            submitUrl="/api/hr/claims"
            onDone={(r) => {
              toast.success(`${r.claimNumber} recorded`);
              router.push("/hr/claims?status=PENDING");
            }}
            onCancel={() => router.push("/hr/claims")}
          />
        </div>
      </section>
    </>
  );
}
