import { describe, it, expect } from "vitest";
import { DOCUMENT_UI, submitActionLabel } from "@/lib/documents/ui";
import { buildFormLayout } from "@/lib/documents/formLayout";
import { DOCUMENTS } from "@/lib/documents/registry";
import {
  SALES_QUOTATION_WORKFLOW,
  SALES_ORDER_WORKFLOW,
  DELIVERY_CHALLAN_WORKFLOW,
  SALES_INVOICE_WORKFLOW,
  SALES_RETURN_WORKFLOW,
  CREDIT_NOTE_WORKFLOW,
  PURCHASE_ORDER_WORKFLOW,
  GOODS_RECEIPT_WORKFLOW,
  PURCHASE_INVOICE_WORKFLOW,
  PURCHASE_RETURN_WORKFLOW,
  DEBIT_NOTE_WORKFLOW,
} from "@/lib/documents/workflows";

const KEYS = Object.keys(DOCUMENT_UI);

describe("document entry form layout", () => {
  it("covers all eleven sales and purchase modules", () => {
    expect(KEYS).toHaveLength(11);
  });

  it("gives every module the same core tabs", () => {
    // Item Details, Other Addition/Deduction and Other Details always have
    // built-in content, so no module can be missing them.
    for (const key of KEYS) {
      const { visibleTabs } = buildFormLayout(DOCUMENT_UI[key].extraFields);
      const labels = visibleTabs.map((t) => t.label);
      expect(labels[0], key).toBe("Item Details");
      expect(labels, key).toContain("Other Addition/Deduction");
      expect(labels, key).toContain("Other Details");
    }
  });

  it("never renders a tab with nothing in it", () => {
    for (const key of KEYS) {
      const { tabs, visibleTabs } = buildFormLayout(DOCUMENT_UI[key].extraFields);
      for (const tab of visibleTabs) {
        if (tab.key === "items" || tab.key === "addition" || tab.key === "other") continue;
        expect(tabs[tab.key].length, `${key} → ${tab.label}`).toBeGreaterThan(0);
      }
    }
  });

  it("places every configured field exactly once", () => {
    for (const key of KEYS) {
      const fields = DOCUMENT_UI[key].extraFields;
      const { header, tabs } = buildFormLayout(fields);
      const placed = [...header, ...Object.values(tabs).flat()].map((f) => f.name);

      expect(placed.slice().sort(), key).toEqual(fields.map((f) => f.name).sort());
      expect(new Set(placed).size, `${key} placed a field twice`).toBe(placed.length);
    }
  });

  it("puts warehouse, transporter and vehicle under Partner Details", () => {
    const delivery = buildFormLayout(DOCUMENT_UI["delivery-challans"].extraFields);
    const partnerNames = delivery.tabs.partner.map((f) => f.name);
    expect(partnerNames).toContain("warehouseId");
    expect(partnerNames).toContain("transporterId");
    expect(partnerNames).toContain("vehicleNumber");

    // A quotation has no fulfilment partner, so the tab is not rendered.
    const quotation = buildFormLayout(DOCUMENT_UI["sales-quotations"].extraFields);
    expect(quotation.tabs.partner).toHaveLength(0);
    expect(quotation.visibleTabs.map((t) => t.key)).not.toContain("partner");
  });

  it("puts free-text reasons under Other Details, beside the notes box", () => {
    for (const [key, field] of [
      ["sales-returns", "returnReason"],
      ["purchase-returns", "returnReason"],
      ["credit-notes", "reason"],
      ["debit-notes", "reason"],
    ] as const) {
      const { tabs } = buildFormLayout(DOCUMENT_UI[key].extraFields);
      expect(tabs.other.map((f) => f.name), key).toContain(field);
    }
  });

  it("promotes the right fields into the header grid", () => {
    const expected: Record<string, string[]> = {
      "sales-quotations": ["validUntil"],
      "sales-orders": ["expectedDeliveryDate", "orderType"],
      "delivery-challans": [],
      "sales-invoices": ["dueDate", "orderType"],
      "sales-returns": [],
      "credit-notes": [],
      "purchase-orders": ["expectedDeliveryDate"],
      "goods-receipts": [],
      "purchase-invoices": ["vendorInvoiceNumber", "dueDate"],
      "purchase-returns": [],
      "debit-notes": [],
    };

    for (const key of KEYS) {
      const { header } = buildFormLayout(DOCUMENT_UI[key].extraFields);
      expect(header.map((f) => f.name), key).toEqual(expected[key]);
    }
  });

  it("keeps the header grid small enough to stay readable", () => {
    // Party, date and number are fixed, plus currency — so promoting more
    // than three extras would overflow the three-column grid.
    for (const key of KEYS) {
      const { header } = buildFormLayout(DOCUMENT_UI[key].extraFields);
      expect(header.length, key).toBeLessThanOrEqual(3);
    }
  });
});

describe("save-and-submit checkbox", () => {
  const WORKFLOWS = {
    "sales-quotations": SALES_QUOTATION_WORKFLOW,
    "sales-orders": SALES_ORDER_WORKFLOW,
    "delivery-challans": DELIVERY_CHALLAN_WORKFLOW,
    "sales-invoices": SALES_INVOICE_WORKFLOW,
    "sales-returns": SALES_RETURN_WORKFLOW,
    "credit-notes": CREDIT_NOTE_WORKFLOW,
    "purchase-orders": PURCHASE_ORDER_WORKFLOW,
    "goods-receipts": GOODS_RECEIPT_WORKFLOW,
    "purchase-invoices": PURCHASE_INVOICE_WORKFLOW,
    "purchase-returns": PURCHASE_RETURN_WORKFLOW,
    "debit-notes": DEBIT_NOTE_WORKFLOW,
  };

  it("has exactly one non-cancel step out of DRAFT for every document", () => {
    // This is what makes one checkbox work across all eleven modules. If a
    // workflow ever gains a second choice here, the checkbox becomes
    // ambiguous and this test says so.
    for (const [key, workflow] of Object.entries(WORKFLOWS)) {
      const fromDraft = workflow.transitions[workflow.initial] ?? [];
      const forward = fromDraft.filter((t) => t.to !== "CANCELLED");
      expect(forward.length, `${key} has ${forward.length} forward steps from ${workflow.initial}`).toBe(1);
    }
  });

  it("labels the checkbox for every document type", () => {
    for (const key of KEYS) {
      const label = submitActionLabel(key);
      expect(label.length, key).toBeGreaterThan(5);
    }
  });

  it("says 'Send for approval' only where the workflow really has an approval step", () => {
    for (const [key, workflow] of Object.entries(WORKFLOWS)) {
      const forward = (workflow.transitions[workflow.initial] ?? []).find((t) => t.to !== "CANCELLED");
      const claimsApproval = submitActionLabel(key) === "Send for approval";
      expect(claimsApproval, key).toBe(forward?.to === "PENDING_APPROVAL");
    }
  });
});

describe("document UI and server registry agree", () => {
  it("defines a UI config for every server-side document type, and no extras", () => {
    expect(Object.keys(DOCUMENT_UI).sort()).toEqual(Object.keys(DOCUMENTS).sort());
  });

  it("points each UI config at its own API and page routes", () => {
    for (const key of KEYS) {
      const ui = DOCUMENT_UI[key];
      expect(ui.apiPath, key).toBe(`/api/documents/${key}`);
      expect(ui.basePath, key).toBe(`/${key}`);
    }
  });

  it("matches the party side declared on the server", () => {
    for (const key of KEYS) {
      expect(DOCUMENT_UI[key].partyField, key).toBe(DOCUMENTS[key].party.kind);
    }
  });
});
