import type { ReactNode } from "react";
import { IconBrandMark, IconCheckCircle, IconShield, IconBox, IconTrendUp } from "@/components/icons";

/**
 * Split-screen frame for every signed-out page: product story on the left,
 * the task on the right. The left panel collapses away below 960px so the
 * form is never squeezed on a phone or tablet.
 */
export default function AuthLayout({
  children,
  topRight,
  wide = false,
}: {
  children: ReactNode;
  topRight?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="authShell">
      <aside className="authAside" aria-hidden>
        <div className="authBrand">
          <span className="authBrandMark">
            <IconBrandMark />
          </span>
          Garment ERP
        </div>

        <div className="authPitch">
          <h2>Every order, piece and rupee — accounted for.</h2>
          <p>
            Quotations to cash, purchase to stock, GST to the paisa. One connected system for garment
            manufacturers and traders.
          </p>

          <div className="authPreview">
            <div className="authPreviewCaption">How a sale moves through the system</div>
            <div className="authPreviewRow">
              <span>Quotation → Sales Order</span>
              <span>converted</span>
              <span className="authPreviewChip info">Linked</span>
            </div>
            <div className="authPreviewRow">
              <span>Delivery Challan</span>
              <span>stock out</span>
              <span className="authPreviewChip warn">Dispatched</span>
            </div>
            <div className="authPreviewRow">
              <span>Tax Invoice · CGST + SGST</span>
              <span>receivable</span>
              <span className="authPreviewChip">Posted</span>
            </div>
          </div>

          <div className="authFeatures">
            <div className="authFeature">
              <IconTrendUp />
              <span>
                <strong>Connected documents.</strong> Conversions carry lines forward, so nothing is over-delivered
                or invoiced twice.
              </span>
            </div>
            <div className="authFeature">
              <IconBox />
              <span>
                <strong>Stock that actually moves.</strong> Size and colour variants, an append-only ledger, no
                negative stock.
              </span>
            </div>
            <div className="authFeature">
              <IconShield />
              <span>
                <strong>Auditable by design.</strong> Posted documents lock; every change is logged with before
                and after values.
              </span>
            </div>
          </div>
        </div>

        <div className="authAsideFoot">
          <IconCheckCircle style={{ verticalAlign: "-2px", marginRight: "0.35rem" }} />
          Isolated per business · Encrypted sessions · Role-based access
        </div>
      </aside>

      <main className="authMain">
        <div className="authMainTop">
          <div className="authBrand">
            <span className="authBrandMark">
              <IconBrandMark />
            </span>
            Garment ERP
          </div>
          {topRight}
        </div>
        <div className="authContent">
          <div className={`authCard ${wide ? "wide" : ""}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}
