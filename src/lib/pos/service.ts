import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Item } from "@/models/Item";
import { Customer } from "@/models/Customer";
import { Warehouse } from "@/models/Warehouse";
import { User } from "@/models/User";
import { PosRegister, PosOrder, PosCreditNote, POS_PAYMENT_MODES } from "@/models/pos";
import { Coupon, Discount, Membership } from "@/models/crm";
import { StockBalance } from "@/models/inventory";
import { postStockMovement, reverseStockMovement } from "@/lib/services/stockService";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { unitValuation } from "@/lib/inventory/valuation";
import { tryPostDocument, reverseVoucherFor, type PostingEntry } from "@/lib/accounting/posting";
import { getPosSettings } from "@/lib/settings/service";
import { resolveBusinessContext, escapeRegex, dayRange } from "@/lib/services/businessContext";
import { SEQUENCES } from "@/lib/numbering/catalogue";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

const D = (v: unknown) => new Decimal(String(v ?? 0));
const ZERO = new Decimal(0);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/* ================================================================== */
/* Registers                                                           */
/* ================================================================== */

export const openRegisterSchema = z.object({
  counterName: z.string().trim().min(1, "Name the counter").max(60),
  warehouseId: z.string().trim().min(1, "Choose the warehouse this counter sells from"),
  openingCash: z.string().trim().default("0"),
});

export const closeRegisterSchema = z.object({
  countedCash: z.string().trim().min(1, "Enter the cash counted in the drawer"),
  closingNotes: z.string().trim().max(1000).optional(),
});

/** Cash in, cash out and card/UPI totals for a register session. */
async function registerTotals(businessId: Types.ObjectId, registerId: Types.ObjectId) {
  const [orders, notes] = await Promise.all([
    PosOrder.find({ businessId, registerId, status: "COMPLETED" }, { payments: 1, changeReturned: 1, totals: 1 }).lean<AnyDoc[]>(),
    PosCreditNote.find({ businessId, registerId, status: "ISSUED" }, { refundMode: 1, totals: 1 }).lean<AnyDoc[]>(),
  ]);
  const byMode: Record<string, Decimal> = { CASH: ZERO, CARD: ZERO, UPI: ZERO };
  let sales = ZERO;
  for (const o of orders) {
    sales = sales.plus(D(o.totals?.grandTotal));
    for (const p of o.payments ?? []) byMode[p.mode] = (byMode[p.mode] ?? ZERO).plus(D(p.amount));
    byMode.CASH = byMode.CASH.minus(D(o.changeReturned));
  }
  const refunds: Record<string, Decimal> = { CASH: ZERO, CARD: ZERO, UPI: ZERO };
  for (const n of notes) refunds[n.refundMode] = (refunds[n.refundMode] ?? ZERO).plus(D(n.totals?.grandTotal));
  return {
    orderCount: orders.length,
    sales,
    cashSales: byMode.CASH,
    cardSales: byMode.CARD,
    upiSales: byMode.UPI,
    refundCount: notes.length,
    cashRefunds: refunds.CASH,
    otherRefunds: refunds.CARD.plus(refunds.UPI),
  };
}

async function registerView(reg: AnyDoc) {
  const t = await registerTotals(reg.businessId, reg._id);
  const [wh, user] = await Promise.all([
    Warehouse.findById(reg.warehouseId, { name: 1 }).lean<AnyDoc>(),
    User.findById(reg.openedBy, { name: 1 }).lean<AnyDoc>(),
  ]);
  const expected = D(reg.openingCash).plus(t.cashSales).minus(t.cashRefunds);
  return {
    ...(serializeDoc(reg) as AnyDoc),
    warehouseName: wh?.name ?? "—",
    openedByName: user?.name ?? "—",
    orderCount: t.orderCount,
    refundCount: t.refundCount,
    salesTotal: t.sales.toFixed(2),
    cashSales: t.cashSales.toFixed(2),
    cardSales: t.cardSales.toFixed(2),
    upiSales: t.upiSales.toFixed(2),
    cashRefunds: t.cashRefunds.toFixed(2),
    otherRefunds: t.otherRefunds.toFixed(2),
    // For a closed register, the figure frozen at closing; otherwise live.
    expectedCashNow: reg.status === "CLOSED" ? D(reg.expectedCash).toFixed(2) : expected.toFixed(2),
    // Over/short only means something once the drawer has been counted.
    cashDifference: reg.status === "CLOSED" ? D(reg.cashDifference).toFixed(2) : null,
    countedCash: reg.status === "CLOSED" ? D(reg.countedCash).toFixed(2) : null,
  };
}

