import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { splitSalary, structureProblems, monthlyGrossFrom, type StructureLine } from "@/lib/hr/salaryStructureMath";
import { computePayslip, ptFromSlabs, DEFAULT_RULES, type SalaryStructure, type StatutoryRules } from "@/lib/hr/payrollMath";
import { hrPfSettingsSchema, hrEsicSettingsSchema, hrPayrollSettingsSchema } from "@/lib/settings/definitions";

const STANDARD: StructureLine[] = [
  { component: "BASIC", calcType: "PERCENT_OF_GROSS", value: 50 },
  { component: "HRA", calcType: "PERCENT_OF_BASIC", value: 40 },
  { component: "CONV", calcType: "FIXED", value: 1600 },
  { component: "SPECIAL", calcType: "BALANCE", value: 0 },
];

const str = (s: ReturnType<typeof splitSalary>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.toFixed(2)]));

describe("salary structure split", () => {
  it("splits the demo structure on ₹30,000 as the help example says", () => {
    expect(str(splitSalary(STANDARD, "30000"))).toEqual({
      basic: "15000.00",
      hra: "6000.00",
      conveyance: "1600.00",
      specialAllowance: "7400.00",
      otherAllowance: "0.00",
    });
  });

  it("puts the rounding into the balance so the heads add up to the gross", () => {
    const s = splitSalary(STANDARD, "25001");
    const total = Object.values(s).reduce((t, v) => t.plus(v), new Decimal(0));
    expect(total.toFixed(2)).toBe("25001.00");
    expect(s.basic.toFixed(2)).toBe("12501.00"); // 12500.5 rounds half up
  });

  it("annual amounts are divided by 12", () => {
    expect(monthlyGrossFrom("360000", "ANNUAL").toFixed(2)).toBe("30000.00");
    expect(monthlyGrossFrom("30000", "MONTHLY").toFixed(2)).toBe("30000.00");
    // ₹3,50,000 a year: the balance head takes the paise, total still exact.
    const s = splitSalary(STANDARD, monthlyGrossFrom("350000", "ANNUAL"));
    expect(Object.values(s).reduce((t, v) => t.plus(v), new Decimal(0)).toFixed(2)).toBe("29166.67");
  });

  it("refuses a gross smaller than the fixed heads", () => {
    expect(() => splitSalary([...STANDARD.slice(0, 2), { component: "CONV", calcType: "FIXED", value: 5000 }, STANDARD[3]], "5000")).toThrow(/more than the gross/);
  });

  it("reports unusable structures", () => {
    expect(structureProblems(STANDARD)).toEqual([]);
    expect(structureProblems(STANDARD.slice(0, 3)).map((p) => p[1]).join()).toMatch(/balance/);
    expect(structureProblems([...STANDARD, { component: "BASIC", calcType: "FIXED", value: 1 }]).map((p) => p[1]).join()).toMatch(/twice/);
    expect(structureProblems([{ component: "BASIC", calcType: "PERCENT_OF_BASIC", value: 50 }, STANDARD[3]]).length).toBeGreaterThan(0);
    expect(structureProblems([{ component: "HRA", calcType: "PERCENT_OF_BASIC", value: 40 }, STANDARD[3]]).map((p) => p[1]).join()).toMatch(/needs a Basic/);
  });
});

const structure = (over: Partial<SalaryStructure> = {}): SalaryStructure => ({
  basic: "15000",
  hra: "6000",
  conveyance: "1600",
  specialAllowance: "7400",
  otherAllowance: "0",
  pfApplicable: true,
  esiApplicable: true,
  ptApplicable: true,
  professionalTax: "200",
  monthlyTds: "0",
  ...over,
});
const ded = (r: ReturnType<typeof computePayslip>, code: string) => r.deductions.find((d) => d.code === code)?.amount.toFixed(2);
const base = { daysInMonth: 30, lopDays: 0, loans: [], reimbursements: "0" };

describe("payslip with HR settings", () => {
  it("default settings match the old hardcoded rules", () => {
    const rules = {
      ...DEFAULT_RULES,
      pfEmployeeRate: new Decimal(hrPfSettingsSchema.parse({}).employeeRate).div(100),
    };
    const a = computePayslip({ ...base, structure: structure({ basic: "18000" }) });
    const b = computePayslip({ ...base, structure: structure({ basic: "18000" }), rules });
    expect(ded(a, "PF")).toBe("1800.00");
    expect(ded(b, "PF")).toBe("1800.00");
    expect(hrEsicSettingsSchema.parse({})).toEqual({ esicApplicable: true, grossLimit: 21000, employeeRate: 0.75, employerRate: 3.25 });
    expect(hrPayrollSettingsSchema.parse({}).salaryAmountBasis).toBe("MONTHLY");
  });

  it("PF on the whole basic when the ceiling cap is off", () => {
    const rules: StatutoryRules = { ...DEFAULT_RULES, pfCapAtCeiling: false };
    expect(ded(computePayslip({ ...base, structure: structure({ basic: "18000" }), rules }), "PF")).toBe("2160.00");
  });

  it("switching PF or ESI off for the workspace drops them", () => {
    const r = computePayslip({ ...base, structure: structure({ basic: "8000", hra: "3200", conveyance: "1600", specialAllowance: "2200" }), rules: { ...DEFAULT_RULES, pfEnabled: false, esiEnabled: false } });
    expect(ded(r, "PF")).toBeUndefined();
    expect(ded(r, "ESI")).toBeUndefined();
    expect(r.employerContributions).toEqual([]);
  });

  it("a higher ESI limit brings a ₹30,000 gross into ESI", () => {
    expect(ded(computePayslip({ ...base, structure: structure() }), "ESI")).toBeUndefined();
    const r = computePayslip({ ...base, structure: structure(), rules: { ...DEFAULT_RULES, esiGrossLimit: "35000" } });
    expect(ded(r, "ESI")).toBe("225.00"); // 0.75% of 30,000
  });

  it("PT slabs replace the fixed amount, with a February rate", () => {
    const slabs = [
      { minGross: "0", maxGross: "11999.99", amount: "0", februaryAmount: "0" },
      { minGross: "12000", maxGross: "0", amount: "200", februaryAmount: "300" },
    ];
    expect(ptFromSlabs(slabs, new Decimal("11000"))?.toFixed(2)).toBe("0.00");
    expect(ptFromSlabs(slabs, new Decimal("30000"), 2)?.toFixed(2)).toBe("300.00");
    const rules = { ...DEFAULT_RULES, ptSlabs: slabs };
    expect(ded(computePayslip({ ...base, structure: structure({ professionalTax: "999" }), rules, month: 5 }), "PT")).toBe("200.00");
    expect(ded(computePayslip({ ...base, structure: structure({ basic: "5000", hra: "2000", conveyance: "1000", specialAllowance: "1000" }), rules }), "PT")).toBeUndefined();
    // No slabs: the employee's own amount, as before.
    expect(ded(computePayslip({ ...base, structure: structure({ professionalTax: "150" }) }), "PT")).toBe("150.00");
  });
});
