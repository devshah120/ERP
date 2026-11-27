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

/**
 * PF, ESI and professional-tax rules, from HR Settings (PF Settings, ESIC
 * Settings, PT Slabs). Left out, the statutory defaults above apply.
 */
export interface StatutoryRules {
  pfEnabled: boolean;
  pfEmployeeRate: Decimal.Value;
  pfEmployerRate: Decimal.Value;
  pfWageCeiling: Decimal.Value;
  /** true: PF on wages up to the ceiling; false: PF on the whole earned basic. */
  pfCapAtCeiling: boolean;
  esiEnabled: boolean;
  esiGrossLimit: Decimal.Value;
  esiEmployeeRate: Decimal.Value;
  esiEmployerRate: Decimal.Value;
  /** Professional-tax slabs on earned gross; empty = each employee's fixed monthly amount. */
  ptSlabs: { minGross: Decimal.Value; maxGross: Decimal.Value; amount: Decimal.Value; februaryAmount: Decimal.Value }[];
}

export const DEFAULT_RULES: StatutoryRules = {
  pfEnabled: true,
  pfEmployeeRate: PF_RATE,
  pfEmployerRate: PF_RATE,
  pfWageCeiling: PF_WAGE_CEILING,
  pfCapAtCeiling: true,
  esiEnabled: true,
  esiGrossLimit: ESI_GROSS_LIMIT,
  esiEmployeeRate: ESI_EMPLOYEE_RATE,
  esiEmployerRate: ESI_EMPLOYER_RATE,
  ptSlabs: [],
};

/** The slab amount for an earned gross (maxGross 0 = no upper limit); null when no slab covers it. */
export function ptFromSlabs(slabs: StatutoryRules["ptSlabs"], gross: Decimal, month?: number): Decimal | null {
  const slab = slabs.find((s) => {
    const max = new Decimal(s.maxGross || 0);
    return gross.gte(new Decimal(s.minGross || 0)) && (max.lte(0) || gross.lte(max));
  });
  if (!slab) return null;
  const feb = new Decimal(slab.februaryAmount || 0);
  return new Decimal(month === 2 && feb.gt(0) ? feb : slab.amount || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

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
  /** One-off amounts for the month (bonus, incentive, canteen…); not reduced for loss-of-pay days. */
  variables?: { code: string; label: string; kind: "EARNING" | "DEDUCTION"; amount: Decimal.Value; esiApplicable?: boolean }[];
  /** From HR Settings; the statutory defaults when left out. */
  rules?: StatutoryRules;
  /** 1–12; picks a PT slab's February amount. */
  month?: number;
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
  const r = input.rules ?? DEFAULT_RULES;
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
  const variables = (input.variables ?? []).map((v) => ({ ...v, amount: money(v.amount) })).filter((v) => v.amount.gt(0));
  for (const v of variables.filter((x) => x.kind === "EARNING")) earnings.push({ code: v.code, label: v.label, amount: v.amount });
  const gross = earnings.reduce((t, l) => t.plus(l.amount), new Decimal(0));
  // Variable earnings that ESI does not cover (e.g. an annual bonus) stay out of ESI wages.
  const esiExcluded = variables.filter((x) => x.kind === "EARNING" && x.esiApplicable === false).reduce((t, v) => t.plus(v.amount), new Decimal(0));
  const fullGross = components.reduce((t, [, , v]) => t.plus(new Decimal(v || 0)), new Decimal(0));
  const earnedBasic = earnings.find((l) => l.code === "BASIC")?.amount ?? new Decimal(0);

  const deductions: PayLine[] = [];
  const employer: PayLine[] = [];

  let pfWages = new Decimal(0);
  if (r.pfEnabled && s.pfApplicable && earnedBasic.gt(0)) {
    pfWages = r.pfCapAtCeiling ? Decimal.min(earnedBasic, new Decimal(r.pfWageCeiling)) : earnedBasic;
    deductions.push({ code: "PF", label: "Provident fund", amount: rupee(pfWages.times(r.pfEmployeeRate)) });
    employer.push({ code: "PF_ER", label: "Employer PF", amount: rupee(pfWages.times(r.pfEmployerRate)) });
  }

  let esiWages = new Decimal(0);
  if (r.esiEnabled && s.esiApplicable && fullGross.lte(new Decimal(r.esiGrossLimit)) && gross.minus(esiExcluded).gt(0)) {
    esiWages = gross.minus(esiExcluded);
    deductions.push({ code: "ESI", label: "ESI", amount: rupeeUp(esiWages.times(r.esiEmployeeRate)) });
    employer.push({ code: "ESI_ER", label: "Employer ESI", amount: rupeeUp(esiWages.times(r.esiEmployerRate)) });
  }

  if (s.ptApplicable && gross.gt(0)) {
    // Slabs, when HR has set them up, decide PT from the month's gross; otherwise the employee's fixed amount.
    const pt = r.ptSlabs.length > 0 ? ptFromSlabs(r.ptSlabs, gross, input.month) ?? new Decimal(0) : money(s.professionalTax);
    if (pt.gt(0)) deductions.push({ code: "PT", label: "Professional tax", amount: pt });
  }

  if (new Decimal(s.monthlyTds || 0).gt(0) && gross.gt(0)) {
    deductions.push({ code: "TDS", label: "Income tax (TDS)", amount: money(s.monthlyTds) });
  }

  for (const v of variables.filter((x) => x.kind === "DEDUCTION")) deductions.push({ code: v.code, label: v.label, amount: v.amount });

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