export async function openRegister(input: z.infer<typeof openRegisterSchema>, ctx: AuthContext) {
  const existing = await PosRegister.findOne({ businessId: ctx.businessId, openedBy: ctx.userId, status: "OPEN" }).lean<AnyDoc>();
  if (existing) throw AppError.conflict(`You already have register ${existing.registerNumber} open. Close it first.`, "REGISTER_OPEN");

  if (!Types.ObjectId.isValid(input.warehouseId)) throw AppError.badRequest("Warehouse not found", "WAREHOUSE_NOT_FOUND");
  const wh = await Warehouse.findOne({ _id: input.warehouseId, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!wh) throw AppError.badRequest("Warehouse not found", "WAREHOUSE_NOT_FOUND");

  let opening: Decimal;
  try {
    opening = D(input.openingCash || "0");
  } catch {
    throw AppError.badRequest("Opening cash must be a number", "BAD_AMOUNT");
  }
  if (opening.lt(0)) throw AppError.badRequest("Opening cash cannot be negative", "BAD_AMOUNT");

  const { branchId, financialYear } = await resolveBusinessContext(ctx.businessId);
  const { formatted } = await getNextDocumentNumber({
    businessId: ctx.businessId,
    branchId,
    financialYearId: financialYear._id,
    documentType: SEQUENCES.POS_REGISTER.documentType,
    prefix: SEQUENCES.POS_REGISTER.defaultPrefix,
    financialYearLabel: financialYear.label,
  });

  const reg = await PosRegister.create({
    businessId: ctx.businessId,
    registerNumber: formatted,
    counterName: input.counterName,
    warehouseId: wh._id,
    status: "OPEN",
    openedBy: ctx.userId,
    openedAt: new Date(),
    openingCash: toDecimal128(opening),
  });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "pos.registers",
    documentType: "POS register",
    documentId: reg._id,
    newValue: { registerNumber: formatted, openingCash: opening.toFixed(2) },
  });
  return registerView(reg.toObject());
}

export async function currentRegister(ctx: AuthContext) {
  const reg = await PosRegister.findOne({ businessId: ctx.businessId, openedBy: ctx.userId, status: "OPEN" }).lean<AnyDoc>();
  return reg ? registerView(reg) : null;
}

export async function getRegister(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Register not found");
  const reg = await PosRegister.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!reg) throw AppError.notFound("Register not found");
  return registerView(reg);
}

/**
 * Closes a shift. Expected cash = float + cash taken − change given − cash
 * refunds; the counted figure is compared against it and the over/short is
 * kept on the register for good.
 */
export async function closeRegister(id: string, input: z.infer<typeof closeRegisterSchema>, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Register not found");
  const reg = await PosRegister.findOne({ _id: id, businessId: ctx.businessId });
  if (!reg) throw AppError.notFound("Register not found");
  if (reg.status === "CLOSED") throw AppError.badRequest("This register is already closed", "REGISTER_CLOSED");
  const isOwner = reg.openedBy.equals(ctx.userId);
  const canManage = ctx.permissions.includes("*") || ctx.permissions.includes("pos.manage-registers");
  if (!isOwner && !canManage) throw AppError.forbidden("Only the cashier who opened this register, or a manager, can close it");

  let counted: Decimal;
  try {
    counted = D(input.countedCash);
  } catch {
    throw AppError.badRequest("Counted cash must be a number", "BAD_AMOUNT");
  }
  const t = await registerTotals(ctx.businessId, reg._id);
  const expected = D(reg.openingCash).plus(t.cashSales).minus(t.cashRefunds);

  reg.status = "CLOSED";
  reg.closedBy = ctx.userId;
  reg.closedAt = new Date();
  reg.expectedCash = toDecimal128(expected);
  reg.countedCash = toDecimal128(counted);
  reg.cashDifference = toDecimal128(counted.minus(expected));
  reg.closingNotes = input.closingNotes;
  await reg.save();

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "pos.registers",
    documentType: "POS register",
    documentId: reg._id,
    newValue: { status: "CLOSED", expected: expected.toFixed(2), counted: counted.toFixed(2) },
  });
  return registerView(reg.toObject());
}

