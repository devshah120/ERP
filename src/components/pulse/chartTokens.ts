/**
 * Chart colours for the Business Pulse dashboard.
 *
 * ECharts paints on a canvas, which cannot resolve CSS variables, so the
 * values are read from the `--chart-*` tokens in globals.css at render time.
 * The fallbacks are the same values, used only when no document exists.
 *
 * Categorical order (identity) and the blue ramp (magnitude / ordered bands)
 * were checked with the dataviz palette validator against the white card
 * surface: categorical passes CVD and normal-vision separation; slots 3–5
 * sit below 3:1 contrast, so every chart using them also lists its values
 * in text beside the mark.
 */

const FALLBACK = {
  cat: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"],
  ramp: ["#cde2fb", "#9ec5f4", "#86b6ef", "#5598e7", "#3987e5", "#2a78d6", "#1c5cab", "#104281", "#0d366b"],
  other: "#a8a7a1",
  ink: "#111827",
  inkSecondary: "#64748b",
  inkMuted: "#94a3b8",
  grid: "#eef0f3",
  axis: "#d1d5db",
  surface: "#ffffff",
  tooltipBg: "#111827",
  tooltipInk: "#ffffff",
};

export type ChartTokens = typeof FALLBACK;

let cache: ChartTokens | null = null;

export function chartTokens(): ChartTokens {
  if (cache) return cache;
  if (typeof document === "undefined") return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
  cache = {
    cat: FALLBACK.cat.map((fb, i) => v(`--chart-${i + 1}`, fb)),
    ramp: FALLBACK.ramp.map((fb, i) => v(`--chart-ramp-${i + 1}`, fb)),
    other: v("--chart-other", FALLBACK.other),
    ink: v("--text", FALLBACK.ink),
    inkSecondary: v("--text-secondary", FALLBACK.inkSecondary),
    inkMuted: v("--text-tertiary", FALLBACK.inkMuted),
    grid: v("--border-subtle", FALLBACK.grid),
    axis: v("--border-strong", FALLBACK.axis),
    surface: v("--surface", FALLBACK.surface),
    tooltipBg: v("--text", FALLBACK.tooltipBg),
    tooltipInk: v("--text-inverse", FALLBACK.tooltipInk),
  };
  return cache;
}

/** Shared tooltip chrome so every chart's hover layer looks the same. */
export function tooltipBase(t: ChartTokens) {
  return {
    backgroundColor: t.tooltipBg,
    borderColor: "transparent",
    borderRadius: 8,
    padding: [8, 10] as [number, number],
    textStyle: { color: t.tooltipInk, fontSize: 12, fontFamily: "inherit" },
    extraCssText: "box-shadow: 0 8px 24px -6px rgba(16,24,40,.35);",
  };
}

/** One tooltip row: swatch, name, value. */
export function tipRow(color: string, name: string, value: string) {
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:3px">
    <span style="width:8px;height:8px;border-radius:2px;background:${color}"></span>
    <span style="opacity:.75">${name}</span>
    <strong style="margin-left:auto;padding-left:12px">${value}</strong>
  </div>`;
}

export function tipTitle(text: string) {
  return `<div style="font-weight:600;margin-bottom:2px">${text}</div>`;
}

/** Escape text that came from user data (party, item, category names) before it goes into tooltip HTML. */
export function esc(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
