# NEXORA HRMS — Roadmap Audit

Status of each item in the *NEXORA HRMS Product Vision & Development Roadmap* against the code at commit `67b6d9a` (2026-11-22). This is step 1–3 of the roadmap's §18 "Before development".

**Statuses:** **Done** = built and wired end to end · **Partial** = some of it exists (the note says what) · **Missing** = nothing in the code · **Verify** = needs a manual check before anyone relies on it.

"Done" here means the screens, APIs and data model exist. It does not mean the roadmap's definition of done (tests, monitoring, release gates) is met. See [§5](#5-test-coverage).

---

## 1. Findings that change the plan

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | **Hardcoded super-admin password.** Both login routes accept `Admin@12345` for the super-admin email whatever the environment says. If `SUPERADMIN_EMAIL` is unset, the email defaults to `superadmin@nexora.in`. Anyone who knows these values gets full control of every customer workspace in production. | `src/app/api/superadmin/login/route.ts:42`, `src/app/api/auth/login/route.ts:41` | **Fixed** — backlog item 1 |
| 2 | **`mustChangePassword` is set but never read.** It is set in 4 places (provisioning, portal grant, owner reset, admin user create), but no login, middleware or API check uses it. | `grep mustChangePassword src` | **Fixed** — backlog item 2 |
| 3 | **Payroll pays unmarked days with no warning.** Payroll counts unmarked working days as present (`summary.unmarked` added to `presentDays`). The readiness check does not report unmarked days, so HR approves without seeing them. | `src/lib/hr/payroll.ts:135`, `payrollReadiness()` at `payroll.ts:433` | **Fixed** — backlog item 3 |
| 4 | **Statutory rates are code constants.** PF 12% / ₹15,000 ceiling and ESI 0.75% / 3.25% / ₹21,000 are hard-coded. PT is a per-employee number (default ₹200). TDS is a per-employee monthly number. | `src/lib/hr/payrollMath.ts:18-22`, `src/models/hr.ts` (`professionalTax`, `monthlyTds`) | High for the compliance roadmap |
| 5 | **Employee changes overwrite history.** Salary, designation, department, manager and status are plain fields on `Employee`. Only the generic audit log keeps the old values. Promotions, salary revisions, arrears, F&F and point-in-time reports all depend on effective-dated history. | `src/models/hr.ts:119` | **Fixed** — backlog item 7 |
| 6 | **Leave carry-forward and encashment are settings only.** `carryForward`, `maxCarryForward` and `encashable` are stored on the leave type, but no code applies them. Carry-forward is typed in by hand on the allocation. | `src/lib/resources/hrRegistry.ts:165`; no use in `src/lib/hr/` | Carry-forward **fixed** (item 6); encashment still a flag |
| 7 | **The chart of accounts has no payroll accounts.** It has no system roles for salary expense, salary payable, PF/ESI/PT/TDS payable or employee advances. ERP posting needs these first. | `src/lib/accounting/chartOfAccounts.ts` | **Fixed** — backlog item 9 |

The roadmap's "Current Product Foundation" table is accurate, with three additions:
- A payroll readiness check already exists (no salary, no bank details, pending leaves).
- Overtime minutes are already calculated from punches.
- `reportingManagerId` already exists and is indexed on `Employee`, which gives manager approvals a starting point.

---

## 2. Module status

### 2.1 Core HRIS & employee lifecycle

| Capability | Status | Notes |
|---|---|---|
| Employee 360° profile | Done | `/hr/employees/[id]`, `src/lib/hr/people.ts` |
| Profile timeline | Missing | |
| Custom employee fields | Missing | |
| Reporting hierarchy | Partial | `reportingManagerId` drives manager leave approval (direct reports only); no chart, no indirect reports |
| Organization chart view | Missing | |
| Multiple entities / branches / locations | Partial | `branchId`, free-text `workLocation`; one legal entity per workspace |
| Department, designation, grade | Done | Designations carry a grade (L1–L5) |
| Transfers, promotions, salary revisions | Done | Dated changes on the profile's History tab (`history.ts`); future-dated changes applied when due |
| Contracts, appointment letters | Missing | |
| Probation tracking | Partial | `probationEndDate`, `confirmationDate`, status; no confirmation workflow or reminders |
| Emergency contacts / dependants | Partial | One contact name and phone; no dependants |
| Employee document vault | Missing | A generic `/api/storage` exists. **Verify** whether it can be attached to employees |
| PAN, UAN, PF, ESI, bank | Done | Stored in plain text; no field-level restriction |
| Status & lifecycle history | Partial | Status changes are dated in the history; exits still recorded on the employee form |
| Rehire | Missing | |
| Duplicate detection | Partial | Unique `employeeCode` only; no PAN/Aadhaar/phone match |
| Bulk import/export with validation | Done | Generic resource framework; employee limit enforced on import |

