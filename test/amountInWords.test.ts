import { describe, it, expect } from "vitest";
import { amountInWords } from "@/lib/documents/numberToWords";

describe("amountInWords (Indian numbering)", () => {
  it("handles zero and small values", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(1)).toBe("Rupees One Only");
    expect(amountInWords(19)).toBe("Rupees Nineteen Only");
    expect(amountInWords(20)).toBe("Rupees Twenty Only");
    expect(amountInWords(99)).toBe("Rupees Ninety Nine Only");
  });

  it("handles hundreds and thousands", () => {
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
    expect(amountInWords(1180)).toBe("Rupees One Thousand One Hundred Eighty Only");
    expect(amountInWords(4825)).toBe("Rupees Four Thousand Eight Hundred Twenty Five Only");
  });

  it("uses lakh and crore, not million", () => {
    expect(amountInWords(100000)).toBe("Rupees One Lakh Only");
    expect(amountInWords(1500000)).toBe("Rupees Fifteen Lakh Only");
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
    expect(amountInWords(12345678)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only"
    );
  });

  it("includes paise", () => {
    expect(amountInWords(1250.5)).toBe("Rupees One Thousand Two Hundred Fifty and Fifty Paise Only");
    expect(amountInWords("36372.00")).toBe(
      "Rupees Thirty Six Thousand Three Hundred Seventy Two Only"
    );
  });

  it("rounds paise rather than truncating", () => {
    // 0.005 must not silently vanish from a printed invoice.
    expect(amountInWords(10.005)).toBe("Rupees Ten and One Paise Only");
  });

  it("handles negative amounts and other currencies", () => {
    expect(amountInWords(-500)).toBe("Minus Rupees Five Hundred Only");
    expect(amountInWords(500, "Dollars")).toBe("Dollars Five Hundred Only");
  });
});
