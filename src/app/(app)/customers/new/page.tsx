"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import CustomerForm, { customerFormToPayload, type CustomerFormState } from "../CustomerForm";

export default function NewCustomerPage() {
  const router = useRouter();
  const toast = useToast();

  async function handleSubmit(form: CustomerFormState) {
    const customer = await apiFetch<{ id: string; name?: string }>("/api/customers", {
      method: "POST",
      body: JSON.stringify(customerFormToPayload(form)),
    });
    toast.success("Customer created", customer.name ?? form.name);
    router.push(`/customers/${customer.id}`);
  }

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">New customer</h1>
          <div className="pageSubtitle">
            <Link href="/customers">&larr; Back to customers</Link>
          </div>
        </div>
      </div>

      <div className="formCard">
        <CustomerForm submitLabel="Create customer" onSubmit={handleSubmit} />
      </div>
    </>
  );
}