### 2.2 Recruitment (ATS)

| Capability | Status | Notes |
|---|---|---|
| Job openings | Partial | Master with positions, budget CTC, status; no requisition approval |
| Candidate pipeline | Partial | Fixed stage list, `resumeUrl`, single `interviewDate`; list view, no Kanban |
| Everything else in §3.2 | Missing | Career page, parsing, scheduling, scorecards, offers, BGV, referrals, analytics |

### 2.3 Onboarding & offboarding

| Capability | Status | Notes |
|---|---|---|
| Exit date, reason, exits report | Done | |
| Asset issue record | Partial | See 2.11 |
| Everything else in §3.3 | Missing | Checklists, e-sign, notice period, exit interview, F&F, letters |

### 2.4 Attendance

| Capability | Status | Notes |
|---|---|---|
| Web punch (self-service) | Done | `/api/hr/self/punch`; no location captured |
| Daily sheet, bulk marking, monthly register | Done | `src/lib/hr/attendance.ts` |
| Shifts, weekly offs, late grace, half-day hours | Done | |
| Night / cross-midnight shifts | Verify | `computeTimes()` works on same-day `HH:mm` strings |
| Overtime | Partial | Minutes calculated; no approval, no pay |
| Holidays | Partial | Company-wide calendar; not location-specific |
| Attendance regularization requests | Done | `src/lib/hr/corrections.ts`; employee raises from My Attendance, reporting manager or HR approves |
| Missing-punch / anomaly detection, alerts | Missing | |
| Biometric, GPS/geofence, selfie, QR, kiosk | Missing | |
| Timesheets, WFH/field attendance | Missing | `ON_DUTY` status exists |

### 2.5 Leave

| Capability | Status | Notes |
|---|---|---|
| Leave types, apply / approve / reject / cancel | Done | Approval writes attendance in a transaction |
| Half-day leave | Done | Per-type `allowHalfDay` |
| Balances, yearly allocations | Done | |
| Manager approval | Done | Reporting manager approves or rejects direct reports' leave from *Team Leave*; decision is final. Multi-level chains still missing |
| Pro-rata allocation for joiners | Done | `proratedQuota()`; per leave type, overridden by a hand grant |
| Carry-forward and expiry | Done | Year-end run with preview, capped by `maxCarryForward`; excess lapses |
| Encashment | Partial | Flag only |
| Comp-off | Missing | |
| Optional / restricted holidays | Partial | `OPTIONAL` holiday type; no per-employee quota |
| Team leave calendar | Missing | |
| Leave policy versions, location policies | Missing | |

### 2.6 Payroll & compensation

| Capability | Status | Notes |
|---|---|---|
| Monthly run: draft → approved → paid, cancel with reversal | Done | Approve locks the month, records loan EMIs, marks claims reimbursed |
| Loss-of-pay proration | Done | Through `summarizeMonth()` |
| Salary structure | Partial | Five fixed components on the employee plus configurable variable components per month; no configurable fixed structures |
| PF, ESI | Partial | Calculated correctly for the common case; rates hard-coded (finding 4); EPS/EDLI split **Verify** |
| Professional tax | Partial | Flat amount per employee |
| TDS | Partial | Manual monthly amount |
| Loans, advances, claims through payroll | Done | `src/lib/hr/money.ts` |
| Readiness check | Done | Includes unmarked days; approval refuses stale payslips and unconfirmed unmarked days |
| Payslips | Done | On screen, PDF download per slip and per run (`payslipPdf.ts`); employee snapshot stored on the payslip; no emailing yet |
| Reproducibility | Partial | Output lines, day counts and the salary structure used are stored; statutory rule version is not |
| Bank transfer sheet | Done | Excel/CSV export only |
| ERP accounting posting | Done | Accrual on approve, payment on paid, reversal on rollback (`payrollPosting.ts`) |
| Multi-level approval, variance analysis | Missing | |
| Bonus, arrears, retro, F&F | Done | Bonus via variable pay; increment/day/DA arrears (no PF on arrears yet); full & final settlement |
| Tax declarations, regimes, HRA, Form 16 | Missing | |
| Gratuity, LWF, minimum wage | Partial | Gratuity calculation and in F&F; LWF and minimum wage missing |

