import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildLabelPdf, type LabelPdfOptions } from "@/lib/barcode/labelPdf";

const MM = 72 / 25.4;
const base: Omit<LabelPdfOptions, "width" | "height" | "across"> = {
  gap: 2,
  showBusiness: true,
  showMrp: true,
  showDate: true,
  business: { name: "Rangoli Textiles", city: "Surat", phone: "9876543210", email: "hello@rangoli.test" },
};
const items = [
  { name: "Round Neck T-Shirt", variant: "L / White", code: "RNT101-WHT-L", mrp: "499", packedOn: "11/2026", copies: 2 },
  { name: "Formal Shirt Slim Fit", variant: "39 / Sky Blue", code: "FSH220-SKY-39", mrp: "1299", packedOn: "11/2026", copies: 1 },
  { name: "Denim", variant: "", code: "ITEM-000007", mrp: "1899", packedOn: "", copies: 1 },
];

async function pages(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getSize());
}

describe("label PDF", () => {
  it("makes one true-size page per row of labels", async () => {
    // 4 labels, 2 across → 2 pages of (2 × 50 + 2) × 25 mm
    const sizes = await pages(await buildLabelPdf(items, { ...base, width: 50, height: 25, across: 2 }));
    expect(sizes).toHaveLength(2);
    for (const s of sizes) {
      expect(s.width).toBeCloseTo(102 * MM, 1);
      expect(s.height).toBeCloseTo(25 * MM, 1);
    }
  });

  it("uses the large sticker layout for 75 × 50 labels, one per page", async () => {
    const sizes = await pages(await buildLabelPdf(items, { ...base, width: 75, height: 50, across: 1 }));
    expect(sizes).toHaveLength(4);
    expect(sizes[0].width).toBeCloseTo(75 * MM, 1);
    expect(sizes[0].height).toBeCloseTo(50 * MM, 1);
  });

  it("skips codes that can't be barcoded and survives non-Latin names", async () => {
    const sizes = await pages(
      await buildLabelPdf(
        [
          { name: "कुर्ता Kurta ₹", variant: "M", code: "KRT-001", mrp: "799", packedOn: "", copies: 1 },
          { name: "Bad code", variant: "", code: "कोड", mrp: "1", packedOn: "", copies: 3 },
        ],
        { ...base, width: 50, height: 25, across: 1 }
      )
    );
    expect(sizes).toHaveLength(1);
  });
});
