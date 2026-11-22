"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { MONTH_NAMES } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";

interface VoucherRef {
  id: string;
  number: string;
  status: string;
  date: string;
  amount: string;
}

interface Data {
  enabled: boolean;
  reason: string | null;
  items: { id: string; runNumber: string; month: number; year: number; status: string; totalNet: string; accrual: VoucherRef | null; payment: VoucherRef | null; reversal: VoucherRef | null; missing: boolean }[];
}

/** Voucher posting: payroll journals in the ERP general ledger, and posting any that are missing. */
export default function PayrollVouchersPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [posting, setPosting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<Data>("/api/hr/payroll/vouchers"));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function post(runId: string) {
    setPosting(runId);
    try {
      const r = await apiFetch<{ posted: string[] }>("/api/hr/payroll/vouchers", { method: "POST", body: JSON.stringify({ runId }) });
      toast.success(r.posted.length ? `Posted ${r.posted.join(", ")}` : "Nothing was missing");
      load();
    } catch (err) {
      toast.error("Could not post", err instanceof ApiError ? err.message : undefined);
    } finally {
      setPosting(null);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  const canPost = hasPermission("hr-payroll.approve") && Boolean(data?.enabled);
  const canSeeLedger = hasPermission("vouchers.view");
  const ref = (v: VoucherRef | null) =>
    v ? (
      <>
        {canSeeLedger ? (
          <Link href={`/account-vouchers/${v.id}`} className="cellLink cellMono">
            {v.number}
          </Link>
        ) : (
          <span className="cellMono">{v.number}</span>
        )}
        <div className="hrMuted">
          {v.date} · {formatMoney(v.amount)}
          {v.status === "CANCELLED" ? " · reversed" : ""}
        </div>
      </>
    ) : (
      <span className="cellMuted">—</span>
    );

  return (
    <>
      <PageHeader
        title="Voucher posting"
        description="Approving payroll posts the month's salary journal to the general ledger (salary cost, PF/ESI/PT/TDS payable, loan recovery, net pay due); marking it paid posts the bank or cash payment; rolling it back posts a reversal."
      />

      {data && !data.enabled && (
        <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
          <span>{data.reason}</span>
        </div>
      )}

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Payroll</th>
              <th>Status</th>
              <th className="numCell">Net pay</th>
              <th>Salary journal</th>
              <th>Payment</th>
              <th>Reversal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={7} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={7}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load vouchers."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No approved payroll yet" description="Vouchers are posted when a payroll is approved." />
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/payroll/${r.id}`} className="cellLink cellMono">
                    {r.runNumber}
                  </Link>
                  <div className="hrMuted">
                    {MONTH_NAMES[r.month - 1]} {r.year}
                  </div>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="numCell">{formatMoney(r.totalNet)}</td>
                <td>{ref(r.accrual)}</td>
                <td>{ref(r.payment)}</td>
                <td>{ref(r.reversal)}</td>
                <td style={{ textAlign: "right" }}>
                  {r.missing && canPost && (
                    <button type="button" className="button buttonPrimary buttonSm" onClick={() => post(r.id)} disabled={posting === r.id}>
                      {posting === r.id && <span className="spinner" />} Post voucher
                    </button>
                  )}
                  {r.missing && !canPost && <span className="hrMuted">Not posted</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
