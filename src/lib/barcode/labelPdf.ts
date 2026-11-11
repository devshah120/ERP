import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { canEncodeCode128, code128Widths } from "@/lib/barcode/code128";

/**
 * Builds the label print file: a PDF whose every page is exactly one row of
 * labels (e.g. 102 × 25 mm for two 50 × 25 mm labels). Any printer or PDF
 * viewer then prints them at true size — unlike browser printing, where the
 * printer's paper size (A4/Letter) wins and labels come out tiny.
 */

const MM = 72 / 25.4; // PDF points per millimetre
const QUIET = 10; // barcode quiet zone, in modules
const BLACK = rgb(0, 0, 0);

export interface LabelPdfItem {
  name: string;
  variant: string;
  code: string;
  mrp: string;
  packedOn: string; // already formatted, e.g. "11/2026"
  copies: number;
}

export interface LabelPdfOptions {
  width: number; // mm, one label
  height: number; // mm
  across: number;
  gap: number; // mm between labels across
  showBusiness: boolean;
  showMrp: boolean;
  showDate: boolean;
  business: { name: string; city?: string; phone?: string; email?: string };
}

/** Standard PDF fonts only speak WinAnsi; keep text printable. */
function pdfText(s: string): string {
  return s
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

function money(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Shrinks text to fit a width (down to a minimum size), then truncates with "...". */
function fit(font: PDFFont, text: string, maxWidth: number, size: number, minSize: number): { text: string; size: number } {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.25;
  if (font.widthOfTextAtSize(text, s) <= maxWidth) return { text, size: s };
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, s) > maxWidth) t = t.slice(0, -1);
  return { text: `${t}...`, size: s };
}

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}

function textAt(c: Ctx, raw: string, x: number, y: number, size: number, opts: { bold?: boolean; align?: "left" | "center" | "right"; maxWidth?: number; minSize?: number; underline?: boolean } = {}) {
  const f = opts.bold ? c.bold : c.font;
  const { text, size: s } = opts.maxWidth ? fit(f, pdfText(raw), opts.maxWidth, size, opts.minSize ?? size * 0.6) : { text: pdfText(raw), size };
  const w = f.widthOfTextAtSize(text, s);
  const left = opts.align === "center" ? x - w / 2 : opts.align === "right" ? x - w : x;
  c.page.drawText(text, { x: left, y, size: s, font: f, color: BLACK });
  if (opts.underline) c.page.drawLine({ start: { x: left, y: y - s * 0.15 }, end: { x: left + w, y: y - s * 0.15 }, thickness: Math.max(0.4, s * 0.06), color: BLACK });
  return { width: w, size: s };
}

/** Draws a Code 128 barcode with its left edge at x, bottom at y. */
function barcode(c: Ctx, value: string, x: number, y: number, width: number, height: number) {
  const widths = code128Widths(value);
  const modules = widths.reduce((a, b) => a + b, 0) + QUIET * 2;
  // Keep bars between 0.19 mm and 0.5 mm per module so scanners can read them.
  const mod = Math.min(width / modules, 0.5 * MM);
  const used = mod * modules;
  let cx = x + (width - used) / 2 + QUIET * mod;
  widths.forEach((w, i) => {
    if (i % 2 === 0) c.page.drawRectangle({ x: cx, y, width: w * mod, height, color: BLACK });
    cx += w * mod;
  });
}

/** Small tag: business, product, MRP / date, barcode, code — stacked and centred. */
function drawCompact(c: Ctx, item: LabelPdfItem, ox: number, W: number, H: number, o: LabelPdfOptions) {
  const pad = Math.max(1.2 * MM, H * 0.05);
  const inner = W - pad * 2;
  const cx = ox + W / 2;
  const u = o.height / 25; // scale relative to a 25 mm label (mm, not points)
  let y = H - pad;

  if (o.showBusiness && o.business.name) {
    const s = 5.6 * u;
    y -= s;
    textAt(c, o.business.name.toUpperCase(), cx, y, s, { bold: true, align: "center", maxWidth: inner });
    y -= s * 0.35;
  }
  const nameSize = 7.4 * u;
  y -= nameSize;
  textAt(c, item.variant ? `${item.name} - ${item.variant}` : item.name, cx, y, nameSize, { bold: true, align: "center", maxWidth: inner, minSize: 5 * u });
  y -= nameSize * 0.3;

  const info = [o.showMrp ? `MRP : Rs. ${money(item.mrp)}` : "", o.showDate && item.packedOn ? `Pkd ${item.packedOn}` : ""].filter(Boolean).join("   ");
  if (info) {
    const s = 6.4 * u;
    y -= s;
    textAt(c, info, cx, y, s, { bold: true, align: "center", maxWidth: inner });
    y -= s * 0.35;
  }

  const codeSize = 5.4 * u;
  const barBottom = pad + codeSize * 1.25;
  const barHeight = Math.max(4 * MM, y - barBottom - 0.6 * MM);
  barcode(c, item.code, ox + pad, barBottom, inner, barHeight);
  textAt(c, item.code, cx, pad, codeSize, { align: "center", maxWidth: inner });
}