### 2.7 – 2.11 Talent, engagement, expenses, assets

| Area | Status | Notes |
|---|---|---|
| Performance | Partial | `Appraisal` master: one record per period, self and manager rating, recommended increment. No goals, OKRs, 360° or PIP |
| Learning (LMS) | Missing | |
| Announcements | Done | Shown on dashboard |
| Birthdays & anniversaries | Done | Dashboard widget |
| Other engagement (surveys, recognition, helpdesk, grievances) | Missing | |
| Expense claims | Done | Categories, approve, reimbursed through payroll. Receipt upload **Verify** |
| Expense policies and limits, travel, benefits | Missing | |
| Assets | Partial | Assign, return, condition, serial number. One assignment per record, so no history |

### 2.12 Dashboards & reports

| Capability | Status | Notes |
|---|---|---|
| HR dashboard | Done | Headcount, present and on leave today, pending approvals, payroll trend, birthdays, holidays, announcements |
| Employee self-service workspace | Done | `/hr/me/**` |
| Manager dashboard | Missing | |
| Executive dashboard | Missing | |
| Reports | Partial | 9 reports, Excel/CSV: headcount, attendance, leave, salary register, PF ECR, ESI, bank sheet, loans, exits. No PT/TDS output, no PDF, no custom builder, no scheduling |

### 2.13 Roles, permissions, super admin

| Capability | Status | Notes |
|---|---|---|
| Module and action permissions, product gating | Done | `src/lib/auth/permissionCatalog.ts`, `hr-` prefix |
| Self-service role | Done | `hr-self.view` |
| Data scope (department, location, hierarchy) | Partial | Direct-report scope for team leave only |
| Field-level restriction (salary, bank) | Missing | |
| Delegation, temporary permissions | Missing | |
| Super admin: products, plan, employee limit, expiry, suspend, owner reset | Done | `src/app/api/superadmin/companies/**` |
| Trial accounts | Verify | |
| Usage, feature flags, platform announcements, health | Missing | |

### 2.14 Platform & security

| Capability | Status | Notes |
|---|---|---|
| Tenant scoping by `businessId` | Done | By convention in each query. No HR cross-tenant tests found |
| Audit log on writes | Done | Leave, payroll, money, people, attendance |
| Transactions on multi-collection writes | Done | Leave approval, payroll create, approve and cancel |
| Rate limiting on auth routes | Done | |
| Super-admin credentials | Done | Finding 1 fixed: `src/lib/auth/superAdminCredentials.ts`, `test/superAdminCredentials.test.ts` |
| Forced password change | Done | Finding 2 fixed: token flag, `getAuthContext` refuses other APIs, `/change-password` |
| MFA, SSO | Missing | |
| Sensitive-field encryption, read-access logging | Missing | Aadhaar, PAN and bank stored in plain text |
| Background jobs, Redis | Missing | All work runs in the request |

### 2.15 Phase 3–4 items

AI copilot, workforce intelligence, workflow builder, workforce and succession planning, mobile apps, integrations (Google, Microsoft, WhatsApp, biometric, banking, e-sign, job portals), public APIs and webhooks: **Missing**. Nothing in the code today depends on them.

---

## 3. P0 backlog (Phase 1), in recommended order

Sizes: **S** ≈ a day or two · **M** ≈ a week · **L** ≈ several weeks. Rough estimates; check them against the team's pace.