export async function listRegisters(params: URLSearchParams, ctx: AuthContext) {
  const q = listSchema.parse(Object.fromEntries(params.entries()));
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (q.status) filter.status = q.status;
  if (q.query) {
    const rx = { $regex: escapeRegex(q.query), $options: "i" };
    filter.$or = [{ registerNumber: rx }, { counterName: rx }];
  }
  const range = dayRange(q.fromDate, q.toDate);
  if (range) filter.openedAt = range;
  const [docs, total] = await Promise.all([
    PosRegister.find(filter).sort({ openedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<AnyDoc[]>(),
    PosRegister.countDocuments(filter),
  ]);
  return { items: await Promise.all(docs.map(registerView)), total };
}

/* ================================================================== */
/* Pricing                                                             */
/* ================================================================== */

const cartLineInput = z.object({
  itemId: z.string().trim().min(1),
  variantSku: z.string().trim().optional(),
  quantity: z.coerce.number().positive("Quantity must be more than zero"),
  /** Counter price; blank uses the item's selling price. */
  price: z.string().trim().optional(),
  /** Manual line discount; blank lets automatic discounts apply. */
  discountPercent: z.coerce.number().min(0).max(100).optional(),
});

export const quoteSchema = z.object({
  customerId: z.string().trim().optional(),
  couponCode: z.string().trim().toUpperCase().optional(),
  lines: z.array(cartLineInput).max(500),
});

export const orderSchema = quoteSchema.extend({
  registerId: z.string().trim().min(1, "Open a register first"),
  customerName: z.string().trim().max(150).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
  payments: z
    .array(
      z.object({
        mode: z.enum(POS_PAYMENT_MODES),
        amount: z.string().trim().min(1),
        reference: z.string().trim().max(60).optional(),
      })
    )
    .min(1, "Take a payment"),
});

function activeOn(doc: AnyDoc, when: Date) {
  if (doc.validFrom && new Date(doc.validFrom) > when) return false;
  if (doc.validTo && new Date(new Date(doc.validTo).setHours(23, 59, 59, 999)) < when) return false;
  return true;
}

/**
 * Prices a cart the way the counter will bill it. One function serves both
 * the live quote on screen and the saved order, so the two cannot disagree.
 *
 * Per line: counter price × qty, less the line discount — the cashier's, or
 * failing that the best of any automatic Discount and the customer's
 * membership discount. With MRP pricing the GST is carved out of the price;
 * otherwise it is added on top. A coupon then comes off the whole bill,
 * spread across lines in proportion so the GST stays correct per line.
 */
export async function priceCart(businessId: Types.ObjectId, input: z.infer<typeof quoteSchema>) {
  const settings = await getPosSettings(businessId);
  const now = new Date();
  const warnings: string[] = [];

  const ids = [...new Set(input.lines.map((l) => l.itemId))].filter((id) => Types.ObjectId.isValid(id));
  const [items, discounts, membership] = await Promise.all([
    Item.find({ businessId, _id: { $in: ids } }).lean<AnyDoc[]>(),
    settings.applyAutomaticDiscounts
      ? Discount.find({ businessId, status: "ACTIVE", deletedAt: null }).lean<AnyDoc[]>()
      : Promise.resolve([] as AnyDoc[]),
    input.customerId && Types.ObjectId.isValid(input.customerId)
      ? Membership.findOne({ businessId, customerId: input.customerId, status: "ACTIVE", deletedAt: null }).sort({ discountPercent: -1 }).lean<AnyDoc>()
      : Promise.resolve(null),
  ]);
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
  const memberPct = membership && activeOn({ validFrom: membership.startDate, validTo: membership.endDate }, now) ? Number(membership.discountPercent ?? 0) : 0;
  const liveDiscounts = discounts.filter((d) => activeOn(d, now));

  const lines = input.lines.map((l) => {
    const item = itemMap.get(l.itemId);
    if (!item) throw AppError.badRequest("An item on the bill no longer exists", "ITEM_NOT_FOUND");
    if (item.hasVariants && item.variants?.length > 0) {
      if (!l.variantSku) throw AppError.badRequest(`Choose a size/colour for "${item.name}"`, "VARIANT_REQUIRED");
      if (!item.variants.some((v: AnyDoc) => v.sku.toUpperCase() === l.variantSku!.toUpperCase())) {
        throw AppError.badRequest(`Variant "${l.variantSku}" does not belong to "${item.name}"`, "UNKNOWN_VARIANT");
      }
    }

    let price: Decimal;
    try {
      price = l.price ? D(l.price) : D(item.sellingPrice);
    } catch {
      throw AppError.badRequest(`Invalid price for "${item.name}"`, "BAD_PRICE");
    }
    if (price.lt(0)) throw AppError.badRequest(`Price for "${item.name}" cannot be negative`, "BAD_PRICE");

    let pct = 0;
    let discountName: string | undefined;
    if (l.discountPercent !== undefined && l.discountPercent > 0) {
      if (l.discountPercent > settings.maxManualDiscountPercent) {
        throw AppError.badRequest(
          `A manual discount of ${l.discountPercent}% on "${item.name}" exceeds the ${settings.maxManualDiscountPercent}% limit in POS Settings`,
          "DISCOUNT_TOO_HIGH"
        );
      }
      pct = l.discountPercent;
      discountName = "Manual";
    } else {
      for (const d of liveDiscounts) {
        const applies =
          d.scope === "ALL" ||
          (d.scope === "CATEGORY" && d.categoryId && item.categoryId && d.categoryId.equals(item.categoryId)) ||
          (d.scope === "BRAND" && d.brandId && item.brandId && d.brandId.equals(item.brandId)) ||
          (d.scope === "ITEM" && d.itemId && d.itemId.equals(item._id));
        if (applies && Number(d.discountPercent) > pct) {
          pct = Number(d.discountPercent);
          discountName = d.name;
        }
      }
      if (memberPct > pct) {
        pct = memberPct;
        discountName = `Member · ${membership.planName}`;
      }
    }

    const rate = Number(item.taxRatePercent ?? 0);
    const gross = price.times(l.quantity);
    const discount = r2(gross.times(pct).div(100));
    const net = gross.minus(discount);
    let taxable: Decimal;
    let tax: Decimal;
    if (settings.pricesIncludeTax) {
      taxable = r2(net.div(new Decimal(1).plus(new Decimal(rate).div(100))));
      tax = net.minus(taxable);
    } else {
      taxable = r2(net);
      tax = r2(taxable.times(rate).div(100));
    }
    return { item, l, price, pct, discountName, rate, gross, discount, taxable, tax, lineTotal: taxable.plus(tax) };
  });

  const subtotal = lines.reduce((s, x) => s.plus(x.lineTotal), ZERO);

  // Coupon
  let couponDiscount = ZERO;
  let coupon: AnyDoc = null;
  if (input.couponCode) {
    coupon = await Coupon.findOne({ businessId, couponCode: input.couponCode, deletedAt: null }).lean<AnyDoc>();
    const reason = !coupon
      ? "not found"
      : coupon.status !== "ACTIVE"
        ? "inactive"
        : !activeOn(coupon, now)
          ? "outside its validity dates"
          : coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit
            ? "fully used"
            : subtotal.lt(D(coupon.minOrderValue))
              ? `only valid on bills of ${D(coupon.minOrderValue).toFixed(2)} or more`
              : null;
    if (reason) {
      warnings.push(`Coupon ${input.couponCode} is ${reason}.`);
      coupon = null;
    } else {
      couponDiscount =
        coupon.discountType === "PERCENT" ? r2(subtotal.times(D(coupon.discountValue)).div(100)) : Decimal.min(D(coupon.discountValue), subtotal);
      if (coupon.discountType === "PERCENT" && D(coupon.maxDiscount).gt(0)) couponDiscount = Decimal.min(couponDiscount, D(coupon.maxDiscount));
    }
  }

  // Spread the coupon across lines pro rata so each line's GST stays right.
  if (couponDiscount.gt(0) && subtotal.gt(0)) {
    const factor = new Decimal(1).minus(couponDiscount.div(subtotal));
    for (const x of lines) {
      const newTotal = r2(x.lineTotal.times(factor));
      const taxable = r2(newTotal.div(new Decimal(1).plus(new Decimal(x.rate).div(100))));
      x.taxable = taxable;
      x.tax = newTotal.minus(taxable);
      x.lineTotal = newTotal;
    }
  }

  const taxable = lines.reduce((s, x) => s.plus(x.taxable), ZERO);
  const totalTax = lines.reduce((s, x) => s.plus(x.tax), ZERO);
  const exact = taxable.plus(totalTax);
  const grandTotal = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const cgst = r2(totalTax.div(2));
  const sgst = totalTax.minus(cgst);

  return {
    settings,
    coupon,
    warnings,
    membership: memberPct > 0 ? { planName: membership.planName as string, discountPercent: memberPct } : null,
    lines: lines.map((x) => {
      const lineCgst = r2(x.tax.div(2));
      return {
        itemId: x.item._id as Types.ObjectId,
        itemCode: x.item.itemCode as string,
        itemName: x.item.name as string,
        variantSku: x.l.variantSku || undefined,
        hsnCode: x.item.hsnCode as string | undefined,
        quantity: x.l.quantity,
        price: x.price,
        discountPercent: x.pct,
        discountName: x.discountName,
        taxRatePercent: x.rate,
        discountAmount: x.discount,
        taxableAmount: x.taxable,
        cgstAmount: lineCgst,
        sgstAmount: x.tax.minus(lineCgst),
        taxAmount: x.tax,
        lineTotal: x.lineTotal,
        costPrice: x.item.costPrice,
      };
    }),
    totals: {
      grossAmount: lines.reduce((s, x) => s.plus(x.gross), ZERO),
      discountAmount: lines.reduce((s, x) => s.plus(x.discount), ZERO),
      couponDiscount,
      taxableAmount: taxable,
      cgstAmount: cgst,
      sgstAmount: sgst,
      totalTax,
      roundOff: grandTotal.minus(exact),
      grandTotal,
    },
  };
}

type Priced = Awaited<ReturnType<typeof priceCart>>;

function totalsView(t: Priced["totals"]) {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toFixed(2)]));
}

