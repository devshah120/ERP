"use client";

import type { PeriodKey } from "@/lib/analytics/types";

export interface PeriodState {
  period: PeriodKey;
  fromDate: string;
  toDate: string;
}

const PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "year", label: "This Year" },
  { key: "custom", label: "Custom" },
];

/** Builds the query string the analytics endpoints expect. */
export function periodQuery(state: PeriodState): string {
  const params = new URLSearchParams({ period: state.period });
  if (state.period === "custom") {
    params.set("fromDate", state.fromDate);
    params.set("toDate", state.toDate);
  }
  return params.toString();
}

/** A custom range is only usable once both ends are filled in. */
export function isPeriodReady(state: PeriodState): boolean {
  return state.period !== "custom" || Boolean(state.fromDate && state.toDate);
}

export default function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
}) {
  return (
    <div className="periodPicker">
      <div className="periodTabs" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`periodTab ${value.period === p.key ? "periodTabActive" : ""}`}
            onClick={() => onChange({ ...value, period: p.key })}
          >
            {p.label}
          </button>
        ))}
      </div>

      {value.period === "custom" && (
        <div className="periodCustom">
          <input
            type="date"
            aria-label="From date"
            value={value.fromDate}
            max={value.toDate || undefined}
            onChange={(e) => onChange({ ...value, fromDate: e.target.value })}
          />
          <span>to</span>
          <input
            type="date"
            aria-label="To date"
            value={value.toDate}
            min={value.fromDate || undefined}
            onChange={(e) => onChange({ ...value, toDate: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
