import type { ReactNode } from "react";

/**
 * Frame for every signed-out page: a dark marbled background with a white
 * card in the middle — an inset visual panel (logo, big headline, short
 * pitch) on the left and the task on the right. Below 900px the panel is
 * hidden and the card holds just the form.
 */
export default function AuthLayout({
  children,
  topRight,
  wide = false,
  headline = DEFAULT_HEADLINE,
  lead = DEFAULT_LEAD,
  tagline = "Your business, in one place.",
}: {
  children: ReactNode;
  topRight?: ReactNode;
  wide?: boolean;
  /** The big uppercase lines on the visual panel. */
  headline?: string[];
  /** The paragraph under the headline. */
  lead?: string;
  /** The short closing line under the paragraph. */
  tagline?: string;
}) {
  return (
    <div className="auPage">
      <Marble seed={7} tone="light" className="auPageTexture" />
      <div className={`auCard ${wide ? "auCardWide" : ""}`}>
        <aside className="auVisual" aria-hidden>
          <Marble seed={21} tone="brand" className="auVisualTexture" />
          <div className="auLogo">NEXORA</div>
          <div className="auPitch">
            <h2>
              {headline.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h2>
            <p>{lead}</p>
            {tagline && <p className="auTagline">{tagline}</p>}
          </div>
        </aside>

        <main className="auBody">
          {topRight && <div className="auTop">{topRight}</div>}
          <div className="auFormWrap">
            <div className="auMobileLogo">NEXORA</div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

const DEFAULT_HEADLINE = ["Every order,", "piece & rupee", "accounted for."];
const DEFAULT_LEAD =
  "Quotations, stock, POS and GST in one connected system — built for garment manufacturers and traders.";

/** Colours for each texture: background gradient stops, glow and vein tints (RGB 0–1). */
const TONES = {
  // Soft, airy page background: pale blue with faint white-blue veins.
  light: { stops: ["#f4f9fd", "#e3eff9", "#cfe2f3"], glow: [0.62, 0.8, 0.95], glowA: 0.35, vein: [1, 1, 1], veinA: 0.9 },
  // The inset panel in NEXORA brand blue, with bright foam veins.
  brand: { stops: ["#1d9be0", "#0a6fae", "#0a3f73"], glow: [0.55, 0.82, 1], glowA: 0.3, vein: [0.9, 0.97, 1], veinA: 0.75 },
} as const;

/**
 * Marbled "aerial water" texture drawn with SVG noise: thin foam veins where
 * the noise crosses a narrow band, a soft glow around them, over a gradient.
 * No image file to load.
 */
function Marble({ seed, className, tone }: { seed: number; className: string; tone: keyof typeof TONES }) {
  const id = `marble-${tone}-${seed}`;
  const t = TONES[tone];
  const g = t.glowA;
  const tint = (c: readonly number[]) => `0 0 0 0 ${c[0]}  0 0 0 0 ${c[1]}  0 0 0 0 ${c[2]}  1 0 0 0 0`;
  return (
    <svg className={className} viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <radialGradient id={`${id}-bg`} cx="30%" cy="20%" r="95%">
          <stop offset="0" stopColor={t.stops[0]} />
          <stop offset="0.55" stopColor={t.stops[1]} />
          <stop offset="1" stopColor={t.stops[2]} />
        </radialGradient>
        <filter id={`${id}-glow`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.0028 0.004" numOctaves="5" seed={seed} />
          <feColorMatrix type="matrix" values={tint(t.glow)} />
          <feComponentTransfer>
            <feFuncA type="table" tableValues={`0 0 0 ${g * 0.3} ${g} ${g * 0.3} 0 0 0`} />
          </feComponentTransfer>
        </filter>
        <filter id={`${id}-veins`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.0028 0.004" numOctaves="7" seed={seed} />
          <feColorMatrix type="matrix" values={tint(t.vein)} />
          <feComponentTransfer>
            <feFuncA type="table" tableValues={`0 0 0 0 0 0 0 0 0 0 0.02 ${t.veinA} 0.02 0 0 0 0 0 0 0 0`} />
          </feComponentTransfer>
        </filter>
      </defs>
      <rect width="1200" height="800" fill={`url(#${id}-bg)`} />
      <rect width="1200" height="800" filter={`url(#${id}-glow)`} />
      <rect width="1200" height="800" filter={`url(#${id}-veins)`} />
    </svg>
  );
}