/** Large label (≥ 40 mm tall), laid out like a retail product sticker. */
function drawDetailed(c: Ctx, item: LabelPdfItem, ox: number, W: number, H: number, o: LabelPdfOptions) {
  const pad = 2.5 * MM;
  const inner = W - pad * 2;
  const cx = ox + W / 2;
  const u = o.height / 50; // scale relative to a 50 mm label (mm, not points)
  let y = H - pad;

  // Product name, underlined, centred
  const titleSize = 11 * u;
  y -= titleSize;
  textAt(c, item.name, cx, y, titleSize, { bold: true, align: "center", maxWidth: inner, minSize: 7 * u, underline: true });
  y -= titleSize * 0.45;
  if (item.variant) {
    const s = 8 * u;
    y -= s;
    textAt(c, item.variant, cx, y, s, { bold: true, align: "center", maxWidth: inner });
    y -= s * 0.4;
  }

  // MRP (left) and Mfg date (right)
  const s = 7.6 * u;
  y -= s * 1.2;
  if (o.showMrp) {
    const r = textAt(c, `MRP : Rs. ${money(item.mrp)}/-`, ox + pad, y, s, { bold: true, maxWidth: inner * 0.62 });
    textAt(c, "(Incl. of all taxes)", ox + pad + r.width + 1.2 * MM, y + s * 0.1, 4.6 * u, { maxWidth: inner * 0.3 });
  }
  if (o.showDate && item.packedOn) textAt(c, `Mfg : ${item.packedOn}`, ox + W - pad, y, s, { bold: true, align: "right" });

  // Footer lines (bottom-up): contact, then Mfg & Pkd by
  const small = 6.2 * u;
  let fy = pad;
  const contact = [o.business.email ? `Email : ${o.business.email}` : "", o.business.phone ? `Cust. Care No : ${o.business.phone}` : ""].filter(Boolean);
  if (contact.length) {
    textAt(c, contact.join("    "), ox + pad, fy, small, { bold: true, maxWidth: inner, minSize: 4.5 * u });
    fy += small * 1.45;
  }
  if (o.showBusiness && o.business.name) {
    const by = `Mfg. & Pkd. by : ${o.business.name}${o.business.city ? `, ${o.business.city}` : ""}`;
    textAt(c, by, ox + pad, fy, small, { bold: true, maxWidth: inner, minSize: 4.5 * u });
    fy += small * 1.6;
  }

  // Barcode + code in the middle band, left-aligned like the reference
  const codeSize = 7 * u;
  const barBottom = fy + codeSize * 1.35;
  const barTop = y - s * 0.9;
  const barHeight = Math.max(5 * MM, barTop - barBottom);
  const barWidth = Math.min(inner * 0.62, 55 * MM);
  barcode(c, item.code, ox + pad, barBottom, barWidth, barHeight);
  textAt(c, item.code, ox + pad + barWidth / 2, fy + codeSize * 0.2, codeSize, { align: "center", maxWidth: barWidth });
}

/** Builds the PDF and returns its bytes. Labels that can't be barcoded are skipped by the caller. */
export async function buildLabelPdf(items: LabelPdfItem[], o: LabelPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Barcode labels");
  doc.setCreator("NEXORA");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = o.width * MM;
  const H = o.height * MM;
  const pageW = (o.across * o.width + (o.across - 1) * o.gap) * MM;
  const labels = items.filter((i) => canEncodeCode128(i.code)).flatMap((i) => Array.from({ length: Math.max(0, i.copies) }, () => i));
  const detailed = o.height >= 40;

  for (let i = 0; i < labels.length; i += o.across) {
    const page = doc.addPage([pageW, H]);
    const c: Ctx = { page, font, bold };
    labels.slice(i, i + o.across).forEach((item, j) => {
      const ox = j * (W + o.gap * MM);
      if (detailed) drawDetailed(c, item, ox, W, H, o);
      else drawCompact(c, item, ox, W, H, o);
    });
  }
  return doc.save();
}
