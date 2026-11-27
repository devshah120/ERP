/**
 * "How this works" help for the HR settings screens, shown by <HelpPanel>.
 * Plain data (no server imports) so client screens can use it. Keyed by the
 * settings section or master resource key.
 */

export interface HelpTopic {
  title: string;
  /** One or two sentences: what this screen is for. */
  purpose: string;
  /** Where it sits in the setup order and what reads it. */
  steps: string[];
  /** A worked example with real numbers. */
  example?: { title: string; rows: [string, string][]; note?: string };
  tips?: string[];
}

export const PAYROLL_SETUP_STEPS: { key: string; label: string; href: string; detail: string }[] = [
  { key: "hr-payroll-settings", label: "Payroll Settings", href: "/hr/settings/payroll", detail: "Is the salary you type monthly or annual, and what is mandatory on an employee." },
  { key: "hr-pf-settings", label: "PF Settings", href: "/hr/settings/pf", detail: "PF rates and the ₹15,000 wage ceiling." },
  { key: "hr-esic-settings", label: "ESIC Settings", href: "/hr/settings/esic", detail: "ESI rates and the ₹21,000 gross limit." },
  { key: "hr-pt-slabs", label: "PT Slabs", href: "/hr-pt-slabs", detail: "Professional tax by monthly gross, for your state." },
  { key: "hr-salary-structures", label: "Salary Structures", href: "/hr-salary-structures", detail: "How a gross splits into basic, HRA, conveyance and the rest." },
  { key: "hr-employees", label: "Employees", href: "/hr-employees", detail: "Pick the structure and type only the salary amount." },
  { key: "hr-pay-components", label: "Pay Components", href: "/hr-pay-components", detail: "Monthly extras: bonus, overtime, incentive, canteen recovery." },
  { key: "payroll", label: "Run Payroll", href: "/hr/payroll", detail: "Attendance → payslips → approve → pay." },
];

