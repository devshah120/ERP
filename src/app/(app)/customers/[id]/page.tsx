"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import CustomerForm, {
  customerFormToPayload,
  emptyCustomerForm,
  type CustomerFormState,
} from "../CustomerForm";

interface CustomerDTO {
  id: string;
  customerCode: string;
  name: string;
  companyName?: string;
  contactPerson?: string;
  email?: string;
  phone: string;
  alternatePhone?: string;
  billingAddress: CustomerFormState["billingAddress"];
  shippingAddress?: CustomerFormState["billingAddress"];
  gstin?: string;
  creditLimit: string;
  creditDays: number;
  paymentTerms?: string;
  currency: string;
  customerGroup?: string;
  openingBalance: string;
  openingBalanceType: "DEBIT" | "CREDIT";
  status: "ACTIVE" | "INACTIVE";
  notes?: string;
}

function toFormState(dto: CustomerDTO): Partial<CustomerFormState> {
  return {
    name: dto.name,
    companyName: dto.companyName ?? "",
    contactPerson: dto.contactPerson ?? "",
    email: dto.email ?? "",
    phone: dto.phone,
    alternatePhone: dto.alternatePhone ?? "",
    billingAddress: { ...emptyCustomerForm.billingAddress, ...dto.billingAddress },
    shippingSameAsBilling: !dto.shippingAddress,
    shippingAddress: dto.shippingAddress
      ? { ...emptyCustomerForm.shippingAddress, ...dto.shippingAddress }
      : emptyCustomerForm.shippingAddress,
    gstin: dto.gstin ?? "",
    creditLimit: dto.creditLimit,
    creditDays: String(dto.creditDays),
    paymentTerms: dto.paymentTerms ?? "",
    currency: dto.currency,
    customerGroup: dto.customerGroup ?? "",
    openingBalance: dto.openingBalance,
    openingBalanceType: dto.openingBalanceType,
    notes: dto.notes ?? "",
    status: dto.status,
  };
}

export default function EditCustomerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CustomerDTO>(`/api/customers/${params.id}`)
      .then(setCustomer)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load customer"))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function handleSubmit(form: CustomerFormState) {
    const updated = await apiFetch<CustomerDTO>(`/api/customers/${params.id}`, {
      method: "PATCH",
      body: JSON.stringify(customerFormToPayload(form)),
    });
    setCustomer(updated);
    router.refresh();
  }

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">{customer ? customer.name : "Customer"}</h1>
          <div className="pageSubtitle">
            <Link href="/customers">&larr; Back to customers</Link>
            {customer && ` · ${customer.customerCode}`}
          </div>
        </div>
      </div>

      {loading && <p style={{ opacity: 0.6 }}>Loading...</p>}
      {error && <div className="banner bannerError">{error}</div>}

      {customer && (
        <div className="formCard">
          <CustomerForm
            key={customer.id}
            initial={toFormState(customer)}
            submitLabel="Save changes"
            showStatus
            onSubmit={handleSubmit}
          />
        </div>
      )}
    </>
  );
}
