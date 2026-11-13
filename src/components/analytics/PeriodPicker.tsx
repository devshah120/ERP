"use client";

import type { PeriodKey } from "@/lib/analytics/types";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

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
      <ToggleButtonGroup
        value={value.period}
        exclusive
        onChange={(_, nextPeriod: PeriodKey | null) => {
          if (nextPeriod) onChange({ ...value, period: nextPeriod });
        }}
        size="small"
        aria-label="Date range"
        sx={{
          flexWrap: "wrap",
          bgcolor: "background.paper",
          borderRadius: 2,
          "& .MuiToggleButton-root": {
            textTransform: "none",
            fontSize: "0.8125rem",
            px: 1.5,
            py: 0.6,
            fontWeight: 500,
            borderColor: "divider",
            color: "text.secondary",
            "&:hover": {
              bgcolor: "var(--accent-soft, #e7f3fb)",
              color: "text.primary",
            },
            "&.Mui-selected": {
              bgcolor: "var(--accent-soft, #e7f3fb)",
              color: "primary.main",
              fontWeight: 600,
              "&:hover": {
                bgcolor: "var(--accent-soft, #e7f3fb)",
              },
            },
          },
        }}
      >
        {PRESETS.map((p) => (
          <ToggleButton key={p.key} value={p.key}>
            {p.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {value.period === "custom" && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
          <input
            type="date"
            aria-label="From date"
            className="input"
            style={{ width: "auto" }}
            value={value.fromDate}
            max={value.toDate || undefined}
            onChange={(e) => onChange({ ...value, fromDate: e.target.value })}
          />
          <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.85rem" }}>
            to
          </Typography>
          <input
            type="date"
            aria-label="To date"
            className="input"
            style={{ width: "auto" }}
            value={value.toDate}
            min={value.fromDate || undefined}
            onChange={(e) => onChange({ ...value, toDate: e.target.value })}
          />
        </Box>
      )}
    </div>
  );
}
