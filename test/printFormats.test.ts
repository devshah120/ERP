import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRINT_DOC_TYPES, PRINT_LAYOUTS, resolveLayout, type LayoutId } from "@/lib/printFormats/catalog";
import { printFormatSettingsSchema } from "@/lib/settings/definitions";
import { fromDocument, fromPosOrder, sampleModel, taxSummary, type PrintBusiness } from "@/components/print/model";
import { PrintSheet } from "@/components/print/layouts";
import { pageCss } from "@/components/print/PrintArea";

const business: PrintBusiness = { name: "Rangoli Textiles", gstin: "24AAACR1234A1Z5", state: "Gujarat", city: "Surat" };

describe("print format catalog", () => {
  it("offers each type's default layout and only layouts that exist", () => {
    for (const t of PRINT_DOC_TYPES) {
      expect(t.layouts, t.key).toContain(t.defaultLayout);
      for (const id of t.layouts) expect(PRINT_LAYOUTS[id], `${t.key}:${id}`).toBeDefined();
    }
  });

  it("falls back to the type's default for an unknown or unoffered choice", () => {
    expect(resolveLayout("pos-orders", "thermal-58-standard").id).toBe("thermal-58-standard");
    expect(resolveLayout("pos-orders", "nonsense").id).toBe("thermal-80-standard");
    // A4 Simple isn't offered for POS bills.
    expect(resolveLayout("pos-orders", "a4-simple").id).toBe("thermal-80-standard");
    expect(resolveLayout("sales-invoices", undefined).id).toBe("a4-standard");
  });

  it("stores one layout per type and repairs invalid values instead of failing", () => {
    const parsed = printFormatSettingsSchema.parse({ "pos-orders": "thermal-80-compact", "sales-invoices": "not-a-layout" });
    expect(parsed["pos-orders"]).toBe("thermal-80-compact");
    expect(parsed["sales-invoices"]).toBe("a4-standard");
    expect(parsed["purchase-orders"]).toBe("a4-simple");
  });
});

describe("print layouts", () => {
  const samples = {
    pos: sampleModel(business, "pos", "TAX INVOICE"),
    "pos-return": sampleModel(business, "pos-return", "CREDIT NOTE"),
    document: sampleModel(business, "document", "Tax Invoice"),
  };

  for (const id of Object.keys(PRINT_LAYOUTS) as LayoutId[]) {
    it(`renders ${id} for bills, returns and documents`, () => {
      for (const [kind, model] of Object.entries(samples)) {
        const html = renderToStaticMarkup(createElement(PrintSheet, { layoutId: id, model }));
        expect(html, `${id}/${kind}`).toContain(model.number);
        expect(html, `${id}/${kind}`).toContain("Rangoli Textiles");
        expect(html, `${id}/${kind}`).toContain(model.lines[0].name.split(" ")[0]);
      }
    });
  }

  it("prints IGST, not CGST/SGST, on an inter-state document", () => {
    const m = fromDocument(
      {
        documentNumber: "INV-1",
        documentDate: "2026-11-11",
        intraState: false,
        customer: { name: "Delhi Buyer" },
        lines: [{ itemName: "Shirt", quantity: 1, rate: "100", taxRatePercent: 5, taxableAmount: "100", igstAmount: "5", lineTotal: "105" }],
        totals: { taxableAmount: "100", igstAmount: "5", grandTotal: "105" },
      },
      business,
      { title: "Tax Invoice", partyField: "customer" }
    );
    const html = renderToStaticMarkup(createElement(PrintSheet, { layoutId: "a4-gst-detailed", model: m }));
    expect(html).toContain("IGST");
    expect(html).not.toContain("CGST");
  });
});

describe("print model", () => {
  it("summarises GST by rate", () => {
    const m = sampleModel(business, "pos", "TAX INVOICE");
    const rows = taxSummary(m.lines);
    expect(rows.map((r) => r.rate)).toEqual([5, 12]);
    expect(rows[0].taxable).toBe("2538.28");
    expect(rows[0].cgst).toBe("63.46");
    expect(rows[1].total).toBe("139.18");
  });

  it("keeps a POS bill's payments, change and customer", () => {
    const m = fromPosOrder(
      {
        orderNumber: "POS-1",
        orderDate: "2026-11-11T10:00:00Z",
        lines: [],
        totals: { grandTotal: "524.00" },
        payments: [{ mode: "CASH", amount: "600" }],
        changeReturned: "76",
      },
      business
    );
    expect(m.party?.name).toBe("Walk-in customer");
    expect(m.payments).toEqual([{ mode: "CASH", amount: "600" }]);
    expect(m.change).toBe("76");
    expect(m.grandLabel).toBe("TOTAL");
  });

  it("fixes sheet sizes but leaves thermal paper to the printer, with no margins", () => {
    expect(pageCss("A4")).toContain("size: A4");
    expect(pageCss("A5")).toContain("size: A5");
    // A forced size makes Chrome shrink and centre the receipt on real printers.
    expect(pageCss("THERMAL_80")).toBe("@page { size: auto; margin: 0; }");
    expect(pageCss("THERMAL_58")).toBe("@page { size: auto; margin: 0; }");
  });
});
