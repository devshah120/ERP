import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { resolvePeriod, toDateParam } from "@/lib/analytics/period";
import { derivePaymentStatus } from "@/lib/payments/service";
import { formatByKind, formatCompact, formatMoney } from "@/lib/format/number";
import { nextAverageCost } from "@/lib/services/stockService";
import { unitValuation, stockValue } from "@/lib/inventory/valuation";

// A fixed Wednesday, so weekday arithmetic is deterministic.
const NOW = new Date(2026, 8, 16, 14, 30, 0); // 16 Sep 2026, a Wednesday

describe("period resolution", () => {
  it("covers a whole day for 'today'", () => {
    const p = resolvePeriod({ period: "today" }, NOW);
    expect(toDateParam(p.from)).toBe("2026-09-16");
    expect(p.from.getHours()).toBe(0);
    expect(p.to.getHours()).toBe(23);
    expect(p.to.getMinutes()).toBe(59);
  });

  it("starts the week on Monday", () => {
    const p = resolvePeriod({ period: "week" }, NOW);
    expect(toDateParam(p.from)).toBe("2026-09-14");
    expect(p.from.getDay()).toBe(1);
  });

  it("starts the month and quarter on their first day", () => {
    expect(toDateParam(resolvePeriod({ period: "month" }, NOW).from)).toBe("2026-09-01");
    // September sits in Jul–Sep.
    expect(toDateParam(resolvePeriod({ period: "quarter" }, NOW).from)).toBe("2026-07-01");
    expect(toDateParam(resolvePeriod({ period: "year" }, NOW).from)).toBe("2026-01-01");
  });

  it("puts the comparison window immediately before the current one", () => {
    const p = resolvePeriod({ period: "month" }, NOW);
    expect(p.previousTo.getTime()).toBeLessThan(p.from.getTime());
    // Same length, so a period-on-period change compares like with like.
    const span = p.to.getTime() - p.from.getTime();
    const prevSpan = p.previousTo.getTime() - p.previousFrom.getTime();
    expect(Math.abs(span - prevSpan)).toBeLessThan(1000);
  });

  it("switches to month buckets once a range exceeds a quarter", () => {
    expect(resolvePeriod({ period: "month" }, NOW).bucket).toBe("day");
    expect(resolvePeriod({ period: "year" }, NOW).bucket).toBe("month");
  });

  it("rejects an incomplete or inverted custom range", () => {
    expect(() => resolvePeriod({ period: "custom" }, NOW)).toThrow(/fromDate and toDate/);
    expect(() =>
      resolvePeriod({ period: "custom", fromDate: "2026-09-30", toDate: "2026-09-01" }, NOW)
    ).toThrow(/must not be after/);
  });

  it("formats dates in local time, not UTC", () => {
    // toISOString() would roll back a day for anything east of UTC late in
    // the evening, silently shifting a filter by 24 hours.
    const lateEvening = new Date(2026, 8, 16, 23, 45, 0);
    expect(toDateParam(lateEvening)).toBe("2026-09-16");
  });
});

describe("payment status derivation", () => {
  const d = (v: string) => new Decimal(v);

  it("is UNPAID with nothing against it", () => {
    expect(derivePaymentStatus(d("0"), d("1000"))).toBe("UNPAID");
  });

  it("is PARTIALLY_PAID in between", () => {
    expect(derivePaymentStatus(d("1"), d("1000"))).toBe("PARTIALLY_PAID");
    expect(derivePaymentStatus(d("999.99"), d("1000"))).toBe("PARTIALLY_PAID");
  });

  it("is PAID once settled", () => {
    expect(derivePaymentStatus(d("1000"), d("1000"))).toBe("PAID");
  });

  it("treats a sub-paise shortfall as settled", () => {
    // Otherwise rounding leaves invoices permanently 0.004 short of closed.
    expect(derivePaymentStatus(d("999.996"), d("1000"))).toBe("PAID");
    expect(derivePaymentStatus(d("999.99"), d("1000"))).toBe("PARTIALLY_PAID");
  });

  it("handles a zero-value document", () => {
    expect(derivePaymentStatus(d("0"), d("0"))).toBe("UNPAID");
  });
});

describe("display formatting", () => {
  it("groups money the Indian way", () => {
    expect(formatMoney("1234567.5")).toBe("12,34,567.50");
    expect(formatMoney("999")).toBe("999.00");
  });

  it("abbreviates in lakhs and crores", () => {
    expect(formatCompact(125000)).toBe("1.25 L");
    expect(formatCompact(25000000)).toBe("2.50 Cr");
    expect(formatCompact(4500)).toBe("4.5 K");
    expect(formatCompact(-125000)).toBe("-1.25 L");
    expect(formatCompact(250)).toBe("250");
  });

  it("never renders a count as currency", () => {
    expect(formatByKind(30, "count")).toBe("30");
    expect(formatByKind(30, "money")).toBe("₹30.00");
    expect(formatByKind("92.3", "percent")).toBe("92.3%");
  });
});

describe("moving-average stock cost", () => {
  const avg = (p: Parameters<typeof nextAverageCost>[0]) => nextAverageCost(p).toString();

  it("takes the incoming cost as the basis for the first receipt", () => {
    expect(avg({ currentQty: 0, currentAverage: "0", direction: "IN", quantity: 100, unitCost: "250" }))
      .toBe("250.0000");
  });

  it("blends subsequent receipts in proportion to quantity", () => {
    // 100 @ 250 then 100 @ 350 → 300
    expect(avg({ currentQty: 100, currentAverage: "250", direction: "IN", quantity: 100, unitCost: "350" }))
      .toBe("300.0000");
    // 300 @ 100 then 100 @ 200 → 125
    expect(avg({ currentQty: 300, currentAverage: "100", direction: "IN", quantity: 100, unitCost: "200" }))
      .toBe("125.0000");
  });

  it("leaves the average untouched when stock goes out", () => {
    // Issuing stock does not change what the remaining stock cost.
    expect(avg({ currentQty: 200, currentAverage: "300", direction: "OUT", quantity: 50, unitCost: "999" }))
      .toBe("300.0000");
  });

  it("resets the basis when receiving against a negative balance", () => {
    // Blending into a negative quantity would produce a nonsense average.
    expect(avg({ currentQty: -20, currentAverage: "300", direction: "IN", quantity: 100, unitCost: "180" }))
      .toBe("180.0000");
  });

  it("keeps four decimal places so rounding cannot compound", () => {
    // 3 @ 10 then 1 @ 11 → 10.25
    expect(avg({ currentQty: 3, currentAverage: "10", direction: "IN", quantity: 1, unitCost: "11" }))
      .toBe("10.2500");
  });
});

describe("stock valuation basis", () => {
  it("prefers the moving average once one exists", () => {
    expect(unitValuation("250.50", "999").toString()).toBe("250.5");
  });

  it("falls back to the item cost price for uncosted stock", () => {
    // Opening balances and pre-averaging data have no recorded average.
    expect(unitValuation("0", "180").toString()).toBe("180");
    expect(unitValuation(null, "180").toString()).toBe("180");
  });

  it("reports zero when neither basis is available, rather than guessing", () => {
    expect(unitValuation("0", "0").toString()).toBe("0");
  });

  it("multiplies out to a 2dp value", () => {
    expect(stockValue(12, "10.3333", "0")).toBe("124.00");
  });
});
