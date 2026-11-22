import Decimal from "decimal.js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/*
 * Salary slips as real PDF files (one A4 page per payslip), for download by
 * HR and employees and for a whole payroll run at once. Same content as the
 * on-screen payslip.
 */

interface Line {
  code: string;
  label: string;
  amount: string;
}

export interface PayslipPrintData {
  period: string;
  status: string;
  employee: {
    code: string;
    name: string;
    department?: string;
    designation?: string;
    dateOfJoining?: string | Date | null;
    panNumber?: string;
    uanNumber?: string;
    esiNumber?: string;
    bankName?: string;
    bankAccountNumber?: string;
    paymentMode?: string;
  };
  daysInMonth: number;
  payableDays: number;
  lopDays: number;
  presentDays: number;
  paidLeaveDays: number;
  holidays: number;
  weeklyOffs: number;
  earnings: Line[];
  deductions: Line[];
  employerContributions: Line[];
  grossEarnings: string;
  reimbursements: string;
  totalDeductions: string;
  netPay: string;
  netPayInWords: string;
  salaryRevisedOn?: string[];
  business: { name: string; tradeName: string; address: string };
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 40;
const INK = rgb(0.11, 0.13, 0.17);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const SHADE = rgb(0.96, 0.97, 0.98);

/** Standard PDF fonts only speak WinAnsi; keep text printable. */
function pdfText(s: unknown): string {
  return String(s ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "*")
    .replace(/[^\x20-\x7e]/g, "?");
}

/** Indian digit grouping (12,34,567.89) on the decimal string, never via floating point. */
export function inr(value: string): string {
  const [whole, fraction] = new Decimal(value || "0").toFixed(2).split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}

function fmtDay(v: string | Date | null | undefined): string {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function drawPayslip(page: PDFPage, p: PayslipPrintData, f: Fonts) {
  const width = A4.w - MARGIN * 2;
  const text = (s: string, x: number, y: number, size = 9, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(pdfText(s), { x, y, size, font: opts.bold ? f.bold : f.regular, color: opts.color ?? INK });
  const right = (s: string, xRight: number, y: number, size = 9, bold = false) => {
    const t = pdfText(s);
    const font = bold ? f.bold : f.regular;
    page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y, size, font, color: INK });
  };
  const rule = (y: number, x1 = MARGIN, x2 = A4.w - MARGIN) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: RULE });

  let y = A4.h - MARGIN - 6;

  if (p.status === "DRAFT") {
    page.drawText("DRAFT", { x: 150, y: 380, size: 110, font: f.bold, color: rgb(0.93, 0.94, 0.96), opacity: 0.8 });
  }

  // Letterhead
  text(p.business.name || p.business.tradeName || "", MARGIN, y, 15, { bold: true });
  right("PAYSLIP", A4.w - MARGIN, y, 13, true);
  y -= 14;
  for (const l of wrap(p.business.address, f.regular, 8.5, width * 0.6).slice(0, 2)) {
    text(l, MARGIN, y, 8.5, { color: MUTED });
    y -= 11;
  }
  right(p.period, A4.w - MARGIN, A4.h - MARGIN - 20, 10);
  y -= 6;
  rule(y);
  y -= 18;

  // Employee details, two columns
  const masked = p.employee.bankAccountNumber ? `xxxx${p.employee.bankAccountNumber.slice(-4)}` : "-";
  const bank = (p.employee.paymentMode ?? "BANK") === "BANK" ? `${p.employee.bankName ?? ""} ${masked}`.trim() : p.employee.paymentMode ?? "";
  const meta: [string, string][] = [
    ["Employee", p.employee.name],
    ["Employee code", p.employee.code],
    ["Designation", p.employee.designation || "-"],
    ["Department", p.employee.department || "-"],
    ["Date of joining", fmtDay(p.employee.dateOfJoining)],
    ["PAN", p.employee.panNumber || "-"],
    ["UAN", p.employee.uanNumber || "-"],
    ["ESI number", p.employee.esiNumber || "-"],
    ["Bank", bank || "-"],
    ["Days paid", `${p.payableDays} of ${p.daysInMonth}${p.lopDays ? ` (LOP ${p.lopDays})` : ""}`],
  ];
  const colW = width / 2;
  for (let i = 0; i < meta.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const item = meta[i + c];
      if (!item) continue;
      const x = MARGIN + c * colW;
      text(item[0], x, y, 8.5, { color: MUTED });
      text(item[1], x + 90, y, 9, { bold: item[0] === "Employee" });
    }
    y -= 15;
  }
  y -= 6;

  // Earnings and deductions side by side
  const gap = 16;
  const tableW = (width - gap) / 2;
  const rowH = 16;
  const tables: { title: string; lines: Line[]; totalLabel: string; total: string }[] = [
    { title: "Earnings", lines: p.earnings, totalLabel: "Total earnings", total: new Decimal(p.grossEarnings || "0").plus(p.reimbursements || "0").toFixed(2) },
    { title: "Deductions", lines: p.deductions, totalLabel: "Total deductions", total: p.totalDeductions },
  ];
  const rows = Math.max(p.earnings.length, p.deductions.length, 1);
  const top = y;
  tables.forEach((t, idx) => {
    const x = MARGIN + idx * (tableW + gap);
    let ty = top;
    page.drawRectangle({ x, y: ty - 5, width: tableW, height: rowH, color: SHADE });
    text(t.title, x + 6, ty, 9, { bold: true });
    right("Amount", x + tableW - 6, ty, 9, true);
    ty -= rowH;
    for (let i = 0; i < rows; i++) {
      const l = t.lines[i];
      if (l) {
        text(l.label, x + 6, ty, 9);
        right(inr(l.amount), x + tableW - 6, ty, 9);
      } else if (i === 0) {
        text("None", x + 6, ty, 9, { color: MUTED });
      }
      ty -= rowH;
    }
    rule(ty + rowH - 5, x, x + tableW);
    text(t.totalLabel, x + 6, ty, 9, { bold: true });
    right(inr(t.total), x + tableW - 6, ty, 9, true);
  });
  y = top - rowH * (rows + 2) - 10;

  // Net pay
  const boxH = 44;
  page.drawRectangle({ x: MARGIN, y: y - boxH + 12, width, height: boxH, color: SHADE, borderColor: RULE, borderWidth: 0.6 });
  text("Net pay", MARGIN + 10, y - 4, 9, { color: MUTED });
  text(`Rs. ${inr(p.netPay)}`, MARGIN + 10, y - 22, 15, { bold: true });
  const words = wrap(p.netPayInWords, f.regular, 8.5, width * 0.55);
  words.slice(0, 3).forEach((l, i) => right(l, A4.w - MARGIN - 10, y - 6 - i * 11, 8.5));
  y -= boxH + 10;

  // Footnotes
  const notes: string[] = [];
  if (p.employerContributions.length > 0) {
    notes.push(`Employer contributions (not deducted from pay): ${p.employerContributions.map((l) => `${l.label} Rs. ${inr(l.amount)}`).join(", ")}`);
  }
  if (p.salaryRevisedOn && p.salaryRevisedOn.length > 0) {
    notes.push(`Salary revised on ${p.salaryRevisedOn.map((x) => fmtDay(x)).join(", ")}; earnings are paid at each rate for the days it applied.`);
  }
  notes.push(`Attendance: ${p.presentDays} present, ${p.paidLeaveDays} paid leave, ${p.holidays} holidays, ${p.weeklyOffs} weekly offs.`);
  notes.push("This is a computer-generated payslip and needs no signature.");
  for (const n of notes) {
    for (const l of wrap(n, f.regular, 8.5, width)) {
      text(l, MARGIN, y, 8.5, { color: MUTED });
      y -= 11;
    }
    y -= 3;
  }
}

/** One A4 page per payslip, in the order given. */
export async function renderPayslipsPdf(slips: PayslipPrintData[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfText(title));
  doc.setCreator("NEXORA HRMS");
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  for (const s of slips) drawPayslip(doc.addPage([A4.w, A4.h]), s, fonts);
  return doc.save();
}

/** A safe download filename: "Payslip-EMP-000001-October-2026.pdf". */
export function pdfFilename(...parts: string[]): string {
  return `${parts.map((p) => p.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).join("-")}.pdf`;
}

export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
