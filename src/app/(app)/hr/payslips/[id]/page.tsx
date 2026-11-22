"use client";

import { useParams } from "next/navigation";
import PayslipView from "@/components/hr/PayslipView";

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  return <PayslipView apiUrl={`/api/hr/payslips/${id}`} backHref="/hr/payroll" backLabel="Payroll" />;
}
