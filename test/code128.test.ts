import { describe, it, expect } from "vitest";
import { CODE128_PATTERNS, code128Values, code128Widths, canEncodeCode128 } from "@/lib/barcode/code128";

describe("Code 128 encoder", () => {
  it("has the full, well-formed symbol table", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    const sum = (p: string) => p.split("").reduce((a, c) => a + Number(c), 0);
    CODE128_PATTERNS.slice(0, 106).forEach((p, i) => {
      expect(p, `symbol ${i}`).toHaveLength(6);
      expect(sum(p), `symbol ${i}`).toBe(11);
    });
    expect(sum(CODE128_PATTERNS[106])).toBe(13); // stop
    expect(new Set(CODE128_PATTERNS).size).toBe(107); // every symbol distinct
  });

  it("computes the start, checksum and stop symbols", () => {
    // "A" = value 33; checksum = (104 + 33×1) mod 103 = 34
    expect(code128Values("A")).toEqual([104, 33, 34, 106]);
    // "PJJ123C" — a worked example: checksum 54
    const v = code128Values("PJJ123C");
    expect(v[0]).toBe(104);
    expect(v.at(-1)).toBe(106);
    const data = v.slice(1, -2);
    expect((104 + data.reduce((s, x, i) => s + x * (i + 1), 0)) % 103).toBe(v.at(-2));
  });

  it("produces bar/space runs whose length matches the symbol count", () => {
    const text = "RNT101-WHT-L";
    const widths = code128Widths(text);
    // start + data + checksum = 6 runs each, stop = 7 runs
    expect(widths).toHaveLength((text.length + 2) * 6 + 7);
    expect(widths.reduce((a, b) => a + b, 0)).toBe((text.length + 2) * 11 + 13);
  });

  it("only accepts printable ASCII", () => {
    expect(canEncodeCode128("ITEM-000038")).toBe(true);
    expect(canEncodeCode128("")).toBe(false);
    expect(canEncodeCode128("कुर्ता")).toBe(false);
    expect(() => code128Values("tab\there")).toThrow();
  });
});
