"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney, formatQuantity } from "@/lib/format/number";

export type ReceiptDoc = Record<string, unknown> & {
  lines: Record<string, unknown>[];
  totals: Record<string, string>;
};

/**
 * A narrow till receipt. Rendered on screen inside the page, and mirrored
 * into a body-level node that is the only thing visible when printing, so a
 * receipt prints cleanly on an 80 mm roll without the app around it.
 */
export function ReceiptBody({
  doc,
  businessName,
  header,
  footer,
  kind = "sale",
}: {
  doc: ReceiptDoc;
  businessName: string;
  header?: string;
  footer?: string;
  kind?: "sale" | "return";
}) {
  const number = String(kind === "sale" ? doc.orderNumber : doc.creditNoteNumber);
  const date = new Date(String(kind === "sale" ? doc.orderDate : doc.creditNoteDate));
  const t = doc.totals;
  const payments = (doc.payments as { mode: string; amount: string; reference?: string }[] | undefined) ?? [];

  return (
    <div className="receipt">
      <div className="receiptCenter">
        <strong className="receiptBiz">{businessName}</strong>
        {header && <div className="receiptSmall" style={{ whiteSpace: "pre-line" }}>{header}</div>}
        <div className="receiptRule" />
        <div>{kind === "sale" ? "TAX INVOICE" : "CREDIT NOTE"}</div>
        <div className="receiptSmall">
          {number} · {date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
        {kind === "return" && <div className="receiptSmall">Against {String(doc.orderNumber)}</div>}
        <div className="receiptSmall">{String(doc.customerName ?? "Walk-in customer")}</div>
      </div>
      <div className="receiptRule" />
      <table className="receiptTable">
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {String(l.itemName)}
                {l.variantSku ? <div className="receiptSmall">{String(l.variantSku)}</div> : null}
                <div className="receiptSmall">
                  {formatQuantity(String(l.quantity))} × {formatMoney(String(l.price))}
                  {Number(l.discountPercent) > 0 ? ` · −${Number(l.discountPercent)}%` : ""}
                  {` · GST ${Number(l.taxRatePercent)}%`}
                </div>
              </td>
              <td className="receiptNum">{formatMoney(String(l.lineTotal))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="receiptRule" />
      <table className="receiptTable">
        <tbody>
          {Number(t.discountAmount) > 0 && (
            <tr>
              <td>Discount</td>
              <td className="receiptNum">−{formatMoney(t.discountAmount)}</td>
            </tr>
          )}
          {Number(t.couponDiscount) > 0 && (
            <tr>
              <td>Coupon {String(doc.couponCode ?? "")}</td>
              <td className="receiptNum">−{formatMoney(t.couponDiscount)}</td>
            </tr>
          )}
          <tr>
            <td>Taxable value</td>
            <td className="receiptNum">{formatMoney(t.taxableAmount)}</td>
          </tr>
          <tr>
            <td>CGST</td>
            <td className="receiptNum">{formatMoney(t.cgstAmount)}</td>
          </tr>
          <tr>
            <td>SGST</td>
            <td className="receiptNum">{formatMoney(t.sgstAmount)}</td>
          </tr>
          {t.roundOff && Number(t.roundOff) !== 0 && (
            <tr>
              <td>Round off</td>
              <td className="receiptNum">{formatMoney(t.roundOff)}</td>
            </tr>
          )}
          <tr className="receiptGrand">
            <td>{kind === "sale" ? "TOTAL" : "REFUND"}</td>
            <td className="receiptNum">{formatMoney(t.grandTotal)}</td>
          </tr>
        </tbody>
      </table>
      {kind === "sale" && payments.length > 0 && (
        <>
          <div className="receiptRule" />
          <table className="receiptTable">
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td>Paid · {p.mode}</td>
                  <td className="receiptNum">{formatMoney(p.amount)}</td>
                </tr>
              ))}
              {Number(doc.changeReturned) > 0 && (
                <tr>
                  <td>Change</td>
                  <td className="receiptNum">{formatMoney(String(doc.changeReturned))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
      {kind === "return" && <div className="receiptSmall">Refunded by {String(doc.refundMode)}</div>}
      {footer && (
        <>
          <div className="receiptRule" />
          <div className="receiptCenter receiptSmall" style={{ whiteSpace: "pre-line" }}>
            {footer}
          </div>
        </>
      )}
    </div>
  );
}

/** Mirror of the receipt that only shows up in print. */
export function ReceiptPrintPortal(props: Parameters<typeof ReceiptBody>[0]) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Portals need document.body, which only exists after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="receiptPrintRoot" aria-hidden>
      <ReceiptBody {...props} />
    </div>,
    document.body
  );
}

/** Prints only the receipt. */
export function printReceipt() {
  document.body.classList.add("printingReceipt");
  const done = () => {
    document.body.classList.remove("printingReceipt");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  // Browsers without afterprint still need the class cleared.
  setTimeout(done, 1500);
}