/** The live bill for the counter screen. */
export async function quoteCart(businessId: Types.ObjectId, input: z.infer<typeof quoteSchema>) {
  const p = await priceCart(businessId, input);
  return {
    warnings: p.warnings,
    coupon: p.coupon ? { code: p.coupon.couponCode, description: p.coupon.description ?? null } : null,
    membership: p.membership,
    lines: p.lines.map((l) => ({
      itemId: l.itemId.toString(),
      variantSku: l.variantSku ?? "",
      price: l.price.toFixed(2),
      discountPercent: l.discountPercent,
      discountName: l.discountName ?? null,
      taxRatePercent: l.taxRatePercent,
      taxAmount: l.taxAmount.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
    })),
    totals: totalsView(p.totals),
    pricesIncludeTax: p.settings.pricesIncludeTax,
  };
}

/* ================================================================== */
/* Orders                                                              */
/* ================================================================== */

function salesEntries(totals: Priced["totals"], cashIn: Decimal, bankIn: Decimal, party: string): PostingEntry[] {
  return [
    { role: "CASH", debit: cashIn, narration: party },
    { role: "BANK", debit: bankIn, narration: party },
    { role: "SALES", credit: totals.taxableAmount },
    { role: "OUTPUT_CGST", credit: totals.cgstAmount },
    { role: "OUTPUT_SGST", credit: totals.sgstAmount },
    totals.roundOff.gte(0) ? { role: "ROUND_OFF", credit: totals.roundOff } : { role: "ROUND_OFF", debit: totals.roundOff.abs() },
  ];
}

