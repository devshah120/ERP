# Garment ERP

A multi-tenant, production-grade ERP for garment manufacturers and traders. Next.js (App Router) + Node + MongoDB, TypeScript throughout.

## Stack

- **Frontend/API**: Next.js 16 (App Router, Route Handlers), TypeScript
- **Database**: MongoDB via Mongoose 9
- **Auth**: Username/password + email OTP, JWT access token + rotating opaque refresh token
- **Validation**: Zod
- **Money**: `Decimal128` at the DB layer / `decimal.js` at the app boundary (never floats)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in real values (a working dev default is already in `.env.local` for local iteration, but replace the JWT secrets before deploying anywhere).
3. **MongoDB must be a replica set**, even a single-node one — the app uses multi-document session transactions for every write that touches more than one collection (e.g. registration, invoice posting), and a standalone `mongod` does not support those.
   - Local: `mongod --replSet rs0 --dbpath <path>`, then once: `mongosh --eval "rs.initiate()"`
   - Or use [MongoDB Atlas](https://www.mongodb.com/atlas) (every Atlas cluster, including the free tier, is a replica set already).
4. `npm run dev`

## Architecture

Every module follows the same layering:

```
Route Handler (src/app/api/**/route.ts)  — thin: parse request, call service, format response
        ↓
Service (src/lib/services/**)            — business logic, transaction orchestration
        ↓
Repository / Model (src/models/**, src/lib/repositories/**) — data access
```

Key shared infrastructure (built once, used by every module — see `TenantRepository`, `StatusEngine`, `numberingService`, `auditService`):

- **Tenant isolation**: every tenant-scoped collection carries `businessId`; `TenantRepository` makes it a compile error to query one without it.
- **Status engine**: document lifecycles (DRAFT → CONFIRMED → ... ) are defined as data and enforced centrally, not hand-rolled per module.
- **Document numbering**: atomic, race-free sequence allocation scoped by business/branch/financial year/document type.
- **Audit log**: every state-changing action is recorded with before/after values.
- **Standard API responses**: `{ success, data, message }` / `{ success, message, code, errors }` — see `src/lib/http`.

Full architecture write-up (module tree, status matrices, DB/accounting/inventory design, roadmap) lives in the conversation history with the assistant that scaffolded this project — ask it to restate any section if you need it back in front of you.

## Implemented so far

**Foundation (Phase 1)**:
- Multi-tenant business registration (with OTP email verification) — auto-provisions a default financial year, branch, warehouse, and Owner role
- Login / JWT refresh (rotating) / logout, account lockout after repeated failed attempts, login history
- RBAC skeleton (`Role`, permission-key checks via `requirePermission`)
- Audit log, document numbering engine, generic status/workflow engine
- Per-route rate limiting (in-memory — replace with Redis before horizontally scaling, see `src/lib/http/rateLimit.ts`)

**Master data (Phase 2)** — full CRUD (list with per-column filters + sorting + paging, create, edit, soft delete), audit-logged and tenant-scoped:

| Module | Route | Notes |
|---|---|---|
| Customers | `/customers` | Bespoke module (richest form) |
| Vendors | `/vendors` | Credit terms, opening balance |
| Agents | `/agents` | Commission % |
| Transporters | `/transporters` | E-way-bill transporter ID |
| Items | `/items` | Garment attributes + size/colour variant matrix |
| Categories | `/categories` | Self-referencing hierarchy |
| Brands | `/brands` | |
| Units | `/units` | Per-unit decimal precision |
| Warehouses | `/warehouses` | Branch-scoped |
| Branches | `/branches` | |

All except Customers are served by the **generic resource framework** (`src/lib/resources`): one registry entry defines a master's schema, filters, sorting and permissions, and it gets API + UI for free via `/api/masters/[resource]` and the `[resource]` page routes. Adding a new master is a config entry, not a new set of hand-written screens.

**Sales (Phase 4)** — the full transactional chain, connected end to end:

```
Quotation ──convert──▶ Sales Order ──convert──▶ Delivery (stock OUT) ──convert──▶ Invoice
                                                                          │
                                                          ┌───────────────┴───────────────┐
                                                          ▼                               ▼
                                                   Sales Return (stock IN)          Credit Note
```

| Document | Route | Statuses |
|---|---|---|
| Sales Quotation | `/sales-quotations` | DRAFT → SENT → UNDER_NEGOTIATION → APPROVED → CONVERTED / REJECTED / EXPIRED / CANCELLED |
| Sales Order | `/sales-orders` | DRAFT → PENDING_APPROVAL → CONFIRMED → PARTIALLY_DELIVERED → DELIVERED → PARTIALLY_INVOICED → INVOICED → COMPLETED |
| Sales Delivery | `/delivery-challans` | DRAFT → CONFIRMED → DISPATCHED *(posts stock OUT)* → DELIVERED |
| Invoice | `/sales-invoices` | DRAFT → POSTED → PARTIALLY_PAID → PAID |
| Sales Return | `/sales-returns` | DRAFT → APPROVED → RECEIVED *(posts stock IN)* → COMPLETED |
| Credit Note | `/credit-notes` | DRAFT → ISSUED |

What makes this a chain rather than six CRUD screens:

- **Conversion carries lines forward** and records a two-way link, so any document shows what it came from.
- **Fulfilment rolls up**: dispatching a delivery increments the source order's `deliveredQty` and recomputes the order's own status; posting an invoice does the same for `invoicedQty`.
- **Over-delivery/over-invoicing is impossible** — conversions only carry the outstanding quantity, and refuse when nothing is left.
- **Stock actually moves**: dispatch writes to the append-only `inventoryTransactions` ledger and updates `stockBalances` in one transaction. Negative stock is blocked.
- **Cancellation reverses rather than deletes**: cancelling a dispatched delivery writes offsetting ledger rows and rolls the order's fulfilment back.
- **Posted documents lock** against edits; status changes only follow the workflow in `src/lib/documents/workflows.ts`.
- **All money is computed server-side** (`src/lib/documents/totals.ts`) with GST split into CGST+SGST intra-state or IGST inter-state, in `Decimal128` — the client's figures are preview only.

**Purchase (Phase 5)** — the mirror chain, on the same engine: Purchase Order → Goods Receipt *(stock IN)* → Purchase Invoice, plus Purchase Return *(stock OUT)* and Debit Note. One `party` config swaps customers for vendors, so both sides of the ledger share the same conversion, workflow, fulfilment-rollup and stock-posting logic.

**Reports** — a report catalogue at `/reports` grouped by module (Sales, Purchase, GST, Inventory, Masters). Pick a report, choose from its full column catalogue, filter, and export. Column selection is applied **server-side**, so the API response, the table and the export all contain exactly the same fields.

| Report | Module |
|---|---|
| Sales Register / Sales Detail (item-wise) | Sales |
| Purchase Register / Purchase Detail (item-wise) | Purchase |
| GST HSN Summary (GSTR-1 shape) | GST |
| Stock Summary / Stock Ledger | Inventory |
| Customer / Supplier / Product reports | Masters |

**Export** — every listing and report exports to Excel (.xlsx) or CSV, honouring the active filters and the selected columns. Numbers and dates keep their types so Excel can sum and sort them; the applied filters are written into the file. Exports fail loudly above 5,000 rows rather than silently truncating.

**Import** — masters (customers, vendors, items, categories, brands, units, agents, transporters) import from .xlsx/.csv with a downloadable template, per-row/per-column validation, a preview before anything is saved, duplicate detection, and master references resolved **by name** (e.g. a Category column takes "T-Shirts", not an id). Commits run in a single transaction: if any row fails, nothing is written.

**Print** — A4 print layouts for all 11 Sales and Purchase documents, server-rendered, with company header, party details, place of supply, the correct CGST+SGST or IGST columns, totals and amount in words.

**Document entry form** — all eleven Sales and Purchase modules share one layout (`DocumentFormView`), so Sales Quotation and Debit Note are the same screen with different config:

- **Sticky title bar** — document name, live status badge, an actions menu (Print, Email, Copy to new, Mass discount), the workflow's own status buttons, conversion buttons, Save and Cancel.
- **Three-column header grid** — party (with open / add / info buttons), date, document number (`Auto` until the server allocates one), currency, plus the fields each document type promotes: Order type and Delivery date on a Sales Order, Vendor invoice no. and Due date on a Purchase Invoice, Valid until on a Quotation.
- **Tabs** — Item Details, Other Addition/Deduction, Partner Details, Other Details, Additional Details. Which tabs appear is derived from the config by `buildFormLayout`, and a tab with nothing in it is never rendered — a Quotation has no Partner Details because it has no warehouse or transporter.
- **Quick-entry row** — type an item name or code, set qty/rate, press Enter. Variant-tracked items demand a size/colour before the line is accepted, matching the server rule.
- **Line grid** — Sr.No, Code, Item, Qty, UOM, Rate, Disc(%), Disc.Amount, Amount, GST(%), Tot. Amount, all editable in place.
- **Sticky footer** — Save, Cancel, Mass Discount, a save-and-submit checkbox labelled with that document's real next step ("Send for approval", "Post immediately", "Issue immediately"), and a running total.

The header/tab placement rules are a pure function and are unit-tested across all eleven modules, including a check that every document type still has exactly one forward step out of DRAFT — the property that lets one checkbox serve them all.

**Listings** — every list (masters, documents, payments, reports) has the same action set: New, Search, Filters, Columns, Refresh, Import, Export, bulk selection, and per-row View / Edit / Print / Copy / Amendment / Email / Delete. Actions that do not apply are shown **disabled with the reason** rather than hidden — "Only drafts can be deleted" teaches the rule; a missing button looks like a bug.

Delete follows the data, not the button:

| Record | Delete does |
|---|---|
| Master (customer, item, …) | Soft delete — hidden from lists, kept so historical documents still resolve |
| Draft document | Hard delete, unless another document links to it |
| Posted document | **Refused** — cancel it instead, which reverses stock and fulfilment and keeps the numbering gap-free |
| Receipt / Payment | Cancel, returning the money to the invoices it settled |

**Receipts & Payments** — money actually moving, recorded against invoices. One entry can be split across several invoices or left partly unallocated ("on account"). Settlement runs in a single transaction: the entry, every invoice's paid/due amounts and their payment statuses all land together or not at all. Over-payment, over-allocation and duplicate allocation are refused. Cancelling reverses the settlement and reopens the invoices.

**Dashboard** (`/dashboard`) — KPI tiles plus charts over a selectable period (Today / Week / Month / Quarter / Year / Custom). Every figure is computed from live documents, every figure carries the drill-through link that reproduces it as a filtered list, and every figure is typed as money, count, quantity or percent so *"30 invoices"* can never render as *"₹30"*.

**Module analysis** (`/analysis/<module>`) — Sales, Purchase, Inventory, Customers, Suppliers and Cash & Settlement. Each states its findings as sentences with the numbers behind them, for example:

> 15 sales order(s) were created, but only 14 have been fully converted into invoices. 1 still has quantity left to invoice.

> 18 invoice(s) were raised, but payment has been received against only 3. 15 still need follow-up.

Counts and values are always shown as separate measures, receivables are aged 0–30 / 31–60 / 61–90 / 90+ days as of today (not just the selected period), and each analysis states what it cannot see.

**Keyboard shortcuts** — a central handler (`src/lib/shortcuts`) that screens declare *capabilities* to rather than each binding its own listener. Ctrl + / opens the reference, which renders from the same registry the handler reads, so the table can never drift from what actually works. Global actions never fire while you are typing; Ctrl + S and Ctrl + / are the deliberate exceptions. Cmd and ⌥ are substituted on macOS.

| Shortcut | Action |
|---|---|
| Ctrl + N / S / F | New · Save · Search |
| Ctrl + E / I / P | Export · Import · Print |
| Ctrl + R / K | Refresh listing · Column picker |
| Ctrl + Shift + F | Advanced filters |
| Ctrl + Enter | Add a document line |
| Esc | Close the open dialog |
| Alt + ← / → | Back · Forward |
| Alt + Q/O/S, P/B, R/Y, C/V/M, D/L | Quick-create and quick-go (see Ctrl + /) |

**Administration** — Employees (`/users`), User Roles (`/user-roles`, every permission a role holds, grouped by module) and the Activity Log (`/logs`, the audit trail filtered by module, action and date) are read-only views over `/api/admin/users`, `/api/admin/roles` and `/api/admin/audit-logs` (permissions `users.view`, `roles.view`, `audit-logs.view`).

**Not yet built** (listed in the sidebar as "Soon", never as links): Production (recipes, BOM, material creation/consumption), Point of Sale, CRM (coupons, memberships, discounts, loyalty, feedback), bank accounts/transactions/expenses/cash-flow/reconciliation, departments, combo products, category-wise variants, eCommerce catalog, price mapping, terms & conditions, stock-transfer requests, utilities (storage, barcode labels, Tally export), global setup (prefixes, tax rates, payment terms, additional charges, device binding, targets), module settings, financial-year management, inviting users / editing roles, and Apps & Integrations. A "Show planned modules" switch at the foot of the sidebar hides them.

## UI / design system

- **Tokens** live at the top of `src/app/globals.css` (surfaces, text, borders, indigo accent, semantic colours, radii, shadows, 4/8px rhythm). Components use tokens and shared classes — no hard-coded colours.
- **Shared primitives** in `src/components/ui`: `PageHeader`, `SearchBox`, `Pagination`, `StatusBadge`, `EmptyState` / `ErrorState` / `SkeletonRows`, `AccessDenied`, `Toast` (`useToast()`), `usePopover`.
- **Shell** (`src/app/(app)/AppShell.tsx`): collapsible sidebar (remembered per browser, flyout menus when collapsed, drawer on phones), breadcrumbs, quick-create, alerts, help and account menus. All navigation comes from one registry, `src/app/(app)/navigation.ts`, which also feeds breadcrumbs, quick-create and the command palette.
- **Command palette** — `Ctrl + K` jumps to any screen, creates any record, or opens a customer, vendor, item or document by name/number (live search over the existing list APIs). The column picker moved to `Ctrl + Shift + K`.
- **Header**: financial-year menu, "Jump to anywhere" (Ctrl + K), + New, a decimal-exact calculator, Help (F1), alerts and account menu.
- **Alerts** in the top bar are the dashboard's own "needs attention" findings, not a separate feed.
- **Dashboard** reads `/api/analytics/dashboard` plus `/api/analytics/overview` (period-on-period deltas, payment-mode mix, receivable/payable aging per party, customer recency/frequency/value segments, sales by category, best/least-selling items with an estimated margin at current cost price). Both are read-only aggregations; purchase-side figures are returned only to roles that can view purchase invoices.
- **Sessions**: the API client renews an expired access token once (single-flight, so rotating refresh tokens aren't double-spent); if renewal fails mid-use the user lands on `/session-expired` and is returned to where they were after signing in.
- **Inventory overview** (`/inventory`) and **Workspace settings** (`/settings`) are built on existing APIs — stock by item, warehouse and size/colour, recent movements; business, financial year and account details (read-only).

**Deliberately out of scope**: Job Work, Production and Quality Control were removed from the product. The architecture still accommodates them — adding a manufacturing document type is a registry entry plus a workflow — but nothing in the codebase references them today.

## Auth endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register a new business + owner user, sends OTP |
| POST | `/api/auth/verify-otp` | Verify the registration OTP, activates the business |
| POST | `/api/auth/resend-otp` | Resend the registration OTP (rate-limited) |
| POST | `/api/auth/login` | Login with domain + username/email + password; `rememberMe: false` makes the session end with the browser |
| POST | `/api/auth/refresh` | Rotate the refresh token, issue a new access token |
| POST | `/api/auth/logout` | Revoke the current session |
| POST | `/api/auth/forgot-password` | Email a 6-digit reset code (same response whether or not the account exists) |
| POST | `/api/auth/reset-password` | Verify the code, set the new password, clear any lockout, revoke every session |
| GET | `/api/auth/me` | Current authenticated user + permissions (reference for protected-route pattern) |
