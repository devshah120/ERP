"use client";

import { useState } from "react";
import IconButton from "@mui/material/IconButton";
import { IconEye, IconEyeOff } from "@/components/icons";

/** Mirrors the server rule in lib/auth/password.ts so the meter never disagrees with the API. */
export function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    digit: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
}

export function passwordMeetsPolicy(pw: string): boolean {
  return Object.values(passwordChecks(pw)).every(Boolean);
}

function score(pw: string): number {
  if (!pw) return 0;
  const c = passwordChecks(pw);
  const met = Object.values(c).filter(Boolean).length;
  if (!c.length) return 1;
  if (met <= 3) return 2;
  if (met === 4) return 3;
  return pw.length >= 12 ? 4 : 3.5;
}

const RULES: { key: keyof ReturnType<typeof passwordChecks>; label: string }[] = [
  { key: "length", label: "8+ characters" },
  { key: "upper", label: "uppercase" },
  { key: "lower", label: "lowercase" },
  { key: "digit", label: "number" },
  { key: "symbol", label: "symbol" },
];

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  showStrength = false,
  error,
  required = true,
  extraLabel,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  showStrength?: boolean;
  error?: string;
  required?: boolean;
  extraLabel?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const s = score(value);
  const checks = passwordChecks(value);
  const missing = RULES.filter((r) => !checks[r.key]).map((r) => r.label);

  return (
    <div className="field">
      <div className="authRowBetween">
        <label htmlFor={id}>{label}</label>
        {extraLabel}
      </div>
      <div className="passwordWrap">
        <input
          id={id}
          className="input"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : showStrength ? `${id}-hint` : undefined}
        />
        <IconButton
          type="button"
          className="passwordToggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
          size="small"
        >
          {visible ? <IconEyeOff /> : <IconEye />}
        </IconButton>
      </div>
      {showStrength && (
        <>
          <div className="strengthMeter" data-score={Math.min(4, Math.floor(s))} aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
          <span id={`${id}-hint`} className="fieldHint">
            {value && missing.length === 0 ? "Strong enough — meets every requirement." : `Needs ${missing.join(", ")}.`}
          </span>
        </>
      )}
      {error && (
        <span id={`${id}-error`} className="fieldError">
          {error}
        </span>
      )}
    </div>
  );
}
