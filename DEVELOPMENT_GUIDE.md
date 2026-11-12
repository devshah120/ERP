# NEXORA ERP — Architecture, System Analysis & Task Completion Guide

> **Primary Reference Document** for understanding the codebase, backend and frontend architecture, data flows, and implementing new features or completing tasks with strict consistency.

---

## 1. Executive Summary & Tech Stack

**NEXORA** is a multi-tenant, production-grade Enterprise Resource Planning (ERP) platform purpose-built for garment manufacturers, wholesalers, and retail traders. It is designed around strict financial accounting principles, Indian GST compliance, multi-document ACID transactions, and extensible generic frameworks.

### Technology Stack
- **Framework & Runtime**: Next.js 16 (App Router, Route Handlers, Server & Client Components), React 19, TypeScript 5.
- **Database & ODM**: MongoDB with Mongoose 9. **Requires a Replica Set** (local `rs0` or MongoDB Atlas) for multi-document session transactions.
- **Authentication**: JWT access token (15-min TTL) + rotating opaque refresh token (30-day TTL) in secure HTTP cookies; email/console OTP verification; account lockout protection.
- **Validation**: Zod (v4) schemas across all endpoints, imports, and forms.
- **Financial Precision**: MongoDB `Decimal128` at persistence layer; `decimal.js` at runtime. **Zero floating-point numbers** for financial data.
- **Reports & Export/Import**: ExcelJS (`.xlsx`), CSV streaming, `pdf-lib` for barcode and A4/A5/thermal document printing.
- **Testing**: Vitest 5, `mongodb-memory-server`.

---

## 2. Core Architectural Principles (Never Violate)

1. **Tenant Isolation by Construction**:
   - Every tenant-scoped entity carries `businessId: Types.ObjectId`.
   - Never call bare `Model.find()` directly on tenant data. Use `TenantRepository` or explicitly filter by `businessId: ctx.businessId`.
2. **Deterministic Financial Arithmetic**:
   - Never use JavaScript numbers (`+`, `-`, `*`, `/`) for money, taxes, or discounts.
   - Always wrap values in `new Decimal(val)`, compute with `toDecimalPlaces(2, Decimal.ROUND_HALF_UP)`, and serialize to MongoDB using `toDecimal128()`.
3. **Transaction Safety (ACID)**:
   - Any operation touching more than one collection (e.g. document posting + stock update + general ledger voucher + source order rollup) **must** run inside a Mongoose `ClientSession` (`session.withTransaction(...)`).
4. **Append-Only Auditing and Ledgers**:
   - Stock does not just get edited; it moves via `inventoryTransactions` ledger rows and updates `StockBalance`.
   - Accounting postings are recorded as balanced double-entry vouchers in the `Voucher` collection.
   - State mutations record before-and-after snapshots in `AuditLog`.
5. **No Blind Deletions**:
   - Masters are soft-deleted (`status: "DELETED"` or `isDeleted: true`) so historical transactions do not break.
   - Draft documents may be hard deleted; posted documents can only be **Cancelled**, which creates reversing ledger entries.

---

## 3. Backend Architecture & Design

