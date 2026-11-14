"use client";

import { useState } from "react";
import type { PeriodState } from "@/components/analytics/PeriodPicker";
import type { PeriodKey } from "@/lib/analytics/types";
import { usePopover } from "@/components/ui/usePopover";
import { IconCalendar, IconTrendUp } from "@/components/icons";

/* ------------------------------------------------------------------ */
/* Date range pill                                                     */
/* ------------------------------------------------------------------ */

const PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
];

export function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** "01 Nov 2026 – 30 Nov 2026" with a preset/custom picker behind it. */
export function DateRangePill({
  value,
  onChange,
  range,
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  range?: { fromDate: string; toDate: string };
}) {
  const { open, toggle, close, ref } = usePopover<HTMLDivElement>();
  const [from, setFrom] = useState(value.fromDate);
  const [to, setTo] = useState(value.toDate);

  return (
    <div className="menuWrap" ref={ref}>
      <button type="button" className="dateRangePill" onClick={toggle} aria-expanded={open} aria-haspopup="dialog">
        <IconCalendar />
        {range ? `${fmtDay(range.fromDate)} – ${fmtDay(range.toDate)}` : "Select dates"}
      </button>
      {open && (
        <div className="menu menuLeft" role="dialog" aria-label="Date range" style={{ minWidth: "17rem" }}>
          <div className="menuLabel">Quick ranges</div>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="menuItem"
              aria-pressed={value.period === p.key}
              style={value.period === p.key ? { background: "var(--accent-soft)", color: "var(--accent-text)", fontWeight: 600 } : undefined}
              onClick={() => {
                onChange({ ...value, period: p.key });
                close();
              }}
            >
              {p.label}
            </button>
          ))}
          <div className="menuSep" />
          <div className="menuLabel">Custom range</div>
          <form
            style={{ display: "grid", gap: "0.5rem", padding: "0.25rem 0.625rem 0.5rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!from || !to) return;
              onChange({ period: "custom", fromDate: from, toDate: to });
              close();
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <input className="input" type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              <input className="input" type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button type="submit" className="button buttonPrimary buttonSm" disabled={!from || !to}>
              Apply range
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function Delta({ current, previous, goodWhen = "up" }: { current: string; previous: string; goodWhen?: "up" | "down" }) {
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0 && cur === 0) return <span className="delta deltaFlat" title="No change vs previous period">— 0.00%</span>;
  // From nothing to something reads as a full 100% move (the true ratio is undefined).
  const fromZero = prev === 0;
  const pct = fromZero ? (cur > 0 ? 100 : -100) : ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct > 0;
  const good = pct === 0 ? null : up === (goodWhen === "up");
  const cls = good === null ? "deltaFlat" : good ? "deltaUp" : "deltaDown";
  return (
    <span className={`delta ${cls}`} title={fromZero ? "Nothing in the previous period to compare with" : `Previous period: ${previous}`}>
      <IconTrendUp style={up ? undefined : { transform: "scaleY(-1)" }} aria-hidden />
      {Math.abs(pct).toFixed(2)}%
      <span className="srOnly">{up ? "up" : "down"} vs previous period</span>
    </span>
  );
}
