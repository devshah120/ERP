"use client";

import { useParams } from "next/navigation";
import PayslipView from "@/components/hr/PayslipView";

export default function MyPayslipPage() {
  const { id } = useParams<{ id: string }>();
  return <PayslipView apiUrl={`/api/hr/self/payslips/${id}`} backHref="/hr/me?tab=payslips" backLabel="My payslips" />;
}
