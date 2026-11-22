"use client";

import { useCallback, useEffect, useState } from "react";
import Decimal from "decimal.js";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { formatMoney } from "@/lib/format/number";
import { fmtDate } from "./HrKit";
import { IconArrowLeft, IconPrint } from "@/components/icons";

interface Line {
  code: string;
  label: string;
  amount: string;
}

interface Payslip {
  id: string;
  payrollRunId: string;
  period: string;
  status: string;
  employee: {
    code: string;
    name: string;
    department: string;
    designation: string;
    dateOfJoining?: string;
    panNumber?: string;
    uanNumber?: string;
    esiNumber?: string;
    bankName?: string;
    bankAccountNumber?: string;
    ifscCode?: string;
    paymentMode?: string;
  };
  daysInMonth: number;
  payableDays: number;
  lopDays: number;
  presentDays: number;
  paidLeaveDays: number;
  holidays: number;
  weeklyOffs: number;
  earnings: Line[];
  deductions: Line[];
  employerContributions: Line[];
  grossEarnings: string;
  reimbursements: string;
  totalDeductions: string;
  netPay: string;
  netPayInWords: string;
  business: { name: string; tradeName: string; address: string; logoUrl: string | null };
}

/** A printable payslip. `apiUrl` decides whose: HR's view or the employee's own. */
export default function PayslipView({ apiUrl, backHref, backLabel }: { apiUrl: string; backHref: string; backLabel: string }) {
  const [p, setP] = useState<Payslip | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setP(await apiFetch<Payslip>(apiUrl));
    } catch (err) {
      setError(err);
    }
  }, [apiUrl]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  if (error) return <ErrorState message={error instanceof ApiError ? error.message : "Could not load the payslip."} onRetry={load} />;
  if (!p) return <SkeletonBlock lines={10} />;

  const earningsTotal = new Decimal(p.grossEarnings).plus(p.reimbursements);
  const masked = p.employee.bankAccountNumber ? `••••${p.employee.bankAccountNumber.slice(-4)}` : "—";

  return (
    <>
      <div className="noPrint" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link href={backHref} className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <IconArrowLeft /> {backLabel}
        </Link>
        <button type="button" className="button buttonPrimary" onClick={() => window.print()}>
          <IconPrint /> Print / save PDF
        </button>
      </div>

      {p.status === "DRAFT" && (
        <div className="banner bannerWarning noPrint" style={{ marginBottom: "1rem" }}>
          <span>Draft: this payroll is not approved yet, so the figures can still change.</span>
        </div>
      )}

      <article className="payslip">
        <header className="payslipHead">
          <div>
            <h2>{p.business.name || p.business.tradeName}</h2>
            {p.business.address && <div className="hrMuted">{p.business.address}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>Payslip</div>
            <div className="hrMuted">{p.period}</div>
          </div>
        </header>

        <div className="payslipMeta">
          <div>
            <span>Employee</span>
            <strong>{p.employee.name}</strong>
          </div>
          <div>
            <span>Employee code</span>
            <span>{p.employee.code}</span>
          </div>
          <div>
            <span>Designation</span>
            <span>{p.employee.designation || "—"}</span>
          </div>
          <div>
            <span>Department</span>
            <span>{p.employee.department || "—"}</span>
          </div>
          <div>
            <span>Date of joining</span>
            <span>{fmtDate(p.employee.dateOfJoining)}</span>
          </div>
          <div>
            <span>PAN</span>
            <span>{p.employee.panNumber || "—"}</span>
          </div>
          <div>
            <span>UAN</span>
            <span>{p.employee.uanNumber || "—"}</span>
          </div>
          <div>
            <span>ESI number</span>
            <span>{p.employee.esiNumber || "—"}</span>
          </div>
          <div>
            <span>Bank</span>
            <span>{p.employee.paymentMode === "BANK" ? `${p.employee.bankName || ""} ${masked}`.trim() : p.employee.paymentMode}</span>
          </div>
          <div>
            <span>Days paid</span>
            <span>
              {p.payableDays} of {p.daysInMonth}
              {p.lopDays ? ` (LOP ${p.lopDays})` : ""}
            </span>
          </div>
        </div>

        <div className="payslipCols">
          <table className="payslipTable">
            <thead>
              <tr>
                <th>Earnings</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {p.earnings.map((l) => (
                <tr key={l.code}>
                  <td>{l.label}</td>
                  <td>{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total earnings</td>
                <td>{formatMoney(earningsTotal.toFixed(2))}</td>
              </tr>
            </tfoot>
          </table>
          <table className="payslipTable">
            <thead>
              <tr>
                <th>Deductions</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {p.deductions.length === 0 && (
                <tr>
                  <td colSpan={2} className="hrMuted">
                    None
                  </td>
                </tr>
              )}
              {p.deductions.map((l) => (
                <tr key={l.code}>
                  <td>{l.label}</td>
                  <td>{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total deductions</td>
                <td>{formatMoney(p.totalDeductions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="payslipNet">
          <div>
            <div className="hrMuted">Net pay</div>
            <strong>{formatMoney(p.netPay)}</strong>
          </div>
          <div className="hrMuted" style={{ maxWidth: "28rem", textAlign: "right" }}>
            {p.netPayInWords}
          </div>
        </div>

        {p.employerContributions.length > 0 && (
          <p className="hrMuted" style={{ marginTop: "0.875rem" }}>
            Employer contributions (not deducted from pay): {p.employerContributions.map((l) => `${l.label} ${formatMoney(l.amount)}`).join(" · ")}
          </p>
        )}
        <p className="hrMuted" style={{ marginTop: "1.5rem", marginBottom: 0 }}>
          Attendance: {p.presentDays} present · {p.paidLeaveDays} paid leave · {p.holidays} holidays · {p.weeklyOffs} weekly offs. This is a computer-generated payslip and needs no signature.
        </p>
      </article>
    </>
  );
}
