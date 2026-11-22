import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { productForPermission, productForHref, normalizeProducts, grants, homePathFor } from "@/lib/products";
import { computePayslip, type SalaryStructure } from "@/lib/hr/payrollMath";
import { computeTimes, statusFromHours, summarizeMonth } from "@/lib/hr/attendance";
import { eachDay, monthRange, toDay, dayKey, type HrCalendar, type ShiftRule } from "@/lib/hr/calendar";

describe("product gating", () => {
  it("assigns permissions and screens to products", () => {
    expect(productForPermission("hr-payroll.approve")).toBe("HRMS");
    expect(productForPermission("sales-invoices.view")).toBe("ERP");
    expect(productForPermission("users.create")).toBeNull();
    expect(productForPermission("settings.view")).toBeNull();
    expect(productForPermission("*")).toBeNull();

    expect(productForHref("/hr/payroll")).toBe("HRMS");
    expect(productForHref("/hr-employees/new")).toBe("HRMS");
    expect(productForHref("/hr")).toBe("HRMS");
    expect(productForHref("/sales-invoices")).toBe("ERP");
    expect(productForHref("/settings")).toBeNull();
    expect(productForHref("/settings/sales")).toBe("ERP");
    expect(productForHref("/users")).toBeNull();
  });

  it("treats workspaces without a product list as ERP", () => {
    expect(normalizeProducts(undefined)).toEqual(["ERP"]);
    expect(normalizeProducts([])).toEqual(["ERP"]);
    expect(normalizeProducts(["HRMS", "bogus"])).toEqual(["HRMS"]);
    expect(normalizeProducts(["ERP", "HRMS", "ERP"])).toEqual(["ERP", "HRMS"]);
  });

  it("limits even the owner's wildcard to the products bought", () => {
    expect(grants(["*"], ["HRMS"], "hr-payroll.view")).toBe(true);
    expect(grants(["*"], ["HRMS"], "sales-invoices.view")).toBe(false);
    expect(grants(["*"], ["HRMS"], "users.view")).toBe(true);
    expect(grants(["*"], ["ERP"], "hr-payroll.view")).toBe(false);
    expect(grants(["hr-self.view"], ["ERP", "HRMS"], "hr-self.view")).toBe(true);
    expect(grants(["hr-self.view"], ["ERP", "HRMS"], "hr-payroll.view")).toBe(false);
  });

  it("sends each kind of user to the right home screen", () => {
    expect(homePathFor(["*"], ["ERP"])).toBe("/dashboard");
    expect(homePathFor(["*"], ["HRMS"])).toBe("/hr/dashboard");
    expect(homePathFor(["*"], ["ERP", "HRMS"])).toBe("/dashboard");
    expect(homePathFor(["hr-self.view"], ["HRMS"])).toBe("/hr/me");
    expect(homePathFor(["hr-self.view"], ["ERP", "HRMS"])).toBe("/hr/me");
    // An HR owner whose login is not an employee lands on the HR dashboard, never an empty self-service page.
    expect(homePathFor(["*"], ["HRMS"], false)).toBe("/hr/dashboard");
  });
});

const structure = (over: Partial<SalaryStructure> = {}): SalaryStructure => ({
  basic: "15000",
  hra: "6000",
  conveyance: "1600",
  specialAllowance: "2400",
  otherAllowance: "0",
  pfApplicable: true,
  esiApplicable: false,
  ptApplicable: true,
  professionalTax: "200",
  monthlyTds: "0",
  ...over,
});

