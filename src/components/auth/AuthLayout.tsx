import type { ReactNode } from "react";

/**
 * Split-screen frame for every signed-out page: an illustrated welcome panel
 * on the left (big gold NEXORA greeting), the task on the right with the logo
 * on top. The left panel collapses away below 960px so the form is never
 * squeezed on a phone or tablet.
 */
export default function AuthLayout({
  children,
  topRight,
  wide = false,
  eyebrow,
  lead,
}: {
  children: ReactNode;
  topRight?: ReactNode;
  wide?: boolean;
  /** The small line above the big gold NEXORA, e.g. "Get started with". */
  eyebrow?: string;
  /** The sentence under it. */
  lead?: string;
}) {
  return (
    <div className="authShell">
      <WelcomeAside eyebrow={eyebrow} lead={lead} />
      <main className="authMain authMainWelcome">
        {topRight && <div className="authMainTop">{topRight}</div>}
        <div className="authContent">
          <div className={`authCard authCardWelcome ${wide ? "wide" : ""}`}>
            <div className="authLogo">NEXORA</div>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sign-in illustration                                                */
/* ------------------------------------------------------------------ */

/** What NEXORA does — real product capabilities, not marketing numbers. */
const HIGHLIGHTS = [
  { big: "GST", small: "CGST · SGST · IGST billing" },
  { big: "POS", small: "cash, UPI & card counter" },
  { big: "Live", small: "stock by size & colour" },
];

const PETALS = Array.from({ length: 16 }, (_, i) => i * (360 / 16));
const DOTS = Array.from({ length: 24 }, (_, i) => i * (360 / 24));

const DEFAULT_LEAD = "Every order, piece and rupee — accounted for. One connected system for garment manufacturers and traders.";

function WelcomeAside({ eyebrow = "Welcome to", lead = DEFAULT_LEAD }: { eyebrow?: string; lead?: string }) {
  return (
    <aside className="authAside awAside" aria-hidden>
      {/* hanging garment price tags */}
      <svg className="awTags" viewBox="0 0 360 150" fill="none">
        <defs>
          <linearGradient id="awGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f6dfa4" />
            <stop offset="1" stopColor="#c99a45" />
          </linearGradient>
        </defs>
        {[
          { x: 60, len: 38, rot: -6, d: "0s" },
          { x: 180, len: 12, rot: 4, d: "-1.4s" },
          { x: 300, len: 52, rot: -3, d: "-2.6s" },
        ].map((t) => (
          <g key={t.x} className="awTag" style={{ transformOrigin: `${t.x}px 0px`, animationDelay: t.d }}>
            <line x1={t.x} y1="0" x2={t.x} y2={t.len} stroke="#e8c983" strokeOpacity="0.7" strokeWidth="1.2" />
            <g transform={`rotate(${t.rot} ${t.x} ${t.len})`}>
              <path
                d={`M${t.x - 15} ${t.len + 12} L${t.x} ${t.len} L${t.x + 15} ${t.len + 12} V${t.len + 62} a6 6 0 0 1 -6 6 H${t.x - 9} a6 6 0 0 1 -6 -6 Z`}
                fill="url(#awGold)"
              />
              <circle cx={t.x} cy={t.len + 13} r="3.2" fill="#0b3a5e" />
              <path d={`M${t.x - 8} ${t.len + 32} H${t.x + 8} M${t.x - 8} ${t.len + 41} H${t.x + 5} M${t.x - 8} ${t.len + 50} H${t.x + 7}`} stroke="#8a6a2a" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
            </g>
          </g>
        ))}
      </svg>

      {/* sparkle */}
      <svg className="awSpark" viewBox="0 0 60 60" fill="none">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="30" y1="8" x2="30" y2={i % 2 ? 16 : 20} stroke="#f2d48f" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${i * 30} 30 30)`} />
        ))}
      </svg>

      {/* glowing mandala */}
      <span className="awGlow" />
      <svg className="awMandala" viewBox="0 0 400 400" fill="none">
        <g stroke="rgba(242, 212, 143, 0.32)" strokeWidth="1.2">
          <circle cx="200" cy="200" r="190" />
          <circle cx="200" cy="200" r="150" />
          <circle cx="200" cy="200" r="104" />
          <circle cx="200" cy="200" r="62" />
          {PETALS.map((a) => (
            <ellipse key={a} cx="200" cy="72" rx="16" ry="44" transform={`rotate(${a} 200 200)`} />
          ))}
          {PETALS.map((a) => (
            <path key={`l${a}`} d="M200 150 Q214 128 200 104 Q186 128 200 150 Z" transform={`rotate(${a + 11.25} 200 200)`} />
          ))}
        </g>
        <g fill="rgba(242, 212, 143, 0.45)">
          {DOTS.map((a) => (
            <circle key={a} cx="200" cy="18" r="3" transform={`rotate(${a} 200 200)`} />
          ))}
        </g>
      </svg>
      <span className="awCore" />

      <div className="awPitch">
        <p className="awEyebrow">{eyebrow}</p>
        <h2 className="awDisplay">NEXORA</h2>
        <p className="awLead">{lead}</p>
        <div className="awStats">
          {HIGHLIGHTS.map((h) => (
            <div key={h.big}>
              <strong>{h.big}</strong>
              <small>{h.small}</small>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
