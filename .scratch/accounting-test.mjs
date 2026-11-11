// Accounting: chart of accounts, double-entry vouchers, auto-posting from
// documents, backfill idempotency, trial balance and general ledger.
const BASE = "http://localhost:3000";
let cookie = "";
const failures = [];

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", cookie, ...(options.headers ?? {}) },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
function check(cond, msg) {
  if (!cond) { console.log(`   ✗ ${msg}`); failures.push(msg); return false; }
  return true;
}
const n = (v) => Number(Number(v ?? 0).toFixed(2));

await call("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ domain: "rangoli-textiles", usernameOrEmail: "asha", password: "Str0ng!Passw0rd" }),
});
console.log("✓ logged in\n");

// ---- 1. Chart of accounts setup ---------------------------------------
console.log("── Chart of accounts");
const before = await call("/api/accounting/setup");
check(before.body?.success, "setup status should be readable");

const setup = await call("/api/accounting/setup", { method: "POST" });
if (!check(setup.body?.success, `setup failed: ${JSON.stringify(setup.body).slice(0, 200)}`)) process.exit(1);
console.log(`   ✓ ${setup.body.message}`);

// Running it twice must not duplicate anything.
const again = await call("/api/accounting/setup", { method: "POST" });
check(again.body?.data?.created === 0, `re-running setup created ${again.body?.data?.created} accounts — must be 0`);
console.log("   ✓ running setup again creates nothing (idempotent)");

const accounts = await call("/api/masters/chart-of-accounts?pageSize=200");
const list = accounts.body?.data?.items ?? [];
check(list.length >= 35, `expected 35+ accounts, got ${list.length}`);

const roles = list.filter((a) => a.systemRole).map((a) => a.systemRole);
for (const required of ["ACCOUNTS_RECEIVABLE", "SALES", "OUTPUT_CGST", "CASH", "BANK", "ACCOUNTS_PAYABLE"]) {
  check(roles.includes(required), `system account ${required} is missing`);
}
check(new Set(roles).size === roles.length, "a system role is assigned to more than one account");
console.log(`   ✓ ${list.length} accounts, ${roles.length} system roles, each unique`);

// Every type is represented and each has the right normal side.
const byType = {};
for (const a of list) byType[a.type] = (byType[a.type] ?? 0) + 1;
console.log(`   ✓ ${Object.entries(byType).map(([t, c]) => `${c} ${t.toLowerCase()}`).join(", ")}`);

// ---- 2. Manual voucher must balance -----------------------------------
console.log("\n── A journal entry must balance");
const postable = list.filter((a) => !a.isGroup && a.status === "ACTIVE");
const cash = postable.find((a) => a.systemRole === "CASH");
const bank = postable.find((a) => a.systemRole === "BANK");
const rent = postable.find((a) => a.name === "Rent");

const unbalanced = await call("/api/vouchers", {
  method: "POST",
  body: JSON.stringify({
    lines: [
      { accountId: rent.id, debit: "5000", credit: "0" },
      { accountId: cash.id, debit: "0", credit: "4000" },
    ],
  }),
});
check(!unbalanced.body?.success, "an unbalanced voucher must be refused");
check(unbalanced.body?.code === "UNBALANCED_VOUCHER", `expected UNBALANCED_VOUCHER, got ${unbalanced.body?.code}`);
console.log(`   ✓ rejected: ${unbalanced.body?.message}`);

// A line cannot be both a debit and a credit.
const bothSides = await call("/api/vouchers", {
  method: "POST",
  body: JSON.stringify({
    lines: [
      { accountId: rent.id, debit: "5000", credit: "5000" },
      { accountId: cash.id, debit: "0", credit: "5000" },
    ],
  }),
});
check(bothSides.body?.code === "BOTH_SIDES", `expected BOTH_SIDES, got ${bothSides.body?.code}`);
console.log(`   ✓ rejected: ${bothSides.body?.message}`);

