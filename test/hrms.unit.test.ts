import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { productForPermission, productForHref, normalizeProducts, grants, homePathFor } from "@/lib/products";
import { computePayslip, type SalaryStructure } from "@/lib/hr/payrollMath";
import { computeTimes, statusFromHours, summarizeMonth } from "@/lib/hr/attendance";
import { eachDay, monthRange, toDay, dayKey, dayKind, shiftFor, type HrCalendar, type ShiftRule } from "@/lib/hr/calendar";
import { toForest } from "@/lib/hr/orgTree";
import { dayOvertimeMinutes, overtimeHourlyRate, overtimeAmount, hoursOf } from "@/lib/hr/contractLabour";

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

describe("salary slip PDF", () => {
  const slip = {
    period: "October 2026",
    status: "APPROVED",
    employee: { code: "EMP-000001", name: "Asha Rao", department: "Human Resources", designation: "Executive", dateOfJoining: "2026-09-01", panNumber: "ABCDE1234F", uanNumber: "100200300400", bankName: "HDFC Bank", bankAccountNumber: "50100012345678", paymentMode: "BANK" },
    daysInMonth: 31,
    payableDays: 29,
    lopDays: 2,
    presentDays: 26,
    paidLeaveDays: 2,
    holidays: 1,
    weeklyOffs: 4,
    earnings: [
      { code: "BASIC", label: "Basic", amount: "14032.26" },
      { code: "HRA", label: "House rent allowance", amount: "4677.42" },
      { code: "REIMB", label: "Reimbursements", amount: "500.00" },
    ],
    deductions: [
      { code: "PF", label: "Provident fund", amount: "1684.00" },
      { code: "PT", label: "Professional tax", amount: "200.00" },
      { code: "LOAN", label: "Loan / advance recovery", amount: "1000.00" },
    ],
    employerContributions: [{ code: "PF_ER", label: "Employer PF", amount: "1684.00" }],
    grossEarnings: "18709.68",
    reimbursements: "500.00",
    totalDeductions: "2884.00",
    netPay: "16325.68",
    netPayInWords: "Rupees Sixteen Thousand Three Hundred Twenty Five and Sixty Eight Paise Only",
    business: { name: "People First Pvt Ltd", tradeName: "People First", address: "12 MG Road, Pune, Maharashtra" },
  };

  it("formats amounts with Indian grouping from the decimal string", async () => {
    const { inr } = await import("@/lib/hr/payslipPdf");
    expect(inr("1234567.5")).toBe("12,34,567.50");
    expect(inr("16325.68")).toBe("16,325.68");
    expect(inr("999")).toBe("999.00");
    expect(inr("0")).toBe("0.00");
    expect(inr("-1500")).toBe("-1,500.00");
    expect(inr("0.005")).toBe("0.01"); // half-up
  });

  it("renders one A4 page per payslip, drafts included", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { renderPayslipsPdf, pdfFilename } = await import("@/lib/hr/payslipPdf");
    const bytes = await renderPayslipsPdf([slip, { ...slip, status: "DRAFT", employee: { ...slip.employee, name: "Ravi Kumar", bankAccountNumber: "" } }], "Payslips October 2026");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toBe("Payslips October 2026");
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
    expect(pdfFilename("Payslip", "EMP-000001", "October 2026")).toBe("Payslip-EMP-000001-October-2026.pdf");
  });
});

describe("variable pay on the payslip", () => {
  it("adds variable earnings to gross (ESI only where it applies) and takes deductions before loans", () => {
    const r = computePayslip({
      structure: { basic: "10000", hra: "4000", conveyance: "0", specialAllowance: "0", otherAllowance: "0", pfApplicable: true, esiApplicable: true, ptApplicable: false, professionalTax: "0", monthlyTds: "0" },
      daysInMonth: 30,
      lopDays: 3, // fixed pay is prorated…
      loans: [{ loanId: "L1", emi: "100000", outstanding: "100000" }],
      reimbursements: "0",
      variables: [
        { code: "BONUS", label: "Bonus", kind: "EARNING", amount: "2000", esiApplicable: false }, // …variable pay is not
        { code: "OT", label: "Overtime pay", kind: "EARNING", amount: "1000", esiApplicable: true },
        { code: "CANTEEN", label: "Canteen recovery", kind: "DEDUCTION", amount: "300" },
        { code: "ZERO", label: "Nothing", kind: "EARNING", amount: "0" },
      ],
    });
    // 14000 × 27/30 = 12600, + 2000 + 1000.
    expect(r.grossEarnings.toFixed(2)).toBe("15600.00");
    expect(r.earnings.map((l) => l.code)).toEqual(["BASIC", "HRA", "BONUS", "OT"]);
    // ESI wages leave the bonus out: 13600 × 0.75% = 102 (rounded up).
    expect(r.esiWages.toFixed(2)).toBe("13600.00");
    expect(r.deductions.find((d) => d.code === "ESI")?.amount.toFixed(2)).toBe("102.00");
    // PF stays on basic only: 9000 × 12% = 1080.
    expect(r.deductions.find((d) => d.code === "PF")?.amount.toFixed(2)).toBe("1080.00");
    // Canteen comes before the loan, which takes whatever is left.
    expect(r.deductions.map((d) => d.code)).toEqual(["PF", "ESI", "CANTEEN", "LOAN"]);
    expect(r.netPay.toFixed(2)).toBe("0.00");
  });
});