describe("payslip arithmetic", () => {
  it("pays the full structure with PF and PT for a full month", () => {
    const r = computePayslip({ structure: structure(), daysInMonth: 30, lopDays: 0, loans: [], reimbursements: "0" });
    expect(r.grossEarnings.toFixed(2)).toBe("25000.00");
    expect(r.deductions.find((d) => d.code === "PF")?.amount.toFixed(2)).toBe("1800.00");
    expect(r.employerContributions.find((d) => d.code === "PF_ER")?.amount.toFixed(2)).toBe("1800.00");
    expect(r.deductions.find((d) => d.code === "PT")?.amount.toFixed(2)).toBe("200.00");
    expect(r.netPay.toFixed(2)).toBe("23000.00");
    expect(r.payableDays).toBe(30);
  });

  it("prorates earnings for loss-of-pay days and caps PF wages at 15,000", () => {
    const r = computePayslip({ structure: structure({ basic: "30000" }), daysInMonth: 30, lopDays: 3, loans: [], reimbursements: "0" });
    // 27 of 30 days: basic 27,000 → PF on the 15,000 ceiling.
    expect(r.earnings.find((e) => e.code === "BASIC")?.amount.toFixed(2)).toBe("27000.00");
    expect(r.pfWages.toFixed(2)).toBe("15000.00");
    expect(r.deductions.find((d) => d.code === "PF")?.amount.toFixed(2)).toBe("1800.00");
    expect(r.payableDays).toBe(27);
  });

  it("applies ESI only when the full-month gross is within the limit, rounding up", () => {
    const low = computePayslip({ structure: structure({ basic: "10000", hra: "4000", conveyance: "0", specialAllowance: "1001", esiApplicable: true }), daysInMonth: 30, lopDays: 0, loans: [], reimbursements: "0" });
    // 15,001 × 0.75% = 112.5075 → 113; employer 3.25% = 487.5325 → 488.
    expect(low.deductions.find((d) => d.code === "ESI")?.amount.toFixed(2)).toBe("113.00");
    expect(low.employerContributions.find((d) => d.code === "ESI_ER")?.amount.toFixed(2)).toBe("488.00");

    const high = computePayslip({ structure: structure({ esiApplicable: true }), daysInMonth: 30, lopDays: 0, loans: [], reimbursements: "0" });
    expect(high.deductions.find((d) => d.code === "ESI")).toBeUndefined();
  });

  it("recovers loans last, never beyond what the salary can bear, and adds reimbursements", () => {
    const r = computePayslip({
      structure: structure({ basic: "5000", hra: "0", conveyance: "0", specialAllowance: "0", pfApplicable: false, ptApplicable: false }),
      daysInMonth: 30,
      lopDays: 0,
      loans: [
        { loanId: "a", emi: "3000", outstanding: "10000" },
        { loanId: "b", emi: "4000", outstanding: "1500" },
      ],
      reimbursements: "750.50",
    });
    expect(r.loanDeductions.map((l) => [l.loanId, l.amount.toFixed(2)])).toEqual([
      ["a", "3000.00"],
      ["b", "1500.00"],
    ]);
    expect(r.netPay.toFixed(2)).toBe(new Decimal("5000").minus("4500").plus("750.50").toFixed(2));

    const tight = computePayslip({
      structure: structure({ basic: "2000", hra: "0", conveyance: "0", specialAllowance: "0", pfApplicable: false, ptApplicable: false }),
      daysInMonth: 30,
      lopDays: 0,
      loans: [{ loanId: "a", emi: "5000", outstanding: "5000" }],
      reimbursements: "0",
    });
    expect(tight.loanDeductions[0].amount.toFixed(2)).toBe("2000.00");
    expect(tight.netPay.toFixed(2)).toBe("0.00");
  });

  it("pays nothing and deducts nothing for a month fully lost", () => {
    const r = computePayslip({ structure: structure(), daysInMonth: 31, lopDays: 31, loans: [{ loanId: "x", emi: "1000", outstanding: "1000" }], reimbursements: "0" });
    expect(r.grossEarnings.toFixed(2)).toBe("0.00");
    expect(r.totalDeductions.toFixed(2)).toBe("0.00");
    expect(r.netPay.toFixed(2)).toBe("0.00");
  });
});

const shift: ShiftRule = { id: "s", name: "General", startTime: "09:30", endTime: "18:30", graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, weeklyOffs: ["SUNDAY"] };