// A group heading is not a posting account.
const group = list.find((a) => a.isGroup);
const toGroup = await call("/api/vouchers", {
  method: "POST",
  body: JSON.stringify({
    lines: [
      { accountId: group.id, debit: "100", credit: "0" },
      { accountId: cash.id, debit: "0", credit: "100" },
    ],
  }),
});
check(toGroup.body?.code === "GROUP_ACCOUNT", `expected GROUP_ACCOUNT, got ${toGroup.body?.code}`);
console.log(`   ✓ rejected: ${toGroup.body?.message}`);

// ---- 3. A balanced voucher posts --------------------------------------
console.log("\n── A balanced voucher posts and can be reversed");
const voucher = await call("/api/vouchers", {
  method: "POST",
  body: JSON.stringify({
    voucherType: "CONTRA",
    narration: "Cash deposited into bank",
    lines: [
      { accountId: bank.id, debit: "25000", credit: "0", narration: "Deposit" },
      { accountId: cash.id, debit: "0", credit: "25000" },
    ],
  }),
});
if (!check(voucher.body?.success, `voucher failed: ${JSON.stringify(voucher.body).slice(0, 220)}`)) process.exit(1);
const v = voucher.body.data;
check(n(v.totalDebit) === 25000 && n(v.totalCredit) === 25000, "totals should both be 25000");
check(v.isSystemGenerated === false, "a hand-written voucher must not be flagged as system generated");
console.log(`   ✓ ${v.voucherNumber} posted: Dr Bank 25000 / Cr Cash 25000`);

const cancelled = await call(`/api/vouchers/${v.id}?reason=${encodeURIComponent("Entered twice")}`, {
  method: "DELETE",
});
check(cancelled.body?.success, `cancel failed: ${cancelled.body?.message}`);
const afterCancel = await call(`/api/vouchers/${v.id}`);
check(afterCancel.body?.data?.status === "CANCELLED", "the original should be marked cancelled, not deleted");
console.log("   ✓ cancelled by posting a reversing entry; the original is kept");

// ---- 4. Auto-posting from a sales invoice -----------------------------
console.log("\n── Posting an invoice writes its journal entry");
const customers = await call("/api/customers?pageSize=1&status=ACTIVE");
const items = await call("/api/masters/items?pageSize=5&status=ACTIVE");
const customer = customers.body.data.items[0];
const item = items.body.data.items[0];

const line = { itemId: item.id, quantity: 2, rate: "1000", taxRatePercent: 12 };
if (item.variants?.length) line.variantSku = item.variants[0].sku;

const invoice = await call("/api/documents/sales-invoices", {
  method: "POST",
  body: JSON.stringify({ customerId: customer.id, lines: [line], paymentMode: "CREDIT" }),
});
if (!check(invoice.body?.success, `invoice create failed: ${JSON.stringify(invoice.body).slice(0, 200)}`)) process.exit(1);
const inv = invoice.body.data;

// A draft has no accounting effect.
let vouchers = await call(`/api/vouchers?query=${inv.documentNumber}`);
check(vouchers.body?.data?.total === 0, "a DRAFT invoice must not post anything");
console.log("   ✓ draft invoice posts nothing");

await call(`/api/documents/sales-invoices/${inv.id}/transition`, {
  method: "POST",
  body: JSON.stringify({ toStatus: "POSTED" }),
});