export const PAYROLL_HELP: Record<string, HelpTopic> = {
  "hr-payroll-settings": {
    title: "Payroll Settings",
    purpose: "Workspace-wide payroll rules. Set these once, before the first salary structure and employee.",
    steps: [
      "Salary amount entered as: choose Monthly if you type ₹25,000 for a ₹25,000-a-month employee, or Annual if you type ₹3,00,000. Annual amounts are divided by 12.",
      "Restrict salary if PF account no. is missing: payslips are not generated while a PF-deducted employee has no UAN or PF number. The error names them.",
      "Restrict salary if leaves are pending: a payroll month can't be approved while leave requests in that month wait for a decision.",
      "Employee configurations: what the employee form insists on, and the PF / ESI / PT ticks a new employee starts with.",
    ],
    tips: ["Payroll cycle is always the calendar month (1st to last day). Attendance and leave follow the same month."],
  },
  "hr-pf-settings": {
    title: "PF Settings",
    purpose: "Provident fund rates used on every payslip of employees with “Deduct Provident Fund” ticked.",
    steps: [
      "PF wages = earned basic (basic after loss-of-pay days), capped at the wage ceiling when “Deduct PF up to ceiling” is ticked.",
      "Employee share = PF wages × employee rate. Employer share = PF wages × employer rate (shown on the payslip and posted to accounts).",
      "Untick “PF applicable” to stop PF for the whole workspace without touching each employee.",
    ],
    example: {
      title: "Basic ₹18,000, full month, defaults (12%, ceiling ₹15,000)",
      rows: [
        ["PF wages", "₹15,000 (capped)"],
        ["Employee PF (12%)", "₹1,800"],
        ["Employer PF (12%)", "₹1,800"],
      ],
      note: "With the cap off, PF would be 12% of ₹18,000 = ₹2,160 each.",
    },
  },
  "hr-esic-settings": {
    title: "ESIC Settings",
    purpose: "Employee State Insurance rates for employees with “Deduct ESI” ticked.",
    steps: [
      "ESI applies in a month only when the employee's full-month gross is at or under the gross limit (₹21,000 by law).",
      "Employee share = earned gross × employee rate; employer share = earned gross × employer rate. Both round up to the rupee.",
      "Bonus kept out of ESI (Pay Components → untick “Counts towards ESI wages”) is excluded from ESI wages.",
    ],
    example: {
      title: "Gross ₹18,000, full month, defaults (0.75% / 3.25%)",
      rows: [
        ["ESI wages", "₹18,000"],
        ["Employee ESI (0.75%)", "₹135"],
        ["Employer ESI (3.25%)", "₹585"],
      ],
    },
  },
  "hr-pt-slabs": {
    title: "Professional Tax Slabs",
    purpose: "Professional tax by monthly gross. Once any active slab exists, payroll takes PT from the slabs instead of each employee's fixed PT amount.",
    steps: [
      "Add one row per band: gross from, gross up to (0 = no upper limit) and the monthly tax.",
      "February amount: states like Maharashtra charge more in February (₹300 instead of ₹200). Leave 0 to use the normal amount.",
      "Employees with “Deduct Professional Tax” unticked never pay PT.",
    ],
    example: {
      title: "Gujarat (demo slabs)",
      rows: [
        ["Up to ₹11,999", "₹0"],
        ["₹12,000 and above", "₹200"],
      ],
      note: "Check your state's current notification before going live: slabs change.",
    },
  },
  "hr-salary-structures": {
    title: "Salary Structures",
    purpose: "A template that splits one gross amount into salary heads. Assign it to an employee and you only type the salary amount.",
    steps: [
      "Add one line per head: Basic, HRA, Conveyance, Special allowance, Other allowance.",
      "Each line is a % of gross, a % of basic, a fixed amount, or the Balance. Exactly one line must be the Balance (usually Special allowance): it takes whatever is left, so the heads always add up to the gross.",
      "On the employee form, choose the structure and type the salary amount. Saving works out basic, HRA and the rest. Typing over a head by hand is replaced while a structure is chosen; clear the structure to type heads freely.",
      "Changing a structure does not re-split existing employees. Open and save an employee to re-split them with the new lines.",
    ],
    example: {
      title: "Standard Staff (demo) on a ₹30,000 monthly gross",
      rows: [
        ["Basic: 50% of gross", "₹15,000"],
        ["HRA: 40% of basic", "₹6,000"],
        ["Conveyance: fixed", "₹1,600"],
        ["Special allowance: balance", "₹7,400"],
        ["Total", "₹30,000"],
      ],
      note: "Payroll then takes PF 12% of ₹15,000 = ₹1,800 and PT from the slabs; ESI is off because the gross is over ₹21,000.",
    },
  },
  "hr-employees": {
    title: "Employees and salary",
    purpose: "Every person on your monthly payroll. Workers paid by the day through a contractor belong in Contract Labour instead.",
    steps: [
      "Fill in personal, job and bank details.",
      "Under Salary, choose a Salary structure and type the Salary amount (monthly or annual, as Payroll Settings says). Save: the heads fill in.",
      "Tick PF / ESI / PT as they apply. New employees start with the defaults from Payroll Settings.",
    ],
  },
  "hr-pay-components": {
    title: "Pay Components",
    purpose: "One-off monthly items on top of the fixed salary: bonus, overtime pay, incentive, canteen or other recoveries.",
    steps: [
      "Earning components are added to gross; deduction components are taken after statutory deductions.",
      "Enter the month's amounts under Payroll → Variable Pay (or import them from Excel), then generate payroll.",
      "Untick “Counts towards ESI wages” for items ESI does not cover, such as an annual bonus.",
    ],
  },
};

/** Which module to use for whom. Shown on the HR Settings page. */
export const WORKFORCE_GUIDE: { who: string; module: string; href: string; pay: string; setup: string[] }[] = [
  {
    who: "Monthly salaried employees (staff, office, supervisors)",
    module: "Employees + Payroll",
    href: "/hr-employees",
    pay: "Monthly salary from their structure, cut for loss-of-pay days; PF, ESI, PT and TDS deducted; payslips and bank transfer.",
    setup: ["Payroll, PF, ESIC settings and PT slabs", "Salary Structures", "Employees: structure + salary amount", "Payroll → generate, approve, pay"],
  },
  {
    who: "Contractors (labour agencies and sub-contractors)",
    module: "Contract Labour → Contractors",
    href: "/hr-contractors",
    pay: "Not paid through payroll. The contractor record holds the contract, licence, default day wage and overtime terms for their workers.",
    setup: ["Contract Labour → Contractors", "Assign Shift to Contractors"],
  },
  {
    who: "Daily-wage workers (through a contractor, or your own casual hands)",
    module: "Contract Labour → Workers",
    href: "/hr-contract-workers",
    pay: "Day wage × days worked, plus overtime hours × OT rate, from Labour Attendance. Contract Labour → Overtime Calculation works out the month's wages and OT.",
    setup: [
      "Create the contractor (for your own casual workers, one in-house contractor such as “Direct Labour”)",
      "Workers: day wage and contractor(s)",
      "Labour Attendance each day",
      "Overtime Calculation for the month's wages and OT",
    ],
  },
];