describe("payroll journal", () => {
  it("balances the accrual and payment entries for a set of payslips", async () => {
    const { accrualEntries, paymentEntries } = await import("@/lib/hr/payrollPosting");
    const slips = [
      {
        grossEarnings: "18709.68",
        reimbursements: "500.00",
        netPay: "15825.68",
        employee: { paymentMode: "BANK" },
        deductions: [
          { code: "PF", amount: "1684.00" },
          { code: "PT", amount: "200.00" },
          { code: "LOAN", amount: "1000.00" },
          { code: "CANTEEN", amount: "500.00" },
        ],
        employerContributions: [{ code: "PF_ER", amount: "1684.00" }],
      },
      { grossEarnings: "12000.00", reimbursements: "0", netPay: "11910.00", employee: { paymentMode: "CASH" }, deductions: [{ code: "ESI", amount: "90.00" }], employerContributions: [{ code: "ESI_ER", amount: "390.00" }] },
    ];
    const total = (entries: { debit?: Decimal; credit?: Decimal }[], side: "debit" | "credit") => entries.reduce((t, e) => t.plus(e[side] ?? 0), new Decimal(0)).toFixed(2);
    const accrual = accrualEntries(slips);
    expect(total(accrual, "debit")).toBe(total(accrual, "credit"));
    const by = (role: string) => accrual.find((e) => e.role === role)!;
    expect(by("SALARY_EXPENSE").debit!.toFixed(2)).toBe("30709.68");
    expect(by("EMPLOYER_CONTRIBUTION_EXPENSE").debit!.toFixed(2)).toBe("2074.00");
    expect(by("PF_PAYABLE").credit!.toFixed(2)).toBe("3368.00");
    expect(by("ESI_PAYABLE").credit!.toFixed(2)).toBe("480.00");
    expect(by("SALARY_RECOVERIES").credit!.toFixed(2)).toBe("500.00");
    expect(by("SALARY_PAYABLE").credit!.toFixed(2)).toBe("27735.68");

    const payment = paymentEntries(slips);
    expect(total(payment, "debit")).toBe(total(payment, "credit"));
    expect(payment.find((e) => e.role === "BANK")!.credit!.toFixed(2)).toBe("15825.68");
    expect(payment.find((e) => e.role === "CASH")!.credit!.toFixed(2)).toBe("11910.00");
  });
});

describe("gratuity", () => {
  it("counts completed years (over six months rounds up), needs five years and is capped", async () => {
    const { gratuityFor, serviceBetween } = await import("@/lib/hr/fnf");
    const g = (joined: string, until: string, basic: string, waive = false) => gratuityFor({ joined: new Date(joined), until: new Date(until), basic, waiveMinimum: waive });
    expect(serviceBetween(new Date("2020-01-01"), new Date("2025-12-31"))).toEqual({ years: 6, months: 0, days: 0 });
    expect(g("2020-01-01", "2025-12-31", "26000")).toMatchObject({ completedYears: 6, eligible: true });
    expect(g("2020-01-01", "2025-12-31", "26000").payable.toFixed(2)).toBe("90000.00"); // 26000 × 15/26 × 6
    expect(g("2021-03-10", "2026-10-09", "20000")).toMatchObject({ completedYears: 6, eligible: true }); // 5 yr 7 mo
    expect(g("2021-01-01", "2026-06-30", "20000").completedYears).toBe(5); // exactly six months extra does not count
    const short = g("2022-01-01", "2026-11-30", "20000"); // 4 yr 11 mo
    expect(short.eligible).toBe(false);
    expect(short.payable.toFixed(2)).toBe("0.00");
    expect(short.accrued.toFixed(2)).toBe("57692.31"); // 20000 × 15/26 × 5, for the provision
    expect(g("2022-01-01", "2026-11-30", "20000", true).payable.toFixed(2)).toBe("57692.31"); // e.g. on death
    const big = g("1990-01-01", "2025-12-31", "1000000");
    expect(big).toMatchObject({ capped: true });
    expect(big.payable.toFixed(2)).toBe("2000000.00");
  });
});

