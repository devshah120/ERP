import { stateTaxLabel } from "@/lib/gst/supply";
import { amountInWords } from "@/lib/documents/numberToWords";
import type { DocumentUi } from "@/lib/documents/ui";

interface PrintLine {
  itemCode: string;
  itemName: string;
  variantSku?: string;
  description?: string;
  quantity: number;
  unitName?: string;
  rate: string;
  discountAmount: string;
  taxRatePercent: number;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

export interface PrintDoc {
  documentNumber: string;
  documentDate: string;
  intraState: boolean;
  isUnionTerritory?: boolean;
  placeOfSupplyName?: string;
  placeOfSupplyCode?: string;
  party?: { name: string; code: string; gstin?: string; phone?: string; email?: string };
  billingAddress?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };
  shippingAddress?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };
  lines: PrintLine[];
  totals: Record<string, string>;
  notes?: string;
  termsAndConditions?: string;
  dueDate?: string;
  paymentTerms?: string;
  paymentMode?: string;
  vehicleNumber?: string;
  ewayBillNumber?: string;
  sourceDocuments?: { docNumber: string }[];
}

export interface PrintBusiness {
  name: string;
  gstin?: string;
  state?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  currency?: string;
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function addressLines(a?: PrintDoc["billingAddress"]) {
  if (!a) return [];
  return [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(", ")].filter(
    Boolean
  ) as string[];
}

/**
 * A4 document sheet. Rendered on the server so the printable content is in
 * the initial HTML — a print view that waits on a client fetch would show a
 * blank/loading page if the user hits Print too quickly.
 */
export default function DocumentPrintSheet({
  doc,
  business,
  config,
}: {
  doc: PrintDoc;
  business: PrintBusiness;
  config: DocumentUi;
}) {
  const intra = doc.intraState;
  const stateLabel = stateTaxLabel(Boolean(doc.isUnionTerritory));
  const currencyWord = business.currency && business.currency !== "INR" ? business.currency : "Rupees";

  return (
    <div className="printSheet">
      <div className="printHeader">
        <div>
          <div className="printCompany">{business.name}</div>
          {business.address && <div className="printMeta">{business.address}</div>}
          {(business.city || business.state) && (
            <div className="printMeta">{[business.city, business.state].filter(Boolean).join(", ")}, India</div>
          )}
          {business.gstin && <div className="printMeta">GSTIN: {business.gstin}</div>}
          {business.phone && <div className="printMeta">Phone: {business.phone}</div>}
        </div>
        <div className="printDocTitle">
          <div className="printDocName">{config.singular}</div>
          <div className="printMeta">
            <strong>No:</strong> {doc.documentNumber}
          </div>
          <div className="printMeta">
            <strong>Date:</strong> {formatDate(doc.documentDate)}
          </div>
          {doc.dueDate && (
            <div className="printMeta">
              <strong>Due:</strong> {formatDate(doc.dueDate)}
            </div>
          )}
        </div>
      </div>

      <div className="printParties">
        <div className="printPartyBox">
          <div className="printBoxLabel">{config.partyField === "customer" ? "Bill To" : "Supplier"}</div>
          <div className="printPartyName">{doc.party?.name ?? "—"}</div>
          {addressLines(doc.billingAddress).map((l, i) => (
            <div key={i} className="printMeta">
              {l}
            </div>
          ))}
          {doc.party?.gstin && <div className="printMeta">GSTIN: {doc.party.gstin}</div>}
          {doc.party?.phone && <div className="printMeta">Phone: {doc.party.phone}</div>}
        </div>

        <div className="printPartyBox">
          <div className="printBoxLabel">{config.partyField === "customer" ? "Ship To" : "Deliver To"}</div>
          {addressLines(doc.shippingAddress ?? doc.billingAddress).map((l, i) => (
            <div key={i} className="printMeta">
              {l}
            </div>
          ))}
          <div className="printMeta" style={{ marginTop: "0.35rem" }}>
            <strong>Place of Supply:</strong>{" "}
            {doc.placeOfSupplyName ? `${doc.placeOfSupplyName} (${doc.placeOfSupplyCode})` : "—"}
          </div>
          <div className="printMeta">
            <strong>Supply Type:</strong> {intra ? "Intra-state" : "Inter-state"}
          </div>
          {doc.vehicleNumber && (
            <div className="printMeta">
              <strong>Vehicle:</strong> {doc.vehicleNumber}
            </div>
          )}
          {doc.ewayBillNumber && (
            <div className="printMeta">
              <strong>E-way Bill:</strong> {doc.ewayBillNumber}
            </div>
          )}
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
                <th style={{ width: "5rem" }}>{stateLabel}</th>
              </>
            ) : (
              <th style={{ width: "6rem" }}>IGST</th>
            )}
            <th style={{ width: "6.5rem" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <strong>{l.itemName}</strong>
                <div className="printLineMeta">
                  {l.itemCode}
                  {l.variantSku ? ` · ${l.variantSku}` : ""}
                  {l.description ? ` · ${l.description}` : ""}
                </div>
              </td>
              <td className="num">
                {l.quantity} {l.unitName ?? ""}
              </td>
              <td className="num">{l.rate}</td>
              <td className="num">{l.discountAmount}</td>
              <td className="num">{l.taxableAmount}</td>
              <td className="num">{l.taxRatePercent}</td>
              {intra ? (
                <>
                  <td className="num">{l.cgstAmount}</td>
                  <td className="num">{l.sgstAmount}</td>
                </>
              ) : (
                <td className="num">{l.igstAmount}</td>
              )}
              <td className="num">{l.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="printFooter">
        <div className="printFooterLeft">
          <div className="printBoxLabel">Amount in words</div>
          <div className="printWords">{amountInWords(doc.totals.grandTotal, currencyWord)}</div>

          {doc.paymentTerms && (
            <div className="printMeta" style={{ marginTop: "0.5rem" }}>
              <strong>Payment terms:</strong> {doc.paymentTerms}
            </div>
          )}
          {doc.paymentMode && (
            <div className="printMeta">
              <strong>Payment mode:</strong> {doc.paymentMode}
            </div>
          )}
          {doc.sourceDocuments && doc.sourceDocuments.length > 0 && (
            <div className="printMeta">
              <strong>Against:</strong> {doc.sourceDocuments.map((s) => s.docNumber).join(", ")}
            </div>
          )}
          {doc.notes && (
            <div style={{ marginTop: "0.5rem" }}>
              <div className="printBoxLabel">Notes</div>
              <div className="printMeta">{doc.notes}</div>
            </div>
          )}
          {doc.termsAndConditions && (
            <div style={{ marginTop: "0.5rem" }}>
              <div className="printBoxLabel">Terms &amp; Conditions</div>
              <div className="printMeta">{doc.termsAndConditions}</div>
            </div>
          )}
        </div>

        <div className="printTotals">
          <div className="printTotalRow">
            <span>Sub total</span>
            <span>{doc.totals.subTotal}</span>
          </div>
          <div className="printTotalRow">
            <span>Discount</span>
            <span>-{doc.totals.totalDiscount}</span>
          </div>
          <div className="printTotalRow">
            <span>Taxable value</span>
            <span>{doc.totals.taxableAmount}</span>
          </div>
          {intra ? (
            <>
              <div className="printTotalRow">
                <span>CGST</span>
                <span>{doc.totals.cgstAmount}</span>
              </div>
              <div className="printTotalRow">
                <span>{stateLabel}</span>
                <span>{doc.totals.sgstAmount}</span>
              </div>
            </>
          ) : (
            <div className="printTotalRow">
              <span>IGST</span>
              <span>{doc.totals.igstAmount}</span>
            </div>
          )}
          {Number(doc.totals.shippingCharge) !== 0 && (
            <div className="printTotalRow">
              <span>Shipping</span>
              <span>{doc.totals.shippingCharge}</span>
            </div>
          )}
          {Number(doc.totals.roundOff) !== 0 && (
            <div className="printTotalRow">
              <span>Round off</span>
              <span>{doc.totals.roundOff}</span>
            </div>
          )}
          <div className="printTotalRow grand">
            <span>Grand Total</span>
            <span>{doc.totals.grandTotal}</span>
          </div>
        </div>
      </div>

      <div className="printSignature">
        <div className="printMeta">This is a computer-generated document.</div>
        <div className="printSignBox">
          <div className="printMeta">
            For <strong>{business.name}</strong>
          </div>
          <div className="printSignLine">Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}