describe("attendance rules", () => {
  it("works out late, worked and overtime minutes", () => {
    expect(computeTimes(shift, "09:40", "18:30")).toEqual({ workedMinutes: 530, lateMinutes: 0, overtimeMinutes: 50 });
    expect(computeTimes(shift, "10:00", "14:00")).toEqual({ workedMinutes: 240, lateMinutes: 15, overtimeMinutes: 0 });
    expect(computeTimes(shift, "22:00", "06:00").workedMinutes).toBe(480);
    expect(statusFromHours(shift, 480)).toBe("PRESENT");
    expect(statusFromHours(shift, 300)).toBe("HALF_DAY");
    expect(statusFromHours(shift, 100)).toBe("ABSENT");
  });

  it("summarises a month into loss-of-pay days the way payroll needs", () => {
    // November 2026: starts on a Sunday, 30 days, Sundays are weekly offs.
    const { start, end } = monthRange(2026, 11);
    const days = eachDay(start, end);
    const cal: HrCalendar = { holidays: new Map([["2026-11-09", "Diwali"]]), shifts: new Map([["s", shift]]), defaultShift: shift };
    const records = new Map([
      ["2026-11-02", { status: "PRESENT", lateMinutes: 20 }],
      ["2026-11-03", { status: "ABSENT" }],
      ["2026-11-04", { status: "HALF_DAY" }],
      ["2026-11-05", { status: "LEAVE", leaveApplicationId: "l1", leaveIsPaid: true }],
      ["2026-11-06", { status: "LEAVE", leaveApplicationId: "l2", leaveIsPaid: false }],
      ["2026-11-10", { status: "HALF_DAY", leaveApplicationId: "l3", leaveIsPaid: true }],
    ]);
    // Joined on the 2nd, so the 1st is not employed.
    const { codes, summary } = summarizeMonth({ dateOfJoining: toDay("2026-11-02"), shiftId: "s" }, cal, days, records);

    expect(codes[0]).toBe("");
    expect(codes.slice(1, 6)).toEqual(["P", "A", "HD", "L", "LOP"]);
    expect(codes[8]).toBe("H");
    expect(codes[7]).toBe("WO");
    expect(summary.notEmployed).toBe(1);
    expect(summary.weeklyOffs).toBe(4);
    expect(summary.holidays).toBe(1);
    expect(summary.lateDays).toBe(1);
    // 1 not employed + 1 absent + 0.5 unpaid half day + 1 unpaid leave; the paid half-day leave costs nothing.
    expect(summary.lopDays).toBe(3.5);
    expect(summary.paidLeave).toBe(1.5);
    expect(dayKey(days[29])).toBe("2026-11-30");
  });
});

describe("leave pro-rata", () => {
  it("grants the months left in the joining year, rounded to half days", async () => {
    const { proratedQuota } = await import("@/lib/hr/leave");
    expect(proratedQuota(12, 2026, new Date("2025-06-10"))).toBe(12); // joined earlier: full quota
    expect(proratedQuota(12, 2026, new Date("2026-01-01"))).toBe(12);
    expect(proratedQuota(12, 2026, new Date("2026-09-01"))).toBe(4); // Sep–Dec
    expect(proratedQuota(12, 2026, new Date("2026-09-15"))).toBe(4); // on the 15th the month still counts
    expect(proratedQuota(12, 2026, new Date("2026-09-16"))).toBe(3); // after the 15th it does not
    expect(proratedQuota(15, 2026, new Date("2026-04-20"))).toBe(10); // 8 months of 15 = 10
    expect(proratedQuota(7, 2026, new Date("2026-08-01"))).toBe(3); // 5 months of 7 = 2.92 → 3
    expect(proratedQuota(12, 2026, new Date("2026-12-20"))).toBe(0);
    expect(proratedQuota(12, 2026, new Date("2027-02-01"))).toBe(0); // not yet joined
    expect(proratedQuota(12, 2026, null)).toBe(12);
  });
});