/**
 * Completes a counter sale in one transaction: the order, stock out of the
 * register's warehouse, coupon usage, and the sales journal entry (cash and
 * card/UPI in; sales and GST out).
 */
export async function createOrder(input: z.infer<typeof orderSchema>, ctx: AuthContext) {
  if (input.lines.length === 0) throw AppError.badRequest("The bill is empty", "EMPTY_BILL");
  if (!Types.ObjectId.isValid(input.registerId)) throw AppError.badRequest("Register not found", "REGISTER_NOT_FOUND");
  const register = await PosRegister.findOne({ _id: input.registerId, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!register) throw AppError.badRequest("Register not found", "REGISTER_NOT_FOUND");
  if (register.status !== "OPEN") throw AppError.badRequest("This register is closed. Open a register to bill.", "REGISTER_CLOSED");

  const priced = await priceCart(ctx.businessId, input);
  if (input.couponCode && !priced.coupon) throw AppError.badRequest(priced.warnings[0] ?? "Coupon not valid", "COUPON_INVALID");

  let customer: AnyDoc = null;
  if (input.customerId) {
    if (!Types.ObjectId.isValid(input.customerId)) throw AppError.badRequest("Customer not found", "CUSTOMER_NOT_FOUND");
    customer = await Customer.findOne({ _id: input.customerId, businessId: ctx.businessId }).lean<AnyDoc>();
    if (!customer) throw AppError.badRequest("Customer not found", "CUSTOMER_NOT_FOUND");
  } else if (priced.settings.requireCustomer) {
    throw AppError.badRequest("POS Settings require a customer on every bill", "CUSTOMER_REQUIRED");
  }

  // Payments: card/UPI must be exact; any overpayment must be cash, returned as change.
  const grand = priced.totals.grandTotal;
  let paid = ZERO;
  let cash = ZERO;
  for (const p of input.payments) {
    let amt: Decimal;
    try {
      amt = D(p.amount);
    } catch {
      throw AppError.badRequest("Payment amounts must be numbers", "BAD_AMOUNT");
    }
    if (amt.lt(0)) throw AppError.badRequest("Payment amounts cannot be negative", "BAD_AMOUNT");
    paid = paid.plus(amt);
    if (p.mode === "CASH") cash = cash.plus(amt);
  }
  if (paid.lt(grand)) throw AppError.badRequest(`Payment of ${paid.toFixed(2)} is short of the bill total ${grand.toFixed(2)}`, "UNDERPAID");
  const change = paid.minus(grand);
  if (change.gt(cash)) throw AppError.badRequest("Card and UPI payments cannot exceed the bill — only cash can be overpaid", "OVERPAID_NON_CASH");
  const cashIn = cash.minus(change);
  const bankIn = grand.minus(cashIn);

  const { branchId, financialYear } = await resolveBusinessContext(ctx.businessId);
  const session = await mongoose.startSession();
  let created: AnyDoc;
  try {
    await session.withTransaction(async () => {
      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId,
        financialYearId: financialYear._id,
        documentType: SEQUENCES.POS_ORDER.documentType,
        prefix: SEQUENCES.POS_ORDER.defaultPrefix,
        financialYearLabel: financialYear.label,
      });

      // Cost each line at the warehouse's moving average for the stock ledger.
      const lines = [];
      for (const l of priced.lines) {
        const bal = await StockBalance.findOne(
          { businessId: ctx.businessId, itemId: l.itemId, variantSku: l.variantSku ?? "", warehouseId: register.warehouseId },
          { averageCost: 1 },
          { session }
        ).lean<AnyDoc>();
        lines.push({
          itemId: l.itemId,
          itemCode: l.itemCode,
          itemName: l.itemName,
          variantSku: l.variantSku,
          hsnCode: l.hsnCode,
          quantity: l.quantity,
          price: toDecimal128(l.price),
          discountPercent: l.discountPercent,
          discountName: l.discountName,
          taxRatePercent: l.taxRatePercent,
          taxableAmount: toDecimal128(l.taxableAmount),
          cgstAmount: toDecimal128(l.cgstAmount),
          sgstAmount: toDecimal128(l.sgstAmount),
          taxAmount: toDecimal128(l.taxAmount),
          lineTotal: toDecimal128(l.lineTotal),
          unitCost: toDecimal128(unitValuation(bal?.averageCost, l.costPrice)),
          returnedQty: 0,
        });
      }

      [created] = await PosOrder.create(
        [
          {
            businessId: ctx.businessId,
            branchId,
            financialYearId: financialYear._id,
            registerId: register._id,
            warehouseId: register.warehouseId,
            orderNumber: formatted,
            orderDate: new Date(),
            customerId: customer?._id ?? null,
            customerName: customer?.name ?? (input.customerName || "Walk-in customer"),
            customerPhone: customer?.phone ?? input.customerPhone,
            lines,
            couponCode: priced.coupon?.couponCode,
            pricesIncludeTax: priced.settings.pricesIncludeTax,
            totals: Object.fromEntries(Object.entries(priced.totals).map(([k, v]) => [k, toDecimal128(v)])),
            payments: input.payments.map((p) => ({ mode: p.mode, amount: toDecimal128(D(p.amount)), reference: p.reference })),
            amountTendered: toDecimal128(paid),
            changeReturned: toDecimal128(change),
            status: "COMPLETED",
            notes: input.notes,
            createdBy: ctx.userId,
          },
        ],
        { session }
      );

      await postStockMovement({
        businessId: ctx.businessId,
        warehouseId: register.warehouseId,
        movementType: "POS_SALE",
        direction: "OUT",
        lines: lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, quantity: l.quantity, unitCost: l.unitCost.toString() })),
        sourceDocumentType: "pos-orders",
        sourceDocumentId: created._id,
        sourceDocumentNumber: formatted,
        userId: ctx.userId,
        allowNegative: priced.settings.allowNegativeStock,
        session,
      });

      if (priced.coupon) {
        // Conditional increment: two tills redeeming the last use cannot both win.
        const res = await Coupon.updateOne(
          {
            _id: priced.coupon._id,
            $or: [{ usageLimit: 0 }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }],
          },
          { $inc: { usedCount: 1 } },
          { session }
        );
        if (res.modifiedCount === 0) throw AppError.conflict(`Coupon ${priced.coupon.couponCode} has just been used up`, "COUPON_USED_UP");
      }

      await tryPostDocument({
        businessId: ctx.businessId,
        userId: ctx.userId,
        voucherType: "SALES",
        voucherDate: created.orderDate,
        entries: salesEntries(priced.totals, cashIn, bankIn, created.customerName),
        narration: `POS sale ${formatted}`,
        referenceNumber: formatted,
        source: { type: "pos-orders", id: created._id, number: formatted },
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "pos.orders",
    documentType: "POS order",
    documentId: created._id,
    newValue: { orderNumber: created.orderNumber, grandTotal: grand.toFixed(2) },
  });
  return serializeDoc(created);
}