| # | Item | Size | Depends on | Main files |
|---|---|---|---|---|
| 1 | ~~Remove the `Admin@12345` fallback.~~ **Done.** In production, super-admin sign-in is disabled unless an email and a password are configured. The built-in credentials work only in development with nothing set. The super-admin login is now rate limited. | S | — | `src/lib/auth/superAdminCredentials.ts` |
| 2 | ~~Enforce `mustChangePassword`.~~ **Done.** The flag travels in the access token. Every API except `/api/auth/me` and `/api/auth/change-password` answers 403 `PASSWORD_CHANGE_REQUIRED`, and the app redirects to `/change-password`. Changing the password revokes all sessions and issues a fresh one. | S–M | — | `src/lib/auth/context.ts`, `authService.changePassword` |
| 3 | ~~Unmarked-day control.~~ **Done.** Readiness lists unmarked days per employee. Approval refuses them unless the approver ticks "pay as present", which is stored on the run and in the audit log. Approval also refuses payslips that no longer match attendance. | S | — | `payroll.ts`, `/hr/payroll` |
| 4 | ~~Manager leave approval.~~ **Done.** Direct reports via `reportingManagerId`; manager's decision is final; recorded as `decidedAs: MANAGER`. | M | — | `leave.ts`, `/api/hr/self/team/leaves`, `/hr/me/team` |
| 5 | ~~Attendance regularization requests.~~ **Done.** `AttendanceRequest` model; employee raises, reporting manager or HR approves; attendance written in a transaction; future days, approved leave and locked months refused. | M | 4 | `corrections.ts`, `/hr/attendance/requests`, `/hr/me/team` |
| 6 | ~~Pro-rata allocation and year-end carry-forward.~~ **Done.** | M | — | `leave.ts`, `/api/hr/leaves/carry-forward`, Leave Balances |
| 7 | ~~Effective-dated employment history.~~ **Done.** `EmploymentChange` model; payroll reads the salary in effect, day-weighted across a mid-month revision. | L | — | `history.ts`, profile History tab, `payroll.ts` |
| 8 | Versioned statutory rules: PF/ESI rates and ceilings, state PT slabs, by effective date. Each payslip records the rule version used. **Needs specialist validation.** | L | 7 helps | new model, `payrollMath.ts` |
| 9 | ~~Payroll → ERP posting.~~ **Done.** Payroll accounts and system roles added to the chart; vouchers on approve, pay and rollback. HR loans are not yet posted when issued. | M–L | — | `payrollPosting.ts`, `chartOfAccounts.ts` |
| 10 | ~~Full & final settlement.~~ **Done.** Salary to the last working day, leave encashment, gratuity, arrears, notice pay/recovery, loans; exit recorded on approval. | L | 6, 7, 8 | `fnf.ts`, `/hr/payroll/fnf` |
| 11 | General multi-level approval engine. Build it from 4 and 5 once both are in use, instead of designing it up front. | L | 4, 5 | new |
| 12 | TDS engine (regimes, declarations, Form 16). | L | 7, 8 | new |

Items 1–3 close the known production gaps and are small. Do them first. Items 7 and 8 are the foundations most later payroll work depends on.

---

## 3a. Payroll menu (requested 2026-11-22)

Feature list taken from a reference payroll product's menu. Built as NEXORA's own screens.

| Item | Status | Where / plan |
|---|---|---|
| Variable pay (variable others) | Done | `/hr/payroll/variables`, `variables.ts` |
| Import variable pay | Done | `/hr/payroll/variables/import` |
| Generate payroll | Done | `/hr/payroll` |
| Approve / reject payroll | Done | `/hr/payroll/approve` |
| Disburse payroll | Done | `/hr/payroll/disburse` (mark paid with reference) |
| Rollback payroll | Done | `/hr/payroll/rollback` (cancel approved run) |
| Block / unblock payroll | Done | `/hr/payroll/holds`, `holds.ts` |
| Voucher posting | Done | `/hr/payroll/vouchers`, `payrollPosting.ts` |
| Day arrear | Done | `/hr/payroll/arrears/day`, `arrears.ts` |
| Increment arrear | Done | Backdated revision on the History tab; listed at `/hr/payroll/arrears/increment` |
| DA arrear | Done | % of basic paid over approved months, `/hr/payroll/arrears/da` |
| Gratuity calculation | Done | `/hr/payroll/gratuity`, `fnf.ts` (rates need specialist validation) |
| F&F calculation | Done | `/hr/payroll/fnf` |
| TDS configuration, TDS declaration, rent receipts, PIT exemption, PF perquisite, increment projection, tax deposit details | Missing | Batch 4 = backlog item 12; needs specialist validation |

## 4. Product decisions needed

1. ~~**Unmarked days (item 3)**~~ — decided: approval is blocked unless the approver confirms paying them as present (audited).
2. ~~**Leave approval chain (item 4)**~~ — decided: the manager's approval is final; HR can still decide or cancel any request.
3. **Statutory validation (item 8):** who reviews the PF, ESI and PT rules before release?
4. **ERP posting (item 9):** post on payroll approve (accrual) or on pay (cash)? Accrual is the usual choice.

---

## 5. Test coverage

- `test/hrms.unit.test.ts`: 11 tests (gating, payroll maths, attendance rules).
- `test/hrms.integration.test.ts`: 9 tests (provision → leave → payroll → self-service on an in-memory replica set).

Missing against the roadmap's §13 release gates: cross-tenant access tests for HR routes, permission tests per HR role, date-boundary tests (month and year edges, IST vs UTC), payroll regression fixtures, idempotency (double approve or pay) and cancellation reversal checks for loans and claims.
