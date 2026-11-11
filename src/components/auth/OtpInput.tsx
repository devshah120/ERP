"use client";

import { useRef } from "react";

/**
 * Six single-digit boxes that behave like one field: typing advances,
 * Backspace steps back, arrow keys move, and pasting a full code fills every
 * box at once (the common case when the code is copied from an email).
 */
export default function OtpInput({
  value,
  onChange,
  onComplete,
  state = "idle",
  disabled = false,
  autoFocus = true,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  state?: "idle" | "error" | "success";
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  function setAt(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    const code = next.join("").slice(0, 6);
    onChange(code);
    if (code.length === 6 && !next.includes("")) onComplete?.(code);
  }

  function focus(i: number) {
    refs.current[Math.max(0, Math.min(5, i))]?.focus();
  }

  return (
    <div className="otpBoxes" data-state={state} role="group" aria-label="6-digit verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="otpBox"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1}`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            if (!raw) {
              setAt(i, "");
              return;
            }
            if (raw.length > 1) {
              // Autofill or a fast typist: spread across the boxes.
              const code = (digits.slice(0, i).join("") + raw).slice(0, 6);
              onChange(code);
              focus(code.length);
              if (code.length === 6) onComplete?.(code);
              return;
            }
            setAt(i, raw);
            if (i < 5) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) {
              e.preventDefault();
              setAt(i - 1, "");
              focus(i - 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              focus(i - 1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              focus(i + 1);
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (!pasted) return;
            e.preventDefault();
            onChange(pasted);
            focus(pasted.length);
            if (pasted.length === 6) onComplete?.(pasted);
          }}
        />
      ))}
    </div>
  );
}