### Layered Architecture
```
Next.js Route Handler (`src/app/api/**/route.ts`)
       ↓ withApiHandler() (Error handling, DB connect, duplicate key catch)
       ↓ getAuthContext() + requirePermission()
Service Layer (`src/lib/services/**`, `src/lib/documents/service.ts`, `src/lib/pos/service.ts`, etc.)
       ↓ Business logic, validations, sequence numbering, session transactions
Repository & Models (`src/lib/repositories/TenantRepository.ts`, `src/models/**`)
       ↓ Mongoose schemas with Decimal128, indexes, and soft-delete scopes
MongoDB Database (Replica Set)
```

### Key Subsystems & Modules

#### A. Multi-Tenancy, Auth & RBAC
- **Context Extraction**: `getAuthContext(req)` in API routes and `getServerAuthContext()` in Server Components verify JWTs and yield `userId`, `businessId`, `roleId`, `permissions`, `branchIds`, and `warehouseIds`.
- **Permission Catalog** (`src/lib/auth/permissionCatalog.ts`): Centralized list of `<module>.<action>` permissions. Owner role carries wildcard `*`.
- **Tenant Isolation**: `TenantRepository<T>` enforces `businessId` as the first argument in all queries.

#### B. The Generic Resource Framework (Masters)
- **Files**: `src/lib/resources/registry.ts`, `src/lib/resources/extendedRegistry.ts`, `src/lib/resources/handlers.ts`.
- **How it works**: Instead of writing separate CRUD routes for every master entity, masters are registered with schema, filter fields, sort fields, search fields, and auto-code sequence.
- **Served endpoints**:
  - `GET /api/masters/[resource]` (Listing, pagination, filters, sorting, search).
  - `POST /api/masters/[resource]` (Creation with auto-generated code and audit log).
  - `GET /api/masters/[resource]/[id]` (Fetch single record).
  - `PUT /api/masters/[resource]/[id]` (Update record).
  - `DELETE /api/masters/[resource]/[id]` (Soft delete).
  - `POST /api/masters/[resource]/export` (Excel/CSV export).
  - `POST /api/masters/[resource]/import/template`, `preview`, `commit`.
- **Covered Entities**: Vendors, Agents, Transporters, Categories, Brands, Units, Warehouses, Branches, Departments, Category-wise Variants, Combo Products, Coupons, Memberships, Discounts, Loyalty, Feedback, Bank Accounts, Tax Rates, Payment Terms, Additional Charges, Devices, Sales Targets.

#### C. The Generic Document Framework (Sales & Purchase Chains)
- **Files**: `src/lib/documents/registry.ts`, `src/lib/documents/service.ts`, `src/lib/documents/workflows.ts`, `src/lib/documents/totals.ts`.
- **Chains Supported**:
  - **Sales**: Sales Quotation → Sales Order → Delivery Challan (Stock OUT) → Sales Invoice → Sales Return (Stock IN) / Credit Note.
  - **Purchase**: Purchase Order → Goods Receipt (Stock IN) → Purchase Invoice → Purchase Return (Stock OUT) / Debit Note.
- **Workflow State Machine**: Transitions are enforced strictly. Posted documents lock against field edits.
- **Automated Calculations**: Server computes gross amounts, discounts, GST split (CGST + SGST for intra-state, IGST for inter-state), shipping, and roundoffs via `computeDocumentTotals()`.
- **Conversion & Rollup Engine**:
  - `convertDocument()` carries lines forward to child documents.
  - Tracking of `deliveredQty` and `invoicedQty` rolls up atomically to the parent order.
  - Over-delivery and over-invoicing are mathematically blocked.

#### D. Inventory Ledger & Stock Service
- **Files**: `src/lib/services/stockService.ts`, `src/lib/inventory/`.
- **Models**: `StockBalance` (per business + warehouse + item + variantSku) and `InventoryTransaction` (append-only ledger).
- **Posting**: Any document with `stock: { direction, movementType, atStatus }` triggers `postStockMovement()` when reaching that status. Reversal is handled automatically on cancellation.
- **Negative Stock Prevention**: Configurable or strictly blocked if stock would fall below zero.

#### E. Double-Entry Accounting Engine
- **Files**: `src/lib/accounting/posting.ts`, `src/lib/accounting/chartOfAccounts.ts`, `src/lib/accounting/voucherService.ts`.
- **Models**: `Account` (COA tree with `systemRole`), `Voucher` (Journal entries with debit/credit balance).
- **Automated Posting**: Invoices, receipts, payments, and credit/debit notes automatically generate balanced vouchers in the General Ledger. Debits must equal credits down to the paise.
- **Reports**: General Ledger, Trial Balance, Profit & Loss.

#### F. Point of Sale (POS) Subsystem
- **Files**: `src/lib/pos/service.ts`, `src/models/pos.ts`, `src/app/(app)/pos/register/page.tsx`.
- **Capabilities**: Register shifts (open/close with cash counts), fast counter checkout, barcode scanning, line discounts, coupons & memberships, split payments (Cash, Card, UPI), POS credit notes/refunds, "Today's Bills" modal, and thermal/A4 receipt printing.

#### G. Document Numbering Engine
- **Files**: `src/lib/services/numberingService.ts`, `src/lib/services/documentPrefixService.ts`.
- **Sequence Generation**: Atomic counter generation using MongoDB `$inc` on `MasterCounter` and `DocumentSequence`, supporting custom prefixes and financial year formatting (e.g. `INV-2026-2027-000001`).

---

## 4. Frontend Architecture & Design

### Directory & Component Hierarchy
```
src/app/(app)/
  ├── layout.tsx              → Wraps with AuthProvider, ShortcutProvider, ToastContainer
  ├── AppShell.tsx            → Sidebar, Topbar, Breadcrumbs, Quick-Create, Jump Menu
  ├── navigation.ts           → Single source of truth for sidebar, permissions, breadcrumbs
  ├── [resource]/             → Dynamic Catch-All routing for Masters, Documents & Payments:
  │     ├── page.tsx          → Resolves to ResourceListView | DocumentListView | PaymentListView
  │     ├── new/page.tsx      → Resolves to ResourceFormView | DocumentFormView | PaymentFormView
  │     ├── [id]/page.tsx     → Resolves to ResourceFormView | DocumentFormView | PaymentFormView (edit/view)
  │     └── [id]/print/page.tsx → Server-rendered A4 / A5 / Thermal print views
  ├── pos/                    → POS Register, Orders, Credit Notes, Shifts
  ├── dashboard/              → KPI widgets, charts, quick links
  ├── analysis/[module]/      → Deep narrative analytics per domain
  ├── reports/[report]/       → Report catalog, column selection, Excel export
  └── settings/               → Workspace, Financial Years, Print Formats, Module Settings
```

### Design System & UI Components
- **Global Tokens** (`src/app/globals.css`): CSS custom properties for surfaces, borders, text contrast, primary indigo, status badge colors, and 4/8px spacing rhythms.
- **Shared Primitives** (`src/components/ui/`):
  - `PageHeader`: Title, badges, back buttons, primary actions.
  - `SearchBox`, `Pagination`: Standardized pagination & query debounce.
  - `StatusBadge`: Consistent color and badge rendering for document & master states.
  - `Modal`, `ConfirmDialog`: Dialog containers with accessible focus management.
  - `Toast` (`useToast`): Stackable toast notifications for success/error feedback.
  - `States.tsx`: `SkeletonRows`, `SkeletonBlock`, `EmptyState`, `ErrorState`.
  - `AccessDenied`: Rendered when user lacks module permissions.
- **Table Components** (`src/components/table/`):
  - `ColumnPicker`: Server-backed and client-controlled visible columns.
  - `RowActions`: Contextual menu for View, Edit, Print, Copy, Cancel, Delete.
  - `BulkActionBar`: Bulk status change or delete operations.
  - `ExportButton`: Handles `.xlsx` and `.csv` downloads.
  - `ImportDialog`: Multi-step upload, column mapping preview, error reporting, and commit.
- **Print Engine** (`src/components/print/`, `src/lib/printFormats/`):
  - Dynamic layouts (Modern, Classic, Minimal, Compact Thermal).
  - Print preview with automatic browser print triggering.
- **Client API Layer** (`src/lib/api/client.ts`):
  - `apiFetch<T>(url, init)`: Single gateway for all frontend HTTP requests.
  - Automatic single-flight token refresh on HTTP 401. If refresh fails, triggers `SESSION_EXPIRED_EVENT`.

---

## 5. Step-by-Step Task Completion Playbook

When assigned a task in this codebase, follow these standardized workflows to ensure flawless integration.

### Workflow A: Adding a New Master Entity
1. **Define Mongoose Schema**: Create model in `src/models/` or add to `src/models/catalogMasters.ts` / `setupMasters.ts`. Export it in `src/models/index.ts`. Ensure it includes `businessId`.
2. **Add Permissions**: Add keys (`<module>.view`, `<module>.create`, etc.) to `src/lib/auth/permissionCatalog.ts`.
3. **Configure Resource Definition**:
   - Add entry in `src/lib/resources/extendedRegistry.ts` (or `registry.ts`).
   - Define fields, Zod schema (`createSchema`, `updateSchema`), `autoCode`, `searchFields`, `filterFields`, `sortableFields`.
4. **Register UI Navigation**:
   - Add UI metadata in `src/lib/resources/ui/extendedRegistry.ts` (columns, form fields, layout).
   - Add navigation item in `src/app/(app)/navigation.ts` under the appropriate `NavGroup`.
5. **Verify**: The dynamic routes `/[resource]`, `/[resource]/new`, and `/[resource]/[id]` automatically serve the new master with search, filter, export, import, and CRUD without creating any new `.tsx` files!

### Workflow B: Adding or Modifying a Document Type
1. **Schema & Model**: Create schema in `src/models/salesDocuments.ts`, `purchaseDocuments.ts`, or `stockDocuments.ts`.
2. **Define Workflow**: Add allowed state transitions in `src/lib/documents/workflows.ts`.
3. **Register Document**:
   - Add definition to `DOCUMENTS` in `src/lib/documents/registry.ts`.
   - Set `prefix`, `sequenceType`, `party` (Customer or Vendor), `convertsTo`, and `stock` movement triggers.
4. **Register Document UI**:
   - Add configuration to `DOCUMENT_UI` in `src/lib/documents/ui.ts`.
   - Define promoted header fields, tab layout (`buildFormLayout`), line columns, and print templates.
5. **Navigation**: Add route to `src/app/(app)/navigation.ts`.

### Workflow C: Creating a Custom API Endpoint
1. Create `src/app/api/<path>/route.ts`.
2. Wrap handlers in `withApiHandler(async (req, ctx) => { ... })`.
3. Authenticate and authorize:
   ```typescript
   const ctx = getAuthContext(req);
   requirePermission(ctx, "module.action");
   ```
4. Perform business logic in a dedicated service function inside `src/lib/services/` or `src/lib/<domain>/`.
5. If modifying multiple collections, start a Mongoose transaction:
   ```typescript
   const session = await mongoose.startSession();
   try {
     let result;
     await session.withTransaction(async () => {
       // All DB operations must pass { session }
     });
     return ok(result);
   } finally {
     await session.endSession();
   }
   ```
6. Return responses using `ok(data)` or `fail(message, statusCode, code)` from `src/lib/http/response.ts`.

### Workflow D: Creating a Bespoke Frontend Screen
1. Place the page in `src/app/(app)/<name>/page.tsx`.
2. Mark `"use client";` if interactive, or keep as Server Component if fetching initial data.
3. Use shared primitives: `PageHeader`, `SearchBox`, `Pagination`, `States` (`SkeletonRows`, `EmptyState`), `Toast`.
4. Fetch data using `apiFetch<T>("/api/...")`.
5. Wrap with permission check: if permission missing, render `<AccessDenied />`.
6. Add entry in `src/app/(app)/navigation.ts` with appropriate `keywords` and `createHref`.

---

## 6. Development Rules & Anti-Patterns ("Never Do This")

| Bad Practice (Will Break Production) | Correct Architecture Pattern |
|---|---|
| `const total = qty * rate;` | `const total = new Decimal(qty).times(rate).toDecimalPlaces(2);` |
| `Item.find({ name: "Shirt" })` | `Item.find({ businessId: ctx.businessId, name: "Shirt" })` or `tenantRepo.find(...)` |
| `doc.status = "COMPLETED"; await doc.save();` | Use `transitionDocument()` in `src/lib/documents/transitions.ts` to enforce state validation, stock movement, and audit log |
| `await Item.updateOne(...); await Stock.updateOne(...);` without session | Use `session.withTransaction(...)` whenever two or more collections are updated together |
| Deleting an invoice or receipt row from DB | Hard delete allowed only for DRAFTs without references. Posted documents must be CANCELLED with reversing vouchers and stock entries |
| Hardcoding `#4f46e5` or colors in CSS | Use CSS variables and theme tokens (`var(--primary)`, `var(--surface)`, `var(--text-primary)`) from `globals.css` |
| Using `window.alert()` or `window.confirm()` | Use `ConfirmDialog` and `useToast()` from `@/components/ui` |

---

## 7. Verification & Quality Checklist

Before considering any task complete:
- [ ] **Type Safety**: Run `npx tsc --noEmit` to verify zero TypeScript errors.
- [ ] **Linter**: Run `npm run lint` to ensure no ESLint warnings or errors.
- [ ] **Precision**: Verify no raw JS floating arithmetic was introduced for prices/taxes/quantities.
- [ ] **Multi-tenancy**: Verify all MongoDB operations enforce `businessId`.
- [ ] **Transactions**: Verify multi-collection updates run within a transactional `ClientSession`.
- [ ] **Audit Trail**: State transitions and key mutations call `recordAudit()`.
- [ ] **Navigation & Breadcrumbs**: Verify any new page resolves properly in `navigation.ts` and `findNavMatch()`.
- [ ] **Test Suite**: Run `npm test` / Vitest tests to ensure existing tests pass.