/** Voids a sale: stock back in, journal reversed, coupon use released. */
export async function cancelOrder(id: string, reason: string | undefined, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Order not found");
  const hasReturns = await PosCreditNote.exists({ businessId: ctx.businessId, orderId: id, status: "ISSUED" });
  if (hasReturns) throw AppError.badRequest("This order has credit notes. Cancel those first.", "HAS_RETURNS");

  const session = await mongoose.startSession();
  let doc: AnyDoc;
  try {
    await session.withTransaction(async () => {
      doc = await PosOrder.findOne({ _id: id, businessId: ctx.businessId }).session(session);
      if (!doc) throw AppError.notFound("Order not found");
      if (doc.status === "CANCELLED") throw AppError.badRequest("Already cancelled", "ALREADY_CANCELLED");
      await reverseStockMovement({
        businessId: ctx.businessId,
        sourceDocumentType: "pos-orders",
        sourceDocumentId: doc._id,
        sourceDocumentNumber: doc.orderNumber,
        userId: ctx.userId,
        session,
      });
      await reverseVoucherFor({ businessId: ctx.businessId, userId: ctx.userId, sourceType: "pos-orders", sourceId: doc._id, reason, session });
      if (doc.couponCode) {
        await Coupon.updateOne({ businessId: ctx.businessId, couponCode: doc.couponCode, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
      }
      doc.status = "CANCELLED";
      doc.cancelledBy = ctx.userId;
      doc.cancelledAt = new Date();
      doc.cancellationReason = reason;
      await doc.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "pos.orders", documentType: "POS order", documentId: doc._id, reason });
  return getOrder(id, ctx);
}

export async function getOrder(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Order not found");
  const doc = await PosOrder.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!doc) throw AppError.notFound("Order not found");
  const [register, notes, cashier] = await Promise.all([
    PosRegister.findById(doc.registerId, { registerNumber: 1, counterName: 1 }).lean<AnyDoc>(),
    PosCreditNote.find({ businessId: ctx.businessId, orderId: doc._id }, { creditNoteNumber: 1, status: 1, totals: 1, creditNoteDate: 1 }).lean<AnyDoc[]>(),
    User.findById(doc.createdBy, { name: 1 }).lean<AnyDoc>(),
  ]);
  return {
    ...(serializeDoc(doc) as AnyDoc),
    registerNumber: register?.registerNumber,
    counterName: register?.counterName,
    cashierName: cashier?.name ?? "—",
    creditNotes: notes.map((n) => serializeDoc(n)),
  };
}

const listSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.string().trim().max(20).optional(),
  registerId: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
});

