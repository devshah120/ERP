import { describe, it, expect } from "vitest";
import { NAV_GROUPS, breadcrumbsFor, findNavMatch, creatableModules } from "@/app/(app)/navigation";
import { statusOptionsFor } from "@/lib/documents/statusOptions";
import { safeNext } from "@/lib/auth/safeNext";
import { passwordChecks, passwordMeetsPolicy } from "@/components/auth/PasswordField";
import { isPasswordStrongEnough } from "@/lib/auth/password";
import { DOCUMENT_UI } from "@/lib/documents/ui";

describe("navigation registry", () => {
  it("gives every enabled module a unique, absolute href", () => {
    const hrefs = NAV_GROUPS.flatMap((g) => [g.href, ...(g.children ?? []).map((c) => c.href)]).filter(Boolean) as string[];
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h.startsWith("/")).toBe(true);
  });

  it("reaches every sales and purchase document type from the sidebar", () => {
    const hrefs = new Set(NAV_GROUPS.flatMap((g) => (g.children ?? []).map((c) => c.href)));
    for (const doc of Object.values(DOCUMENT_UI)) expect(hrefs.has(doc.basePath), doc.basePath).toBe(true);
  });

  it("resolves the most specific entry for a path", () => {
    expect(findNavMatch("/reports/sales-register")?.child?.label).toBe("Sales Book");
    expect(findNavMatch("/reports/stock-summary")?.child?.label).toBe("Stock Position");
    expect(findNavMatch("/sales-orders/abc123")?.child?.label).toBe("Customer Orders");
    expect(findNavMatch("/dashboard")?.group.label).toBe("Business Pulse");
    expect(findNavMatch("/not-a-module")).toBeNull();
  });

  it("builds breadcrumbs whose last crumb is never a link", () => {
    expect(breadcrumbsFor("/sales-orders")).toEqual([{ label: "Selling" }, { label: "Customer Orders" }]);
    expect(breadcrumbsFor("/sales-orders/new")).toEqual([
      { label: "Selling" },
      { label: "Customer Orders", href: "/sales-orders" },
      { label: "New" },
    ]);
    expect(breadcrumbsFor("/sales-invoices/x1/print")).toEqual([
      { label: "Selling" },
      { label: "Sales Bills", href: "/sales-invoices" },
      { label: "Details", href: "/sales-invoices/x1" },
      { label: "Print" },
    ]);
    expect(breadcrumbsFor("/dashboard")).toEqual([{ label: "Business Pulse" }]);
  });

  it("never resolves a planned module as a page or breadcrumb", () => {
    // Apps & Integrations has no screen yet, so it is flagged `soon` and hidden.
    expect(findNavMatch("/apps")).toBeNull();
    expect(breadcrumbsFor("/apps")).toEqual([]);
    // ...while built screens, including ones that used to be planned, do resolve.
    expect(findNavMatch("/coupons")?.child?.label).toBe("Promo Codes");
    expect(findNavMatch("/logs")?.group.label).toBe("Audit Trail");
    expect(findNavMatch("/user-roles")?.child?.label).toBe("Roles & Permissions");
  });

  it("never offers quick-create for a module that is switched off", () => {
    const disabled = new Set(NAV_GROUPS.flatMap((g) => (g.children ?? []).filter((c) => !c.enabled).map((c) => c.createHref)));
    for (const m of creatableModules()) {
      expect(disabled.has(m.href)).toBe(false);
      expect(m.href.endsWith("/new")).toBe(true);
    }
  });
});

describe("document status options", () => {
  it("starts at the workflow's initial status and ends with the negative outcomes", () => {
    const so = statusOptionsFor("sales-orders");
    expect(so[0]).toBe("DRAFT");
    expect(so).toContain("CONFIRMED");
    expect(so[so.length - 1]).toBe("CANCELLED");
  });

  it("covers every document type and lists each status once", () => {
    for (const key of Object.keys(DOCUMENT_UI)) {
      const opts = statusOptionsFor(key);
      expect(opts.length, key).toBeGreaterThan(1);
      expect(new Set(opts).size, key).toBe(opts.length);
    }
    expect(statusOptionsFor("unknown")).toEqual([]);
  });
});

describe("post-login redirect", () => {
  it("keeps same-origin app paths", () => {
    expect(safeNext("/sales-orders/abc?x=1")).toBe("/sales-orders/abc?x=1");
  });

  it("refuses other hosts and signed-out pages", () => {
    for (const bad of [null, undefined, "", "https://evil.test", "//evil.test", "/\\evil.test", "/login", "/session-expired?next=/x", "dashboard"]) {
      expect(safeNext(bad as string | null)).toBe("/dashboard");
    }
    // A path that merely starts with the same letters is fine.
    expect(safeNext("/registers-report")).toBe("/registers-report");
  });
});

describe("password strength meter", () => {
  it("agrees with the server's password policy", () => {
    const samples = ["", "short1!", "alllowercase1!", "ALLUPPER1!", "NoDigits!!", "NoSymbol123", "Str0ng!Passw0rd", "Aa1!aaaa", "Aa1!aaa"];
    for (const pw of samples) expect(passwordMeetsPolicy(pw), pw).toBe(isPasswordStrongEnough(pw));
  });

  it("reports which rules are missing", () => {
    expect(passwordChecks("abc")).toEqual({ length: false, lower: true, upper: false, digit: false, symbol: false });
  });
});
