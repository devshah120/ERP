"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { useAuth } from "@/app/(app)/AuthProvider";
import { apiFetch, ApiError } from "@/lib/api/client";
import { usePopover } from "@/components/ui/usePopover";
import { useToast } from "@/components/ui/Toast";
import {
  IconCalculator,
  IconCalendar,
  IconChevronDown,
  IconSettings,
  IconCheck,
} from "@/components/icons";

/* ------------------------------------------------------------------ */
/* Financial year                                                      */
/* ------------------------------------------------------------------ */

function fyShort(start: string, end: string) {
  return `FY ${new Date(start).getFullYear()}–${new Date(end).getFullYear()}`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface FyOption {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
  isCurrent: boolean;
}

/**
 * The working financial year, with every other year listed. Someone with
 * financial-years.manage can switch to another open year straight from here;
 * everyone else sees which years exist.
 */
export function FinancialYearMenu() {
  const { me, hasPermission, refresh } = useAuth();
  const toast = useToast();
  const { open, toggle, close, ref } = usePopover<HTMLDivElement>();
  const [years, setYears] = useState<FyOption[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const canManage = hasPermission("financial-years.manage");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<{ items: FyOption[] }>("/api/financial-years")
      .then((r) => !cancelled && setYears(r.items))
      .catch(() => !cancelled && setYears([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const fy = me?.financialYear;
  if (!fy) return null;

  async function switchTo(year: FyOption) {
    setSwitching(year.id);
    try {
      await apiFetch(`/api/financial-years/${year.id}`, { method: "PATCH", body: JSON.stringify({ action: "set-current" }) });
      await refresh();
      toast.success(`Working year is now ${year.label}`);
      close();
    } catch (err) {
      toast.error("Couldn't switch year", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSwitching(null);
    }
  }

  const others = (years ?? []).filter((y) => !y.isCurrent);

  return (
    <div className="menuWrap" ref={ref}>
      <button type="button" className="hdrPill" onClick={toggle} aria-expanded={open} aria-haspopup="menu" title="Financial year">
        <IconCalendar />
        <span>{fyShort(fy.startDate, fy.endDate)}</span>
        <IconChevronDown className="hdrPillChevron" />
      </button>
      {open && (
        <div className="menu menuLeft" role="menu" style={{ minWidth: "17rem" }}>
          <div className="menuLabel">Financial year</div>
          <div className="menuItem" role="menuitemradio" aria-checked="true" style={{ cursor: "default" }}>
            <IconCheck style={{ color: "var(--accent)" }} />
            <span className="menuItemText">
              {fy.label}
              <small>
                {fmt(fy.startDate)} – {fmt(fy.endDate)}
              </small>
            </span>
            <span className="badge badgeAccent badgePlain">Current</span>
          </div>
          {others.map((y) => (
            <button
              key={y.id}
              type="button"
              className="menuItem"
              role="menuitemradio"
              aria-checked="false"
              disabled={!canManage || y.status !== "OPEN" || switching !== null}
              title={!canManage ? "Switching years needs the Financial years · manage permission" : y.status !== "OPEN" ? "Closed — reopen it in Financial Years first" : `Switch to ${y.label}`}
              onClick={() => switchTo(y)}
            >
              {switching === y.id ? <span className="spinner" /> : <IconCalendar />}
              <span className="menuItemText">
                {y.label}
                <small>
                  {fmt(y.startDate)} – {fmt(y.endDate)}
                </small>
              </span>
              {y.status === "CLOSED" && <span className="badge badgeNeutral badgePlain">Closed</span>}
            </button>
          ))}
          <div className="menuSep" />
          <Link href="/settings/financial-years" className="menuItem" role="menuitem" onClick={close}>
            <IconCalendar />
            Manage financial years
          </Link>
          <Link href="/settings" className="menuItem" role="menuitem" onClick={close}>
            <IconSettings />
            Workspace settings
          </Link>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calculator                                                          */
/* ------------------------------------------------------------------ */

type Op = "+" | "−" | "×" | "÷";

/** Decimal arithmetic, so 0.1 + 0.2 is 0.3 — the same rule the books use. */
function apply(a: string, b: string, op: Op): string {
  const x = new Decimal(a || "0");
  const y = new Decimal(b || "0");
  switch (op) {
    case "+":
      return x.plus(y).toString();
    case "−":
      return x.minus(y).toString();
    case "×":
      return x.times(y).toString();
    case "÷":
      return y.isZero() ? "Error" : x.div(y).toDecimalPlaces(10).toString();
  }
}

/**
 * A quick calculator for the sums people do mid-entry — rate × qty,
 * discount percentages, splitting a receipt. Keyboard works while it's open.
 */
export function CalculatorButton() {
  const { open, toggle, ref } = usePopover<HTMLDivElement>();
  const toast = useToast();
  const [display, setDisplay] = useState("0");
  const [acc, setAcc] = useState<string | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);

  function digit(d: string) {
    if (display === "Error") {
      setDisplay(d === "." ? "0." : d);
      setFresh(false);
      return;
    }
    if (fresh) {
      setDisplay(d === "." ? "0." : d);
      setFresh(false);
      return;
    }
    if (d === "." && display.includes(".")) return;
    setDisplay(display === "0" && d !== "." ? d : display + d);
  }

  function operator(next: Op) {
    if (acc !== null && op && !fresh) {
      const r = apply(acc, display, op);
      setDisplay(r);
      setAcc(r);
    } else {
      setAcc(display);
    }
    setOp(next);
    setFresh(true);
  }

  function equals() {
    if (acc === null || !op) return;
    setDisplay(apply(acc, display, op));
    setAcc(null);
    setOp(null);
    setFresh(true);
  }

  function clear() {
    setDisplay("0");
    setAcc(null);
    setOp(null);
    setFresh(true);
  }

  function back() {
    if (fresh || display === "Error") return;
    setDisplay(display.length > 1 ? display.slice(0, -1) : "0");
  }

  function percent() {
    if (display === "Error") return;
    // With a pending op, "50 + 10%" means 10% of 50 — how tills work.
    const base = acc !== null && op ? new Decimal(acc) : new Decimal(1);
    setDisplay(base.times(new Decimal(display).div(100)).toString());
    setFresh(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key;
      if (/^[0-9.]$/.test(k)) digit(k);
      else if (k === "+") operator("+");
      else if (k === "-") operator("−");
      else if (k === "*") operator("×");
      else if (k === "/") operator("÷");
      else if (k === "Enter" || k === "=") equals();
      else if (k === "Backspace") back();
      else if (k === "Delete" || k.toLowerCase() === "c") clear();
      else if (k === "%") percent();
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(display);
      toast.success("Copied", display);
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access.");
    }
  }

  const keys: { label: string; onClick: () => void; kind?: "op" | "eq" | "fn" }[] = [
    { label: "C", onClick: clear, kind: "fn" },
    { label: "⌫", onClick: back, kind: "fn" },
    { label: "%", onClick: percent, kind: "fn" },
    { label: "÷", onClick: () => operator("÷"), kind: "op" },
    { label: "7", onClick: () => digit("7") },
    { label: "8", onClick: () => digit("8") },
    { label: "9", onClick: () => digit("9") },
    { label: "×", onClick: () => operator("×"), kind: "op" },
    { label: "4", onClick: () => digit("4") },
    { label: "5", onClick: () => digit("5") },
    { label: "6", onClick: () => digit("6") },
    { label: "−", onClick: () => operator("−"), kind: "op" },
    { label: "1", onClick: () => digit("1") },
    { label: "2", onClick: () => digit("2") },
    { label: "3", onClick: () => digit("3") },
    { label: "+", onClick: () => operator("+"), kind: "op" },
    { label: "0", onClick: () => digit("0") },
    { label: ".", onClick: () => digit(".") },
    { label: "Copy", onClick: copy, kind: "fn" },
    { label: "=", onClick: equals, kind: "eq" },
  ];

  return (
    <div className="menuWrap" ref={ref}>
      <button type="button" className="hdrIconBtn calcToggle" onClick={toggle} aria-expanded={open} aria-label="Calculator" title="Calculator">
        <IconCalculator />
      </button>
      {open && (
        <div className="menu calc" role="dialog" aria-label="Calculator">
          <div className="calcScreen" aria-live="polite">
            <small>{acc !== null && op ? `${acc} ${op}` : " "}</small>
            <span>{display}</span>
          </div>
          <div className="calcKeys">
            {keys.map((k) => (
              <button
                key={k.label}
                type="button"
                className={`calcKey ${k.kind ? `calcKey-${k.kind}` : ""} ${k.kind === "op" && op === k.label && fresh ? "calcKeyActive" : ""}`}
                onClick={k.onClick}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="calcHint">Type on your keyboard · Enter = · Esc closes</div>
        </div>
      )}
    </div>
  );
}

