"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/(app)/AuthProvider";

/** /hr opens the HR dashboard, or the employee's own workspace for self-service logins. */
export default function HrIndexPage() {
  const { me, hasPermission } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!me) return;
    router.replace(hasPermission("hr-dashboard.view") ? "/hr/dashboard" : "/hr/me");
  }, [me, hasPermission, router]);
  return null;
}
