import Decimal from "decimal.js";

/**
 * Payslip arithmetic, kept pure (no database) so it can be unit-tested and so
 * a draft payroll and its recomputation always agree. Every amount is a
 * Decimal; nothing here touches a JavaScript float.
 *
 * Statutory rules (India, as commonly configured for SMEs):
 * - Earnings are prorated by payable days: amount × payable ÷ days in month.
 * - PF: 12% of earned basic, on wages capped at ₹15,000; employer matches 12%.
 * - ESI: when the full-month gross is ₹21,000 or less — employee 0.75% and
 *   employer 3.25% of earned gross, each rounded up to the rupee.
 * - Professional tax: a fixed monthly amount per employee (state slabs vary).
 * - TDS: a fixed monthly amount entered on the employee.
 * - Loan instalments are taken last and only up to what the salary can bear.
 */

export const PF_RATE = new Decimal("0.12");
export const PF_WAGE_CEILING = new Decimal("15000");
export const ESI_EMPLOYEE_RATE = new Decimal("0.0075");
export const ESI_EMPLOYER_RATE = new Decimal("0.0325");
export const ESI_GROSS_LIMIT = new Decimal("21000");

export interface SalaryStructure {
  basic: Decimal.Value;
  hra: Decimal.Value;
  conveyance: Decimal.Value;
  specialAllowance: Decimal.Value;
  otherAllowance: Decimal.Value;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  professionalTax: Decimal.Value;
  monthlyTds: Decimal.Value;
}

export interface LoanDue {
  loanId: string;
  emi: Decimal.Value;
  outstanding: Decimal.Value;
}

export interface PayslipInput {
  structure: SalaryStructure;
  daysInMonth: number;
  lopDays: number;
  loans: LoanDue[];
  /** Approved expense claims paid back with this salary. */
  reimbursements: Decimal.Value;
}

export interface PayLine {
  code: string;
  label: string;
  amount: Decimal;
}

export interface PayslipResult {
  payableDays: number;
  earnings: PayLine[];
  deductions: PayLine[];
  employerContributions: PayLine[];
  grossEarnings: Decimal;
  reimbursements: Decimal;
  totalDeductions: Decimal;
  netPay: Decimal;
  pfWages: Decimal;
  esiWages: Decimal;
  loanDeductions: { loanId: string; amount: Decimal }[];
}

const money = (v: Decimal.Value) => new Decimal(v || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const rupee = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
const rupeeUp = (v: Decimal) => v.toDecimalPlaces(0, Decimal.ROUND_CEIL);

export function computePayslip(input: PayslipInput): PayslipResult {
  const s = input.structure;
  const days = Math.max(1, input.daysInMonth);
  const lop = Math.min(Math.max(0, input.lopDays), days);
  const payable = new Decimal(days).minus(lop);
  const ratio = payable.div(days);
  const prorate = (v: Decimal.Value) => money(new Decimal(v || 0).times(ratio));

  const components: [string, string, Decimal.Value][] = [
    ["BASIC", "Basic", s.basic],
    ["HRA", "House rent allowance", s.hra],
    ["CONV", "Conveyance", s.conveyance],
    ["SPECIAL", "Special allowance", s.specialAllowance],
    ["OTHER", "Other allowance", s.otherAllowance],
  ];
  const earnings: PayLine[] = components
    .map(([code, label, full]) => ({ code, label, amount: prorate(full) }))
    .filter((l) => l.amount.gt(0));
  const gross = earnings.reduce((t, l) => t.plus(l.amount), new Decimal(0));
  const fullGross = components.reduce((t, [, , v]) => t.plus(new Decimal(v || 0)), new Decimal(0));
  const earnedBasic = earnings.find((l) => l.code === "BASIC")?.amount ?? new Decimal(0);

  const deductions: PayLine[] = [];
  const employer: PayLine[] = [];

  let pfWages = new Decimal(0);
  if (s.pfApplicable && earnedBasic.gt(0)) {
    pfWages = Decimal.min(earnedBasic, PF_WAGE_CEILING);
    const pf = rupee(pfWages.times(PF_RATE));
    deductions.push({ code: "PF", label: "Provident fund", amount: pf });
    employer.push({ code: "PF_ER", label: "Employer PF", amount: pf });
  }

  let esiWages = new Decimal(0);
  if (s.esiApplicable && fullGross.lte(ESI_GROSS_LIMIT) && gross.gt(0)) {
    esiWages = gross;
    deductions.push({ code: "ESI", label: "ESI", amount: rupeeUp(gross.times(ESI_EMPLOYEE_RATE)) });
    employer.push({ code: "ESI_ER", label: "Employer ESI", amount: rupeeUp(gross.times(ESI_EMPLOYER_RATE)) });
  }

  if (s.ptApplicable && gross.gt(0) && new Decimal(s.professionalTax || 0).gt(0)) {
    deductions.push({ code: "PT", label: "Professional tax", amount: money(s.professionalTax) });
  }

  if (new Decimal(s.monthlyTds || 0).gt(0) && gross.gt(0)) {
    deductions.push({ code: "TDS", label: "Income tax (TDS)", amount: money(s.monthlyTds) });
  }

  // Loans come last and never push take-home below zero.
  let room = gross.minus(deductions.reduce((t, l) => t.plus(l.amount), new Decimal(0)));
  const loanDeductions: { loanId: string; amount: Decimal }[] = [];
  for (const loan of input.loans) {
    if (room.lte(0)) break;
    const due = Decimal.min(money(loan.emi), money(loan.outstanding), room);
    if (due.lte(0)) continue;
    loanDeductions.push({ loanId: loan.loanId, amount: due });
    room = room.minus(due);
  }
  const loanTotal = loanDeductions.reduce((t, l) => t.plus(l.amount), new Decimal(0));
  if (loanTotal.gt(0)) deductions.push({ code: "LOAN", label: "Loan / advance recovery", amount: loanTotal });

  const totalDeductions = deductions.reduce((t, l) => t.plus(l.amount), new Decimal(0));
  const reimbursements = money(input.reimbursements);
  if (reimbursements.gt(0)) earnings.push({ code: "REIMB", label: "Reimbursements", amount: reimbursements });

  return {
    payableDays: payable.toNumber(),
    earnings,
    deductions,
    employerContributions: employer,
    grossEarnings: gross,
    reimbursements,
    totalDeductions,
    netPay: gross.plus(reimbursements).minus(totalDeductions),
    pfWages,
    esiWages,
    loanDeductions,
  };
}
