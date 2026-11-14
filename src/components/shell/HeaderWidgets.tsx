"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useAuth } from "@/app/(app)/AuthProvider";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import {
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