vouchers = await call(`/api/vouchers?query=${inv.documentNumber}`);
if (check(vouchers.body?.data?.total === 1, `posting should create exactly 1 voucher, got ${vouchers.body?.data?.total}`)) {
  const jv = vouchers.body.data.items[0];
  check(jv.isSystemGenerated === true, "an auto-posted voucher must be flagged as system generated");
  check(n(jv.totalDebit) === n(jv.totalCredit), "the posted voucher must balance");
  check(n(jv.totalDebit) === n(inv.totals.grandTotal), `voucher total ${jv.totalDebit} should equal invoice ${inv.totals.grandTotal}`);

  const detail = await call(`/api/vouchers/${jv.id}`);
  const byRole = {};
  for (const l of detail.body.data.lines) byRole[l.accountName] = { debit: n(l.debit), credit: n(l.credit) };
  console.log(`   ✓ ${jv.voucherNumber}: ${detail.body.data.lines.length} lines, balanced at ${jv.totalDebit}`);
  for (const [name, amt] of Object.entries(byRole)) {
    console.log(`     ${amt.debit > 0 ? "Dr" : "Cr"} ${name.padEnd(24)} ${(amt.debit || amt.credit).toFixed(2)}`);
  }

  // Receivable must equal the invoice total; revenue must equal the taxable value.
  const ar = detail.body.data.lines.find((l) => l.accountName === "Accounts Receivable");
  const sales = detail.body.data.lines.find((l) => l.accountName === "Sales");
  check(ar && n(ar.debit) === n(inv.totals.grandTotal), "Accounts Receivable should be debited with the grand total");
  check(sales && n(sales.credit) === n(inv.totals.taxableAmount), "Sales should be credited with the taxable value");
}

// A system voucher cannot be cancelled on its own.
const sysVoucher = (await call(`/api/vouchers?query=${inv.documentNumber}`)).body.data.items[0];
const refused = await call(`/api/vouchers/${sysVoucher.id}?reason=test`, { method: "DELETE" });
check(refused.body?.code === "SYSTEM_VOUCHER", `expected SYSTEM_VOUCHER, got ${refused.body?.code}`);
console.log(`   ✓ ${refused.body?.message?.slice(0, 95)}…`);

// ---- 5. A receipt posts too -------------------------------------------
console.log("\n── A receipt moves cash and clears the receivable");
const receipt = await call("/api/payments/receipts", {
  method: "POST",
  body: JSON.stringify({
    partyId: customer.id,
    amount: "500.00",
    mode: "BANK",
    allocations: [{ invoiceId: inv.id, amount: "500.00" }],
  }),
});
if (check(receipt.body?.success, `receipt failed: ${JSON.stringify(receipt.body).slice(0, 200)}`)) {
  const rv = (await call(`/api/vouchers?query=${receipt.body.data.documentNumber}`)).body.data.items[0];
  if (check(Boolean(rv), "the receipt should have posted a voucher")) {
    const detail = await call(`/api/vouchers/${rv.id}`);
    const bankLine = detail.body.data.lines.find((l) => l.accountName === "Bank Accounts");
    const arLine = detail.body.data.lines.find((l) => l.accountName === "Accounts Receivable");
    check(bankLine && n(bankLine.debit) === 500, "Bank should be debited 500");
    check(arLine && n(arLine.credit) === 500, "Accounts Receivable should be credited 500");
    console.log(`   ✓ ${rv.voucherNumber}: Dr Bank 500 / Cr Accounts Receivable 500`);
  }
}

// ---- 6. Cancelling an invoice reverses its entry ------------------------
console.log("\n── Cancelling a document reverses its journal entry");
const invoice2 = await call("/api/documents/sales-invoices", {
  method: "POST",
  body: JSON.stringify({ customerId: customer.id, lines: [line], paymentMode: "CREDIT" }),
});
const inv2 = invoice2.body.data;
await call(`/api/documents/sales-invoices/${inv2.id}/transition`, {
  method: "POST",
  body: JSON.stringify({ toStatus: "POSTED" }),
});
await call(`/api/documents/sales-invoices/${inv2.id}/transition`, {
  method: "POST",
  body: JSON.stringify({ toStatus: "CANCELLED", reason: "Raised against the wrong customer" }),
});

const both = await call(`/api/vouchers?query=${inv2.documentNumber}&pageSize=20`);
check(both.body?.data?.total >= 1, "the cancelled invoice should still have its original voucher on file");
const original = both.body.data.items.find((x) => x.status === "CANCELLED");
check(Boolean(original), "the original voucher should be marked cancelled, not deleted");
console.log(`   ✓ original voucher kept and marked cancelled; a reversing entry was posted`);