export async function listOrders(params: URLSearchParams, ctx: AuthContext) {
  const q = listSchema.parse(Object.fromEntries(params.entries()));
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (q.status) filter.status = q.status;
  if (q.registerId && Types.ObjectId.isValid(q.registerId)) filter.registerId = new Types.ObjectId(q.registerId);
  if (q.query) {
    const rx = { $regex: escapeRegex(q.query), $options: "i" };
    filter.$or = [{ orderNumber: rx }, { customerName: rx }, { customerPhone: rx }];
  }
  const range = dayRange(q.fromDate, q.toDate);
  if (range) filter.orderDate = range;
  const [docs, total, sum] = await Promise.all([
    PosOrder.find(filter).sort({ orderDate: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<AnyDoc[]>(),
    PosOrder.countDocuments(filter),
    PosOrder.aggregate([{ $match: { ...filter, status: "COMPLETED" } }, { $group: { _id: null, total: { $sum: "$totals.grandTotal" } } }]),
  ]);
  return {
    items: docs.map((d) => ({
      ...(serializeDoc(d) as AnyDoc),
      itemCount: d.lines.reduce((s: number, l: AnyDoc) => s + l.quantity, 0),
      paymentModes: [...new Set((d.payments ?? []).map((p: AnyDoc) => p.mode))].join(" + "),
    })),
    total,
    salesTotal: D((sum as AnyDoc[])[0]?.total).toFixed(2),
  };
}

/* ================================================================== */
/* Credit notes                                                        */
/* ================================================================== */

export const creditNoteSchema = z.object({
  orderId: z.string().trim().min(1),
  refundMode: z.enum(POS_PAYMENT_MODES).default("CASH"),
  reason: z.string().trim().max(500).optional(),
  lines: z
    .array(z.object({ lineIndex: z.coerce.number().int().min(0), quantity: z.coerce.number().positive() }))
    .min(1, "Choose at least one item to return"),
});

/**
 * Takes goods back against a POS order. Each returned unit is credited at
 * exactly what was charged for it — discounts, coupon share and GST
 * included — so a return can never refund more than the sale took in.
 */
export async function createCreditNote(input: z.infer<typeof creditNoteSchema>, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(input.orderId)) throw AppError.badRequest("Order not found", "ORDER_NOT_FOUND");
  const register = await PosRegister.findOne({ businessId: ctx.businessId, openedBy: ctx.userId, status: "OPEN" }).lean<AnyDoc>();
  if (input.refundMode === "CASH" && !register) {
    throw AppError.badRequest("Open a register to give a cash refund — the cash has to come out of a drawer", "REGISTER_REQUIRED");
  }
  const { branchId, financialYear } = await resolveBusinessContext(ctx.businessId);

  const session = await mongoose.startSession();
  let created: AnyDoc;
  try {
    await session.withTransaction(async () => {
      const order = await PosOrder.findOne({ _id: input.orderId, businessId: ctx.businessId }).session(session);
      if (!order) throw AppError.notFound("Order not found");
      if (order.status !== "COMPLETED") throw AppError.badRequest("Only completed orders can be returned against", "ORDER_NOT_COMPLETED");

      const lines: AnyDoc[] = [];
      let taxable = ZERO;
      let tax = ZERO;
      let cgst = ZERO;
      for (const r of input.lines) {
        const ol = order.lines[r.lineIndex];
        if (!ol) throw AppError.badRequest("A returned line is not on the order", "BAD_LINE");
        const left = ol.quantity - (ol.returnedQty ?? 0);
        if (r.quantity > left + 1e-9) throw AppError.badRequest(`Only ${left} of "${ol.itemName}" can still be returned`, "OVER_RETURN");
        const share = new Decimal(r.quantity).div(ol.quantity);
        const lt = r2(D(ol.taxableAmount).times(share));
        const lx = r2(D(ol.taxAmount).times(share));
        const lc = r2(lx.div(2));
        taxable = taxable.plus(lt);
        tax = tax.plus(lx);
        cgst = cgst.plus(lc);
        ol.returnedQty = (ol.returnedQty ?? 0) + r.quantity;
        lines.push({
          itemId: ol.itemId,
          itemCode: ol.itemCode,
          itemName: ol.itemName,
          variantSku: ol.variantSku,
          hsnCode: ol.hsnCode,
          quantity: r.quantity,
          price: ol.price,
          discountPercent: ol.discountPercent,
          taxRatePercent: ol.taxRatePercent,
          taxableAmount: toDecimal128(lt),
          cgstAmount: toDecimal128(lc),
          sgstAmount: toDecimal128(lx.minus(lc)),
          taxAmount: toDecimal128(lx),
          lineTotal: toDecimal128(lt.plus(lx)),
          unitCost: ol.unitCost,
        });
      }
      const total = taxable.plus(tax);
      const sgst = tax.minus(cgst);

      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId,
        financialYearId: financialYear._id,
        documentType: SEQUENCES.POS_CREDIT_NOTE.documentType,
        prefix: SEQUENCES.POS_CREDIT_NOTE.defaultPrefix,
        financialYearLabel: financialYear.label,
      });

      [created] = await PosCreditNote.create(
        [
          {
            businessId: ctx.businessId,
            branchId,
            financialYearId: financialYear._id,
            creditNoteNumber: formatted,
            creditNoteDate: new Date(),
            registerId: register?._id ?? null,
            orderId: order._id,
            orderNumber: order.orderNumber,
            warehouseId: order.warehouseId,
            customerName: order.customerName,
            lines,
            totals: {
              taxableAmount: toDecimal128(taxable),
              cgstAmount: toDecimal128(cgst),
              sgstAmount: toDecimal128(sgst),
              totalTax: toDecimal128(tax),
              grandTotal: toDecimal128(total),
            },
            refundMode: input.refundMode,
            reason: input.reason,
            status: "ISSUED",
            createdBy: ctx.userId,
          },
        ],
        { session }
      );

      order.refundedAmount = toDecimal128(D(order.refundedAmount).plus(total));
      order.markModified("lines");
      await order.save({ session });

      await postStockMovement({
        businessId: ctx.businessId,
        warehouseId: order.warehouseId,
        movementType: "POS_RETURN",
        direction: "IN",
        lines: lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, quantity: l.quantity, unitCost: l.unitCost.toString() })),
        sourceDocumentType: "pos-credit-notes",
        sourceDocumentId: created._id,
        sourceDocumentNumber: formatted,
        userId: ctx.userId,
        session,
      });

      await tryPostDocument({
        businessId: ctx.businessId,
        userId: ctx.userId,
        voucherType: "JOURNAL",
        voucherDate: created.creditNoteDate,
        entries: [
          { role: "SALES_RETURNS", debit: taxable },
          { role: "OUTPUT_CGST", debit: cgst },
          { role: "OUTPUT_SGST", debit: sgst },
          { role: input.refundMode === "CASH" ? "CASH" : "BANK", credit: total, narration: order.customerName },
        ],
        narration: `POS return ${formatted} against ${order.orderNumber}`,
        referenceNumber: formatted,
        source: { type: "pos-credit-notes", id: created._id, number: formatted },
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "pos.credit-notes",
    documentType: "POS credit note",
    documentId: created._id,
    newValue: { creditNoteNumber: created.creditNoteNumber },
  });
  return serializeDoc(created);
}

