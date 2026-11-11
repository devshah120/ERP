import type { ReactNode } from "react";
import { amountInWords } from "@/lib/documents/numberToWords";
import { formatMoney, formatQuantity } from "@/lib/format/number";
import { PRINT_LAYOUTS, type LayoutId } from "@/lib/printFormats/catalog";
import { formatPrintDate, taxSummary, totalQuantity, totalSavings, type PrintLine, type PrintModel } from "./model";

/**
 * Every print layout. Plain components with no hooks, so the same markup
 * renders on the server (document print page) and in the browser (POS
 * receipt, settings previews).
 */

const fm = (v: string) => formatMoney(v);
const nz = (v?: string) => Boolean(v) && Number(v) !== 0;

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

interface TotalRow {
  label: string;
  value: string;
  grand?: boolean;
}

/** The totals block, in the order a GST bill lists them. */
function totalRows(m: PrintModel, { subTotal = true }: { subTotal?: boolean } = {}): TotalRow[] {
  const t = m.totals;
  const rows: TotalRow[] = [];
  if (subTotal && nz(t.subTotal) && t.subTotal !== t.taxable) rows.push({ label: "Sub total", value: fm(t.subTotal) });
  if (nz(t.discount)) rows.push({ label: "Discount", value: `−${fm(t.discount)}` });
  if (t.coupon) rows.push({ label: `Coupon ${t.coupon.code}`.trim(), value: `−${fm(t.coupon.amount)}` });
  rows.push({ label: "Taxable value", value: fm(t.taxable) });
  if (m.intraState) {
    rows.push({ label: "CGST", value: fm(t.cgst) });
    rows.push({ label: m.stateTaxLabel, value: fm(t.sgst) });
  } else {
    rows.push({ label: "IGST", value: fm(t.igst) });
  }
  if (nz(t.shipping)) rows.push({ label: "Shipping", value: fm(t.shipping) });
  if (nz(t.roundOff)) rows.push({ label: "Round off", value: fm(t.roundOff) });
  rows.push({ label: m.grandLabel, value: fm(t.grandTotal), grand: true });
  return rows;
}

function lineMeta(l: PrintLine, { hsn = false }: { hsn?: boolean } = {}) {
  // A variant SKU usually starts with the item code; print just the SKU then.
  const code = l.sku && l.code && l.sku.startsWith(l.code) ? null : l.code;
  return [code, l.sku, hsn && l.hsn ? `HSN ${l.hsn}` : null, l.description].filter(Boolean).join(" · ");
}