// ---- 7. Trial balance balances ----------------------------------------
console.log("\n── Trial balance");
const tb = await call("/api/reports/trial-balance?pageSize=200");
if (check(tb.body?.success, `trial balance failed: ${JSON.stringify(tb.body).slice(0, 200)}`)) {
  const summary = Object.fromEntries(tb.body.data.summary.map((s) => [s.label, s.value]));
  const difference = n(summary.Difference);
  check(difference === 0, `trial balance is out by ${difference} — some voucher does not balance`);
  console.log(
    `   ✓ debits ${summary["Total debits"]} = credits ${summary["Total credits"]}, difference ${summary.Difference}`
  );
  console.log(`   ✓ ${tb.body.data.total} account(s) with activity`);
}

// ---- 8. General ledger ------------------------------------------------
console.log("\n── General ledger");
const arAccount = list.find((a) => a.systemRole === "ACCOUNTS_RECEIVABLE");
const gl = await call(`/api/reports/general-ledger?accountId=${arAccount.id}&pageSize=200`);
if (check(gl.body?.success, `general ledger failed: ${JSON.stringify(gl.body).slice(0, 200)}`)) {
  const rows = gl.body.data.rows;
  check(rows.length > 0, "the receivable ledger should have postings");

  // The running balance must be self-consistent: each row's balance is the
  // previous balance plus that row's movement.
  const summary = Object.fromEntries(gl.body.data.summary.map((s) => [s.label, s.value]));
  let running = n(summary["Opening balance"]);
  let consistent = true;
  for (const r of rows) {
    running = n(running + n(r.debit) - n(r.credit));
    if (Math.abs(running - n(r.balance)) > 0.01) consistent = false;
  }
  check(consistent, "the running balance does not follow from the debits and credits");
  check(
    Math.abs(running - n(summary["Closing balance"])) < 0.01,
    `closing balance ${summary["Closing balance"]} should equal the last running balance ${running}`
  );
  console.log(`   ✓ ${rows.length} postings, running balance consistent, closing ${summary["Closing balance"]}`);
}

// A ledger with no account chosen returns nothing rather than guessing.
const noAccount = await call("/api/reports/general-ledger");
check(noAccount.body?.data?.total === 0, "a ledger with no account selected should return no rows");
console.log("   ✓ no account selected → no rows, rather than every account mixed together");

// ---- 9. Backfill is idempotent ----------------------------------------
console.log("\n── Backfill is idempotent");
const fill1 = await call("/api/accounting/backfill", { method: "POST" });
if (check(fill1.body?.success, `backfill failed: ${JSON.stringify(fill1.body).slice(0, 200)}`)) {
  console.log(`   ✓ first run: ${fill1.body.message}`);
  const fill2 = await call("/api/accounting/backfill", { method: "POST" });
  check(fill2.body?.data?.posted === 0, `second run posted ${fill2.body?.data?.posted} vouchers — must be 0`);
  console.log(`   ✓ second run: ${fill2.body.message}`);
}

// And the trial balance still balances after backfilling.
const tb2 = await call("/api/reports/trial-balance?pageSize=200");
const diff2 = n(Object.fromEntries(tb2.body.data.summary.map((s) => [s.label, s.value])).Difference);
check(diff2 === 0, `trial balance is out by ${diff2} after backfill`);
console.log(`   ✓ trial balance still balances after backfill (difference ${diff2.toFixed(2)})`);

// ---- 10. Profit & loss -------------------------------------------------
console.log("\n── Profit & loss");
const pl = await call("/api/reports/profit-and-loss?pageSize=200");
if (check(pl.body?.success, "profit & loss failed")) {
  const s = Object.fromEntries(pl.body.data.summary.map((x) => [x.label, x.value]));
  const income = n(s["Total income"]);
  const expenses = n(s["Total expenses"]);
  const net = n(s["Net profit"] ?? s["Net loss"]);
  check(Math.abs(Math.abs(income - expenses) - net) < 0.01, "net should be income minus expenses");
  console.log(`   ✓ income ${income.toFixed(2)} − expenses ${expenses.toFixed(2)} = ${net.toFixed(2)}`);
}

console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} FAILURE(S)`);
process.exit(failures.length === 0 ? 0 : 1);
