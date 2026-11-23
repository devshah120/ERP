# NEXORA HRMS

People, attendance, leave and payroll for Indian SMEs, sold as a separate product on the NEXORA platform. A customer can buy **HRMS only**, **ERP only**, or **both** in one workspace.

---

## Contents

1. [What's included](#1-whats-included)
2. [Selling an account (super admin)](#2-selling-an-account-super-admin)
3. [Who sees what: products, roles, permissions](#3-who-sees-what-products-roles-permissions)
4. [First-day setup for a new customer](#4-first-day-setup-for-a-new-customer)
5. [Using the HRMS](#5-using-the-hrms)
6. [Payroll rules](#6-payroll-rules)
7. [Employee self-service](#7-employee-self-service)
8. [Reports](#8-reports)
9. [For developers](#9-for-developers)
10. [Known limitations](#10-known-limitations)

---

## 1. What's included

| Area | Features |
|---|---|
| **People** | Employee directory and 360° profile, employee master with Excel import/export, departments, designations, assets issued, announcements |
| **Time & leave** | Daily attendance sheet (bulk marking, check-in/out times), monthly attendance register, shifts with weekly offs and late grace, holiday calendar, leave types, leave requests with approval, leave balances and yearly allocations |
| **Payroll** | Monthly payroll runs with loss-of-pay proration, PF, ESI, professional tax, TDS, loan/advance recovery and expense reimbursement; draft → approve → paid workflow; salary slips on screen and as PDF downloads (one or a whole month) |
| **Money** | Loans and salary advances (EMI recovery through payroll), expense claims (reimbursed through payroll) |
| **Talent** | Job openings, candidates pipeline, appraisals |
| **Reports** | Salary register, PF statement (ECR layout), ESI statement, bank transfer sheet, attendance summary, leave register, headcount, loans outstanding, exits — all exportable to Excel/CSV |
| **Self-service** | Employee portal: check in/out, attendance calendar, apply for leave, payslips, expense claims |
| **Dashboard** | Headcount, who's present/on leave today, pending approvals, payroll cost trend, birthdays and work anniversaries, holidays, announcements |

---

## 2. Selling an account (super admin)

The product owner manages customers from the **Admin Portal** at `/superadmin/login`.

### Create a customer account

1. Go to **+ New account** (`/superadmin/companies/new`).
2. **What are they buying?** Tick **HRMS** (and/or ERP), choose a **plan**, set the **employee limit** and **valid until** date.
3. Fill in the company and the owner's name, sign-in email and a temporary password (one is generated for you).
4. Click **Create account**, then **Copy details** and send them to the customer.

The workspace is active immediately. The owner signs in at `/login` and lands on the HR dashboard.

### Manage an existing customer

Open the company from **Companies**:

| Action | Effect |
|---|---|
| **Products** | Add or remove HRMS/ERP. Turning HRMS on for an ERP customer sets up the HR starter data automatically. |
| **Plan / employee limit** | The limit counts employees still on the rolls; resigned or deleted employees free a seat. Enforced on create and on Excel import. |
| **Valid until** | Sign-in stops after this date. Extend it to renew. Blank = no expiry. |
| **Suspend / Activate** | Suspended workspaces cannot sign in. |
| **Reset owner password** | For a locked-out customer; unlocks the owner and signs them out everywhere. |

Changes reach users who are already signed in within 15 minutes (the access-token lifetime).

> **Production:** set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD_HASH` (bcrypt) in the server environment. Without them, super-admin sign-in is disabled. Generate a hash with `node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'your-password'`. Only in local development with nothing set does the portal accept the built-in `superadmin@nexora.in` / `Admin@12345`.

---

## 3. Who sees what: products, roles, permissions

**Products gate whole modules.** An HRMS-only workspace never sees sales, stock or accounting — not in the menu, not in search, and the APIs refuse with `PRODUCT_NOT_ENABLED`, even for the Owner. Team members, roles, the activity log and the business profile are available to every product.

**Roles created for every HRMS workspace:**

| Role | Can do | Editable |
|---|---|---|
| **Owner** | Everything in the products bought | No |
| **HR Manager** | All HR screens, approvals, payroll, reports | Yes |
| **Employee (Self Service)** | Only their own workspace (attendance, leave, payslips, claims) | No |

Custom roles are made under **Admin & Setup → Roles & Permissions**. HR permissions are grouped as *HR · People*, *HR · Time & leave*, *HR · Payroll*, *HR · Talent* and *HR · Employee self-service*. The role editor only lists permissions for products the workspace has.

Key permissions: `hr-leaves.approve`, `hr-payroll.process` (draft/recalculate), `hr-payroll.approve` (approve, mark paid, cancel), `hr-claims.approve`, `hr-attendance.edit`, `hr-self.view`.

---

## 4. First-day setup for a new customer

A new HRMS workspace already contains:

- **General Shift** 09:30–18:30, 15-minute grace, Sunday weekly off
- **Leave types:** Casual (12/yr), Sick (7/yr), Earned (15/yr, carry forward up to 30, encashable), Loss of Pay (unpaid, no limit)
- **Departments:** Administration, Human Resources, Finance & Accounts, Sales & Marketing, Operations
- **Designations:** Director, Manager, Team Lead, Executive, Associate, Intern

Recommended order:

1. **Time & Leave → Shifts / Holiday Calendar / Leave Types** — adjust to company policy and add this year's holidays.
2. **Employees → Employee Records** — add employees, or use **Import** to load them from Excel. Fill in the **salary structure** and **statutory & bank** sections; payroll uses them.
3. **Employee profile → Give portal access** — for each employee who should use self-service.
4. **Admin & Setup → Team Members** — add HR staff with the *HR Manager* role.

---

## 5. Using the HRMS

### Employees
- **Employee Directory** (`/hr/employees`): search, filter by department, current/former staff. Click a name for the profile (personal, job, salary & bank, leave, payslips, assets, direct reports, portal login).
- **Employee Records** (`/hr-employees`): the full master with bulk import/export. **Edit details** on a profile opens the same form.
- **Sign-in on the New employee form:** the last section (*Sign-in*) creates their login at the same time: email, **Role** (defaults to *Employee (Self Service)*; any role such as HR Manager can be chosen) and a generated temporary password they must change. Shown to users who can add team members; leave the email blank to skip and use **Give portal access** on the profile later. If the email already has a login, that login is linked and keeps its role.
- **History** tab on a profile: every salary revision, promotion, transfer and status change with the date it took effect. **Record change** picks what changed and from when; a future date is applied automatically when it arrives (a scheduled change shows *Scheduled*). Salary or job edits made on the employee form are logged here too, as corrections from today. A change can be removed unless its month's payroll is approved. Resignations and other exits still go on the employee form with the last working day.
- An employee is "on the rolls" while their status is *On probation*, *Confirmed* or *Serving notice*. Set *Resigned/Terminated/Retired* and a **last working day** when they leave.

### Attendance
- **Daily Attendance** (`/hr/attendance`): pick a date, set each person's status (Present, Absent, Half day, On duty, Weekly off, Holiday) and optional in/out times, then **Save**. **Mark the rest present** fills everyone not yet marked.
- Worked minutes and late minutes are calculated from the employee's shift.
- Days created by approved leave are shown as *On leave* and can't be edited here — cancel the leave instead.
- **Attendance Register** (`/hr/attendance/register`): month grid with totals and loss-of-pay days; downloadable as Excel.
- **Attendance Corrections** (`/hr/attendance/requests`): employees' requests to fix a day (missed punch, on-duty work, wrong times). Approving writes the day to the attendance sheet with worked and late minutes from the shift; rejecting needs a reason. Requests can't touch approved leave or a month whose payroll is approved. Reporting managers can decide their own team's requests too.
- **Working days that nobody marks are paid as present.** Mark absences explicitly.

### Leave
- **Leave Requests** (`/hr/leaves`): approve, reject (with a reason) or cancel approved leave. Only the employee's **reporting manager** or **HR** can approve, reject or cancel a request, and nobody but the Owner can decide their own leave. In Roles & Permissions, *Leave requests → Approve* lets someone decide leave of people who report to them; *Approve anyone's (HR)* lets them decide anyone's (the HR Manager role has both).
- **File leave** files leave for your own employee record only (the employee is fixed). The Owner can file for anyone, e.g. staff without a sign-in.
- **File leave** (`/hr/leaves/new`): HR files on an employee's behalf; the form shows the working days the request will take.
- Weekly offs and holidays are not counted. Half days are allowed when the leave type permits.
- Requests are refused if they overlap another request or exceed the balance (unless the type allows going negative).
- **Leave Balances** (`/hr/leaves/balances`): granted + carried forward − approved, per employee and leave type. Click a number to change an employee's grant for the year.
- **Pro-rata for joiners:** someone who joins during the year gets the leave type's quota for the months left, counting the joining month if they join on or before the 15th, rounded to half days (CL 12 for a 1 September joiner = 4). Balances show *pro-rated*. Turn it off per leave type, or set a grant by hand.
- **Year-end carry-forward:** on *Leave Balances* for the new year, **Carry forward from <last year>** previews each employee's unused days of every leave type marked *Unused days carry forward*, capped at *Most days carried to next year* (0 = no limit); the rest lapse. Confirm to write them. Running it again recalculates, and a grant set by hand for the new year is kept.

### Payroll
The **Payroll** menu follows the monthly cycle:

| Menu | Use |
|---|---|
| **Generate Payroll** | Every run; **Run payroll** drafts a month |
| **Variable Pay** | A grid of one-off amounts per employee for the month (bonus, incentive, overtime, arrears, canteen recovery…). Filter by department, designation, location or name and pick which components to show. Earnings are added to gross and deductions taken after tax, without loss-of-pay proration. Locked once the month's payroll is approved |
| **Import Variable Pay** | Download the month's template (everyone on the rolls, one column per component code, current amounts), fill it in, upload, **Check file**, then **Import**. A blank or 0 clears an amount |
| **Approve / Reject Payroll** | Drafts waiting for a decision: open one, then approve it or delete the draft |
| **Disburse Payroll** | Approved runs waiting to be paid: bank sheet, then **Mark paid** |
| **Rollback Payroll** | Approved runs that can be cancelled to correct and run again |
| **Voucher Posting** | Workspaces with ERP: approving payroll posts the month's salary journal (dated the last day of the month), marking it paid posts the bank/cash payment, rolling it back posts a reversal. This screen shows each run's vouchers and posts any that are missing (e.g. runs approved before the chart of accounts existed) |
| **Block / Unblock Payroll** | Put a salary on hold for a month (with a reason): that employee gets no payslip and is left out of the bank sheet until unblocked. Needs the payroll approval permission |
| **Day Arrear** | Pay back loss-of-pay days of a month whose payroll is approved, at that month's daily rate (no more than the month's LOP days) |
| **Increment Arrear** | Created automatically when a salary increase is recorded on the History tab with a date inside approved months: the new rate minus what was paid, for the same paid days. Removing the revision cancels its unpaid arrears |
| **DA Arrear** | A DA revision applied retrospectively: % of the basic actually paid in each approved month of a range, for everyone or one department. Preview, then add |
| **Gratuity Calculation** | Gratuity for everyone on the rolls as of a date: service, years counted (a final part-year over six months counts), basic, accrued (for the provision) and payable (after 5 years). Basic × 15/26 × years, capped at ₹20 lakh |
| **F & F Settlement** | Full & final for a leaving employee. **New settlement** with separation type, resignation date, last working day and notice period calculates a draft: salary for unpaid months up to the last working day (attendance, salary history, PF/ESI/PT/TDS), leave encashment (encashable leave × basic ÷ 30), gratuity, pending arrears, pay in lieu of notice (terminations) or notice recovery (resignations), outstanding loans, plus lines added with **Adjust**. Unreturned assets are listed. **Approve** recovers the loans, marks arrears paid and records the exit; payroll then leaves the employee out from the first settled month. **Print statement**, **Mark paid**; an approved settlement can be cancelled (reverses loans and arrears) |
| **Pay Components** | The variable components: code, earning or deduction, and whether an earning counts towards ESI wages. Bonus, Incentive, Overtime pay, Arrears, Canteen recovery and Other deduction are set up for you |

1. **Generate Payroll → Run payroll**, pick the month. A readiness check warns about employees with no salary, missing bank details, pending leave, working days with no attendance, and salaries on hold.
2. Review the **draft**. Changed attendance, leave or salaries? **Recalculate**.
3. **Approve** — locks that month's attendance and leave, records loan instalments, marks included claims as reimbursed, and makes payslips visible to employees. Approval re-reads attendance first. If attendance changed after the draft was calculated, it asks you to **Recalculate**. If any working days are unmarked, you must tick **Pay these unmarked days as present**, and the count is recorded on the run and in the audit log.
4. Download the **Salary register** and **Bank sheet**, pay salaries, then **Mark paid** with the date and bank reference.

**Salary slips:** each payslip has **Download PDF** (an A4 file generated on the server, same content as the screen), and a payroll run has **All payslips (PDF)**: every employee's slip in one file, one page each, for printing or records. Draft slips carry a DRAFT watermark.

Pending arrears are paid with the next payroll as earning lines (*Increment / Day / DA arrears*, counted in ESI wages; PF on arrears is not calculated yet). Approval marks them paid; rolling that payroll back makes them pending again.

Changing variable pay, holds or arrears after a draft is calculated makes approval ask for a **Recalculate** first.

Mistakes: a **draft** can be deleted; an **approved** run can be cancelled with a reason (loan recoveries and claim reimbursements are reversed and the month is unlocked); a **paid** run is final. Only one live run per month is allowed.

### Loans & advances
- **New loan / advance**: amount, monthly instalment and the first payroll month to deduct from.
- Instalments are taken automatically when payroll is approved, and never push net pay below zero.
- **Record repayment** for money paid back outside payroll. A loan with nothing recovered can be cancelled.

### Expense claims
- Employees submit claims from their portal; HR can also record them (`/hr/claims/new`).
- **Approve** → the amount is added to the next payroll as *Reimbursements* (not taxed, not part of PF/ESI wages).

---

## 6. Payroll rules

| Item | Rule |
|---|---|
| **Salary structure** | Monthly basic, HRA, conveyance, special and other allowance, entered on the employee and changed over time from the *History* tab |
| **Mid-month revision** | Each component is weighted by the calendar days at each rate (a raise on the 16th of a 30-day month pays 15 days at each); PF/ESI/PT/TDS settings are those in force at month end. The salary used is saved on the payslip, and the payslip notes the revision date |
| **Proration** | Each component × payable days ÷ calendar days in the month |
| **Loss-of-pay days** | Absent days, unpaid leave, half of each half day without paid leave, and days before joining or after the last working day |
| **PF** | 12% of earned basic on wages capped at ₹15,000; employer matches 12% (shown as employer contribution) |
| **ESI** | Only when full-month gross is ₹21,000 or less: employee 0.75%, employer 3.25% of earned gross, each rounded up to the rupee |
| **Professional tax** | Fixed monthly amount per employee (default ₹200) |
| **TDS** | Fixed monthly amount per employee |
| **Loans** | Instalment, or the outstanding balance if smaller, deducted after all statutory deductions |
| **Reimbursements** | Approved claims dated on or before the month end |
| **Precision** | All amounts are calculated with `decimal.js` and stored as `Decimal128` — no floating-point arithmetic |

Each payslip stores a snapshot of the employee's details (name, department, bank, PAN, UAN), so later edits don't change past payslips.

---

## 7. Employee self-service

An employee needs a login linked to their employee record (**Employee profile → Give portal access**). They sign in at `/login`, replace the temporary password on first sign-in, and then see only **My Workspace**:

| Menu | What they can do |
|---|---|
| **Overview** | Check in / check out, today's times, this month's summary, leave balances, announcements, upcoming holidays, their own details |
| **My Attendance** | Month calendar with day codes and punch times. **Request correction** asks for a past day to be set to Present, Half day or On duty, with optional times and a reason; the list below shows each request's status. |
| **My Leave** | Apply (with live day count), see status and the manager's or HR's notes, withdraw pending requests |
| **My Payslips** | Payslips of approved payroll runs; open, print, or **Download PDF** |
| **My Claims** | Submit expense claims, track status, withdraw pending ones |
| **Team Approvals** | Shown only to reporting managers (anyone set as an employee's *Reporting manager*). Two tabs, **Leave** and **Attendance corrections**: approve or reject direct reports' requests; a rejection needs a reason. The manager's decision is final, and HR still sees every request and can cancel approved leave. |

Check-in uses the business time zone and the employee's shift: a second punch checks out and sets the day to Present / Half day / Absent from the hours worked.

If the employee's email already has a login (for example the HR manager is also on payroll), that login is linked and keeps its role. **Remove access** disables a self-service-only login and signs it out everywhere.

---

## 8. Reports

**HR Reports** (`/hr/reports`) — view on screen or download as Excel/CSV.

| Report | Period | Use |
|---|---|---|
| Employee master (headcount) | Current | Staff list with monthly gross |
| Attendance summary | Month | Present / absent / leave / late / LOP per employee |
| Leave register | Year | Every leave request |
| Salary register | Month | Earnings, deductions and net pay per employee |
| PF statement (ECR) | Month | EPF/EPS/EDLI wages and contributions for EPFO upload |
| ESI statement | Month | ESI wages and contributions |
| Bank transfer sheet | Month | Account, IFSC and net pay for bank upload (bank-paid employees only) |
| Loans outstanding | Current | Active loans with balance |
| Exits / attrition | Year | Leavers with an approximate attrition rate |

---

## 9. For developers

The HRMS follows the same architecture as the ERP (see `DEVELOPMENT_GUIDE.md`, sections H and I).

### Where things live

| Path | Contents |
|---|---|
| `src/lib/products.ts` | Product definitions and gating rules (client-safe) |
| `src/lib/services/provisioningService.ts` | Workspace creation shared by sign-up and the admin portal |
| `src/models/hr.ts` | All HR models |
| `src/lib/hr/setup.ts` | HR starter data and roles |
| `src/lib/hr/calendar.ts` | Day handling (UTC-midnight dates), shifts, holidays, who was employed when |
| `src/lib/hr/attendance.ts` | Daily sheet, register, punch, `summarizeMonth()` (source of LOP days) |
| `src/lib/hr/leave.ts` | Apply / approve / reject / cancel, balances, allocations |
| `src/lib/hr/payrollMath.ts` | Pure payslip calculation |
| `src/lib/hr/payroll.ts` | Payroll run workflow and payslips |
| `src/lib/hr/money.ts` | Loans and expense claims |
| `src/lib/hr/people.ts` | Directory, profile, portal access, self-service profile |
| `src/lib/hr/insights.ts` | HR dashboard and reports |
| `src/lib/resources/hrRegistry.ts`, `ui/hrRegistry.ts` | HR masters on the generic resource framework |
| `src/app/api/hr/**` | HR API routes (`/api/hr/self/**` for self-service) |
| `src/app/api/superadmin/companies/**` | Account creation and subscription management |
| `src/app/(app)/hr/**`, `src/components/hr/**` | HR screens |
| `src/app/superadmin/**` | Admin portal screens |

### Conventions

- **Permission keys for HR modules start with `hr-`**; screens live under `/hr`, `/hr/...` or `/hr-...`. That prefix is what makes them HRMS for gating — keep it for anything new.
- Every query is scoped by `businessId`; multi-collection writes (leave approval, payroll create/approve/cancel) run in a MongoDB transaction.
- Every change is recorded with `recordAudit()`.
- Payroll and attendance read loss-of-pay days only through `summarizeMonth()`, so the register and payslips always agree.

### Main API endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/hr/dashboard` | Dashboard data |
| `GET /api/hr/employees`, `GET /api/hr/employees/:id` | Directory, profile |
| `POST/DELETE /api/hr/employees/:id/portal` | Grant / remove portal access |
| `GET/PUT /api/hr/attendance?date=` | Daily sheet |
| `GET /api/hr/attendance/register?year=&month=[&format=xlsx]` | Monthly register |
| `GET/POST /api/hr/leaves`, `POST /api/hr/leaves/:id` | List / file; `approve`, `reject`, `cancel` |
| `GET/PUT /api/hr/leaves/balances` | Balances / set allocation |
| `GET/POST /api/hr/payroll`, `GET/POST /api/hr/payroll/:id` | Runs; `recompute`, `approve`, `pay`, `cancel` |
| `GET /api/hr/payslips/:id` | Payslip |
| `GET /api/hr/payslips/:id/pdf`, `GET /api/hr/self/payslips/:id/pdf` | One salary slip as a PDF file (HR / the employee's own) |
| `GET /api/hr/payroll/:id/pdf` | Every salary slip of a payroll run in one PDF, a page each |
| `GET/POST /api/hr/loans`, `POST /api/hr/loans/:id` | Loans; `repay`, `cancel` |
| `GET/POST /api/hr/claims`, `POST /api/hr/claims/:id` | Claims; `approve`, `reject` |
| `GET /api/hr/reports/:report?year=&month=[&format=xlsx\|csv]` | Reports |
| `/api/hr/self/**` | Self-service: profile, punch, attendance, leaves, payslips, claims, loans |
| `/api/masters/hr-*` | HR masters (generic CRUD, export, import) |
| `POST /api/superadmin/companies`, `PATCH /api/superadmin/companies/:id` | Create account / change subscription |

### Tests

```bash
npm test                                  # whole suite
npx vitest run test/hrms.unit.test.ts     # gating, payroll maths, attendance rules
npx vitest run test/hrms.integration.test.ts  # provision → leave → payroll → self-service on a real replica set
```

The integration test needs no external database; it starts an in-memory MongoDB replica set.

---

## 10. Known limitations

- **Professional tax** is a flat monthly amount per employee, not state-wise slabs. **TDS** is entered manually.
- **Unmarked working days** are still paid as present, but approval now needs explicit confirmation (see *Approve* above).