describe("organization tree", () => {
  const n = (id: string, managerId: string | null) => ({ id, managerId });
  const managers = (nodes: { id: string; managerId: string | null }[]) => Object.fromEntries(toForest(nodes).map((x) => [x.id, x.managerId]));

  it("keeps reporting lines and puts people without a manager on the rolls at the top", () => {
    expect(managers([n("ceo", null), n("a", "ceo"), n("b", "a"), n("c", "gone"), n("d", "d")])).toEqual({ ceo: null, a: "ceo", b: "a", c: null, d: null });
  });

  it("breaks a reporting loop so nobody falls out of the tree", () => {
    const out = managers([n("a", "b"), n("b", "c"), n("c", "a"), n("x", "a")]);
    expect(Object.values(out).filter((m) => m === null)).toHaveLength(1);
    expect(out.x).toBe("a");
    // Every chain now ends at the top.
    const top = (id: string): string => (out[id] ? top(out[id]!) : id);
    expect(new Set(["a", "b", "c", "x"].map(top)).size).toBe(1);
  });
});

describe("holiday calendars", () => {
  const general: ShiftRule = { id: "s", name: "General", startTime: "09:30", endTime: "18:30", graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, weeklyOffs: ["SUNDAY"] };
  const cal: HrCalendar = {
    holidays: new Map([["2026-01-26", "Republic Day"]]),
    calendarHolidays: new Map([
      ["gj", new Map([["2026-01-14", "Uttarayan"]])],
      ["mh", new Map([["2026-05-01", "Maharashtra Day"]])],
    ]),
    defaultCalendarId: "gj",
    shifts: new Map([["s", general]]),
    defaultShift: general,
  };
  const kind = (calendarId: string | null, day: string) => dayKind(cal, shiftFor(cal, "s", calendarId), toDay(day));

  it("gives everyone the holidays on no calendar", () => {
    expect(kind("mh", "2026-01-26")).toBe("HOLIDAY");
    expect(kind(null, "2026-01-26")).toBe("HOLIDAY");
  });

  it("gives a calendar's holidays only to its employees, and the default calendar's to those with none", () => {
    expect(kind("mh", "2026-05-01")).toBe("HOLIDAY");
    expect(kind("gj", "2026-05-01")).toBe("WORKING");
    expect(kind("mh", "2026-01-14")).toBe("WORKING");
    expect(kind(null, "2026-01-14")).toBe("HOLIDAY");
    // An unknown calendar (deleted) leaves only the holidays for everyone.
    expect(kind("gone", "2026-01-14")).toBe("WORKING");
  });

  it("keeps working for calendars built before holiday calendars existed", () => {
    const old: HrCalendar = { holidays: new Map([["2026-01-26", "Republic Day"]]), shifts: new Map([["s", general]]), defaultShift: general };
    expect(dayKind(old, general, toDay("2026-01-26"))).toBe("HOLIDAY");
    expect(dayKind(old, shiftFor(old, "s", "anything"), toDay("2026-01-26"))).toBe("HOLIDAY");
  });
});

describe("contract labour overtime", () => {
  const shift: ShiftRule = { id: "s", name: "General", startTime: "09:00", endTime: "17:00", graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, weeklyOffs: ["SUNDAY"] };

  it("counts time beyond the shift's full day, honouring the contractor's minimum", () => {
    expect(dayOvertimeMinutes(shift, "09:00", "19:30", "").overtimeMinutes).toBe(150);
    expect(dayOvertimeMinutes(shift, "09:00", "17:20", "", 30).overtimeMinutes).toBe(0);
    expect(dayOvertimeMinutes(shift, "09:00", "17:30", "", 30).overtimeMinutes).toBe(30);
    // Night shift crossing midnight.
    expect(dayOvertimeMinutes(shift, "20:00", "06:00", "").overtimeMinutes).toBe(120);
  });

  it("lets typed-in hours win over the times", () => {
    const t = dayOvertimeMinutes(shift, "09:00", "17:00", "1.5");
    expect(t).toMatchObject({ overtimeMinutes: 90, manual: true, workedMinutes: 480 });
  });

  it("takes the worker's rate, else the fixed rate, else day wage ÷ hours × multiple", () => {
    const base = { workerRate: "0", rateType: "MULTIPLIER", fixedRate: "0", multiplier: 2, dailyWage: "600", fullDayHours: 8 };
    expect(overtimeHourlyRate(base).toFixed(2)).toBe("150.00");
    expect(overtimeHourlyRate({ ...base, workerRate: "95" }).toFixed(2)).toBe("95.00");
    expect(overtimeHourlyRate({ ...base, rateType: "FIXED", fixedRate: "120" }).toFixed(2)).toBe("120.00");
    expect(overtimeHourlyRate({ ...base, dailyWage: "550", multiplier: 1.5 }).toFixed(2)).toBe("103.13");
    expect(overtimeHourlyRate({ ...base, fullDayHours: 0 }).toFixed(2)).toBe("0.00");
  });

  it("pays overtime minutes to the paisa", () => {
    expect(overtimeAmount(150, new Decimal("103.13")).toFixed(2)).toBe("257.83");
    expect(overtimeAmount(0, new Decimal("150")).toFixed(2)).toBe("0.00");
    expect(hoursOf(150)).toBe("2.50");
  });
});
