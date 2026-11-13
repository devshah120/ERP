"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { useAuth } from "@/app/(app)/AuthProvider";
import { apiFetch, ApiError } from "@/lib/api/client";
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
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
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

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  async function switchTo(year: FyOption) {
    setSwitching(year.id);
    try {
      await apiFetch(`/api/financial-years/${year.id}`, { method: "PATCH", body: JSON.stringify({ action: "set-current" }) });
      await refresh();
      toast.success(`Working year is now ${year.label}`);
      handleClose();
    } catch (err) {
      toast.error("Couldn't switch year", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSwitching(null);
    }
  }

  const others = (years ?? []).filter((y) => !y.isCurrent);

  return (
    <div className="menuWrap">
      <button
        type="button"
        className="hdrPill"
        onClick={handleOpen}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Financial year"
      >
        <IconCalendar />
        <span>{fyShort(fy.startDate, fy.endDate)}</span>
        <IconChevronDown className="hdrPillChevron" />
      </button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              minWidth: "17rem",
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              mt: 1,
            },
          },
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="overline" sx={{ color: "text.secondary", fontWeight: 700, fontSize: "0.6875rem" }}>
            Financial year
          </Typography>
        </Box>

        <MenuItem
          selected
          sx={{
            cursor: "default",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            py: 1,
          }}
        >
          <ListItemIcon sx={{ minWidth: 24, color: "primary.main" }}>
            <IconCheck />
          </ListItemIcon>
          <ListItemText
            primary={<Typography variant="body2" sx={{ fontWeight: 600 }}>{fy.label}</Typography>}
            secondary={<Typography variant="caption" color="text.secondary">{`${fmt(fy.startDate)} – ${fmt(fy.endDate)}`}</Typography>}
          />
          <Chip label="Current" size="small" color="primary" sx={{ height: 20, fontSize: "0.6875rem", fontWeight: 600 }} />
        </MenuItem>

        {others.map((y) => (
          <MenuItem
            key={y.id}
            disabled={!canManage || y.status !== "OPEN" || switching !== null}
            title={
              !canManage
                ? "Switching years needs the Financial years · manage permission"
                : y.status !== "OPEN"
                ? "Closed — reopen it in Financial Years first"
                : `Switch to ${y.label}`
            }
            onClick={() => switchTo(y)}
            sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1 }}
          >
            <ListItemIcon sx={{ minWidth: 24, color: "text.secondary" }}>
              {switching === y.id ? <CircularProgress size={16} /> : <IconCalendar />}
            </ListItemIcon>
            <ListItemText
              primary={<Typography variant="body2">{y.label}</Typography>}
              secondary={<Typography variant="caption" color="text.secondary">{`${fmt(y.startDate)} – ${fmt(y.endDate)}`}</Typography>}
            />
            {y.status === "CLOSED" && (
              <Chip label="Closed" size="small" variant="outlined" sx={{ height: 20, fontSize: "0.6875rem" }} />
            )}
          </MenuItem>
        ))}

        <Divider sx={{ my: 0.5 }} />

        <MenuItem component={Link} href="/settings/financial-years" onClick={handleClose}>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <IconCalendar />
          </ListItemIcon>
          <ListItemText primary={<Typography variant="body2">Manage financial years</Typography>} />
        </MenuItem>

        <MenuItem component={Link} href="/settings" onClick={handleClose}>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <IconSettings />
          </ListItemIcon>
          <ListItemText primary={<Typography variant="body2">Workspace settings</Typography>} />
        </MenuItem>
      </Menu>
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
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const toast = useToast();
  const [display, setDisplay] = useState("0");
  const [acc, setAcc] = useState<string | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

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
    <div className="menuWrap">
      <button
        type="button"
        className="hdrIconBtn calcToggle"
        onClick={handleOpen}
        aria-expanded={open}
        aria-label="Calculator"
        title="Calculator"
      >
        <IconCalculator />
      </button>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            elevation: 6,
            sx: {
              width: 250,
              p: 1.5,
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              mt: 1,
            },
          },
        }}
      >
        <Box
          className="calcScreen"
          sx={{
            bgcolor: "var(--surface-subtle, #f8fbfd)",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            p: 1.5,
            mb: 1.5,
            textAlign: "right",
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", minHeight: 16, display: "block", fontFamily: "monospace" }}>
            {acc !== null && op ? `${acc} ${op}` : "\u00A0"}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
            {display}
          </Typography>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 0.75,
          }}
        >
          {keys.map((k) => {
            const isOp = k.kind === "op";
            const isEq = k.kind === "eq";
            const isFn = k.kind === "fn";
            const isActiveOp = isOp && op === k.label && fresh;

            return (
              <ButtonBase
                key={k.label}
                onClick={k.onClick}
                sx={{
                  py: 1,
                  borderRadius: 1.5,
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  fontFamily: "monospace",
                  border: "1px solid",
                  borderColor: isEq ? "primary.main" : "divider",
                  bgcolor: isEq
                    ? "primary.main"
                    : isActiveOp
                    ? "primary.light"
                    : isOp
                    ? "action.selected"
                    : isFn
                    ? "var(--surface-subtle, #f8fbfd)"
                    : "background.paper",
                  color: isEq ? "primary.contrastText" : isActiveOp ? "primary.main" : "text.primary",
                  transition: "all 0.1s ease",
                  "&:hover": {
                    bgcolor: isEq ? "primary.dark" : "action.hover",
                  },
                }}
              >
                {k.label}
              </ButtonBase>
            );
          })}
        </Box>

        <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "text.disabled", mt: 1.5, fontSize: "0.6875rem" }}>
          Type on your keyboard · Enter = · Esc closes
        </Typography>
      </Popover>
    </div>
  );
}