function bizAddress(m: PrintModel) {
  const b = m.business;
  return [b.address, [b.city, b.state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}

function words(m: PrintModel) {
  return amountInWords(m.totals.grandTotal, m.currencyWord);
}

function Signature({ m, className = "pfSign" }: { m: PrintModel; className?: string }) {
  return (
    <div className={className}>
      <div className="pfMuted">This is a computer-generated document.</div>
      <div className="pfSignBox">
        <div>
          For <strong>{m.business.name}</strong>
        </div>
        <div className="pfSignLine">Authorised Signatory</div>
      </div>
    </div>
  );
}

function NotesAndTerms({ m }: { m: PrintModel }) {
  return (
    <>
      {m.notes && (
        <div className="pfBlock">
          <div className="pfLabel">Notes</div>
          <div className="pfPre">{m.notes}</div>
        </div>
      )}
      {m.terms && (
        <div className="pfBlock">
          <div className="pfLabel">Terms &amp; Conditions</div>
          <div className="pfPre">{m.terms}</div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Thermal                                                             */
/* ------------------------------------------------------------------ */

function ThermalHead({ m, detailed = false }: { m: PrintModel; detailed?: boolean }) {
  const b = m.business;
  return (
    <div className="pfCenter">
      <div className="pfTBiz">{b.name}</div>
      {detailed && bizAddress(m) && <div className="pfTSmall">{bizAddress(m)}</div>}
      {detailed && b.phone && <div className="pfTSmall">Ph: {b.phone}</div>}
      {b.gstin && <div className="pfTSmall">GSTIN: {b.gstin}</div>}
      {m.header && <div className="pfTSmall pfPre">{m.header}</div>}
      <div className="pfRule" />
      <div className="pfTTitle">{m.title}</div>
      <div className="pfTSmall">
        {m.number} · {formatPrintDate(m.date, m.showTime)}
      </div>
      {m.meta.map((x) => (
        <div key={x.label} className="pfTSmall">
          {x.label}: {x.value}
        </div>
      ))}
      {m.party && (
        <div className="pfTSmall">
          {m.party.name}
          {m.party.phone ? ` · ${m.party.phone}` : ""}
        </div>
      )}
      {m.party?.gstin && <div className="pfTSmall">GSTIN: {m.party.gstin}</div>}
    </div>
  );
}

function ThermalTotals({ m, compact = false }: { m: PrintModel; compact?: boolean }) {
  const rows = totalRows(m, { subTotal: !m.showTime });
  const shown = compact ? rows.filter((r) => r.grand || r.label === "Discount" || r.label.startsWith("Coupon") || r.label === "Round off") : rows;
  return (
    <table className="pfTTable">
      <tbody>
        {compact && (
          <tr>
            <td>GST incl.</td>
            <td className="pfNum">{formatMoney(Number(m.totals.cgst) + Number(m.totals.sgst) + Number(m.totals.igst))}</td>
          </tr>
        )}
        {shown.map((r) => (
          <tr key={r.label} className={r.grand ? "pfTGrand" : undefined}>
            <td>{r.label}</td>
            <td className="pfNum">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ThermalTail({ m, savings = false }: { m: PrintModel; savings?: boolean }) {
  const saved = totalSavings(m);
  return (
    <>
      {m.payments.length > 0 && (
        <>
          <div className="pfRule" />
          <table className="pfTTable">
            <tbody>
              {m.payments.map((p, i) => (
                <tr key={i}>
                  <td>Paid · {p.mode}</td>
                  <td className="pfNum">{fm(p.amount)}</td>
                </tr>
              ))}
              {m.change && (
                <tr>
                  <td>Change</td>
                  <td className="pfNum">{fm(m.change)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
      {m.refundNote && <div className="pfTSmall">{m.refundNote}</div>}
      {savings && Number(saved) > 0 && (
        <>
          <div className="pfRule" />
          <div className="pfCenter pfTSave">You saved ₹{fm(saved)} on this bill</div>
        </>
      )}
      {m.footer && (
        <>
          <div className="pfRule" />
          <div className="pfCenter pfTSmall pfPre">{m.footer}</div>
        </>
      )}
    </>
  );
}

/** Thermal 80 / 58 mm, the everyday receipt. */
function ThermalStandard({ m }: { m: PrintModel }) {
  return (
    <>
      <ThermalHead m={m} />
      <div className="pfRule" />
      <table className="pfTTable">
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.name}
                {l.sku && <div className="pfTSmall">{l.sku}</div>}
                <div className="pfTSmall">
                  {formatQuantity(l.quantity)} × {fm(l.rate)}
                  {l.discountPercent > 0 ? ` · −${l.discountPercent}%` : ""}
                  {` · GST ${l.taxRate}%`}
                </div>
              </td>
              <td className="pfNum">{fm(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pfRule" />
      <ThermalTotals m={m} />
      <ThermalTail m={m} />
    </>
  );
}

/** Thermal 80 mm with codes, HSN and a rate-wise GST table. */
function ThermalDetailed({ m }: { m: PrintModel }) {
  const summary = taxSummary(m.lines);
  return (
    <>
      <ThermalHead m={m} detailed />
      <div className="pfRule" />
      <table className="pfTTable pfTCols">
        <thead>
          <tr>
            <th>Item</th>
            <th className="pfNum">Qty</th>
            <th className="pfNum">Rate</th>
            <th className="pfNum">Amt</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.name}
                <div className="pfTSmall">
                  {lineMeta(l, { hsn: true })}
                  {` · GST ${l.taxRate}%`}
                  {l.discountPercent > 0 ? ` · −${l.discountPercent}%` : ""}
                </div>
              </td>
              <td className="pfNum">{formatQuantity(l.quantity)}</td>
              <td className="pfNum">{fm(l.rate)}</td>
              <td className="pfNum">{fm(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pfRule" />
      <div className="pfTSmall pfSpread">
        <span>Items: {m.lines.length}</span>
        <span>Qty: {formatQuantity(totalQuantity(m.lines))}</span>
      </div>
      <div className="pfRule" />
      <ThermalTotals m={m} />
      <div className="pfRule" />
      <table className="pfTTable pfTCols pfTSmall">
        <thead>
          <tr>
            <th>GST%</th>
            <th className="pfNum">Taxable</th>
            {m.intraState ? (
              <>
                <th className="pfNum">CGST</th>
                <th className="pfNum">{m.stateTaxLabel}</th>
              </>
            ) : (
              <th className="pfNum">IGST</th>
            )}
          </tr>
        </thead>
        <tbody>
          {summary.map((r) => (
            <tr key={r.rate}>
              <td>{r.rate}%</td>
              <td className="pfNum">{fm(r.taxable)}</td>
              {m.intraState ? (
                <>
                  <td className="pfNum">{fm(r.cgst)}</td>
                  <td className="pfNum">{fm(r.sgst)}</td>
                </>
              ) : (
                <td className="pfNum">{fm(r.igst)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <ThermalTail m={m} savings />
    </>
  );
}

/** One line per item, totals only. */
function ThermalCompact({ m }: { m: PrintModel }) {
  return (
    <>
      <div className="pfCenter">
        <div className="pfTBiz">{m.business.name}</div>
        {m.business.gstin && <div className="pfTSmall">GSTIN: {m.business.gstin}</div>}
        <div className="pfTSmall">
          {m.title} {m.number}
        </div>
        <div className="pfTSmall">{formatPrintDate(m.date, m.showTime)}</div>
      </div>
      <div className="pfRule" />
      <table className="pfTTable">
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i}>
              <td className="pfEllipsis">{l.name}</td>
              <td className="pfNum">{formatQuantity(l.quantity)}</td>
              <td className="pfNum">{fm(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pfRule" />
      <ThermalTotals m={m} compact />
      <ThermalTail m={m} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A4 · Tax invoice (the original layout)                              */
/* ------------------------------------------------------------------ */

function A4Standard({ m }: { m: PrintModel }) {
  const b = m.business;
  const intra = m.intraState;
  return (
    <>
      <div className="printHeader">
        <div>
          <div className="printCompany">{b.name}</div>
          {b.address && <div className="printMeta">{b.address}</div>}
          {(b.city || b.state) && <div className="printMeta">{[b.city, b.state].filter(Boolean).join(", ")}, India</div>}
          {b.gstin && <div className="printMeta">GSTIN: {b.gstin}</div>}
          {b.phone && <div className="printMeta">Phone: {b.phone}</div>}
          {m.header && <div className="printMeta pfPre">{m.header}</div>}
        </div>
        <div className="printDocTitle">
          <div className="printDocName">{m.title}</div>
          <div className="printMeta">
            <strong>No:</strong> {m.number}
          </div>
          <div className="printMeta">
            <strong>Date:</strong> {formatPrintDate(m.date, m.showTime)}
          </div>
          {m.dueDate && (
            <div className="printMeta">
              <strong>Due:</strong> {formatPrintDate(m.dueDate)}
            </div>
          )}
        </div>
      </div>

      <div className="printParties">
        <div className="printPartyBox">
          <div className="printBoxLabel">{m.party?.label ?? "Bill To"}</div>
          <div className="printPartyName">{m.party?.name ?? "—"}</div>
          {m.party?.address.map((l, i) => (
            <div key={i} className="printMeta">
              {l}
            </div>
          ))}
          {m.party?.gstin && <div className="printMeta">GSTIN: {m.party.gstin}</div>}
          {m.party?.phone && <div className="printMeta">Phone: {m.party.phone}</div>}
        </div>
        <div className="printPartyBox">
          <div className="printBoxLabel">{m.shipTo?.label ?? "Details"}</div>
          {m.shipTo?.address.map((l, i) => (
            <div key={i} className="printMeta">
              {l}
            </div>
          ))}
          <div className="printMeta" style={{ marginTop: m.shipTo?.address.length ? "0.35rem" : 0 }}>
            <strong>Place of Supply:</strong> {m.placeOfSupply ?? "—"}
          </div>
          <div className="printMeta">
            <strong>Supply Type:</strong> {intra ? "Intra-state" : "Inter-state"}
          </div>
          {m.meta.map((x) => (
            <div key={x.label} className="printMeta">
              <strong>{x.label}:</strong> {x.value}
            </div>
          ))}
        </div>
      </div>

      <table className="printTable">
        <thead>
          <tr>
            <th style={{ width: "2rem" }}>#</th>
            <th>Description</th>
            <th style={{ width: "4.5rem" }}>Qty</th>
            <th style={{ width: "5.5rem" }}>Rate</th>
            <th style={{ width: "5rem" }}>Discount</th>
            <th style={{ width: "6rem" }}>Taxable</th>
            <th style={{ width: "3.5rem" }}>GST%</th>
            {intra ? (
              <>
                <th style={{ width: "5rem" }}>CGST</th>
                <th style={{ width: "5rem" }}>{m.stateTaxLabel}</th>
              </>
            ) : (
              <th style={{ width: "6rem" }}>IGST</th>
            )}
            <th style={{ width: "6.5rem" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <strong>{l.name}</strong>
                <div className="printLineMeta">{lineMeta(l, { hsn: true })}</div>
              </td>
              <td className="num">
                {formatQuantity(l.quantity)} {l.unit ?? ""}
              </td>
              <td className="num">{fm(l.rate)}</td>
              <td className="num">{fm(l.discountAmount)}</td>
              <td className="num">{fm(l.taxable)}</td>
              <td className="num">{l.taxRate}</td>
              {intra ? (
                <>
                  <td className="num">{fm(l.cgst)}</td>
                  <td className="num">{fm(l.sgst)}</td>
                </>
              ) : (
                <td className="num">{fm(l.igst)}</td>
              )}
              <td className="num">{fm(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="printFooter">
        <div className="printFooterLeft">
          <div className="printBoxLabel">Amount in words</div>
          <div className="printWords">{words(m)}</div>
          {m.payments.length > 0 && (
            <div className="printMeta" style={{ marginTop: "0.5rem" }}>
              <strong>Paid:</strong> {m.payments.map((p) => `${p.mode} ${fm(p.amount)}`).join(", ")}
              {m.change ? ` · Change ${fm(m.change)}` : ""}
            </div>
          )}
          {m.refundNote && <div className="printMeta">{m.refundNote}</div>}
          <NotesAndTerms m={m} />
        </div>
        <div className="printTotals">
          {totalRows(m).map((r) => (
            <div key={r.label} className={`printTotalRow${r.grand ? " grand" : ""}`}>
              <span>{r.label}</span>
              <span>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <Signature m={m} className="printSignature" />
      {m.footer && <div className="pfFooterNote">{m.footer}</div>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A4 · GST classic (fully ruled)                                      */
/* ------------------------------------------------------------------ */

function A4GstClassic({ m }: { m: PrintModel }) {
  const b = m.business;
  const intra = m.intraState;
  const hasHsn = m.lines.some((l) => l.hsn);
  const summary = taxSummary(m.lines, hasHsn);
  return (
    <div className="pfBox">
      <div className="pfClassicTop">
        <span>Original for Recipient</span>
        <strong>{m.title.toUpperCase()}</strong>
        <span />
      </div>
      <div className="pfClassicHead">
        <div className="pfClassicBiz">{b.name}</div>
        {bizAddress(m) && <div>{bizAddress(m)}</div>}
        <div>
          {[b.gstin && `GSTIN: ${b.gstin}`, b.phone && `Phone: ${b.phone}`, b.email && `Email: ${b.email}`].filter(Boolean).join("  ·  ")}
        </div>
      </div>

      <div className="pfGrid2">
        <div className="pfCell">
          <div className="pfKv">
            <span>Number</span>
            <strong>{m.number}</strong>
          </div>
          <div className="pfKv">
            <span>Date</span>
            <strong>{formatPrintDate(m.date, m.showTime)}</strong>
          </div>
          {m.dueDate && (
            <div className="pfKv">
              <span>Due date</span>
              <strong>{formatPrintDate(m.dueDate)}</strong>
            </div>
          )}
        </div>
        <div className="pfCell">
          <div className="pfKv">
            <span>Place of supply</span>
            <strong>{m.placeOfSupply ?? "—"}</strong>
          </div>
          <div className="pfKv">
            <span>Supply type</span>
            <strong>{intra ? "Intra-state" : "Inter-state"}</strong>
          </div>
          {m.meta.map((x) => (
            <div key={x.label} className="pfKv">
              <span>{x.label}</span>
              <strong>{x.value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="pfGrid2">
        <div className="pfCell">
          <div className="pfLabel">{m.party?.label ?? "Bill To"}</div>
          <strong>{m.party?.name}</strong>
          {m.party?.address.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          {m.party?.gstin && <div>GSTIN: {m.party.gstin}</div>}
          {m.party?.phone && <div>Phone: {m.party.phone}</div>}
        </div>
        <div className="pfCell">
          <div className="pfLabel">{m.shipTo?.label ?? "Ship To"}</div>
          <strong>{m.shipTo?.name ?? m.party?.name}</strong>
          {(m.shipTo?.address ?? []).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>

      <table className="pfRuled">
        <thead>
          <tr>
            <th>Sr</th>
            <th>Description of goods</th>
            {hasHsn && <th>HSN</th>}
            <th className="pfNum">Qty</th>
            <th className="pfNum">Rate</th>
            <th className="pfNum">Disc.</th>
            <th className="pfNum">GST%</th>
            <th className="pfNum">Taxable</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                {l.name}
                {lineMeta(l) && <div className="pfMuted">{lineMeta(l)}</div>}
              </td>
              {hasHsn && <td>{l.hsn ?? ""}</td>}
              <td className="pfNum">
                {formatQuantity(l.quantity)} {l.unit ?? ""}
              </td>
              <td className="pfNum">{fm(l.rate)}</td>
              <td className="pfNum">{nz(l.discountAmount) ? fm(l.discountAmount) : ""}</td>
              <td className="pfNum">{l.taxRate}</td>
              <td className="pfNum">{fm(l.taxable)}</td>
            </tr>
          ))}
          <tr className="pfRuledTotal">
            <td />
            <td>Total</td>
            {hasHsn && <td />}
            <td className="pfNum">{formatQuantity(totalQuantity(m.lines))}</td>
            <td />
            <td className="pfNum">{nz(m.totals.discount) ? fm(m.totals.discount) : ""}</td>
            <td />
            <td className="pfNum">{fm(m.totals.taxable)}</td>
          </tr>
        </tbody>
      </table>

      <table className="pfRuled pfRuledSmall">
        <thead>
          <tr>
            {hasHsn && <th>HSN</th>}
            <th className="pfNum">GST%</th>
            <th className="pfNum">Taxable value</th>
            {intra ? (
              <>
                <th className="pfNum">CGST</th>
                <th className="pfNum">{m.stateTaxLabel}</th>
              </>
            ) : (
              <th className="pfNum">IGST</th>
            )}
            <th className="pfNum">Total tax</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((r, i) => (
            <tr key={i}>
              {hasHsn && <td>{r.hsn ?? ""}</td>}
              <td className="pfNum">{r.rate}%</td>
              <td className="pfNum">{fm(r.taxable)}</td>
              {intra ? (
                <>
                  <td className="pfNum">{fm(r.cgst)}</td>
                  <td className="pfNum">{fm(r.sgst)}</td>
                </>
              ) : (
                <td className="pfNum">{fm(r.igst)}</td>
              )}
              <td className="pfNum">{fm(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pfGrid2">
        <div className="pfCell">
          <div className="pfLabel">Amount in words</div>
          <div className="pfWords">{words(m)}</div>
          {m.payments.length > 0 && <div style={{ marginTop: 4 }}>Paid: {m.payments.map((p) => `${p.mode} ${fm(p.amount)}`).join(", ")}</div>}
          {m.refundNote && <div>{m.refundNote}</div>}
          <NotesAndTerms m={m} />
        </div>
        <div className="pfCell pfCellFlush">
          {totalRows(m).map((r) => (
            <div key={r.label} className={`pfKv pfKvLine${r.grand ? " pfKvGrand" : ""}`}>
              <span>{r.label}</span>
              <strong>{r.value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="pfClassicSign">
        <div>
          <div className="pfLabel">Declaration</div>
          We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
        </div>
        <div className="pfSignBox">
          <div>
            For <strong>{b.name}</strong>
          </div>
          <div className="pfSignLine">Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A4 · Simple and Modern                                              */
/* ------------------------------------------------------------------ */

function PartyLines({ p }: { p?: PrintModel["party"] }) {
  if (!p) return null;
  return (
    <>
      <strong className="pfPartyName">{p.name}</strong>
      {p.address.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {p.gstin && <div>GSTIN: {p.gstin}</div>}
      {p.phone && <div>Phone: {p.phone}</div>}
    </>
  );
}

function SimpleItems({ m, numbered = true }: { m: PrintModel; numbered?: boolean }) {
  return (
    <table className="pfItems">
      <thead>
        <tr>
          {numbered && <th style={{ width: "2rem" }}>#</th>}
          <th>Item</th>
          <th className="pfNum">Qty</th>
          <th className="pfNum">Rate</th>
          <th className="pfNum">GST</th>
          <th className="pfNum">Amount</th>
        </tr>
      </thead>
      <tbody>
        {m.lines.map((l, i) => (
          <tr key={i}>
            {numbered && <td className="pfMuted">{i + 1}</td>}
            <td>
              <strong>{l.name}</strong>
              {lineMeta(l) && <div className="pfMuted">{lineMeta(l)}</div>}
              {l.discountPercent > 0 && <div className="pfMuted">Discount {l.discountPercent}%</div>}
            </td>
            <td className="pfNum">
              {formatQuantity(l.quantity)} {l.unit ?? ""}
            </td>
            <td className="pfNum">{fm(l.rate)}</td>
            <td className="pfNum">{l.taxRate}%</td>
            <td className="pfNum">{fm(l.taxable)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsBox({ m, className = "pfTotals" }: { m: PrintModel; className?: string }) {
  return (
    <div className={className}>
      {totalRows(m).map((r) => (
        <div key={r.label} className={`pfKv${r.grand ? " pfKvGrand" : ""}`}>
          <span>{r.label}</span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

function A4Simple({ m }: { m: PrintModel }) {
  const b = m.business;
  return (
    <>
      <div className="pfSimpleHead">
        <div>
          <div className="pfSimpleBiz">{b.name}</div>
          <div className="pfMuted">{bizAddress(m)}</div>
          <div className="pfMuted">{[b.gstin && `GSTIN ${b.gstin}`, b.phone, b.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="pfRight">
          <div className="pfSimpleTitle">{m.title}</div>
          <div>{m.number}</div>
          <div className="pfMuted">{formatPrintDate(m.date, m.showTime)}</div>
        </div>
      </div>
      <div className="pfSimpleParty">
        <div>
          <div className="pfLabel">{m.party?.label ?? "To"}</div>
          <PartyLines p={m.party} />
        </div>
        <div>
          {m.dueDate && (
            <div className="pfKv">
              <span>Due date</span>
              <strong>{formatPrintDate(m.dueDate)}</strong>
            </div>
          )}
          {m.placeOfSupply && (
            <div className="pfKv">
              <span>Place of supply</span>
              <strong>{m.placeOfSupply}</strong>
            </div>
          )}
          {m.meta.map((x) => (
            <div key={x.label} className="pfKv">
              <span>{x.label}</span>
              <strong>{x.value}</strong>
            </div>
          ))}
        </div>
      </div>
      <SimpleItems m={m} />
      <div className="pfSplit">
        <div>
          <div className="pfLabel">Amount in words</div>
          <div className="pfWords">{words(m)}</div>
          <NotesAndTerms m={m} />
        </div>
        <TotalsBox m={m} />
      </div>
      <Signature m={m} />
      {m.footer && <div className="pfFooterNote">{m.footer}</div>}
    </>
  );
}

function A4Modern({ m }: { m: PrintModel }) {
  const b = m.business;
  return (
    <>
      <div className="pfModernBand">
        <div>
          <div className="pfModernBiz">{b.name}</div>
          <div>{bizAddress(m)}</div>
          <div>{[b.gstin && `GSTIN ${b.gstin}`, b.phone, b.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="pfRight">
          <div className="pfModernTitle">{m.title}</div>
          <div># {m.number}</div>
        </div>
      </div>
      <div className="pfModernInfo">
        <div>
          <div className="pfLabel">{m.party?.label ?? "Billed to"}</div>
          <PartyLines p={m.party} />
        </div>
        <div>
          <div className="pfLabel">Date</div>
          <strong>{formatPrintDate(m.date, m.showTime)}</strong>
          {m.dueDate && (
            <>
              <div className="pfLabel" style={{ marginTop: 6 }}>
                Due
              </div>
              <strong>{formatPrintDate(m.dueDate)}</strong>
            </>
          )}
        </div>
        <div>
          {m.placeOfSupply && (
            <>
              <div className="pfLabel">Place of supply</div>
              <strong>{m.placeOfSupply}</strong>
            </>
          )}
          {m.meta.map((x) => (
            <div key={x.label} style={{ marginTop: 6 }}>
              <div className="pfLabel">{x.label}</div>
              <strong>{x.value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="pfModernItems">
        <SimpleItems m={m} />
      </div>
      <div className="pfSplit">
        <div>
          <div className="pfLabel">Amount in words</div>
          <div className="pfWords">{words(m)}</div>
          <NotesAndTerms m={m} />
        </div>
        <TotalsBox m={m} className="pfTotals pfModernTotals" />
      </div>
      <Signature m={m} />
      {m.footer && <div className="pfFooterNote">{m.footer}</div>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A5                                                                  */
/* ------------------------------------------------------------------ */

function A5Compact({ m }: { m: PrintModel }) {
  const b = m.business;
  const facts = [m.placeOfSupply && `Place of supply: ${m.placeOfSupply}`, ...m.meta.map((x) => `${x.label}: ${x.value}`)].filter(Boolean);
  return (
    <>
      <div className="pfA5Head">
        <div>
          <div className="pfA5Biz">{b.name}</div>
          <div className="pfMuted">{bizAddress(m)}</div>
          {b.gstin && <div className="pfMuted">GSTIN: {b.gstin}</div>}
        </div>
        <div className="pfRight">
          <div className="pfA5Title">{m.title}</div>
          <div>{m.number}</div>
          <div className="pfMuted">{formatPrintDate(m.date, m.showTime)}</div>
        </div>
      </div>
      <div className="pfA5Party">
        <div>
          <span className="pfLabel">{m.party?.label ?? "To"}: </span>
          <strong>{m.party?.name}</strong>
          {m.party?.gstin ? ` · GSTIN ${m.party.gstin}` : ""}
          {m.party?.phone ? ` · ${m.party.phone}` : ""}
        </div>
        {facts.length > 0 && <div className="pfMuted">{facts.join(" · ")}</div>}
      </div>
      <SimpleItems m={m} numbered={false} />
      <div className="pfSplit">
        <div>
          <div className="pfLabel">Amount in words</div>
          <div className="pfWords">{words(m)}</div>
          {m.payments.length > 0 && <div style={{ marginTop: 4 }}>Paid: {m.payments.map((p) => `${p.mode} ${fm(p.amount)}`).join(", ")}</div>}
          {m.refundNote && <div>{m.refundNote}</div>}
        </div>
        <TotalsBox m={m} />
      </div>
      <Signature m={m} />
      {m.footer && <div className="pfFooterNote">{m.footer}</div>}
    </>
  );
}

/** Counter bill on A5: receipt contents with room to breathe. */
function A5Receipt({ m }: { m: PrintModel }) {
  const b = m.business;
  return (
    <>
      <div className="pfCenter pfA5RcptHead">
        <div className="pfA5Biz">{b.name}</div>
        {bizAddress(m) && <div className="pfMuted">{bizAddress(m)}</div>}
        <div className="pfMuted">{[b.gstin && `GSTIN ${b.gstin}`, b.phone && `Ph ${b.phone}`].filter(Boolean).join(" · ")}</div>
        {m.header && <div className="pfMuted pfPre">{m.header}</div>}
        <div className="pfA5Title" style={{ marginTop: 6 }}>
          {m.title}
        </div>
      </div>
      <div className="pfSpread pfA5Meta">
        <span>
          <strong>{m.number}</strong>
        </span>
        <span>{formatPrintDate(m.date, m.showTime)}</span>
      </div>
      <div className="pfSpread pfA5Meta">
        <span>
          {m.party?.name}
          {m.party?.phone ? ` · ${m.party.phone}` : ""}
        </span>
        <span>{m.meta.map((x) => `${x.label}: ${x.value}`).join(" · ")}</span>
      </div>
      <table className="pfItems">
        <thead>
          <tr>
            <th style={{ width: "1.6rem" }}>#</th>
            <th>Item</th>
            <th className="pfNum">Qty</th>
            <th className="pfNum">Price</th>
            <th className="pfNum">Disc</th>
            <th className="pfNum">GST</th>
            <th className="pfNum">Amount</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i}>
              <td className="pfMuted">{i + 1}</td>
              <td>
                {l.name}
                {lineMeta(l, { hsn: true }) && <div className="pfMuted">{lineMeta(l, { hsn: true })}</div>}
              </td>
              <td className="pfNum">{formatQuantity(l.quantity)}</td>
              <td className="pfNum">{fm(l.rate)}</td>
              <td className="pfNum">{l.discountPercent > 0 ? `${l.discountPercent}%` : ""}</td>
              <td className="pfNum">{l.taxRate}%</td>
              <td className="pfNum">{fm(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pfSplit">
        <div>
          {m.payments.length > 0 && (
            <>
              <div className="pfLabel">Payment</div>
              {m.payments.map((p, i) => (
                <div key={i}>
                  {p.mode}: ₹{fm(p.amount)}
                </div>
              ))}
              {m.change && <div>Change: ₹{fm(m.change)}</div>}
            </>
          )}
          {m.refundNote && <div>{m.refundNote}</div>}
          <div className="pfLabel" style={{ marginTop: 6 }}>
            Amount in words
          </div>
          <div className="pfWords">{words(m)}</div>
        </div>
        <TotalsBox m={m} />
      </div>
      {m.footer && <div className="pfFooterNote pfCenter">{m.footer}</div>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const RENDERERS: Record<LayoutId, (p: { m: PrintModel }) => ReactNode> = {
  "thermal-80-standard": ThermalStandard,
  "thermal-80-detailed": ThermalDetailed,
  "thermal-80-compact": ThermalCompact,
  "thermal-58-standard": ThermalStandard,
  "a4-standard": A4Standard,
  "a4-gst-detailed": A4GstClassic,
  "a4-simple": A4Simple,
  "a4-modern": A4Modern,
  "a5-compact": A5Compact,
  "a5-receipt": A5Receipt,
};

const SIZE_CLASS = {
  THERMAL_58: "pfThermal pfThermal58",
  THERMAL_80: "pfThermal pfThermal80",
  A5: "pfPaper pfA5",
  A4: "pfPaper pfA4",
} as const;

/** One printable sheet in the given layout. */
export function PrintSheet({ layoutId, model }: { layoutId: LayoutId; model: PrintModel }) {
  const layout = PRINT_LAYOUTS[layoutId] ?? PRINT_LAYOUTS["a4-standard"];
  const Render = RENDERERS[layout.id];
  return (
    <div className={`pfSheet ${SIZE_CLASS[layout.size]}`} data-layout={layout.id}>
      <Render m={model} />
    </div>
  );
}