export async function cancelCreditNote(id: string, reason: string | undefined, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Credit note not found");
  const session = await mongoose.startSession();
  let doc: AnyDoc;
  try {
    await session.withTransaction(async () => {
      doc = await PosCreditNote.findOne({ _id: id, businessId: ctx.businessId }).session(session);
      if (!doc) throw AppError.notFound("Credit note not found");
      if (doc.status === "CANCELLED") throw AppError.badRequest("Already cancelled", "ALREADY_CANCELLED");
      const order = await PosOrder.findOne({ _id: doc.orderId, businessId: ctx.businessId }).session(session);
      if (order) {
        for (const l of doc.lines as AnyDoc[]) {
          const ol = (order.lines as AnyDoc[]).find(
            (x) => x.itemId.equals(l.itemId) && (x.variantSku ?? "") === (l.variantSku ?? "") && (x.returnedQty ?? 0) >= l.quantity
          );
          if (ol) ol.returnedQty -= l.quantity;
        }
        order.refundedAmount = toDecimal128(Decimal.max(ZERO, D(order.refundedAmount).minus(D(doc.totals?.grandTotal))));
        order.markModified("lines");
        await order.save({ session });
      }
      await reverseStockMovement({
        businessId: ctx.businessId,
        sourceDocumentType: "pos-credit-notes",
        sourceDocumentId: doc._id,
        sourceDocumentNumber: doc.creditNoteNumber,
        userId: ctx.userId,
        session,
      });
      await reverseVoucherFor({ businessId: ctx.businessId, userId: ctx.userId, sourceType: "pos-credit-notes", sourceId: doc._id, reason, session });
      doc.status = "CANCELLED";
      doc.cancelledBy = ctx.userId;
      doc.cancelledAt = new Date();
      doc.cancellationReason = reason;
      await doc.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "pos.credit-notes", documentId: doc._id, reason });
  return serializeDoc(doc);
}

export async function getCreditNote(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Credit note not found");
  const doc = await PosCreditNote.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!doc) throw AppError.notFound("Credit note not found");
  return serializeDoc(doc);
}

export async function listCreditNotes(params: URLSearchParams, ctx: AuthContext) {
  const q = listSchema.parse(Object.fromEntries(params.entries()));
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (q.status) filter.status = q.status;
  if (q.query) {
    const rx = { $regex: escapeRegex(q.query), $options: "i" };
    filter.$or = [{ creditNoteNumber: rx }, { orderNumber: rx }, { customerName: rx }];
  }
  const range = dayRange(q.fromDate, q.toDate);
  if (range) filter.creditNoteDate = range;
  const [docs, total] = await Promise.all([
    PosCreditNote.find(filter).sort({ creditNoteDate: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<AnyDoc[]>(),
    PosCreditNote.countDocuments(filter),
  ]);
  return { items: docs.map((d) => serializeDoc(d)), total };
}
