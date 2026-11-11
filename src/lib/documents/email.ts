import nodemailer from "nodemailer";
import Decimal from "decimal.js";
import { getEnv } from "@/lib/config/env";
import { AppError } from "@/lib/errors/AppError";
import { amountInWords } from "./numberToWords";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const env = getEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return transporter;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: unknown): string {
  return new Decimal(String(value ?? 0)).toFixed(2);
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  return new Date(String(value)).toLocaleDateString("en-GB");
}

/**
 * Document email body.
 *
 * Written as a table with inline styles rather than reusing the print sheet:
 * email clients strip <style> blocks and ignore CSS grid, so the on-screen
 * layout would arrive broken. Same numbers, different medium.
 */
export function buildDocumentEmailHtml(params: {
  doc: AnyDoc;
  documentLabel: string;
  businessName: string;
  businessGstin?: string;
  partyName: string;
}): string {
  const { doc, documentLabel, businessName, businessGstin, partyName } = params;
  const intra = doc.intraState !== false;
  const taxLabel = doc.isUnionTerritory ? "UTGST" : "SGST";

  const lines = (doc.lines ?? [])
    .map(
      (l: AnyDoc, i: number) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${i + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">
          ${esc(l.itemName)}${l.variantSku ? `<br><span style="color:#64748b;font-size:11px;">${esc(l.variantSku)}</span>` : ""}
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${esc(l.quantity)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${money(l.rate)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${esc(l.taxRatePercent)}%</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${money(l.lineTotal)}</td>
      </tr>`
    )
    .join("");

  const taxRows = intra
    ? `
      <tr><td style="padding:4px 8px;">CGST</td><td style="padding:4px 8px;text-align:right;">${money(doc.totals?.cgstAmount)}</td></tr>
      <tr><td style="padding:4px 8px;">${taxLabel}</td><td style="padding:4px 8px;text-align:right;">${money(doc.totals?.sgstAmount)}</td></tr>`
    : `<tr><td style="padding:4px 8px;">IGST</td><td style="padding:4px 8px;text-align:right;">${money(doc.totals?.igstAmount)}</td></tr>`;

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
    <tr>
      <td style="padding:20px 24px;border-bottom:2px solid #0f172a;">
        <div style="font-size:18px;font-weight:700;">${esc(businessName)}</div>
        ${businessGstin ? `<div style="font-size:12px;color:#64748b;">GSTIN: ${esc(businessGstin)}</div>` : ""}
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px;">
        <p style="margin:0 0 14px;">Dear ${esc(partyName)},</p>
        <p style="margin:0 0 18px;">
          Please find the details of ${esc(documentLabel)}
          <strong>${esc(doc.documentNumber)}</strong> dated ${formatDate(doc.documentDate)} below.
        </p>

        <table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:8px;text-align:left;border-bottom:2px solid #cbd5e1;">#</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #cbd5e1;">Item</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #cbd5e1;">Qty</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #cbd5e1;">Rate</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #cbd5e1;">GST</th>
              <th style="padding:8px;text-align:right;border-bottom:2px solid #cbd5e1;">Amount</th>
            </tr>
          </thead>
          <tbody>${lines}</tbody>
        </table>

        <table role="presentation" style="margin-top:16px;margin-left:auto;font-size:13px;border-collapse:collapse;min-width:260px;">
          <tr><td style="padding:4px 8px;">Taxable value</td><td style="padding:4px 8px;text-align:right;">${money(doc.totals?.taxableAmount)}</td></tr>
          ${taxRows}
          <tr><td style="padding:4px 8px;">Shipping</td><td style="padding:4px 8px;text-align:right;">${money(doc.totals?.shippingCharge)}</td></tr>
          <tr style="background:#0f172a;color:#ffffff;">
            <td style="padding:8px;font-weight:700;">Grand total</td>
            <td style="padding:8px;text-align:right;font-weight:700;">${money(doc.totals?.grandTotal)}</td>
          </tr>
        </table>

        <p style="margin:14px 0 0;font-size:12px;color:#334155;">
          <strong>Amount in words:</strong> ${esc(amountInWords(String(doc.totals?.grandTotal ?? 0)))}
        </p>
        <p style="margin:6px 0 0;font-size:12px;color:#64748b;">
          Place of supply: ${esc(doc.placeOfSupplyName ?? "—")}${doc.placeOfSupplyCode ? ` (${esc(doc.placeOfSupplyCode)})` : ""} ·
          ${intra ? "Intra-state supply" : "Inter-state supply"}
        </p>
        ${doc.notes ? `<p style="margin:14px 0 0;font-size:12px;">${esc(doc.notes)}</p>` : ""}
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">
        This is a system-generated summary from ${esc(businessName)}.
      </td>
    </tr>
  </table>
</body></html>`;
}

/**
 * Sends the document summary.
 *
 * With no SMTP configured this throws rather than reporting success — a
 * "sent" toast for an email nobody received is worse than an error,
 * particularly when the user believes a customer has been chased.
 */
export async function sendDocumentEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const mailer = getTransporter();
  if (!mailer) {
    throw AppError.badRequest(
      "Email is not configured on this server. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to enable sending.",
      "SMTP_NOT_CONFIGURED"
    );
  }

  const env = getEnv();
  await mailer.sendMail({
    from: env.SMTP_FROM ?? env.SMTP_USER,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}
