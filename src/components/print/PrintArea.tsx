"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PAPER_SIZES, PRINT_LAYOUTS, type LayoutId, type PaperSize } from "@/lib/printFormats/catalog";
import { PrintSheet } from "./layouts";
import type { PrintModel } from "./model";

const PX_PER_MM = 96 / 25.4;

/**
 * The @page rule for a paper size.
 *
 * Thermal layouts deliberately set no page size. Chrome honours a custom
 * size only for "Save as PDF"; a real printer (thermal driver, A4 laser,
 * Microsoft Print to PDF) keeps its own paper and Chrome then shrinks and
 * centres the page on it, with the date/URL header around it. With
 * `size: auto` the printer's paper is used as-is, and zero margins leave no
 * room for Chrome's header and footer, so the receipt starts at the top of
 * the roll and the printer cuts after it. (`size: auto` also overrides the
 * app-wide A4 rule in globals.css.)
 */
export function pageCss(size: PaperSize): string {
  if (size === "A4") return "@page { size: A4; margin: 8mm; }";
  if (size === "A5") return "@page { size: A5; margin: 6mm; }";
  return "@page { size: auto; margin: 0; }";
}

/** Tracks an element's rendered height (for scaled previews). */
function useHeight<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const ro = new ResizeObserver(() => setHeight(el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return [ref, height] as const;
}

/**
 * Wraps a server-rendered sheet on the print page and adds the matching
 * @page rule. The sheet itself stays a server component (children).
 */
export function PrintArea({ size, children }: { size: PaperSize; children: ReactNode }) {
  return (
    <div className="pfArea">
      <style>{`@media print { ${pageCss(size)} }`}</style>
      {children}
    </div>
  );
}

/**
 * A copy of the sheet mounted on <body>, invisible on screen, that is the
 * only thing on the page while `printPortal()` prints. Lets a screen like
 * the POS register print a receipt without leaving the page.
 */
export function PrintPortal({ layoutId, model }: { layoutId: LayoutId; model: PrintModel }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Portals need document.body, which only exists after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="pfPrintRoot" aria-hidden data-paper={PRINT_LAYOUTS[layoutId].size}>
      <PrintSheet layoutId={layoutId} model={model} />
    </div>,
    document.body
  );
}

/**
 * Prints only the mounted PrintPortal. Its @page rule is added just for this
 * print, so printing the rest of the screen keeps the normal paper size.
 */
export function printPortal() {
  const root = document.querySelector<HTMLElement>(".pfPrintRoot");
  const size = (root?.dataset.paper ?? "THERMAL_80") as PaperSize;
  const style = document.createElement("style");
  style.textContent = `@media print { ${pageCss(size)} }`;
  document.head.appendChild(style);
  document.body.classList.add("printingPortal");
  const done = () => {
    document.body.classList.remove("printingPortal");
    style.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  // Browsers without afterprint still need the class cleared.
  setTimeout(done, 1500);
}

/**
 * The sheet scaled down to `width` px: thumbnails on the settings screen
 * and the receipt shown after a sale. `maxHeight` crops to the top of the
 * page, as a thumbnail should.
 */
export function ScaledSheet({
  layoutId,
  model,
  width,
  maxHeight,
  className,
}: {
  layoutId: LayoutId;
  model: PrintModel;
  width: number;
  maxHeight?: number;
  className?: string;
}) {
  const naturalWidth = PAPER_SIZES[PRINT_LAYOUTS[layoutId].size].widthMm * PX_PER_MM;
  const scale = Math.min(1, width / naturalWidth);
  const [ref, height] = useHeight<HTMLDivElement>(true);
  const scaledHeight = height ? height * scale : undefined;
  return (
    <div
      className={`pfScaled ${className ?? ""}`}
      style={{ width: naturalWidth * scale, height: maxHeight ? Math.min(maxHeight, scaledHeight ?? maxHeight) : scaledHeight }}
      aria-hidden
    >
      <div ref={ref} style={{ width: naturalWidth, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <PrintSheet layoutId={layoutId} model={model} />
      </div>
    </div>
  );
}
