import { canEncodeCode128, code128Widths } from "@/lib/barcode/code128";

const QUIET = 10; // modules of white space each side, as scanners expect

/** A Code 128 barcode as crisp SVG bars; it stretches to its box's width and height. */
export default function BarcodeSvg({ value, className }: { value: string; className?: string }) {
  if (!canEncodeCode128(value)) {
    return <div className={`barcodeInvalid ${className ?? ""}`}>Can&apos;t encode “{value}”</div>;
  }
  const widths = code128Widths(value);
  const total = widths.reduce((a, b) => a + b, 0) + QUIET * 2;
  let x = QUIET;
  const bars: { x: number; w: number }[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <svg className={className} viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`} shapeRendering="crispEdges">
      <rect width={total} height="40" fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y="0" width={b.w} height="40" fill="#000" />
      ))}
    </svg>
  );
}
